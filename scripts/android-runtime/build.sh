#!/usr/bin/env bash
# Build the Android (bionic) userland shipped inside NIBI-GO (D25 Phase 2).
#
# Runs on Linux or WSL: cross-compiles bash/readline/ncurses, busybox, and
# git (zlib/openssl/curl) with the same NDK as libnibi.so, stages the flat
# lib*.so files into jniLibs, and packs the read-only runtime assets.
#
# Required env:
#   SRC_CACHE     directory with the pinned source archives (see sources.json)
#   JNI_OUT       .../android/prebuilt/jniLibs/arm64-v8a
#   ASSET_ZIP     .../android/src/main/assets/nibi-runtime.zip
#   ASSET_MANIFEST .../android/src/main/assets/nibi-runtime.json
# Optional:
#   NDK (default: $HOME/android/ndk/android-ndk-r27b), API (default 24),
#   WORK, JOBS, STRIP (default 1), DEBUG (default 0)

set -euo pipefail
export LC_ALL=C

API=${API:-24}
JOBS=${JOBS:-$(nproc)}
NDK=${NDK:-$HOME/android/ndk/android-ndk-r27b}
SRC_CACHE=${SRC_CACHE:?SRC_CACHE is required}
JNI_OUT=${JNI_OUT:?JNI_OUT is required}
ASSET_ZIP=${ASSET_ZIP:?ASSET_ZIP is required}
ASSET_MANIFEST=${ASSET_MANIFEST:?ASSET_MANIFEST is required}
WORK=${WORK:-$HOME/.cache/nibi-android-runtime/work}
REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v python3 >/dev/null || die "缺少 python3"
command -v tar >/dev/null || die "缺少 tar"
[ -d "$NDK" ] || die "NDK 不存在：$NDK（设置 NDK=/path/to/android-ndk-r27b）"

HOST_TAG=linux-x86_64
TC=$NDK/toolchains/llvm/prebuilt/$HOST_TAG
[ -d "$TC" ] || die "NDK toolchain 不存在：$TC"
export PATH="$TC/bin:$PATH"

CC=$TC/bin/aarch64-linux-android${API}-clang
AR=$TC/bin/llvm-ar
RANLIB=$TC/bin/llvm-ranlib
STRIP_BIN=$TC/bin/llvm-strip
NM=$TC/bin/llvm-nm
OBJCOPY=$TC/bin/llvm-objcopy
[ -x "$CC" ] || die "缺少 $CC"
export CC AR RANLIB

SRC=$WORK/src
OUT=$WORK/out
BUILD_ASSETS=$WORK/assets
rm -rf "$SRC" "$OUT" "$BUILD_ASSETS"
mkdir -p "$SRC" "$OUT" "$BUILD_ASSETS"

CFLAGS_TARGET="-O2 -fPIE -fstack-protector-strong -D_FORTIFY_SOURCE=2"
LDFLAGS_TARGET="-Wl,-z,max-page-size=16384 -pie"
[ "${DEBUG:-0}" = "1" ] && CFLAGS_TARGET="$CFLAGS_TARGET -g"

unpack() {
  local name=$1 archive=$2
  [ -f "$SRC_CACHE/$archive" ] || die "缺少源码包：$SRC_CACHE/$archive"
  tar -xf "$SRC_CACHE/$archive" -C "$SRC"
  [ -d "$SRC/$name" ] || die "解压后找不到 $SRC/$name"
}

log "解压并打补丁（bash/busybox）"
unpack ncurses-6.5 ncurses-6.5.tar.gz
unpack readline-8.2.13 readline-8.2.13.tar.gz
unpack bash-5.2.37 bash-5.2.37.tar.gz
unpack busybox-1.36.1 busybox-1.36.1.tar.bz2
unpack zlib-1.3.1 zlib-1.3.1.tar.gz
unpack openssl-3.5.4 openssl-3.5.4.tar.gz
unpack curl-8.16.0 curl-8.16.0.tar.xz
unpack git-2.51.0 git-2.51.0.tar.xz
unpack jq-1.7.1 jq-1.7.1.tar.gz
unpack zip30 zip30.tar.gz
python3 "$REPO_ROOT/scripts/android-runtime/patch-sources.py" "$SRC"

