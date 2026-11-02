// Register MV3 listeners synchronously at module evaluation.
import { getState, setState } from "./shared/storage.js";
import { normalise, shouldSkip } from "./shared/url.js";
import { enqueue, processQueue } from "./background/queue.js";

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
