#!/bin/zsh
set -e

PROJECT_DIR="${0:A:h}"
BUNDLED_NODE="/Users/hiramotoakihiro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
elif [[ -x "$BUNDLED_NODE" ]]; then
  NODE_BIN="$BUNDLED_NODE"
else
  print -u2 "Node.jsが見つかりません。Codexのワークスペース依存関係を再読み込みしてください。"
  exit 1
fi

cd "$PROJECT_DIR"
exec "$NODE_BIN" server.mjs
