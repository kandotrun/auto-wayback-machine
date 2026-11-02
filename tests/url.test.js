import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

// Characterize the initial worker before extracting its pure functions.
const source = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const context = vm.createContext({ URL, chrome: {
  webNavigation: { onCompleted: { addListener() {} }, onHistoryStateUpdated: { addListener() {} } },
  alarms: { onAlarm: { addListener() {} } },
  runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} } },
} });
vm.runInContext(source + "\nthis.logic = { normalise, shouldSkip, DEFAULT_SETTINGS };", context);
const { normalise, shouldSkip, DEFAULT_SETTINGS: settings } = context.logic;

test("normalization strips fragments and tracking while preserving meaningful queries", () => {
  assert.equal(normalise("https://EXAMPLE.com/a?utm_source=x&FBCLID=y&q=hello#part", settings).href,
    "https://example.com/a?q=hello");
});
test("unsupported and credential-embedded URLs never pass", () => {
  for (const url of ["bad", "file:///tmp/a", "https://user:pass@example.com"]) {
    assert.equal(normalise(url, settings), null);
  }
});
test("safety exclusions retain their reasons", () => {
  for (const [url, reason] of [
    ["http://192.168.1.2", "private-host"],
    ["https://mail.google.com", "excluded-host"],
    ["https://example.com?TOKEN=x", "sensitive-query"],
    ["https://example.com", null],
  ]) assert.equal(shouldSkip(normalise(url, settings), settings), reason);
});
