import { getState, setState } from "../shared/storage.js";
import { normalise, shouldSkip } from "../shared/url.js";
import { isDuplicate, pruneMap } from "./history.js";
import { saveOne } from "./wayback.js";

let processing = false;
let lastSentAt = 0;

// ---------- queue ----------
// Serialise enqueues so rapid navigations cannot race on storage read/write.
let enqueueChain = Promise.resolve();
export function enqueue(rawUrl) {
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
  if (isDuplicate(url, savedMap, queue, settings.dedupeHours)) return;

  queue.push({ url, queuedAt: Date.now(), tries: 0 });
  await setState({ queue });
  processQueue();
}

export async function processQueue() {
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

function updateBadge(n) {
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#2b6cb0" });
}

