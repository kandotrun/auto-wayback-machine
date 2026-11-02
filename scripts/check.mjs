import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const extensionFiles = files("extension");
const javascript = [...extensionFiles, ...files("scripts"), ...files("tests")]
  .filter((path) => /\.(js|mjs)$/.test(path));
for (const path of javascript) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
}
execFileSync("bash", ["-n", "install.sh"], { stdio: "inherit" });

const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.background.type, "module");
const references = [
  manifest.background.service_worker, manifest.action.default_popup, manifest.options_page,
  ...(manifest.content_scripts || []).flatMap((script) => [...script.js, ...(script.css || [])]),
  ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
];
for (const path of references) assert.ok(existsSync(join("extension", path)), path);
for (const path of extensionFiles.filter((p) => /\.(html|js)$/.test(p))) {
  const source = readFileSync(path, "utf8");
  const patterns = path.endsWith(".html")
    ? [/\b(?:src|href)="([^"]+)"/g]
    : [/\bfrom\s+"(\.[^"]+)"/g];
  for (const pattern of patterns) {
    for (const [, reference] of source.matchAll(pattern)) {
      assert.ok(existsSync(resolve(dirname(path), reference)), path + ": " + reference);
    }
  }
}
console.log("Syntax, versions, manifest, HTML and module references: OK");
