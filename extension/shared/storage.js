import { DEFAULT_SETTINGS } from "./settings.js";

export async function getState() {
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
export async function setState(patch) {
  await chrome.storage.local.set(patch);
}

// UI reads raw settings to preserve the initial screen fallback behavior.
export async function getSettings() {
  const { settings } = await chrome.storage.local.get(["settings"]);
  return settings || {};
}

export async function updateSettings(patch) {
  const settings = { ...await getSettings(), ...patch };
  await setState({ settings });
  return settings;
}

export function requestProcessing() {
  return chrome.runtime.sendMessage({ type: "processQueue" });
}

// Serialize worker-side read/modify/write operations; never hold this across fetch.
let mutationChain = Promise.resolve();
export function mutateState(transform) {
  const operation = mutationChain.then(async () => {
    const patch = transform(await getState());
    if (patch) await setState(patch);
  });
  mutationChain = operation.catch(() => {});
  return operation;
}
