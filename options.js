const $ = (id) => document.getElementById(id);
const lines = (v) => v.split("\n").map((s) => s.trim()).filter(Boolean);

async function load() {
  const s = await chrome.storage.local.get(["settings"]);
  const st = s.settings || {};
  $("dedupeHours").value = st.dedupeHours ?? 24;
  $("minIntervalSec").value = st.minIntervalSec ?? 8;
  $("stripTracking").checked = st.stripTracking !== false;
  $("skipSensitiveQuery").checked = st.skipSensitiveQuery !== false;
  $("excludeHosts").value = (st.excludeHosts || []).join("\n");
  $("excludePatterns").value = (st.excludePatterns || []).join("\n");
}

$("save").addEventListener("click", async () => {
  const s = await chrome.storage.local.get(["settings"]);
  const settings = {
    ...(s.settings || {}),
    dedupeHours: Math.max(0, Number($("dedupeHours").value) || 0),
    minIntervalSec: Math.min(120, Math.max(4, Number($("minIntervalSec").value) || 8)),
    stripTracking: $("stripTracking").checked,
    skipSensitiveQuery: $("skipSensitiveQuery").checked,
    excludeHosts: lines($("excludeHosts").value),
    excludePatterns: lines($("excludePatterns").value),
  };
  await chrome.storage.local.set({ settings });
  chrome.runtime.sendMessage({ type: "processQueue" });
  $("saved").textContent = "保存しました";
  setTimeout(() => ($("saved").textContent = ""), 2000);
});

$("clear").addEventListener("click", async () => {
  await chrome.storage.local.set({
    savedMap: {}, log: [], queue: [],
    stats: { submitted: 0, skipped: 0, failed: 0 },
  });
  $("saved").textContent = "クリアしました";
});

load();
