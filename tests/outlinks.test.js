import test from "node:test";
import assert from "node:assert/strict";
import { canCollectOutlinks, selectOutlinks, outlinksLimit } from "../extension/shared/outlinks.js";
import { DEFAULT_SETTINGS } from "../extension/shared/settings.js";

const settings = { ...DEFAULT_SETTINGS, captureOutlinks: true };
const source = "https://example.com/page";
test("outlinks opt in and source page safety are required before collection", () => {
  assert.equal(canCollectOutlinks(source, DEFAULT_SETTINGS), false);
  for (const url of ["https://example.com?token=x", "http://10.0.0.1", "https://mail.google.com", "file:///a"]) {
    assert.equal(canCollectOutlinks(url, settings), false);
    assert.deepEqual(selectOutlinks(url, ["https://example.com/a"], settings), []);
  }
  assert.equal(canCollectOutlinks(source, { ...settings, enabled: false }), false);
});
test("same host and descendants only, normalize/filter/dedupe before counting cap", () => {
  const links = [source, "http://127.0.0.1", "https://u:p@example.com",
    "https://example.com?token=x", "https://badexample.com/a", "https://other.com/a",
    "https://example.com/saved", "https://example.com/queued",
    "https://example.com/a?utm_source=x#frag", "https://example.com/a",
    "https://sub.example.com/b", "https://example.com/c"];
  assert.deepEqual(selectOutlinks(source, links, { ...settings, outlinksMaxPerPage: 2 },
    { "https://example.com/saved": 99 }, [{ url: "https://example.com/queued" }], 100),
  ["https://example.com/a", "https://sub.example.com/b"]);
  assert.deepEqual(selectOutlinks("https://sub.example.com", ["https://example.com/a"], settings), []);
});
test("external hosts still obey filters when same-domain restriction is disabled", () => {
  assert.deepEqual(selectOutlinks(source, [
    "https://other.com/a", "https://other.com/private", "https://excluded.net",
    "https://other.com?session=x", null, 4, "mailto:me@example.com",
  ], { ...settings, outlinksSameDomainOnly: false, excludeHosts: ["excluded.net"], excludePatterns: ["/private"] }),
  ["https://other.com/a"]);
});
test("page cap is bounded and zero disables additions", () => {
  assert.equal(outlinksLimit("3.9"), 3);
  assert.equal(outlinksLimit(-1), 0);
  assert.equal(outlinksLimit(1000), 500);
  assert.equal(outlinksLimit("bad"), 30);
  assert.deepEqual(selectOutlinks(source, ["https://example.com/a"], { ...settings, outlinksMaxPerPage: 0 }), []);
});