log "ncurses 6.5"
(
  cd "$SRC/ncurses-6.5"
  ./configure --host=aarch64-linux-android --prefix="$OUT" \
    --without-shared --with-normal --without-debug --without-ada \
    --without-manpages --without-progs --without-tests \
    --enable-widec --with-termlib --disable-db-install >/dev/null
  make -j"$JOBS" >/dev/null
  make install >/dev/null
)

log "readline 8.2.13"
(
  cd "$SRC/readline-8.2.13"
  CPPFLAGS="-I$OUT/include -I$OUT/include/ncursesw" \
  LDFLAGS="-L$OUT/lib" \
  LIBS="-lncursesw -ltinfow" \
  ./configure --host=aarch64-linux-android --prefix="$OUT" \
    --disable-shared --enable-static --with-curses >/dev/null
  make -j"$JOBS" >/dev/null
  make install >/dev/null
  # install-static's optional "backup old library" step can race a fresh tree;
  # make sure the static archives are present for bash's configure.
  [ -f "$OUT/lib/libreadline.a" ] || install -m 644 libreadline.a "$OUT/lib/libreadline.a"
  [ -f "$OUT/lib/libhistory.a" ] || install -m 644 libhistory.a "$OUT/lib/libhistory.a"
)

log "bash 5.2.37"
(
  cd "$SRC/bash-5.2.37"
  CPPFLAGS="-I$OUT/include -I$OUT/include/ncursesw" \
  LDFLAGS="-L$OUT/lib $LDFLAGS_TARGET" \
  bash_cv_getcwd_malloc=yes \
  ./configure --host=aarch64-linux-android --prefix="$OUT" \
    --without-bash-malloc --disable-nls \
    --with-installed-readline="$OUT" >/dev/null
  cp "$REPO_ROOT/scripts/android-runtime/src/nibi_mblen.c" ./nibi_compat.c
  "$CC" $CFLAGS_TARGET -c nibi_compat.c -o nibi_compat.o
  make -j"$JOBS" CPPFLAGS="-Dmblen=nibi_mblen" \
    LDFLAGS="-L$OUT/lib $LDFLAGS_TARGET $PWD/nibi_compat.o" >/dev/null
)

log "busybox 1.36.1"
(
  cd "$SRC/busybox-1.36.1"
  # Applets that bionic cannot compile (SysV IPC, utmp, mntent, kd.h, ...) or
  # that make no sense for an app uid (mount/swap/tc). This list is part of the
  # product boundary, not an accident: it is documented in T9/T10.
  #
  # FEATURE_SUID must stay off: with it, every applet tagged BB_SUID_DROP calls
  # setgid(ruid)/setuid(ruid) at startup. Android's app seccomp policy kills
  # setgid (arm64 syscall 144) with SIGSYS, so every busybox applet dies with
  # "Unknown signal 31" inside the app process (shell/run-as domains don't).
  make ARCH=arm64 CROSS_COMPILE= HOSTCC=gcc CC="$CC" defconfig >/dev/null
  for k in LOADFONT SETFONT HOSTID FEATURE_UTMP FEATURE_WTMP LOGNAME SU \
    FEATURE_SUID FEATURE_SUID_CONFIG FEATURE_SUID_CONFIG_QUIET \
    FEATURE_SYNC_FANCY ADJTIMEX ETHER_WAKE CONSPY SEEDRNG LOGREAD \
    FEATURE_IPC_SYSLOG SHELL_HUSH HUSH HUSH_BASH_COMPAT HUSH_BRACE_EXPANSION \
    HUSH_LINENO_VAR HUSH_ECHO HUSH_PRINTF HUSH_TEST HUSH_HELP HUSH_EXPORT \
    HUSH_READONLY HUSH_KILL HUSH_WAIT HUSH_COMMAND HUSH_TRAP HUSH_TYPE \
    HUSH_TIMES HUSH_READ HUSH_SET HUSH_UNSET HUSH_ULIMIT HUSH_UMASK \
    HUSH_GETOPTS FSCK_MINIX MKFS_MINIX IPCRM IPCS MOUNT SWAPON SWAPOFF TC; do
    sed -i "s/^CONFIG_${k}=y$/# CONFIG_${k} is not set/" .config
  done
  make ARCH=arm64 CROSS_COMPILE= HOSTCC=gcc CC="$CC" oldconfig </dev/null >/dev/null
  bb_make() {
    # BusyBox 的 BB_GLOBAL_CONST 是给 gcc 的优化技巧；clang 18 会把
    # `ptr_to_globals` 的 store 与后续 G 的读取重排，awk 启动即写 NULL+4。
    # 上游 libbb.h 注释给的官方开关就是把它定义为空。
    make ARCH=arm64 CROSS_COMPILE= HOSTCC=gcc CC="$CC" \
      AR="$AR" NM="$NM" STRIP="$STRIP_BIN" OBJCOPY="$OBJCOPY" \
      LDFLAGS="$LDFLAGS_TARGET" LDLIBS="m" \
      CONFIG_EXTRA_CFLAGS="-DBB_GLOBAL_CONST=" "$@"
  }
  bb_make -j"$JOBS" >/dev/null
  rm -rf "$WORK/busybox-root"
  # The install target must see the same CC/AR; otherwise it can rebuild
  # `busybox` with the host gcc and silently stage an x86-64 binary.
  bb_make CONFIG_PREFIX="$WORK/busybox-root" install >/dev/null
)

