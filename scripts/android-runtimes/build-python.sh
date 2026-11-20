#!/usr/bin/env bash
# Build CPython 3.13 for Android/bionic with the NDK (self-built).
#
# CPython 3.13 has official Android support: build a host Python out-of-tree,
# then cross-configure with --with-build-python. Dependencies are self-built:
#   - OpenSSL: reuse the android-runtime build ($RUNTIME_OPENSSL, static)
#   - libffi / zlib / SQLite: built here (PIC/shared or static) into $WORK/pydeps
#
# Output: $JNI_OUT/libpython_bin.so, libpython3.13.so, libffi.so
#         $ASSET_DIR/python/lib/python3.13 (+ pip preinstalled + _sqlite3)
#
# Required env: SRC_CACHE, NDK, RUNTIME_OPENSSL, JNI_OUT, ASSET_DIR
# Optional: API (24), JOBS, WORK, PKG_CONFIG

set -euo pipefail
export LC_ALL=C

API=${API:-24}
JOBS=${JOBS:-$(nproc)}
NDK=${NDK:?NDK is required}
RUNTIME_OPENSSL=${RUNTIME_OPENSSL:-}
SRC_CACHE=${SRC_CACHE:?SRC_CACHE is required}
JNI_OUT=${JNI_OUT:?JNI_OUT is required}
ASSET_DIR=${ASSET_DIR:?ASSET_DIR is required}
WORK=${WORK:-$HOME/.cache/nibi-android-runtimes}
REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
PY_VER=3.13.18

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

PKG_CONFIG=${PKG_CONFIG:-pkg-config}
command -v "$PKG_CONFIG" >/dev/null || die "需要 pkg-config（Ubuntu: apt install pkg-config）"
export PKG_CONFIG
[ -d "$NDK" ] || die "NDK 不存在：$NDK"
for a in Python-3.13.18.tar.xz libffi-3.4.8.tar.gz zlib-1.3.1.tar.gz sqlite-autoconf-3460100.tar.gz; do
  [ -f "$SRC_CACHE/$a" ] || die "缺少 $a"
done
if [ -z "${RUNTIME_OPENSSL:-}" ]; then
  [ -f "$SRC_CACHE/openssl-3.5.4.tar.gz" ] || die "缺少 openssl-3.5.4.tar.gz（或设置 RUNTIME_OPENSSL 复用已构建产物）"
fi

TC=$NDK/toolchains/llvm/prebuilt/linux-x86_64
CC=$TC/bin/aarch64-linux-android${API}-clang
AR=$TC/bin/llvm-ar
RANLIB=$TC/bin/llvm-ranlib
STRIP=$TC/bin/llvm-strip
[ -x "$CC" ] || die "缺少 $CC"

mkdir -p "$WORK/src" "$WORK/pydeps" "$WORK/python"
HOST_PREFIX=$WORK/host-python
mkdir -p "$JNI_OUT" "$ASSET_DIR"

log "解包 Python/libffi/zlib/SQLite"
rm -rf "$WORK/src/Python-3.13.18" "$WORK/src/libffi-3.4.8" "$WORK/src/zlib-1.3.1" \
  "$WORK/src/sqlite-autoconf-3460100"
tar -xf "$SRC_CACHE/Python-3.13.18.tar.xz" -C "$WORK/src"
tar -xf "$SRC_CACHE/libffi-3.4.8.tar.gz" -C "$WORK/src"
tar -xf "$SRC_CACHE/zlib-1.3.1.tar.gz" -C "$WORK/src"
tar -xf "$SRC_CACHE/sqlite-autoconf-3460100.tar.gz" -C "$WORK/src"

log "宿主 Python 3.13"
if [ ! -x "$HOST_PREFIX/bin/python3.13" ]; then
  rm -rf "$WORK/py-host-build"
  mkdir -p "$WORK/py-host-build"
  (
    cd "$WORK/py-host-build"
    "$WORK/src/Python-3.13.18/configure" \
      --prefix="$HOST_PREFIX" --without-ensurepip --disable-test-modules >/dev/null
    make -j"$JOBS" >/dev/null
    make install >/dev/null
  )
