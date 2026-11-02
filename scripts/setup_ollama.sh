#!/bin/bash
# Optional Mac AI runtime setup. install.sh treats any failure here as a warning.
set -euo pipefail

JUDGE_MODEL="${AWM_JUDGE_MODEL:-qwen3.8:27b-mlx}"
OLLAMA_API="http://127.0.0.1:11434"
export OLLAMA_HOST="127.0.0.1:11434"

if [ "${AWM_SKIP_OLLAMA:-0}" = "1" ]; then
  echo "Ollama のセットアップをスキップします（AWM_SKIP_OLLAMA=1）。"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Ollama の準備には curl が必要です。" >&2
  exit 1
fi

OLLAMA_BIN="$(command -v ollama || true)"
if [ -z "$OLLAMA_BIN" ] && [ -x "/Applications/Ollama.app/Contents/Resources/ollama" ]; then
  OLLAMA_BIN="/Applications/Ollama.app/Contents/Resources/ollama"
fi
if [ -z "$OLLAMA_BIN" ]; then
  echo "Ollama を公式インストーラで導入します。"
  INSTALLER="$(mktemp)"
  trap 'rm -f "$INSTALLER"' EXIT
  curl -fsSL --connect-timeout 10 --max-time 120 https://ollama.com/install.sh -o "$INSTALLER"
  OLLAMA_NO_START=1 sh "$INSTALLER"
  OLLAMA_BIN="$(command -v ollama || true)"
  if [ -z "$OLLAMA_BIN" ] && [ -x "/Applications/Ollama.app/Contents/Resources/ollama" ]; then
    OLLAMA_BIN="/Applications/Ollama.app/Contents/Resources/ollama"
  fi
  if [ -z "$OLLAMA_BIN" ]; then
    echo "導入後の ollama コマンドが見つかりません。" >&2
    exit 1
  fi
else
  echo "既存の Ollama を使います（再インストールしません）。"
fi

# Permit Chrome extension origins. The client only contacts loopback; existing
# server bind settings are left alone.
# Preserve existing origin entries. This does not restart an already running server.
if [ "$(uname)" = "Darwin" ]; then
  ORIGINS="$(launchctl getenv OLLAMA_ORIGINS 2>/dev/null || true)"
  case "$ORIGINS" in
    *'chrome-extension://*'*) ;;
    *) ORIGINS="${ORIGINS:+$ORIGINS,}chrome-extension://*" ;;
  esac
  launchctl setenv OLLAMA_ORIGINS "$ORIGINS"
  export OLLAMA_ORIGINS="$ORIGINS"
fi

ready() {
  curl -fsS --connect-timeout 1 --max-time 2 -o /dev/null "$OLLAMA_API/api/tags"
}

if ! ready; then
  echo "Ollama を起動します。API の準備を最大約 2 分待ちます。"
  if [ "$(uname)" = "Darwin" ] && open -a Ollama --args hidden; then
    : # Ollama.app is the standard macOS launcher.
  else
    nohup "$OLLAMA_BIN" serve >/dev/null 2>&1 </dev/null &
  fi
  READY=0
  for ((attempt = 1; attempt <= 30; attempt++)); do
    if ready; then READY=1; break; fi
    if [ "$attempt" -lt 30 ]; then sleep 2; fi
  done
  if [ "$READY" -ne 1 ]; then
    echo "Ollama API が時間内に応答しませんでした: $OLLAMA_API" >&2
    exit 1
  fi
fi

echo "判定モデル $JUDGE_MODEL を用意します。初回は大容量のダウンロードと保存容量が必要です（既定モデルは実測で約 18.2 GB、既存データは再利用）。"
"$OLLAMA_BIN" pull "$JUDGE_MODEL"
echo "Ollama と判定モデルの準備ができました。拡張の AI モードは auto が既定です。"
if [ "$JUDGE_MODEL" != "qwen3.8:27b-mlx" ]; then
  echo "AWM_JUDGE_MODEL を変更したため、拡張の設定画面でもモデル名を $JUDGE_MODEL に合わせてください。"
fi
