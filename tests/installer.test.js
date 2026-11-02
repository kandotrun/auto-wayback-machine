import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const repository = resolve(".");
const resolvedCommands = new Map();
function command(name) {
  if (!resolvedCommands.has(name)) {
    let path = execFileSync("/bin/sh", ["-c", "command -v " + name], { encoding: "utf8" }).trim();
    // Resolve Python version-manager shims before isolating PATH.
    if (name === "python3") path = execFileSync(path, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim();
    resolvedCommands.set(name, path);
  }
  return resolvedCommands.get(name);
}

function fixture(t, { installed = false, mode = "ok", skip = false, model, running = false, originsConfigured = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "awm-installer-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const source = join(root, "source");
  const dest = join(root, "installed");
  mkdirSync(bin);
  mkdirSync(join(source, "scripts"), { recursive: true });
  mkdirSync(join(source, "extension"));
  for (const name of ["bash", "sh", "git", "python3", "mktemp", "rm", "cat", "chmod", "nohup"]) {
    symlinkSync(command(name), join(bin, name));
  }
  const script = (name, text) => writeFileSync(join(bin, name), "#!/bin/sh\n" + text + "\n", { mode: 0o755 });
  const log = join(root, "calls");
  const ready = join(root, "ready");
  if (running) writeFileSync(ready, "");
  const ollamaStub = join(root, "ollama-stub");
  writeFileSync(ollamaStub, `#!/bin/sh
echo "ollama $*" >> "$AWM_TEST_LOG"
if [ "$1" = "pull" ] && [ "$AWM_TEST_MODE" = "pull-fail" ]; then exit 1; fi
`, { mode: 0o755 });
  if (installed) symlinkSync(ollamaStub, join(bin, "ollama"));
  script("uname", 'echo Darwin');
  script("sleep", ':');
  script("pbcopy", 'cat >/dev/null');
  script("launchctl", `echo "launchctl $*" >> "$AWM_TEST_LOG"
if [ "$1" = "getenv" ]; then
  if [ -f "$AWM_TEST_ORIGINS" ]; then cat "$AWM_TEST_ORIGINS"; else echo "https://existing.example"; fi
else
  echo "$3" > "$AWM_TEST_ORIGINS"
fi`);
  script("osascript", `echo "osascript $*" >> "$AWM_TEST_LOG"
if [ "$AWM_TEST_MODE" != "quit-timeout" ]; then rm -f "$AWM_TEST_READY"; fi`);
  script("open", `echo "open $*" >> "$AWM_TEST_LOG"
if [ "$2" = "Ollama" ] && [ "$AWM_TEST_MODE" != "timeout" ]; then
  : > "$AWM_TEST_READY"
  : > "$AWM_TEST_RESTARTED"
fi`);
  script("curl", `output=""
url=""
origin=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -H) origin=1; shift 2 ;;
    -o) output="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
echo "curl $url" >> "$AWM_TEST_LOG"
case "$url" in
  https://ollama.com/install.sh)
    if [ "$AWM_TEST_MODE" = "download-fail" ]; then exit 22; fi
    cat > "$output" <<'INSTALLER'
#!/bin/sh
echo "official-install" >> "$AWM_TEST_LOG"
cat "$AWM_TEST_STUB" > "$AWM_TEST_BIN/ollama"
chmod +x "$AWM_TEST_BIN/ollama"
INSTALLER
    ;;
  http://127.0.0.1:11434/api/tags)
    [ -f "$AWM_TEST_READY" ] && [ "$AWM_TEST_MODE" != "timeout" ] || exit 22
    if [ "$origin" = "1" ] && [ "$AWM_TEST_MODE" = "stale-origin" ]; then
      # Only a new app process inherits the configured origins.
      [ -f "$AWM_TEST_RESTARTED" ] || exit 22
    fi ;;
  *) exit 99 ;;
esac`);
  // Substitute only the app path dependency, avoiding the real Mac's installed app.
  writeFileSync(join(source, "scripts/setup_ollama.sh"),
    readFileSync(join(repository, "scripts/setup_ollama.sh"), "utf8")
      .replaceAll("/Applications/Ollama.app", join(root, "not-installed.app")));
  writeFileSync(join(source, "scripts/generate_icons.py"), readFileSync(join(repository, "scripts/generate_icons.py")));
  writeFileSync(join(source, "extension/manifest.json"), "{}");
  const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  for (const args of [
    ["init", "-q", source],
    ["-C", source, "add", "."],
    ["-C", source, "-c", "user.name=Installer Test", "-c", "user.email=test@example.invalid",
      "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"],
  ]) execFileSync(command("git"), args, { env: gitEnv });
  const origins = join(root, "origins");
  if (originsConfigured) writeFileSync(origins, "https://existing.example,chrome-extension://*");
  const env = {
    ...gitEnv, PATH: bin, AUTO_WAYBACK_DIR: dest,
    AWM_TEST_MODE: mode, AWM_TEST_LOG: log, AWM_TEST_READY: ready,
    AWM_TEST_ORIGINS: origins, AWM_TEST_RESTARTED: join(root, "restarted"),
    AWM_TEST_BIN: bin, AWM_TEST_STUB: ollamaStub,
    AWM_SKIP_OLLAMA: skip ? "1" : "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "url." + source + ".insteadOf",
    GIT_CONFIG_VALUE_0: "https://github.com/kandotrun/auto-wayback-machine.git",
  };
  if (model) env.AWM_JUDGE_MODEL = model;
  else delete env.AWM_JUDGE_MODEL;
  const run = () => {
    const result = spawnSync(command("bash"), [join(repository, "install.sh")], { env, encoding: "utf8", timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.ok(result.stdout.includes("フォルダ: " + dest + "/extension"));
    for (const size of [16, 32, 48, 128]) assert.ok(existsSync(join(dest, "extension/icons/icon" + size + ".png")));
    return { ...result, calls: existsSync(log) ? readFileSync(log, "utf8") : "" };
  };
  return { run };
}

test("installer skip performs real extension clone and update without touching Ollama", (t) => {
  const f = fixture(t, { skip: true });
  assert.ok(!f.run().calls.includes("ollama"));
  assert.ok(!f.run().calls.includes("ollama"));
});
test("installer installs once, starts app, waits for tags, preserves origins and reuses model data", (t) => {
  const f = fixture(t);
  const first = f.run();
  assert.match(first.stdout, /約 18\.2 GB/);
  assert.match(first.calls, /official-install/);
  assert.match(first.calls, /open -a Ollama --args hidden/);
  assert.match(first.calls, /launchctl setenv OLLAMA_ORIGINS https:\/\/existing.example,chrome-extension:\/\/\*/);
  assert.match(first.calls, /ollama pull qwen3.8:27b-mlx/);
  const second = f.run();
  assert.equal((second.calls.match(/official-install/g) || []).length, 1);
  assert.equal((second.calls.match(/ollama pull qwen3.8:27b-mlx/g) || []).length, 2);
});
test("installer respects existing ollama and AWM_JUDGE_MODEL override", (t) => {
  const result = fixture(t, { installed: true, model: "custom:7b" }).run();
  assert.ok(!result.calls.includes("official-install"));
  assert.match(result.calls, /ollama pull custom:7b/);
  assert.match(result.stdout, /拡張の設定画面でもモデル名/);
});
for (const mode of ["download-fail", "timeout", "pull-fail"]) {
  test("Ollama " + mode + " only warns; extension installation still succeeds", (t) => {
    const result = fixture(t, { mode, installed: mode !== "download-fail" }).run();
    assert.match(result.stderr, /警告: Ollama/);
    if (mode === "timeout") {
      assert.equal((result.calls.match(/curl http:\/\/127.0.0.1:11434\/api\/tags/g) || []).length, 32);
      assert.ok(!result.calls.includes("ollama pull"));
    }
  });
}

test("running Ollama restarts once when origins change, waits before pulling, then stays running", (t) => {
  const f = fixture(t, { installed: true, running: true });
  const first = f.run();
  assert.match(first.stdout, /既存プロセスは launchctl setenv の変更を読み込みません/);
  assert.match(first.calls, /osascript -e tell application "Ollama" to quit/);
  assert.ok(first.calls.indexOf("osascript") < first.calls.indexOf("open -a Ollama"));
  assert.ok(first.calls.indexOf("open -a Ollama") < first.calls.indexOf("ollama pull"));
  const second = f.run();
  assert.equal((second.calls.match(/osascript/g) || []).length, 1);
  assert.equal((second.calls.match(/open -a Ollama/g) || []).length, 1);
});
test("already configured running Ollama is left alone when extension Origin succeeds", (t) => {
  const result = fixture(t, { installed: true, running: true, originsConfigured: true }).run();
  assert.ok(!result.calls.includes("osascript"));
  assert.ok(!result.calls.includes("open -a Ollama"));
  assert.match(result.calls, /ollama pull/);
});
test("stale running app restarts even when launchctl origins were already configured", (t) => {
  const result = fixture(t, { installed: true, running: true, originsConfigured: true, mode: "stale-origin" }).run();
  assert.match(result.calls, /osascript/);
  assert.match(result.calls, /open -a Ollama/);
  assert.match(result.calls, /ollama pull/);
  assert.ok(!result.stderr.includes("警告"));
});
test("app quit timeout warns without launching another server or pulling", (t) => {
  const result = fixture(t, { installed: true, running: true, mode: "quit-timeout" }).run();
  assert.match(result.stderr, /時間内に終了しませんでした/);
  assert.match(result.stderr, /警告: Ollama/);
  assert.ok(!result.calls.includes("open -a Ollama"));
  assert.ok(!result.calls.includes("ollama pull"));
});
