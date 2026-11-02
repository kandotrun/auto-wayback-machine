import test from "node:test";
import assert from "node:assert/strict";
import { normalise, shouldSkip } from "../extension/shared/url.js";
import { DEFAULT_SETTINGS as settings } from "../extension/shared/settings.js";

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

test("private hosts and exclusion boundaries", () => {
  for (const host of ["localhost", "printer.local", "127.3.2.1", "10.0.0.1",
    "192.168.2.3", "172.16.0.1", "172.31.255.1", "[::1]", "[2001:db8::1]"]) {
    assert.equal(shouldSkip(new URL("http://" + host), settings), "private-host", host);
  }
  for (const host of ["172.15.0.1", "172.32.0.1", "example.com"]) {
    assert.equal(shouldSkip(new URL("https://" + host), settings), null, host);
  }
});
test("host rules include subdomains but not lookalike suffixes", () => {
  const custom = { ...settings, excludeHosts: [" *.Example.com ", "", "other.net"] };
  for (const host of ["example.com", "a.example.com", "a.other.net"]) {
    assert.equal(shouldSkip(new URL("https://" + host), custom), "excluded-host");
  }
  assert.equal(shouldSkip(new URL("https://notexample.com"), custom), null);
});
test("all sensitive keys are case insensitive exact matches", () => {
  for (const key of ["token", "access_token", "refresh_token", "id_token", "session",
    "sessionid", "auth", "password", "passwd", "otp", "code", "api_key", "apikey",
    "secret", "signature", "sig"]) {
    const url = new URL("https://example.com?" + key.toUpperCase() + "=x");
    assert.equal(shouldSkip(url, settings), "sensitive-query", key);
    assert.equal(shouldSkip(url, { ...settings, skipSensitiveQuery: false }), null);
  }
  assert.equal(shouldSkip(new URL("https://example.com?tokenizer=x"), settings), null);
});
test("pattern matching and tracking switches retain their semantics", () => {
  const raw = "https://example.com/Private?UTM_Source=x&gclid=y&q=a#hash";
  assert.equal(normalise(raw, { ...settings, stripTracking: false }).href, raw.split("#")[0]);
  assert.equal(shouldSkip(normalise(raw, settings), {
    ...settings, excludePatterns: ["", "/Private"],
  }), "excluded-pattern");
  assert.equal(shouldSkip(normalise(raw, settings), {
    ...settings, excludePatterns: ["/private"],
  }), null);
});
