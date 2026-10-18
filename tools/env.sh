#!/usr/bin/env bash
# Source this file: PATH changes cannot propagate out of an executed child shell.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  printf '%s\n' '請使用 source tools/env.sh，而不是執行這個檔案。' >&2
  exit 2
fi
_kms_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$_kms_root/generated/toolchain/python-build-version" || ! -x "$_kms_root/generated/toolchain/node_modules/.bin/node" || ! -x "$_kms_root/generated/toolchain/bin/python3" ]]; then
  printf '%s\n' '本機工具鏈尚未安裝；請先執行 bash tools/bootstrap-toolchain.sh，或自行啟用版本檔指定的版本。' >&2
  unset _kms_root
  return 1
fi
export PATH="$_kms_root/generated/toolchain/bin:$_kms_root/generated/toolchain/node_modules/.bin:$PATH"
unset _kms_root