log "zlib 1.3.1"
(
  cd "$SRC/zlib-1.3.1"
  CC="$CC" CFLAGS="$CFLAGS_TARGET" ./configure --prefix="$OUT" >/dev/null
  make -j"$JOBS" >/dev/null
  make install >/dev/null
)

log "openssl 3.5.4"
(
  cd "$SRC/openssl-3.5.4"
  ANDROID_NDK_ROOT="$NDK" ./Configure android-arm64 \
    -D__ANDROID_API__="$API" --prefix="$OUT" --openssldir="$OUT/ssl" \
    no-shared no-tests no-apps no-docs -fPIC >/dev/null
  # Configure 生成的 configdata.pm 比 Makefile 新时，第一次 make 只重生成
  # Makefile 并退出 1（WSL/Windows 时钟轻微漂移也会触发）；按上游提示再来一次。
  make -j"$JOBS" >/dev/null || make -j"$JOBS" >/dev/null
  make install_sw >/dev/null
)

log "curl 8.16.0"
(
  cd "$SRC/curl-8.16.0"
  export PKG_CONFIG_PATH="$OUT/lib/pkgconfig"
  CPPFLAGS="-I$OUT/include" LDFLAGS="-L$OUT/lib $LDFLAGS_TARGET" \
  ./configure --host=aarch64-linux-android --prefix="$OUT" \
    --with-openssl="$OUT" --with-zlib="$OUT" \
    --disable-shared --enable-static \
    --without-libpsl --without-libidn2 --without-brotli --without-zstd \
    --disable-ldap --disable-ldaps --disable-manual \
    --disable-dict --disable-telnet --disable-tftp --disable-rtsp \
    --with-ca-path=/system/etc/security/cacerts >/dev/null
  make -j"$JOBS" >/dev/null
  make install >/dev/null
)

log "git 2.51.0"
(
  cd "$SRC/git-2.51.0"
  git_make() {
    make -j"$JOBS" prefix="$OUT/git" \
      NO_GETTEXT=1 NO_TCLTK=1 NO_PERL=1 NO_PYTHON=1 NO_ICONV=1 \
      NO_EXPAT=1 NO_OPENSSL=1 NO_PTHREADS=1 NO_GECOS_IN_PWENT=1 \
      HAVE_SYNC_FILE_RANGE= CSPRNG_METHOD=arc4random \
      CURL_CONFIG="$OUT/bin/curl-config" \
      CC="$CC" AR="$AR" RANLIB="$RANLIB" \
      CFLAGS="$CFLAGS_TARGET -I$OUT/include" \
      LDFLAGS="-L$OUT/lib $LDFLAGS_TARGET" \
      NO_INSTALL_HARDLINKS=1 "$@"
  }
  git_make >/dev/null
  git_make install >/dev/null
)

