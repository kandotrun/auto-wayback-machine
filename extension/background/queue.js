import { getState, mutateState } from "../shared/storage.js";
import { normalise, shouldSkip } from "../shared/url.js";
import { selectOutlinks } from "../shared/outlinks.js";
import { aiDisposition, checkWithAi, AI_RETRY_MS, AI_MAX_ATTEMPTS, aiMode, aiAvailable } from "../shared/ai-check.js";
import { isDuplicate, pruneMap } from "./history.js";
import { saveOne } from "./wayback.js";

let processing = null;
let lastSentAt = 0;

function allowedUrl(raw, settings) {
  const url = normalise(raw, settings);
  return url && !shouldSkip(url, settings) ? url : null;
}
const sameItem = (a, b) => a.url === b.url && a.queuedAt === b.queuedAt;
const aiConfig = (settings) => JSON.stringify([
  aiMode(settings), settings.aiCheckEndpoint, settings.aiCheckModel,
]);

export async function enqueue(rawUrl, title = "", manual = false) {
  let response = { ok: true };
  let shouldProcess = false;
  await mutateState(({ settings, queue, savedMap, stats }) => {
    if (!manual && !settings.enabled) return;
    const url = normalise(rawUrl, settings);
    const reason = url ? shouldSkip(url, settings) : "unsupported URL";
    if (reason) {
      response = { ok: false, reason };
      if (url && !manual) return { stats: { ...stats, skipped: stats.skipped + 1 } };
      return;
    }
    const pending = queue.find((item) => item.url === url.href);
    if (pending) {
      shouldProcess = true;
      if (title) pending.title = title;
      return { queue };
    }
    if (!manual && isDuplicate(url.href, savedMap, queue, settings.dedupeHours)) return;
    shouldProcess = true;
    const item = { url: url.href, title, queuedAt: Date.now(), tries: 0 };
    if (manual) queue.unshift(item);
    else queue.push(item);
    return { queue };
  });
  if (shouldProcess) void processQueue();
  return response;
}

export async function attachPageTitle(rawUrl, title) {
  await mutateState(({ settings, queue }) => {
    const url = allowedUrl(rawUrl, settings);
    if (!url || !title) return;
    const pending = queue.find((item) => item.url === url.href);
    if (!pending) return;
    pending.title = title;
    return { queue };
  });
}

export async function enqueueOutlinks(sourceUrl, links) {
  await mutateState(({ settings, queue, savedMap }) => {
    const urls = selectOutlinks(sourceUrl, links, settings, savedMap, queue);
    if (!urls.length) return;
    queue.push(...urls.map((url) => ({ url, title: "", queuedAt: Date.now(), tries: 0 })));
    return { queue };
  });
  void processQueue();
}

async function removeItem(item, status, category) {
  await mutateState(({ queue, log, stats }) => {
    if (!queue.some((q) => sameItem(q, item))) return;
    // Holds intentionally have no URL, title or model-authored reason.
    log.unshift({ at: Date.now(), status, category });
    return {
      queue: queue.filter((q) => !sameItem(q, item)),
      log: log.slice(0, 200),
      stats: { ...stats, skipped: stats.skipped + 1 },
    };
  });
}

export function processQueue() {
  if (!processing) {
    processing = drainQueue().finally(() => { processing = null; });
  }
  return processing;
}

