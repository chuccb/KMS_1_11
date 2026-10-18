#!/usr/bin/env bash
# Recovery preflight: refuse absent/empty files before invoking the existing CLI.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
if [[ $# != 1 || ! -s "$1" ]]; then
  printf '%s\n' '用法：bash tools/serve-existing-save.sh <已存在且非空的真實save路徑>' \
    '找不到存檔就停止；不自動seed、不以新角色代替舊進度。請先確認舊服務已停止並冷備存檔。' >&2
  exit 2
fi
save="$(cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")"
source tools/env.sh
exec node server/src/cli.ts serve --host 0.0.0.0 \
  --port "${KMS_LOGIN_PORT:-8516}" --game-port "${KMS_GAME_PORT:-8517}" \
  --web-port "${KMS_WEB_PORT:-8515}" --data Data.wz --save "$save" --ping off
