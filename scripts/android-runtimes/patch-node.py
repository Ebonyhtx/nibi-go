#!/usr/bin/env python3
"""Android/bionic patches for the Node 24 self-build.

Upstream `android-configure` produces a working gyp setup, but the tree needs
a few small corrections:

1. V8 treats bionic as BSD, so `HAVE_EXECINFO_H` turns on `backtrace*`, which
   bionic does not provide.
2. gyp copies target CFLAGS into host tools, including the ARM64-only
   `-mbranch-protection=standard`, which host g++ rejects.
3. The `openssl-cli` and `node` link lines miss NDK cpufeatures, so
   `android_getCpuFeatures` is undefined.
4. Node has no Android link flags, so LOAD segments stay at 4 KB alignment.
   Android 16 devices with 16 KB pages require 16 KB LOAD alignment.
5. V8 gates the POSIX trap handler on the *target* OS, and gyp reports
   `OS="android"` for both toolsets. The target correctly disables the trap
   handler on Android (`V8_TRAP_HANDLER_SUPPORTED` is false), but the host
   mksnapshot runs an arm64 simulator on x64 Linux and does need
   `handler-inside-posix.cc` / `handler-outside-posix.cc` /
   `handler-outside-simulator.cc`; without them the host link fails.

Each edit pins its anchor; a silent upstream change fails the build.
"""

import pathlib
import re
import sys


def replace_once(path: pathlib.Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text and new in text:
        return  # already patched
    if text.count(old) != 1:
        raise SystemExit(f"anchor mismatch in {path}: {text.count(old)} occurrence(s)")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: patch-node.py <node-source-dir>", file=sys.stderr)
        return 2
    root = pathlib.Path(sys.argv[1])
    stack = root / "deps/v8/src/base/debug/stack_trace_posix.cc"
    replace_once(
        stack,
        "#if V8_LIBC_GLIBC || V8_LIBC_BSD || V8_LIBC_UCLIBC || V8_OS_SOLARIS",
        "#if (V8_LIBC_GLIBC || V8_LIBC_BSD || V8_LIBC_UCLIBC || V8_OS_SOLARIS) && \\\n"
        "    !V8_LIBC_BIONIC",
    )

    # The host toolset inherits v8_target_arch=arm64, so g++ would try to
    # assemble AArch64 inline asm while building host mksnapshot. The host
    # path never executes it; provide a stub for non-aarch64 hosts.
    push = root / "deps/v8/src/heap/base/asm/arm64/push_registers_asm.cc"
    text = push.read_text(encoding="utf-8")
    if "#if defined(__aarch64__)" not in text:
        text = text.replace("\nasm(\n", "\n#if defined(__aarch64__)\nasm(\n", 1)
        marker = "    );\n"
        if text.count(marker) != 1:
            raise SystemExit("push_registers_asm.cc end anchor mismatch")
        text = text.replace(
            marker,
            "    );\n#else\nextern \"C\" void PushAllRegistersAndIterateStack(void*, void*, void*) {}\n#endif\n",
            1,
        )
        push.write_text(text, encoding="utf-8")

    common = root / "common.gypi"
    replace_once(
        common,
        "['OS == \"android\"', {\n"
        "            'cflags': [ '-fPIC' ],\n"
        "            'ldflags': [ '-fPIC' ]\n"
        "          }],",
        "['OS == \"android\"', {\n"
        "            'cflags': [ '-fPIC' ],\n"
        "            'ldflags': [ '-fPIC', '-Wl,-z,max-page-size=16384' ]\n"
        "          }],",
    )
    replace_once(
        common,
        "['OS == \"android\"', {\n"
        "            'cflags': [ '-fPIC', '-I<(android_ndk_path)/sources/android/cpufeatures' ],\n"
        "            'ldflags': [ '-fPIC' ]\n"
        "          }],",
        "['OS == \"android\"', {\n"
        "            'cflags': [ '-fPIC', '-I<(android_ndk_path)/sources/android/cpufeatures' ],\n"
        "            'ldflags': [ '-fPIC', '-Wl,-z,max-page-size=16384' ]\n"
        "          }],",
    )

    cfi = root / "tools/v8_gypfiles/toolchain.gypi"
    replace_once(
        cfi,
        "['v8_control_flow_integrity==1', {\n            'cflags': [ '-mbranch-protection=standard' ],",
        "['v8_control_flow_integrity==1 and _toolset==\"target\"', {\n"
        "            'cflags': [ '-mbranch-protection=standard' ],",
    )

    # Host mksnapshot runs an arm64 simulator on x64; it needs the POSIX trap
    # handler and simulator probe even though gyp's OS is "android" for every
    # toolset. The target build must keep V8's Android exclusion.
    gyp = root / "tools/v8_gypfiles/v8.gyp"
    text = gyp.read_text(encoding="utf-8")
    marker = 'OS=="android" and _toolset=="host" and host_arch=="x64"'
    if marker not in text:
        anchor = (
            "            ['v8_enable_webassembly==1', {\n"
            "              'conditions': [\n"
            '                [\'((_toolset=="host" and host_arch=="arm64" or '
            '_toolset=="target" and target_arch=="arm64") and '
            '(OS in "linux mac ios openharmony")) or'
        )
        if text.count(anchor) != 1:
            raise SystemExit("v8.gyp arm64 webassembly anchor mismatch")
        insert = (
            "            ['v8_enable_webassembly==1', {\n"
            "              'conditions': [\n"
            '                [\'' + marker + "', {\n"
            "                  'sources': [\n"
            "                    '<(V8_ROOT)/src/trap-handler/handler-inside-posix.cc',\n"
            "                    '<(V8_ROOT)/src/trap-handler/handler-outside-posix.cc',\n"
            "                    '<(V8_ROOT)/src/trap-handler/handler-outside-simulator.cc',\n"
            "                  ],\n"
            "                }],\n"
            '                [\'((_toolset=="host" and host_arch=="arm64" or '
            '_toolset=="target" and target_arch=="arm64") and '
            '(OS in "linux mac ios openharmony")) or'
        )
        gyp.write_text(text.replace(anchor, insert, 1), encoding="utf-8")

    out = root / "out"
    if not out.is_dir():
        print("out/ not found; run android-configure first", file=sys.stderr)
        return 1

    for host_mk in out.rglob("*.host.mk"):
        text = host_mk.read_text(encoding="utf-8")
        if "-mbranch-protection=standard" in text:
            host_mk.write_text(
                "\n".join(
                    line for line in text.splitlines() if "-mbranch-protection=standard" not in line
                )
                + "\n",
                encoding="utf-8",
            )

    for rel in ("deps/openssl/openssl-cli.target.mk", "node.target.mk"):
        mk = out / rel
        if not mk.is_file():
            raise SystemExit(f"missing {mk}")
        text = mk.read_text(encoding="utf-8")
        if "-lcpufeatures" in text:
            continue
        text = text.replace(
            "\t-llog\n",
            "\t-llog \\\n\t-L$(CPFEATURES_DIR) \\\n\t-lcpufeatures\n",
            1,
        )
        mk.write_text(text, encoding="utf-8")
        print(f"patched {mk}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