fi

log "OpenSSL（Python _ssl/_hashlib 用；可复用 android-runtime 产物）"
if [ -z "${RUNTIME_OPENSSL:-}" ]; then
  RUNTIME_OPENSSL=$WORK/openssl
  if [ ! -f "$RUNTIME_OPENSSL/lib/libssl.a" ]; then
    rm -rf "$WORK/src/openssl-3.5.4"
    tar -xf "$SRC_CACHE/openssl-3.5.4.tar.gz" -C "$WORK/src"
    (
      cd "$WORK/src/openssl-3.5.4"
      PATH="$TC/bin:$PATH" ANDROID_NDK_ROOT="$NDK" ./Configure android-arm64 \
        -D__ANDROID_API__="$API" --prefix="$RUNTIME_OPENSSL" \
        --openssldir="$RUNTIME_OPENSSL/ssl" \
        no-shared no-tests no-apps no-docs -fPIC >/dev/null
      make -j"$JOBS" >/dev/null || make -j"$JOBS" >/dev/null
      make install_sw >/dev/null
    )
  fi
fi
[ -d "$RUNTIME_OPENSSL" ] || die "RUNTIME_OPENSSL 不存在：$RUNTIME_OPENSSL"

log "libffi（Android shared）"
(
  cd "$WORK/src/libffi-3.4.8"
  ./configure --host=aarch64-linux-android --prefix="$WORK/pydeps" \
    --enable-shared --disable-static \
    CC="$CC" AR="$AR" RANLIB="$RANLIB" \
    CFLAGS="-O2 -fPIC -D__BIONIC_NO_PAGE_SIZE_MACRO" \
    LDFLAGS="-Wl,-z,max-page-size=16384" >/dev/null
  make -j"$JOBS" >/dev/null
  make install >/dev/null
)

log "zlib（Android static/PIC）"
(
  cd "$WORK/src/zlib-1.3.1"
  CC="$CC" CFLAGS="-O2 -fPIC -D__BIONIC_NO_PAGE_SIZE_MACRO" \
    ./configure --prefix="$WORK/pydeps" --static >/dev/null
  make -j"$JOBS" >/dev/null
  make install >/dev/null
)

# Python 的 sqlite3 是标准库模块，缺 _sqlite3 时 import sqlite3 直接失败。
# Android 没有公开的 libsqlite3 NDK 接口，因此把 SQLite 静态编进 _sqlite3；
# pkg-config 文件让 CPython 的 setup.py 在交叉构建时能发现它。
log "SQLite（Python _sqlite3 用；静态 PIC）"
(
  cd "$WORK/src/sqlite-autoconf-3460100"
  CC="$CC" AR="$AR" RANLIB="$RANLIB" \
    CFLAGS="-O2 -fPIC -D__BIONIC_NO_PAGE_SIZE_MACRO" \
    LDFLAGS="-Wl,-z,max-page-size=16384" \
    ./configure --host=aarch64-linux-android --prefix="$WORK/pydeps" \
      --disable-shared --enable-static >/dev/null
  make -j"$JOBS" >/dev/null
  make install >/dev/null
)

