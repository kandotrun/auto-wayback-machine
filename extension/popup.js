import { updateSettings, getState, requestProcessing } from "./shared/storage.js";

async function render() {
  const s = await getState();
  const settings = s.settings || {};
  document.getElementById("enabled").checked = settings.enabled !== false;
  document.getElementById("submitted").textContent = s.stats?.submitted ?? 0;
  document.getElementById("skipped").textContent = s.stats?.skipped ?? 0;
  document.getElementById("failed").textContent = s.stats?.failed ?? 0;
  document.getElementById("queued").textContent = (s.queue || []).length;
  const ul = document.getElementById("log");
  ul.innerHTML = "";
  for (const item of (s.log || []).slice(0, 12)) {
    const li = document.createElement("li");
    const t = new Date(item.at).toLocaleTimeString("ja-JP");
    li.innerHTML = `<span class="time">${t}</span>`;
    if (!item.url) {
      const status = document.createElement("span");
      const statuses = {
        "held-ai-unsafe": "保留：AI が安全でないと判定",
        "held-ai-uncertain": "保留：AI が安全と判断できない",
        "held-ai-unavailable": "保留：AI 判定に失敗",
        "skipped-rule": "除外：送信前のルール判定",
      };
      const categories = {
        credentials: "認証情報", personal_data: "個人情報", private_document: "非公開文書",
        financial: "金融", medical: "医療", internal_system: "社内システム",
        unknown: "不明", unavailable: "接続・判定不能", invalid_response: "応答形式",
        invalid_input: "入力・設定", rule: "除外ルール",
      };
      status.textContent = (statuses[item.status] || "保留") + " / " + (categories[item.category] || "不明");
      li.appendChild(status);
      ul.appendChild(li);
      continue;
    }
    const a = document.createElement("a");
    a.href = "https://web.archive.org/web/*/" + item.url;
    a.target = "_blank";
    a.textContent = item.url;
    a.title = item.status + " — クリックで保存履歴を開く";
    li.appendChild(a);
    ul.appendChild(li);
  }
}

document.getElementById("enabled").addEventListener("change", async (e) => {
  await updateSettings({ enabled: e.target.checked });
  requestProcessing();
  render();
});

document.getElementById("saveNow").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const msg = document.getElementById("msg");
  if (!tab?.url) { msg.textContent = "URLを取得できませんでした"; return; }
  const res = await chrome.runtime.sendMessage({ type: "saveNow", url: tab.url, title: tab.title || "" });
  msg.textContent = res?.ok ? "キューに入れました" : "スキップしました: " + (res?.reason || "");
  setTimeout(render, 500);
});

document.getElementById("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
render();