async function drainQueue() {
  const deferred = new Set();
  try {
    while (true) {
      const state = await getState();
      const { settings } = state;
      if (!settings.enabled || state.backoffUntil > Date.now()) break;
      // Deferred AI failures do not block the remaining queue.
      let item = state.queue.find((q) => !deferred.has(q.url)
        && (aiMode(settings) !== "on" || !q.aiRetryAt || q.aiRetryAt <= Date.now()));
      if (!item) break;

      const wait = lastSentAt + settings.minIntervalSec * 1000 - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      let fresh = await getState();
      if (!fresh.settings.enabled || fresh.backoffUntil > Date.now()) break;
      item = fresh.queue.find((q) => sameItem(q, item));
      if (!item) continue;
      if (!allowedUrl(item.url, fresh.settings)) {
        await removeItem(item, "skipped-rule", "rule");
        continue;
      }

      let approvedConfig = null;
      let approvedTitle = null;
      const mode = aiMode(fresh.settings);
      const useAi = mode === "on" || (mode === "auto" && await aiAvailable(fresh.settings));
      // Probe results can become stale if settings change while awaiting the endpoint.
      const plannedConfig = aiConfig(fresh.settings);
      const afterProbe = await getState();
      if (plannedConfig !== aiConfig(afterProbe.settings)) continue;
      if (!afterProbe.settings.enabled) break;
      fresh = afterProbe;
      item = fresh.queue.find((q) => sameItem(q, item));
      if (!item) continue;
      if (!allowedUrl(item.url, fresh.settings)) {
        await removeItem(item, "skipped-rule", "rule");
        continue;
      }
      if (useAi && item.aiRetryAt > Date.now()) {
        deferred.add(item.url);
        continue;
      }
      if (useAi) {
        if ((item.aiTries || 0) >= AI_MAX_ATTEMPTS) {
          await removeItem(item, "held-ai-unavailable", "unavailable");
          continue;
        }
        const checkedSettings = fresh.settings;
        // Persist the attempt before fetch so worker termination cannot reset the cap.
        await mutateState(({ queue }) => {
          const pending = queue.find((q) => sameItem(q, item));
          if (!pending) return;
          pending.aiTries = (item.aiTries || 0) + 1;
          pending.aiRetryAt = Date.now() + AI_RETRY_MS;
          return { queue };
        });
        chrome.alarms.create("retryAi", { delayInMinutes: 1 });
        const result = await checkWithAi(item, checkedSettings);
        fresh = await getState();
        const pending = fresh.queue.find((q) => sameItem(q, item));
        if (!pending) continue;
        if ((pending.title || "") !== (item.title || "")) continue;
        if (!fresh.settings.enabled) break;
        // A setting change invalidates the decision; re-evaluate before any send.
        if (aiConfig(checkedSettings) !== aiConfig(fresh.settings)) continue;
        if (!allowedUrl(item.url, fresh.settings)) {
          await removeItem(item, "skipped-rule", "rule");
          continue;
        }
        const disposition = aiDisposition(result, item.aiTries || 0);
        if (disposition.action === "hold") {
          await removeItem(item, disposition.status, disposition.category);
          continue;
        }
        if (disposition.action === "retry") {
          await mutateState(({ queue }) => {
            const pending = queue.find((q) => sameItem(q, item));
            if (!pending) return;
            pending.aiTries = disposition.attempts;
            pending.aiRetryAt = Date.now() + AI_RETRY_MS;
            return { queue };
          });
          chrome.alarms.create("retryAi", { delayInMinutes: 1 });
          continue;
        }
        approvedConfig = aiConfig(checkedSettings);
        approvedTitle = item.title || "";
      }

      // A successful AI decision is not cached for later Wayback retries.
      let maySend = false;
      await mutateState(({ queue, settings }) => {
        const pending = queue.find((q) => sameItem(q, item));
        if (!pending || !settings.enabled || !allowedUrl(item.url, settings)) return;
        if (plannedConfig !== aiConfig(settings)) return;
        if (useAi && (approvedConfig !== aiConfig(settings)
            || approvedTitle !== (pending.title || ""))) return;
        maySend = true;
        delete pending.aiTries;
        delete pending.aiRetryAt;
        return { queue };
      });
      if (!maySend) continue;
      lastSentAt = Date.now();
      try {
        const { status } = await saveOne(item.url);
        if (status === 429 || status === 503) {
          await mutateState(({ queue }) => {
            const pending = queue.find((q) => sameItem(q, item));
            if (pending) pending.tries++;
            return { queue, backoffUntil: Date.now() + 5 * 60_000 };
          });
          chrome.alarms.create("retryQueue", { delayInMinutes: 5 });
          break;
        }
        if (status < 200 || status >= 400) throw new Error("HTTP " + status);
        await mutateState(({ queue, savedMap, log, stats }) => {
          if (!queue.some((q) => sameItem(q, item))) return;
          savedMap[item.url] = Date.now();
          log.unshift({ url: item.url, at: Date.now(), status: "submitted" });
          return {
            queue: queue.filter((q) => !sameItem(q, item)),
            savedMap: pruneMap(savedMap), log: log.slice(0, 200),
            stats: { ...stats, submitted: stats.submitted + 1 },
          };
        });
      } catch (error) {
        await mutateState(({ queue, log, stats }) => {
          const pending = queue.find((q) => sameItem(q, item));
          if (!pending) return;
          pending.tries++;
          if (pending.tries < 3) return { queue };
          log.unshift({ url: item.url, at: Date.now(), status: "failed: " + String(error.message || error) });
          return {
            queue: queue.filter((q) => !sameItem(q, item)),
            log: log.slice(0, 200), stats: { ...stats, failed: stats.failed + 1 },
          };
        });
      }
    }
  } finally {
    const { queue } = await getState();
    chrome.action.setBadgeText({ text: queue.length > 0 ? String(queue.length) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#2b6cb0" });
  }
}