log "jq 1.7.1"
(
  cd "$SRC/jq-1.7.1"
  # oniguruma 用 jq 自带的 modules/oniguruma（静态进 jq），正则函数 test/match 可用。
  ./configure --host=aarch64-linux-android --prefix="$OUT" \
    --disable-maintainer-mode --disable-docs \
    --enable-static --disable-shared --with-oniguruma=builtin \
    CC="$CC" AR="$AR" RANLIB="$RANLIB" \
    CFLAGS="$CFLAGS_TARGET" LDFLAGS="$LDFLAGS_TARGET" >/dev/null
  make -j"$JOBS" >/dev/null
)

log "zip 3.0"
(
  cd "$SRC/zip30"
  # Info-ZIP 没有 configure：直接给 unix/Makefile 传 Android 需要的宏。
  # 不要用 generic/flags：那套探测的是构建机 glibc 头，会误判 NO_DIR/NO_ERRNO。
  make -f unix/Makefile zip CC="$CC" BIND="$CC" OBJA="" E="" EXE="" \
    CFLAGS="$CFLAGS_TARGET -I. -DUNIX -DUIDGID_NOT_16BIT -DUNICODE_SUPPORT \
-DHAVE_DIRENT_H -DHAVE_TERMIOS_H -DNO_BZIP2_SUPPORT -DLARGE_FILE_SUPPORT" \
    LFLAGS1="-pie" LFLAGS2="-Wl,-z,max-page-size=16384" >/dev/null
)

log "nibi-run / nibi-hook"
mkdir -p "$JNI_OUT"
"$CC" $CFLAGS_TARGET -Wl,-z,max-page-size=16384 -pie \
  "$REPO_ROOT/scripts/android-runtime/src/nibi_run.c" -o "$JNI_OUT/libnibi_run.so"
"$CC" $CFLAGS_TARGET -Wl,-z,max-page-size=16384 -pie \
  "$REPO_ROOT/scripts/android-runtime/src/nibi_hook.c" -o "$JNI_OUT/libnibi_hook.so"

stage() {
  local src=$1 dst=$2
  [ -f "$src" ] || die "缺少产物：$src"
  install -m 0755 "$src" "$JNI_OUT/$dst"
  if [ "${STRIP:-1}" = "1" ] && [ "${DEBUG:-0}" != "1" ]; then
    "$STRIP_BIN" --strip-unneeded "$JNI_OUT/$dst"
  fi
}

log "落盘 jniLibs"
stage "$SRC/bash-5.2.37/bash" libbash.so
stage "$SRC/busybox-1.36.1/busybox" libbusybox.so
stage "$SRC/jq-1.7.1/jq" libjq.so
stage "$SRC/zip30/zip" libzip.so
stage "$OUT/git/bin/git" libgit.so
stage "$OUT/git/libexec/git-core/git-remote-http" libgit_remote_http.so
for f in libnibi_run.so libnibi_hook.so; do
  if [ "${STRIP:-1}" = "1" ] && [ "${DEBUG:-0}" != "1" ]; then
    "$STRIP_BIN" --strip-unneeded "$JNI_OUT/$f"
  fi
done

log "打包运行时资源"
mkdir -p "$BUILD_ASSETS/etc" "$BUILD_ASSETS/git-scripts" \
  "$BUILD_ASSETS/git-core" "$BUILD_ASSETS/share/git-core" "$BUILD_ASSETS/terminfo"
cp "$REPO_ROOT/scripts/android-runtime/assets/bash_env.sh" "$BUILD_ASSETS/etc/bash_env.sh"
cp "$REPO_ROOT/scripts/android-runtime/assets/cacert.pem" "$BUILD_ASSETS/etc/cacert.pem"

