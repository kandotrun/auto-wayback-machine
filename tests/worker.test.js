import test from "node:test";
import assert from "node:assert/strict";

test("worker registers listeners, resumes storage, backs off and preserves manual safety", async (t) => {
  let state = {};
  const listeners = {};
  const alarms = [];
  const requests = [];
  const delays = [];
  let status = 200;
  let now = 200_000_000;
  const realNow = Date.now;
  const realTimeout = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  Date.now = () => now;
  globalThis.setTimeout = (fn, ms) => {
    if (ms !== 120_000 && ms !== 20_000) {
      delays.push(ms);
      now += ms;
      queueMicrotask(fn);
    }
    return 1;
  };
  globalThis.clearTimeout = () => {};
  const event = (name) => ({ addListener(fn) { listeners[name] = fn; } });
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
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, credentials: options.credentials });
    return { status, body: { async cancel() {} } };
  };
  t.after(() => {
    Date.now = realNow;
    globalThis.setTimeout = realTimeout;
    globalThis.clearTimeout = realClear;
    delete globalThis.chrome;
    delete globalThis.fetch;
  });
  await import("../extension/background.js");
  const { processQueue, enqueue } = await import("../extension/background/queue.js");
  const settle = async () => {
    for (let i = 0; i < 300; i++) await Promise.resolve();
  };
  assert.deepEqual(Object.keys(listeners).sort(),
    ["alarm", "completed", "history", "installed", "message", "startup"]);
  await listeners.installed();
  await settle();
  assert.equal(state.settings.dedupeHours, 24);
  assert.deepEqual(alarms[0], ["retryQueue", { periodInMinutes: 1 }]);

  state.queue = [
    { url: "https://example.com/a", queuedAt: now, tries: 0 },
    { url: "https://example.com/b", queuedAt: now, tries: 0 },
  ];
  await processQueue();
  assert.equal(state.queue.length, 0);
  assert.equal(state.stats.submitted, 2);
  assert.equal(delays.at(-1), 8000);
  assert.equal(requests[0].credentials, "omit");
  assert.equal(requests[0].url, "https://web.archive.org/save/https://example.com/a");

  await enqueue("https://example.com/a");
  await settle();
  assert.equal(requests.length, 2);
  await enqueue("https://example.com/?token=private");
  assert.equal(state.stats.skipped, 1);

  for (const busyStatus of [429, 503]) {
    status = busyStatus;
    state.queue = [{ url: "https://example.com/busy", queuedAt: now, tries: 0 }];
    await processQueue();
    assert.equal(state.queue.length, 1);
    assert.equal(state.queue[0].tries, 1);
    assert.deepEqual(alarms.at(-1), ["retryQueue", { delayInMinutes: 5 }]);
  }
  status = 500;
  state.queue = [{ url: "https://example.com/fail", queuedAt: now, tries: 0 }];
  await processQueue();
  assert.equal(state.queue.length, 0);
  assert.equal(state.stats.failed, 1);
  assert.equal(state.log[0].status, "failed: HTTP 500");

  const manual = (url) => new Promise((resolve) => {
    assert.equal(listeners.message({ type: "saveNow", url }, {}, resolve), true);
  });
  state.settings.enabled = false;
  assert.deepEqual(await manual("https://example.com/?token=secret"),
    { ok: false, reason: "sensitive-query" });
  assert.deepEqual(await manual("file:///tmp/a"), { ok: false, reason: "unsupported URL" });
  assert.deepEqual(await manual("https://example.com/a"), { ok: true });
  assert.equal(state.queue[0].url, "https://example.com/a");
  await settle();
  assert.equal(state.queue.length, 1);
  status = 200;
  state.settings.enabled = true;
  listeners.startup();
  await settle();
  assert.equal(state.queue.length, 0);
  assert.equal(state.stats.submitted, 3);

  const before = requests.length;
  listeners.completed({ frameId: 1, url: "https://example.com/iframe" });
  await settle();
  assert.equal(requests.length, before);
  listeners.history({ frameId: 0, url: "https://example.com/spa" });
  await settle();
  assert.equal(requests.length, before + 1);
});
