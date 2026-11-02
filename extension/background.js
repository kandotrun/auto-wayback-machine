// Register MV3 listeners synchronously at module evaluation.
import { getState, setState } from "./shared/storage.js";
import { normalise, shouldSkip } from "./shared/url.js";
import { enqueue, enqueueOutlinks, processQueue } from "./background/queue.js";

import { canCollectOutlinks } from "./shared/outlinks.js";

// Trust the browser's top-frame sender URL, never a page-supplied source alone.
function sourceFromMessage(msg, sender) {
  if (sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) return null;
  return typeof sender.url === "string" && sender.url === msg.sourceUrl ? sender.url : null;
}

async function enqueueNavigation(details) {
  if (details.frameId !== 0) return;
  let title = "";
  try {
    const tab = await chrome.tabs.get(details.tabId);
    if (tab.url === details.url) title = tab.title || "";
  } catch {}
  return enqueue(details.url, title);
}

// ---------- events ----------
chrome.webNavigation.onCompleted.addListener((d) => {
  enqueueNavigation(d);
});
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  enqueueNavigation(d); // SPA navigations
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
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "pageReady" || msg?.type === "outlinks") {
    (async () => {
      const source = sourceFromMessage(msg, sender);
      if (!source) return sendResponse({ collectOutlinks: false });
      const { settings } = await getState();
      if (msg.type === "pageReady") {
        // Also provide the visited page title when link capture is off.
        await enqueue(source, typeof msg.title === "string" ? msg.title : "");
        return sendResponse({ collectOutlinks: canCollectOutlinks(source, settings) });
      }
      await enqueueOutlinks(source, msg.links);
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }
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
        queue.unshift({ url: u.href, title: typeof msg.title === "string" ? msg.title : "", queuedAt: Date.now(), tries: 0 });
        await setState({ queue });
      }
      processQueue();
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg?.type === "processQueue") processQueue();
});