# Applet names: busybox's own install target creates one symlink per applet.
find "$WORK/busybox-root" -type l -printf '%f\n' | sort -u > "$WORK/applets.txt"
cp "$WORK/applets.txt" "$BUILD_ASSETS/etc/busybox-applets.txt"

# git 脚本分两类：
#  - exec：git 直接 exec（app 数据 noexec）→ git-scripts/ 真文件 + git-core/ symlink→nibi-run
#  - source-only：被 `.` 读取（git-sh-setup 还会按 exec-path 绝对路径 source git-sh-i18n）
#    → 必须留在 git-core/ 当普通文件，不能换成二进制 symlink
printf '%s\n' \
  git-submodule git-filter-branch git-instaweb git-web--browse \
  git-difftool--helper git-mergetool git-merge-octopus git-merge-one-file \
  git-merge-resolve git-request-pull git-quiltimport > "$WORK/scripts.txt"
printf '%s\n' git-sh-setup git-sh-i18n git-mergetool--lib > "$WORK/script-libs.txt"
while read -r script; do
  src="$OUT/git/libexec/git-core/$script"
  [ -f "$src" ] || die "git 脚本缺失：$script"
  cp "$src" "$BUILD_ASSETS/git-scripts/$script"
done < "$WORK/scripts.txt"
while read -r script; do
  src="$OUT/git/libexec/git-core/$script"
  [ -f "$src" ] || die "git source 脚本缺失：$script"
  cp "$src" "$BUILD_ASSETS/git-core/$script"
done < "$WORK/script-libs.txt"

cp -R "$OUT/git/share/git-core/templates" "$BUILD_ASSETS/share/git-core/templates"

# Terminfo is optional: a cross ncurses cannot build tic, so use the host's
# database only when available (CI images usually have ncurses-bin).
TERMINFO_FLAG=""
if command -v infocmp >/dev/null && command -v tic >/dev/null; then
  : > "$WORK/terminfo.src"
  for term in xterm-256color screen-256color xterm screen linux; do
    infocmp -x -1 "$term" >> "$WORK/terminfo.src" 2>/dev/null || true
    printf '\n' >> "$WORK/terminfo.src"
  done
  if [ -s "$WORK/terminfo.src" ]; then
    tic -x -o "$BUILD_ASSETS/terminfo" "$WORK/terminfo.src" >/dev/null 2>&1 || true
  fi
  [ -n "$(find "$BUILD_ASSETS/terminfo" -type f -print -quit)" ] && TERMINFO_FLAG=1
fi

python3 "$REPO_ROOT/scripts/android-runtime/make-manifest.py" \
  --out "$WORK/manifest.json" \
  --sources "$REPO_ROOT/scripts/android-runtime/sources.json" \
  --git-install "$OUT/git" \
  --applets "$WORK/applets.txt" \
  --scripts "$WORK/scripts.txt" \
  --script-libs "$WORK/script-libs.txt" \
  --terminfo "$TERMINFO_FLAG"

python3 "$REPO_ROOT/scripts/android-runtime/make-assets-zip.py" "$BUILD_ASSETS" "$ASSET_ZIP"
mkdir -p "$(dirname "$ASSET_MANIFEST")"
cp "$WORK/manifest.json" "$ASSET_MANIFEST"

log "完成"
for f in "$JNI_OUT"/libbash.so "$JNI_OUT"/libbusybox.so "$JNI_OUT"/libjq.so \
  "$JNI_OUT"/libzip.so "$JNI_OUT"/libgit.so "$JNI_OUT"/libgit_remote_http.so \
  "$JNI_OUT"/libnibi_run.so "$JNI_OUT"/libnibi_hook.so; do
  printf '%-28s %10s bytes  %s\n' "$(basename "$f")" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -d' ' -f1)"
done
printf '%-28s %10s bytes  %s\n' "$(basename "$ASSET_ZIP")" "$(stat -c %s "$ASSET_ZIP")" "$(sha256sum "$ASSET_ZIP" | cut -d' ' -f1)"
