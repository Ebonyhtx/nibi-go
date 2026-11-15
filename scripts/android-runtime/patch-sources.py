#!/usr/bin/env python3
"""Apply the minimal Android/bionic patches to pinned upstream sources.

We deliberately use exact string replacement rather than fuzzy `patch` so a
silent upstream change fails the build instead of producing a half-patched
binary. Every edit pins its expected occurrence count.
"""

import pathlib
import sys

EDITS = {
    "busybox-1.36.1": [
        (
            "networking/ifconfig.c",
            "#if ENABLE_FEATURE_IPV6\nstruct in6_ifreq {",
            "#if ENABLE_FEATURE_IPV6 && !defined(__ANDROID__)\nstruct in6_ifreq {",
            1,
        ),
        (
            "networking/interface.c",
            "# ifndef _LINUX_IN6_H\n/*",
            "# if !defined(_LINUX_IN6_H) && !defined(__ANDROID__)\n/*",
            1,
        ),
    ],
    "bash-5.2.37": [
        (
            "bashline.c",
            "#if defined (__WIN32__) || defined (__OPENNT) || !defined (HAVE_GRP_H)",
            "#if defined (__WIN32__) || defined (__OPENNT) || defined (__ANDROID__) || !defined (HAVE_GRP_H)",
            1,
        ),
        (
            "lib/termcap/tparam.c",
            "#if defined (HAVE_STRING_H)\n#include <string.h>\n#endif",
            "#if defined (HAVE_UNISTD_H)\n#  include <unistd.h>\n#endif\n\n"
            "#if defined (HAVE_STRING_H)\n#include <string.h>\n#endif",
            1,
        ),
    ],
    "git-2.51.0": [
        (
            "ident.c",
            "\tpw = getpwuid(getuid());\n\tif (!pw) {",
            "\tpw = getpwuid(getuid());\n\t/* bionic can return a struct with NULL fields for app UIDs. */\n"
            "\tif (!pw || !pw->pw_name) {",
            1,
        ),
    ],
}


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: patch-sources.py <src-dir>", file=sys.stderr)
        return 2
    root = pathlib.Path(sys.argv[1])
    for tree, edits in EDITS.items():
        base = root / tree
        if not base.is_dir():
            print(f"missing source tree: {base}", file=sys.stderr)
            return 1
        for rel, old, new, expected in edits:
            path = base / rel
            text = path.read_text(encoding="utf-8")
            found = text.count(old)
            if found != expected:
                print(
                    f"patch anchor mismatch: {path} expected {expected} occurrence(s), found {found}",
                    file=sys.stderr,
                )
                return 1
            path.write_text(text.replace(old, new), encoding="utf-8")
            print(f"patched {tree}/{rel} ({expected})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