log "交叉配置 CPython"
rm -rf "$WORK/py-cross"
mkdir -p "$WORK/py-cross"
(
  cd "$WORK/py-cross"
  export PKG_CONFIG_LIBDIR="$WORK/pydeps/lib/pkgconfig:$RUNTIME_OPENSSL/lib/pkgconfig"
  export AR="$AR" AS="$TC/bin/llvm-as" NM="$TC/bin/llvm-nm" RANLIB="$RANLIB" \
    READELF="$TC/bin/llvm-readelf" STRIP="$STRIP" LD="$TC/bin/ld"
  export CC="$CC" CXX="$CC++"
  export CFLAGS="-D__BIONIC_NO_PAGE_SIZE_MACRO -I$WORK/pydeps/include -I$RUNTIME_OPENSSL/include"
  export CXXFLAGS="$CFLAGS"
  export LDFLAGS="-Wl,--build-id=sha1 -Wl,--no-rosegment -Wl,-z,max-page-size=16384 -Wl,--no-undefined -lm -L$WORK/pydeps/lib -L$RUNTIME_OPENSSL/lib"
  "$WORK/src/Python-3.13.18/configure" \
    --host=aarch64-linux-android --build=x86_64-pc-linux-gnu \
    --with-build-python="$HOST_PREFIX/bin/python3.13" \
    --without-ensurepip --enable-shared --without-static-libpython \
    --with-openssl="$RUNTIME_OPENSSL" --disable-test-modules >/dev/null
)

log "编译 CPython（-k 多轮补齐 clang 偶发 rename）"
(
  cd "$WORK/py-cross"
  # setup.py 也在 make 阶段用 pkg-config 找 sqlite3；configure 里的导出不会继承到这一步。
  export PKG_CONFIG_LIBDIR="$WORK/pydeps/lib/pkgconfig:$RUNTIME_OPENSSL/lib/pkgconfig"
  for _ in $(seq 1 10); do
    make -j"$JOBS" -k >>"$WORK/python-build.log" 2>&1 || true
    [ -f python ] && break
    sleep 1
  done
  [ -f python ] || die "CPython 编译失败，日志：$WORK/python-build.log"
  rm -rf "$WORK/py-stage"
  make install DESTDIR="$WORK/py-stage" >/dev/null
)

STD=$WORK/py-stage/usr/local/lib/python3.13
[ -d "$STD/lib-dynload" ] || die "缺少 lib-dynload"
ls "$STD/lib-dynload"/_sqlite3*.so >/dev/null 2>&1 \
  || die "CPython 没有编出 _sqlite3（检查 SQLite pkg-config 与 python-build.log）"

log "裁剪并 strip"
rm -rf "$STD/test" "$STD/idlelib" "$STD/tkinter" "$STD/turtledemo"
find "$STD" -name __pycache__ -type d -prune -exec rm -rf {} +
find "$STD/lib-dynload" -name "*.so" -exec "$STRIP" --strip-unneeded {} +

log "预装 pip（ensurepip 内置 wheel 解压到 site-packages）"
SITE=$STD/site-packages
mkdir -p "$SITE"
WHEEL=$(find "$STD/ensurepip/_bundled" -name "pip-*.whl" | head -1)
[ -n "$WHEEL" ] || die "找不到 pip wheel"
python3 - "$WHEEL" "$SITE" <<'PY'
import pathlib, sys, zipfile
wheel, site = sys.argv[1], pathlib.Path(sys.argv[2])
with zipfile.ZipFile(wheel) as z:
    for info in z.infolist():
        name = info.filename
        if name.startswith(("pip/", "pip-")) and not name.endswith("/"):
            target = site / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(info))
print("pip extracted")
PY

log "落盘 Python"
install -m 0755 "$WORK/py-stage/usr/local/bin/python3.13" "$JNI_OUT/libpython_bin.so"
install -m 0644 "$WORK/py-stage/usr/local/lib/libpython3.13.so" "$JNI_OUT/libpython3.13.so"
install -m 0644 "$WORK/pydeps/lib/libffi.so" "$JNI_OUT/libffi.so"
"$STRIP" --strip-unneeded "$JNI_OUT/libpython3.13.so" "$JNI_OUT/libffi.so"

rm -rf "$ASSET_DIR/python"
mkdir -p "$ASSET_DIR/python/lib"
cp -a "$STD" "$ASSET_DIR/python/lib/python3.13"

log "完成"
ls -lh "$JNI_OUT/libpython_bin.so" "$JNI_OUT/libpython3.13.so" "$JNI_OUT/libffi.so"
du -sh "$ASSET_DIR/python"
