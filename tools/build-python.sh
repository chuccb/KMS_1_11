#!/usr/bin/env bash
# Local source installation for the Python tools; no project tests, PGO or compileall.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
python_version="$(tr -d '[:space:]' < .python-version)"
zlib_version=1.3.2
openssl_version=4.0.3
stamp="$python_version:zlib-$zlib_version:openssl-$openssl_version"
base="$root/generated/toolchain"
prefix="$base/deps"
source_dir="$base/src/cpython-$python_version"
mkdir -p "$base/src" "$base/bin" "$prefix"
if [[ -x "$source_dir/python" && -f "$base/python-build-version" && "$(cat "$base/python-build-version")" == "$stamp" ]]; then
  ln -sf "../src/cpython-$python_version/python" "$base/bin/python3"
  exit 0
fi
for command in curl tar make gcc perl; do
  command -v "$command" >/dev/null || { printf '缺少工具：%s\n' "$command" >&2; exit 1; }
done
fetch_source() {
  local url="$1" archive="$2"
  curl --fail --location --silent --show-error "$url" --output "$base/src/$archive"
  tar -xzf "$base/src/$archive" -C "$base/src"
}
if [[ ! -f "$prefix/lib/libz.a" || ! -f "$base/zlib-build-version" || "$(cat "$base/zlib-build-version")" != "$zlib_version" ]]; then
  fetch_source "https://codeload.github.com/madler/zlib/tar.gz/refs/tags/v$zlib_version" "zlib-$zlib_version.tar.gz"
  (
    cd "$base/src/zlib-$zlib_version"
    ./configure --prefix="$prefix" > "$base/zlib-build.log" 2>&1
    make -j"${KMS_BUILD_JOBS:-4}" >> "$base/zlib-build.log" 2>&1
    make install >> "$base/zlib-build.log" 2>&1
  )
  printf '%s\n' "$zlib_version" > "$base/zlib-build-version"
fi
if [[ ! -f "$prefix/lib/libssl.a" || ! -f "$base/openssl-build-version" || "$(cat "$base/openssl-build-version")" != "$openssl_version" ]]; then
  fetch_source "https://codeload.github.com/openssl/openssl/tar.gz/refs/tags/openssl-$openssl_version" "openssl-$openssl_version.tar.gz"
  (
    cd "$base/src/openssl-openssl-$openssl_version"
    ./Configure --prefix="$prefix" --openssldir=/etc/ssl --libdir=lib shared no-tests \
      > "$base/openssl-build.log" 2>&1
    make -j"${KMS_BUILD_JOBS:-4}" build_sw >> "$base/openssl-build.log" 2>&1
    make install_sw >> "$base/openssl-build.log" 2>&1
  )
  printf '%s\n' "$openssl_version" > "$base/openssl-build-version"
fi
if [[ ! -f "$source_dir/configure" ]]; then
  fetch_source "https://codeload.github.com/python/cpython/tar.gz/refs/tags/v$python_version" "cpython-$python_version.tar.gz"
fi
(
  cd "$source_dir"
  CPPFLAGS="-I$prefix/include" LDFLAGS="-L$prefix/lib -Wl,-rpath,$prefix/lib" \
    PKG_CONFIG_PATH="$prefix/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}" \
    ./configure --with-ensurepip=no --with-openssl="$prefix" --with-openssl-rpath=auto \
      > "$base/python-build.log" 2>&1
  make -j"${KMS_BUILD_JOBS:-4}" >> "$base/python-build.log" 2>&1
)
ln -sf "../src/cpython-$python_version/python" "$base/bin/python3"
# Installation/version reporting only: no game assets, tests, syntax or type checks are run.
"$base/bin/python3" -c 'import ssl, zlib; print(ssl.OPENSSL_VERSION); print("zlib", zlib.ZLIB_RUNTIME_VERSION)'
printf '%s\n' "$stamp" > "$base/python-build-version"
