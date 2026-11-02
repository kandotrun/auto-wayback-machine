import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
const script = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");

test("content script never reads links before source authorization, sends no body or anchor text", async () => {
  for (const allowed of [false, true]) {
    const messages = [];
    let reads = 0;
    const context = vm.createContext({
      location: { href: "https://example.com" },
      document: {
        title: "Page title",
        querySelectorAll(selector) {
          assert.equal(allowed, true);
          assert.equal(selector, "a[href]");
          reads++;
          return [{ href: "https://example.com/a" }, { href: "https://example.com/a" }];
        },
      },
      chrome: { runtime: { async sendMessage(message) {
        messages.push(JSON.parse(JSON.stringify(message)));
        return { collectOutlinks: allowed };
      } } },
    });
    await vm.runInContext(script, context);
    assert.deepEqual(messages[0], { type: "pageReady", sourceUrl: "https://example.com", title: "Page title" });
    assert.equal(reads, allowed ? 1 : 0);
    if (allowed) assert.deepEqual(messages[1],
      { type: "outlinks", sourceUrl: "https://example.com", links: ["https://example.com/a"] });
    else assert.equal(messages.length, 1);
  }
});
