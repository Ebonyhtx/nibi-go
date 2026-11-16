#!/usr/bin/env bash
# Build Node.js 24 LTS for Android/bionic with the NDK (self-built, no Termux).
#
# Upstream `android-configure` drives gyp; patch-node.py fixes the known
# bionic/host-tool problems. Output: $JNI_OUT/libnode.so + $ASSET_DIR/npm.
#
# Required env: SRC_CACHE, NDK, JNI_OUT, ASSET_DIR
# Optional: API (24), JOBS, WORK

set -euo pipefail
export LC_ALL=C

API=${API:-24}
JOBS=${JOBS:-$(nproc)}
NDK=${NDK:?NDK is required}
SRC_CACHE=${SRC_CACHE:?SRC_CACHE is required}
JNI_OUT=${JNI_OUT:?JNI_OUT is required}
ASSET_DIR=${ASSET_DIR:?ASSET_DIR is required}
WORK=${WORK:-$HOME/.cache/nibi-android-runtimes}
REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
SRC=$WORK/src
BUILD=$WORK/node

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ -d "$NDK" ] || die "NDK 不存在：$NDK"
[ -f "$SRC_CACHE/node-v24.22.3.tar.xz" ] || die "缺少 node 源码包"

TC=$NDK/toolchains/llvm/prebuilt/linux-x86_64
CC=$TC/bin/aarch64-linux-android${API}-clang
CXX=$TC/bin/aarch64-linux-android${API}-clang++
AR=$TC/bin/llvm-ar
[ -x "$CC" ] || die "缺少 $CC"
# gyp 生成的 Makefile 用 CC.target ?= $(CC)，只传 CC.host 会让 target 退回
# 宿主 cc（x86 上立刻在 arm_neon.h 处失败）。
export CC CXX AR

log "解包 Node 24"
rm -rf "$SRC/node-v24.22.3" "$BUILD"
mkdir -p "$SRC" "$BUILD"
tar -xf "$SRC_CACHE/node-v24.22.3.tar.xz" -C "$SRC"
TREE=$SRC/node-v24.22.3

log "配置 Android arm64（API $API；host 工具用 gcc/g++）"
# gyp only generates the host toolset when it sees CC_host/CXX_host in the
# environment (CrossCompileRequested); make variables alone are not enough.
export CC_host=gcc CXX_host=g++ AR_host=ar
(
  cd "$TREE"
  # Without CC_host/CXX_host, configure infers host_arch from the NDK clang
  # (arm64), so host mksnapshot tries to assemble AArch64 code with x86 g++.
  ./android-configure "$NDK" "$API" arm64 >/dev/null
)

log "打 bionic/host-tool 补丁"
python3 "$REPO_ROOT/scripts/android-runtimes/patch-node.py" "$TREE"

log "重新生成 gyp（源补丁改了 v8.gyp/toolchain.gypi，需带 host 工具集）"
(
  cd "$TREE"
  python3 tools/gyp_node.py -fmake --ignore-environment \
    -Dtarget_arch=arm64 -Dv8_target_arch=arm64 -Dandroid_target_arch=arm64 \
    -Dhost_os=linux -DOS=android -Dandroid_ndk_path="$NDK" \
    -Dpython="$(command -v python3)" \
    -Dwant_separate_host_toolset=1 -Dhost_arch=x64 >/dev/null
  # gyp 重写 *.mk 会丢掉下面的链接补丁，所以补丁必须在 gyp 之后重跑。
  python3 "$REPO_ROOT/scripts/android-runtimes/patch-node.py" "$TREE" >/dev/null
  # 防止 make 以 gyp 文件更新为由再生成一次（那会再次丢掉 *.mk 补丁）。
  touch out/Makefile
)

log "构建 NDK cpufeatures"
mkdir -p "$BUILD/cpufeatures"
"$CC" -O2 -fPIC -c "$NDK/sources/android/cpufeatures/cpu-features.c" \
  -o "$BUILD/cpufeatures/cpu-features.o"
"$AR" rcs "$BUILD/cpufeatures/libcpufeatures.a" "$BUILD/cpufeatures/cpu-features.o"

log "编译 Node（宿主工具用 gcc/g++；clang 偶发 rename 失败，用 -k 多轮补齐）"
(
  cd "$TREE"
  built=0
  for _ in $(seq 1 30); do
    if make -j"$JOBS" -k node \
      CC.host=gcc CXX.host=g++ LINK.host=g++ AR.host=ar \
      CPFEATURES_DIR="$BUILD/cpufeatures" >>"$WORK/node-build.log" 2>&1; then
      built=1
    fi
    if [ -f out/Release/node ]; then
      built=1
      break
    fi
    sleep 1
  done
  [ "$built" = 1 ] || die "Node 编译失败，日志：$WORK/node-build.log"
)

log "落盘 Node"
mkdir -p "$JNI_OUT"
install -m 0755 "$TREE/out/Release/node" "$JNI_OUT/libnode.so"
"$TC/bin/llvm-strip" --strip-unneeded "$JNI_OUT/libnode.so"

log "打包 npm"
rm -rf "$ASSET_DIR/npm"
mkdir -p "$ASSET_DIR"
cp -a "$TREE/deps/npm" "$ASSET_DIR/npm"
cp "$REPO_ROOT/scripts/android-runtimes/assets/nibi-npm.js" "$ASSET_DIR/npm/nibi-npm.js"
cp "$REPO_ROOT/scripts/android-runtimes/assets/nibi-npx.js" "$ASSET_DIR/npm/nibi-npx.js"
# 文档/测试对运行无影响，删掉以控制体积；keep node_modules.
rm -rf "$ASSET_DIR/npm/man" "$ASSET_DIR/npm/docs" "$ASSET_DIR/npm/test" 2>/dev/null || true

log "完成"
ls -lh "$JNI_OUT/libnode.so"
du -sh "$ASSET_DIR/npm"
