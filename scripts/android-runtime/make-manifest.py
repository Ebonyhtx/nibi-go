#!/usr/bin/env python3
"""Build the runtime manifest consumed by the Android host.

The manifest is intentionally data-only: the host creates every symlink from
`bin`, `gitCore` and `hooks`, and copies `gitScripts` from the asset zip.
"""

import argparse
import json
import os
import pathlib
import stat

HOOKS = [
    "applypatch-msg",
    "pre-applypatch",
    "post-applypatch",
    "pre-commit",
    "pre-merge-commit",
    "prepare-commit-msg",
    "commit-msg",
    "post-commit",
    "pre-rebase",
    "post-checkout",
    "post-merge",
    "pre-push",
    "pre-receive",
    "update",
    "post-receive",
    "post-update",
    "push-to-checkout",
    "pre-auto-gc",
    "post-rewrite",
    "sendemail-validate",
    "fsmonitor-watchman",
    "post-index-change",
]

GIT_SCRIPTS = [
    "git-sh-setup",
    "git-sh-i18n",
    "git-mergetool--lib",
    "git-mergetool",
    "git-difftool--helper",
    "git-filter-branch",
    "git-instaweb",
    "git-web--browse",
    "git-merge-octopus",
    "git-merge-one-file",
    "git-merge-resolve",
    "git-request-pull",
    "git-submodule",
    "git-quiltimport",
]

BIN = {
    "bash": "libbash.so",
    "busybox": "libbusybox.so",
    "git": "libgit.so",
    "nibi-run": "libnibi_run.so",
}

REMOTE = {"git-remote-http", "git-remote-https"}


def is_elf(path: pathlib.Path) -> bool:
    try:
        with path.open("rb") as f:
            return f.read(4) == b"\x7fELF"
    except OSError:
        return False


def git_core(git_install: pathlib.Path) -> dict[str, str]:
    core = git_install / "libexec" / "git-core"
    out: dict[str, str] = {}
    for entry in sorted(core.iterdir()):
        name = entry.name
        if name in REMOTE:
            out[name] = "libgit_remote_http.so"
            continue
        if name == "git" or (name.startswith("git-") and is_elf(entry)):
            # git dispatches builtins in-process; git-daemon/http-backend/etc.
            # are all reachable through `git <name>`.
            out[name] = "libgit.so"
            continue
        if entry.is_symlink() and name.startswith("git-"):
            out[name] = "libgit.so"
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--sources", required=True)
    ap.add_argument("--git-install", required=True)
    ap.add_argument("--applets", required=True)
    ap.add_argument("--scripts", required=True)
    ap.add_argument("--script-libs", required=True)
    ap.add_argument("--terminfo", default="")
    args = ap.parse_args()

    sources = json.loads(pathlib.Path(args.sources).read_text(encoding="utf-8"))
    packages = {item["name"]: item["version"] for item in sources["sources"]}
    applets = [
        line.strip()
        for line in pathlib.Path(args.applets).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    scripts = [
        line.strip()
        for line in pathlib.Path(args.scripts).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    script_libs = [
        line.strip()
        for line in pathlib.Path(args.script_libs).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    manifest = {
        "schema": 1,
        "version": "runtime-1:" + ",".join(f"{k}={v}" for k, v in sorted(packages.items())),
        "packages": packages,
        "bin": BIN,
        "applets": applets,
        "gitCore": git_core(pathlib.Path(args.git_install)),
        "gitScripts": scripts,
        "gitScriptLibs": script_libs,
        "hooks": HOOKS,
        "terminfo": bool(args.terminfo),
    }
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {out}: {len(applets)} applets, {len(manifest['gitCore'])} git-core entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
