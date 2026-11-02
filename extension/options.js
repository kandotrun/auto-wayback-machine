import { aiEndpoint, aiMode } from "./shared/ai-check.js";
import { DEFAULT_SETTINGS } from "./shared/settings.js";
import { outlinksLimit } from "./shared/outlinks.js";
import { getSettings, updateSettings, setState, requestProcessing } from "./shared/storage.js";

const $ = (id) => document.getElementById(id);
const lines = (v) => v.split("\n").map((s) => s.trim()).filter(Boolean);

async function load() {
  const st = await getSettings();
  $("aiCheckMode").value = aiMode(st);
  $("aiCheckEndpoint").value = st.aiCheckEndpoint ?? DEFAULT_SETTINGS.aiCheckEndpoint;
  $("aiCheckModel").value = st.aiCheckModel ?? DEFAULT_SETTINGS.aiCheckModel;
  $("captureOutlinks").checked = st.captureOutlinks === true;
  $("outlinksSameDomainOnly").checked = st.outlinksSameDomainOnly !== false;
  $("outlinksMaxPerPage").value = st.outlinksMaxPerPage ?? 30;
  $("dedupeHours").value = st.dedupeHours ?? 24;
  $("minIntervalSec").value = st.minIntervalSec ?? 8;
  $("stripTracking").checked = st.stripTracking !== false;
  $("skipSensitiveQuery").checked = st.skipSensitiveQuery !== false;
  $("excludeHosts").value = (st.excludeHosts || []).join("\n");
  $("excludePatterns").value = (st.excludePatterns || []).join("\n");
}

$("save").addEventListener("click", async () => {
  const aiCheckMode = $("aiCheckMode").value;
  const aiCheckEndpoint = $("aiCheckEndpoint").value.trim();
  const aiCheckModel = $("aiCheckModel").value.trim();
  if (aiCheckMode !== "off") {
    try {
      const endpoint = aiEndpoint(aiCheckEndpoint);
      if (!aiCheckModel) throw new Error("model");
      // Called directly in the click handler to preserve the user gesture.
      const granted = await chrome.permissions.request({ origins: [endpoint.origin + "/*"] });
      if (!granted) {
        $("saved").textContent = "接続先へのアクセス権限が許可されなかったため保存しませんでした";
        return;
      }
    } catch {
      $("saved").textContent = "エンドポイント（HTTP/HTTPS）とモデル名を確認してください";
      return;
    }
  }
  const settings = {
    aiCheckMode, aiCheckEndpoint, aiCheckModel,
    captureOutlinks: $("captureOutlinks").checked,
    outlinksSameDomainOnly: $("outlinksSameDomainOnly").checked,
    outlinksMaxPerPage: outlinksLimit($("outlinksMaxPerPage").value),
    dedupeHours: Math.max(0, Number($("dedupeHours").value) || 0),
    minIntervalSec: Math.min(120, Math.max(4, Number($("minIntervalSec").value) || 8)),
    stripTracking: $("stripTracking").checked,
    skipSensitiveQuery: $("skipSensitiveQuery").checked,
    excludeHosts: lines($("excludeHosts").value),
    excludePatterns: lines($("excludePatterns").value),
  };
  await updateSettings(settings);
  requestProcessing();
  $("saved").textContent = "保存しました";
  setTimeout(() => ($("saved").textContent = ""), 2000);
});

$("clear").addEventListener("click", async () => {
  await setState({
    savedMap: {}, log: [], queue: [], backoffUntil: 0,
    stats: { submitted: 0, skipped: 0, failed: 0 },
  });
  $("saved").textContent = "クリアしました";
});

load();
