import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../extension/shared/settings.js";

test("AI gate applies to manual and automatic sends, fails closed without blocking other URLs", async (t) => {
  let now = 200_000_000;
  let state = { settings: { ...DEFAULT_SETTINGS, aiCheckEnabled: true } };
  const listeners = {};
  const requests = [];
  const alarms = [];
  let archiveStatus = 200;
  let aiHandler = async () => ({ done: true, message: { content: '{"status":"safe","category":"none"}' } });
  const event = (name) => ({ addListener(fn) { listeners[name] = fn; } });
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "setTimeout", (fn, ms) => {
    if (ms !== 20_000 && ms !== 120_000) {
      now += ms;
      queueMicrotask(fn);
    }
    return 1;
  });
  t.mock.method(globalThis, "clearTimeout", () => {});
  globalThis.chrome = {
    storage: { local: {
      async get(keys) {
        return structuredClone(Object.fromEntries(keys.filter((k) => k in state).map((k) => [k, state[k]])));
      },
      async set(patch) { Object.assign(state, structuredClone(patch)); },
    } },
    webNavigation: { onCompleted: event("completed"), onHistoryStateUpdated: event("history") },
    alarms: { onAlarm: event("alarm"), create(...args) { alarms.push(args); } },
    runtime: { onInstalled: event("installed"), onStartup: event("startup"), onMessage: event("message") },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    tabs: { async get() { return { url: "https://example.com/visited", title: "Visited title" }; } },
  };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    if (url.includes("/api/chat")) return { ok: true, json: () => aiHandler(JSON.parse(options.body)) };
    return { status: archiveStatus, body: { async cancel() {} } };
  });
  t.after(() => { delete globalThis.chrome; });
  await import("../extension/background.js");
  const { enqueue, processQueue } = await import("../extension/background/queue.js");
  const aiRequests = () => requests.filter((r) => r.url.includes("/api/chat"));
  const saves = () => requests.filter((r) => r.url.startsWith("https://web.archive.org/save/"));
  const reset = () => {
    state = { settings: { ...DEFAULT_SETTINGS, aiCheckEnabled: true } };
    requests.length = 0;
  };
  const message = (msg, sender = {}) => new Promise((resolve) => {
    assert.equal(listeners.message(msg, sender, resolve), true);
  });
  // Already queued URLs must also pass rules before any AI network request.
  state.queue = [{ url: "https://example.com?token=PRIVATE", queuedAt: now, tries: 0 }];
  await processQueue();
  assert.equal(requests.length, 0);
  assert.equal(state.queue.length, 0);

  for (const status of ["unsafe", "uncertain"]) {
    reset();
    aiHandler = async () => ({ done: true, message: {
      content: JSON.stringify({ status, category: "personal_data", reason: "PRIVATE" }),
    } });
    assert.deepEqual(await message({ type: "saveNow", url: "https://example.com/manual", title: "PRIVATE title" }), { ok: true });
    await processQueue();
    assert.equal(aiRequests().length, 1);
    assert.equal(saves().length, 0);
    assert.equal(state.queue.length, 0);
    assert.deepEqual(Object.keys(state.log[0]).sort(), ["at", "category", "status"]);
    assert.equal(state.log[0].status, "held-ai-" + status);
    assert.ok(!JSON.stringify(state.log).includes("PRIVATE"));
    assert.equal(state.savedMap, undefined);
  }

  reset();
  aiHandler = async (body) => {
    const data = JSON.parse(body.messages[1].content);
    if (data.url.endsWith("/bad")) throw new Error("PRIVATE error");
    return { done: true, message: { content: '{"status":"safe","category":"none"}' } };
  };
  state.queue = [
    { url: "https://example.com/bad", title: "Bad title", queuedAt: now, tries: 0 },
    { url: "https://example.com/good", title: "Public title", queuedAt: now, tries: 0 },
  ];
  await processQueue();
  assert.equal(saves().length, 1);
  assert.ok(saves()[0].url.endsWith("/good"));
  assert.equal(state.queue[0].aiTries, 1);
  assert.ok(state.queue[0].aiRetryAt > now);
  const persisted = structuredClone(state.queue);
  await processQueue();
  assert.equal(aiRequests().length, 2); // deferred item is not retried early
  state.queue = persisted;
  now += 60_000;
  await processQueue();
  assert.equal(state.queue[0].aiTries, 2);
  now += 60_000;
  await processQueue();
  assert.equal(state.queue.length, 0);
  assert.equal(state.log[0].status, "held-ai-unavailable");
  assert.equal(aiRequests().filter((r) => r.options.body.includes("/bad")).length, 3);
  assert.equal(saves().length, 1);
  assert.ok(!JSON.stringify(state.log).includes("PRIVATE"));
  assert.ok(alarms.some(([name]) => name === "retryAi"));

  reset();
  state.queue = [{ url: "https://example.com/interrupted", title: "Title", queuedAt: now,
    tries: 0, aiTries: 3, aiRetryAt: now - 1 }];
  await processQueue();
  assert.equal(requests.length, 0);
  assert.equal(state.queue.length, 0);
  assert.equal(state.log[0].status, "held-ai-unavailable");

  reset();
  state.settings.aiCheckEnabled = false;
  await enqueue("https://example.com/off", "Title");
  await processQueue();
  assert.equal(aiRequests().length, 0);
  assert.equal(saves().length, 1);

  reset();
  aiHandler = async () => {
    state.settings.excludeHosts = ["example.com"];
    return { done: true, message: { content: '{"status":"safe","category":"none"}' } };
  };
  await enqueue("https://example.com/settings-change", "Title");
  await processQueue();
  assert.equal(saves().length, 0);
  assert.equal(state.log[0].status, "skipped-rule");

  reset();
  aiHandler = async () => {
    state.queue = []; // Clear while AI is in flight must prevent the save.
    return { done: true, message: { content: '{"status":"safe","category":"none"}' } };
  };
  await enqueue("https://example.com/cleared", "Title");
  await processQueue();
  assert.equal(saves().length, 0);

  reset();
  aiHandler = async () => {
    state.settings.enabled = false;
    return { done: true, message: { content: '{"status":"safe","category":"none"}' } };
  };
  await enqueue("https://example.com/paused", "Title");
  await processQueue();
  assert.equal(saves().length, 0);

  reset();
  archiveStatus = 429; // Keep the captured URLs queued for inspection.
  state.settings.aiCheckEnabled = false;
  state.settings.captureOutlinks = true;
  const sender = { frameId: 0, tab: { id: 1 }, url: "https://example.com/source" };
  const sourceUrl = sender.url;
  assert.deepEqual(await message({ type: "pageReady", sourceUrl, title: "Source" }, sender), { collectOutlinks: true });
  await processQueue();
  await message({ type: "outlinks", sourceUrl, links: [
    "https://example.com/a?utm_source=x", "https://example.com/a",
    "https://sub.example.com/b", "https://example.com?token=PRIVATE", "https://other.com",
  ] }, sender);
  await processQueue();
  assert.deepEqual(state.queue.map((q) => q.url), [
    sourceUrl, "https://example.com/a", "https://sub.example.com/b",
  ]);
  assert.equal(state.queue[1].title, ""); // No target title/body is fetched.
  assert.deepEqual(await message({ type: "pageReady", sourceUrl }, { ...sender, frameId: 1 }),
    { collectOutlinks: false });
  assert.deepEqual(await message({ type: "pageReady", sourceUrl: "https://spoof.example" }, sender),
    { collectOutlinks: false });
  const excluded = "https://example.com?token=PRIVATE";
  assert.deepEqual(await message({ type: "pageReady", sourceUrl: excluded, title: "PRIVATE" },
    { ...sender, url: excluded }), { collectOutlinks: false });
  assert.equal(state.queue.length, 3);
});
