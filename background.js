// Wayback Auto Archiver — background service worker (MV3)
// Visited pages -> queue -> throttled Save Page Now requests.

const DEFAULT_SETTINGS = {
  enabled: true,
  dedupeHours: 24,          // same URL is not re-saved within this window
  minIntervalSec: 8,        // Wayback limit is ~15 saves/min; stay well under it
  stripTracking: true,      // remove utm_*, fbclid, gclid... before saving / dedupe
  skipSensitiveQuery: true, // skip URLs whose query has token/session/auth/password etc.
  excludeHosts: [
    "localhost",
    "127.0.0.1",
    "web.archive.org",
    "archive.org",
    "accounts.google.com",
    "mail.google.com",
  ],
  excludePatterns: [], // substrings matched against the full URL
};

const SENSITIVE_PARAMS = [
  "token", "access_token", "refresh_token", "id_token", "session", "sessionid",
  "auth", "password", "passwd", "otp", "code", "api_key", "apikey", "secret",
  "signature", "sig",
];
const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "msclkid", "mc_eid", "igshid", "_ga",
]);

let processing = false;
let lastSentAt = 0;

// ---------- storage helpers ----------
async function getState() {
  const s = await chrome.storage.local.get([
    "settings", "queue", "savedMap", "log", "stats",
  ]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
    queue: s.queue || [],
    savedMap: s.savedMap || {},
    log: s.log || [],
    stats: s.stats || { submitted: 0, skipped: 0, failed: 0 },
  };
}
async function setState(patch) {
  await chrome.storage.local.set(patch);
}

// ---------- URL filtering / normalising ----------
function isPrivateHost(host) {
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const m = host.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (host === "::1" || host.startsWith("[")) return true;
  return false;
}

function hostExcluded(host, list) {
  return list.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (p.startsWith("*.")) return host === p.slice(2) || host.endsWith(p.slice(1));
    return host === p || host.endsWith("." + p);
  });
}

function normalise(rawUrl, settings) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  if (u.username || u.password) return null; // never send credential-embedded URLs
  if (settings.stripTracking) {
    for (const k of [...u.searchParams.keys()]) {
      if (k.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(k.toLowerCase())) {
        u.searchParams.delete(k);
      }
    }
  }
  return u;
}

function shouldSkip(u, settings) {
  const host = u.hostname.toLowerCase();
  if (isPrivateHost(host)) return "private-host";
  if (hostExcluded(host, settings.excludeHosts)) return "excluded-host";
  if (settings.excludePatterns.some((p) => p && u.href.includes(p))) return "excluded-pattern";
  if (settings.skipSensitiveQuery) {
    for (const k of u.searchParams.keys()) {
      if (SENSITIVE_PARAMS.includes(k.toLowerCase())) return "sensitive-query";
    }
  }
  return null;
}

// ---------- queue ----------
// Serialise enqueues so rapid navigations cannot race on storage read/write.
let enqueueChain = Promise.resolve();
function enqueue(rawUrl) {
  enqueueChain = enqueueChain.then(() => enqueueInner(rawUrl)).catch(() => {});
  return enqueueChain;
}

async function enqueueInner(rawUrl) {
  const { settings, queue, savedMap, stats } = await getState();
  if (!settings.enabled) return;

  const u = normalise(rawUrl, settings);
  if (!u) return;
  const reason = shouldSkip(u, settings);
  const url = u.href;

  if (reason) {
    stats.skipped++;
    await setState({ stats });
    return;
  }
  const last = savedMap[url];
  if (last && Date.now() - last < settings.dedupeHours * 3600_000) return;
  if (queue.some((q) => q.url === url)) return;

  queue.push({ url, queuedAt: Date.now(), tries: 0 });
  await setState({ queue });
  processQueue();
}

async function saveOne(url) {
  // Save Page Now: GET /save/<url> starts the capture and redirects to the snapshot.
  // We only need the response headers — cancelling the body keeps this cheap.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch("https://web.archive.org/save/" + url, {
      method: "GET",
      signal: controller.signal,
      credentials: "omit",
    });
    try { await res.body?.cancel(); } catch {}
    return { status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (true) {
      let { settings, queue, savedMap, log, stats } = await getState();
      if (!settings.enabled || queue.length === 0) break;

      const wait = lastSentAt + settings.minIntervalSec * 1000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));

      const item = queue[0];
      lastSentAt = Date.now();
      try {
        const { status } = await saveOne(item.url);
        if (status === 429 || status === 503) {
          // Rate limited / Wayback busy: keep the item, back off 5 minutes.
          item.tries++;
          await setState({ queue });
          chrome.alarms.create("retryQueue", { delayInMinutes: 5 });
          break;
        }
        if (status >= 200 && status < 400) {
          // Re-read fresh state before writing, so a navigation that was
          // enqueued while this save was in flight is not overwritten.
          const fresh = await getState();
          queue = fresh.queue.filter((q) => q.url !== item.url);
          savedMap = fresh.savedMap;
          log = fresh.log;
          stats = fresh.stats;
          savedMap[item.url] = Date.now();
          stats.submitted++;
          log.unshift({ url: item.url, at: Date.now(), status: "submitted" });
        } else {
          throw new Error("HTTP " + status);
        }
      } catch (e) {
        item.tries++;
        if (item.tries >= 3) {
          const fresh = await getState();
          queue = fresh.queue.filter((q) => q.url !== item.url);
          log = fresh.log;
          stats = fresh.stats;
          stats.failed++;
          log.unshift({ url: item.url, at: Date.now(), status: "failed: " + String(e.message || e) });
        }
      }
      await setState({
        queue,
        savedMap: pruneMap(savedMap),
        log: log.slice(0, 200),
        stats,
      });
      updateBadge(queue.length);
    }
  } finally {
    processing = false;
  }
}

function pruneMap(map) {
  // Keep at most 5000 entries / 30 days so storage does not grow forever.
  const cutoff = Date.now() - 30 * 24 * 3600_000;
  const entries = Object.entries(map).filter(([, t]) => t > cutoff);
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, 5000));
}

function updateBadge(n) {
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#2b6cb0" });
}

// ---------- events ----------
chrome.webNavigation.onCompleted.addListener((d) => {
  if (d.frameId === 0) enqueue(d.url);
});
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  if (d.frameId === 0) enqueue(d.url); // SPA navigations
});

chrome.alarms.onAlarm.addListener(() => processQueue());
chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await getState();
  await setState({ settings });
  chrome.alarms.create("retryQueue", { periodInMinutes: 1 });
  processQueue();
});
chrome.runtime.onStartup.addListener(() => processQueue());

// Manual save from the popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "saveNow" && msg.url) {
    (async () => {
      // Bypass dedupe for an explicit click, but never the safety filters.
      const { settings } = await getState();
      const u = normalise(msg.url, settings);
      if (!u) return sendResponse({ ok: false, reason: "unsupported URL" });
      const reason = shouldSkip(u, settings);
      if (reason) return sendResponse({ ok: false, reason });
      const { queue } = await getState();
      if (!queue.some((q) => q.url === u.href)) {
        queue.unshift({ url: u.href, queuedAt: Date.now(), tries: 0 });
        await setState({ queue });
      }
      processQueue();
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg?.type === "processQueue") processQueue();
});
