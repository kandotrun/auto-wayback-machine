import test from "node:test";
import assert from "node:assert/strict";

test("settings defaults, AI endpoint permission denial/grant and persisted opt-ins", async (t) => {
  const elements = new Map();
  globalThis.document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      value: "", checked: false, textContent: "",
      addEventListener(event, handler) { this[event] = handler; },
    });
    return elements.get(id);
  } };
  const $ = (id) => document.getElementById(id);
  let state = { settings: { enabled: false, existing: "keep" } };
  let granted = false;
  const origins = [];
  globalThis.chrome = {
    storage: { local: {
      async get() { return structuredClone(state); },
      async set(patch) { Object.assign(state, structuredClone(patch)); },
    } },
    permissions: { async request(request) { origins.push(request); return granted; } },
    runtime: { sendMessage() {} },
  };
  t.mock.method(globalThis, "setTimeout", () => 1);
  t.after(() => {
    delete globalThis.chrome;
    delete globalThis.document;
  });
  await import("../extension/options.js");
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal($("captureOutlinks").checked, false);
  assert.equal($("outlinksSameDomainOnly").checked, true);
  assert.equal($("outlinksMaxPerPage").value, 30);
  assert.equal($("aiCheckEnabled").checked, false);
  assert.equal($("aiCheckEndpoint").value, "http://127.0.0.1:11434");
  assert.equal($("aiCheckModel").value, "qwen3.8:27b-mlx");

  $("aiCheckEnabled").checked = true;
  $("captureOutlinks").checked = true;
  $("outlinksMaxPerPage").value = "2";
  await $("save").click();
  assert.equal(state.settings.aiCheckEnabled, undefined);
  assert.match($("saved").textContent, /許可されなかった/);
  assert.deepEqual(origins[0], { origins: ["http://127.0.0.1:11434/*"] });

  granted = true;
  await $("save").click();
  assert.equal(state.settings.aiCheckEnabled, true);
  assert.equal(state.settings.captureOutlinks, true);
  assert.equal(state.settings.outlinksMaxPerPage, 2);
  assert.equal(state.settings.enabled, false);
  assert.equal(state.settings.existing, "keep");

  $("aiCheckEndpoint").value = "https://user:secret@example.com";
  const before = JSON.stringify(state);
  await $("save").click();
  assert.equal(JSON.stringify(state), before);
  assert.equal(origins.length, 2); // Invalid endpoint never requests permission.
  assert.match($("saved").textContent, /確認してください/);

  $("aiCheckEnabled").checked = false;
  await $("save").click();
  assert.equal(state.settings.aiCheckEnabled, false);
  assert.equal(origins.length, 2);
});
