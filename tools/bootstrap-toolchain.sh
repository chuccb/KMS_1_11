#!/usr/bin/env bash
# Install tools only. Never start the game, seed a save, execute tests or run typecheck.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
node_version="$(tr -d '[:space:]' < .node-version)"
npm_version="$(sed -n 's/.*"packageManager": "npm@\([^"]*\)".*/\1/p' server/package.json)"
[[ -n "$node_version" && -n "$npm_version" ]]
for command in npm curl tar make gcc perl; do
  command -v "$command" >/dev/null || { printf '缺少工具：%s\n' "$command" >&2; exit 1; }
done
mkdir -p generated/toolchain/src generated/toolchain/bin
# npm's node package distributes the official Node binary for the local platform.
npm install --prefix generated/toolchain --no-save --package-lock=false --no-audit --no-fund \
  "node@$node_version" "npm@$npm_version"
export PATH="$root/generated/toolchain/node_modules/.bin:$PATH"
npm ci --prefix server --ignore-scripts --no-audit --no-fund
bash tools/build-python.sh
export PATH="$root/generated/toolchain/bin:$PATH"
node --version
npm --version
"$root/server/node_modules/.bin/tsc" --version
python3 --version
printf '%s\n' '工具已安裝；未執行專案測試／型別檢查／遊戲 probe，也未修改存檔。' '新 shell 請 source tools/env.sh。'
