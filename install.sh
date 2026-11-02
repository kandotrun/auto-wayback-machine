#!/bin/bash
# Wayback Auto Archiver — Mac installer / updater
#
#   curl -fsSL https://raw.githubusercontent.com/kandotrun/auto-wayback-machine/main/install.sh | bash
#
# What it does:
#   1. Clones (or updates) the extension into ~/auto-wayback-machine
#   2. Generates the PNG icons locally (they are not kept in git)
#   3. Copies the folder path to the clipboard and opens chrome://extensions
#
# The last clicks cannot be automated: since Chrome 137, Google Chrome
# ignores the --load-extension command-line flag, so an unpacked extension
# can only be loaded from the extensions page. First time only:
#   Developer mode ON -> "Load unpacked" -> paste the path (Cmd+V) -> Open
# After an update, just press the reload icon on the same page.
set -euo pipefail

REPO_URL="https://github.com/kandotrun/auto-wayback-machine.git"
DEST="${AUTO_WAYBACK_DIR:-$HOME/auto-wayback-machine}"

if ! command -v git >/dev/null 2>&1; then
  echo "git が見つかりません。Xcode Command Line Tools を入れてください: xcode-select --install" >&2
  exit 1
fi

if [ -d "$DEST/.git" ]; then
  echo "更新します: $DEST"
  git -C "$DEST" pull --ff-only
else
  echo "取得します: $DEST"
  git clone "$REPO_URL" "$DEST"
fi

# Icons are generated, not committed (Chrome needs PNGs; git stays text-only).
if command -v python3 >/dev/null 2>&1; then
  python3 "$DEST/scripts/generate_icons.py"
else
  echo "python3 が無いのでアイコンを生成できませんでした（拡張の読み込み時にアイコンエラーになります）" >&2
fi

echo ""
echo "フォルダ: $DEST"

if [ "$(uname)" = "Darwin" ]; then
  if command -v pbcopy >/dev/null 2>&1; then
    printf '%s' "$DEST" | pbcopy
    echo "パスをクリップボードにコピーしました。"
  fi
  if [ -d "/Applications/Google Chrome.app" ]; then
    open -a "Google Chrome" "chrome://extensions/"
  else
    echo "Google Chrome が /Applications に見つかりませんでした。Chrome で chrome://extensions/ を開いてください。"
  fi
fi

cat <<'EOF'

あとは Chrome の拡張機能ページで（初回だけ）:
  1. 右上の「デベロッパーモード」を ON
  2. 「パッケージ化されていない拡張機能を読み込む」
  3. パスを貼り付け (Cmd+V) してフォルダを選択

更新時: このスクリプトをもう一度実行 → 拡張機能ページで ↻ を押すだけです。
EOF
