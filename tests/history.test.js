import test from "node:test";
import assert from "node:assert/strict";
import { isDuplicate, pruneMap } from "../extension/background/history.js";
import { DEFAULT_SETTINGS } from "../extension/shared/settings.js";

test("initial settings remain unchanged", () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    enabled: true, captureOutlinks: false, outlinksSameDomainOnly: true, outlinksMaxPerPage: 30,
    dedupeHours: 24, minIntervalSec: 8,
    stripTracking: true, skipSensitiveQuery: true,
    excludeHosts: ["localhost", "127.0.0.1", "web.archive.org", "archive.org",
      "accounts.google.com", "mail.google.com"],
    excludePatterns: [],
  });
});
test("dedupe expires at exactly 24 hours, queued URLs always dedupe", () => {
  const now = 200_000_000;
  const url = "https://example.com/";
  assert.equal(isDuplicate(url, { [url]: now - 86400_000 + 1 }, [], 24, now), true);
  assert.equal(isDuplicate(url, { [url]: now - 86400_000 }, [], 24, now), false);
  assert.equal(isDuplicate(url, { [url]: now }, [], 0, now), false);
  assert.equal(isDuplicate(url, {}, [{ url }], 0, now), true);
  assert.equal(isDuplicate(url, {}, [{ url: url + "other" }], 24, now), false);
});
test("history pruning keeps newest 5000 entries and strictly less than 30 days", () => {
  const now = 40 * 86400_000;
  const map = { expired: now - 30 * 86400_000, recent: now };
  assert.deepEqual(pruneMap(map, now), { recent: now });
  assert.equal(Object.keys(map).length, 2);
  const many = Object.fromEntries(Array.from({ length: 5002 }, (_, i) => ["url" + i, now - i]));
  const result = pruneMap(many, now);
  assert.equal(Object.keys(result).length, 5000);
  assert.equal(result.url4999, now - 4999);
  assert.equal(result.url5000, undefined);
});
