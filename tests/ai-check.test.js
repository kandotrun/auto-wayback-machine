import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { aiEndpoint, interpretAiResponse, aiDisposition, checkWithAi, AI_TIMEOUT_MS } from "../extension/shared/ai-check.js";
import { DEFAULT_SETTINGS as settings } from "../extension/shared/settings.js";

const payload = (status, category, extra = {}) => ({
  done: true, message: { content: JSON.stringify({ status, category, ...extra }) },
});
test("strict Ollama JSON parsing accepts only safe/unsafe/uncertain and fixed categories", () => {
  assert.deepEqual(interpretAiResponse(payload("safe", "none")), { status: "safe", category: "none" });
  assert.deepEqual(interpretAiResponse(payload("unsafe", "personal_data", { reason: "PRIVATE" })),
    { status: "unsafe", category: "personal_data" });
  for (const result of [null, {}, { done: false, message: { content: '{"status":"safe","category":"none"}' } },
    { done: true, message: { content: 'safe' } }, payload("safe", "personal_data"),
    payload("safe", "PII HERE"), payload("unsafe", "none"), payload("unknown", "none")]) {
    assert.deepEqual(interpretAiResponse(result), { status: "unavailable", category: "invalid_response" });
  }
});
test("only safe sends; unsafe/uncertain hold, errors stop retrying after three total attempts", () => {
  assert.deepEqual(aiDisposition({ status: "safe", category: "none" }), { action: "send" });
  for (const status of ["unsafe", "uncertain"]) {
    assert.deepEqual(aiDisposition({ status, category: "private_document" }),
      { action: "hold", status: "held-ai-" + status, category: "private_document" });
  }
  const error = { status: "unavailable", category: "invalid_response" };
  assert.deepEqual(aiDisposition(error, 0), { action: "retry", attempts: 1 });
  assert.deepEqual(aiDisposition(error, 1), { action: "retry", attempts: 2 });
  assert.deepEqual(aiDisposition(error, 2),
    { action: "hold", status: "held-ai-unavailable", category: "invalid_response" });
  assert.equal(aiDisposition({ status: "other", category: "PRIVATE" }, 2).category, "unavailable");
});
test("endpoint accepts Ollama base URL or exact API path, rejects credentials and non-HTTP", () => {
  assert.equal(aiEndpoint(settings.aiCheckEndpoint).href, "http://127.0.0.1:11434/api/chat");
  assert.equal(aiEndpoint("https://llm.example/api/chat").href, "https://llm.example/api/chat");
  assert.equal(aiEndpoint("https://llm.example/prefix/").href, "https://llm.example/prefix/api/chat");
  for (const endpoint of ["file:///tmp/a", "https://user:secret@llm.example", "https://llm.example?key=secret"]) {
    assert.throws(() => aiEndpoint(endpoint));
  }
});
test("AI payload includes only URL/title data, no other queue fields, cookie or tool access", async () => {
  const item = { url: "https://example.com", title: "Public page", body: "BODY", cookie: "COOKIE", tries: 2 };
  const result = await checkWithAi(item, settings, async (url, request) => {
    assert.equal(url, "http://127.0.0.1:11434/api/chat");
    assert.equal(request.credentials, "omit");
    assert.equal(request.redirect, "error");
    const body = JSON.parse(request.body);
    assert.equal(body.stream, false);
    assert.equal(body.format, "json");
    assert.equal(body.tools, undefined);
    assert.deepEqual(JSON.parse(body.messages[1].content), { url: item.url, title: item.title });
    assert.ok(!request.body.includes("BODY") && !request.body.includes("COOKIE"));
    return { ok: true, json: async () => payload("safe", "none") };
  });
  assert.equal(result.status, "safe");
});
test("network, HTTP, JSON and configuration errors fail closed without leaking error text", async () => {
  for (const fetcher of [
    async () => { throw new Error("SECRET"); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => { throw new Error("SECRET"); } }),
  ]) {
    assert.deepEqual(await checkWithAi({ url: "https://example.com", title: "" }, settings, fetcher),
      { status: "unavailable", category: "unavailable" });
  }
  let called = false;
  const result = await checkWithAi({ url: "https://example.com" }, { ...settings, aiCheckModel: "" },
    async () => { called = true; });
  assert.equal(called, false);
  assert.equal(result.status, "unavailable");
});
test("hung AI requests abort and fail closed at timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = checkWithAi({ url: "https://example.com" }, settings, async (_url, options) => {
    await new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  });
  t.mock.timers.tick(AI_TIMEOUT_MS);
  assert.equal((await pending).status, "unavailable");
});
test("Ollama HTTP contract smoke test against a local synthetic server", async (t) => {
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    assert.equal(request.url, "/api/chat");
    assert.equal(request.method, "POST");
    assert.deepEqual(JSON.parse(JSON.parse(raw).messages[1].content),
      { url: "https://example.com/public", title: "Synthetic test" });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(payload("safe", "none")));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const result = await checkWithAi({ url: "https://example.com/public", title: "Synthetic test" },
    { ...settings, aiCheckEndpoint: "http://127.0.0.1:" + server.address().port });
  assert.equal(result.status, "safe");
});
