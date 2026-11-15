#!/usr/bin/env python3
"""Create a deterministic zip for the Android runtime assets.

Scripts are read by bash/git, not execve()'d, so they do not need the
executable bit. Fixed timestamps keep the asset hash stable across rebuilds.
"""

import pathlib
import sys
import zipfile


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: make-assets-zip.py <src-dir> <out.zip>", file=sys.stderr)
        return 2
    src = pathlib.Path(sys.argv[1])
    out = pathlib.Path(sys.argv[2])
    if not src.is_dir():
        print(f"missing asset dir: {src}", file=sys.stderr)
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(p for p in src.rglob("*") if p.is_file()):
            rel = path.relative_to(src).as_posix()
            info = zipfile.ZipInfo(rel, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, path.read_bytes())
    print(f"wrote {out} ({out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
