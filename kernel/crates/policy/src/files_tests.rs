use nibi_kernel_api::permission::{PermissionMode, RuleBehavior};

use super::*;
use crate::test_support::run;

fn verdict(
    mode: PermissionMode,
    entries: &[(RuleBehavior, &str)],
    access: Access,
    path: &str,
) -> Check {
    run(mode, entries, |inputs| check(access, Some(path), inputs))
}

#[test]
fn reads_inside_are_allowed_and_outside_ask() {
    assert_eq!(
        verdict(PermissionMode::Default, &[], Access::Read, "a.txt"),
        Check::Allow
    );
    assert_eq!(
        verdict(PermissionMode::Default, &[], Access::Read, "/etc/hosts"),
        Check::ask(
            "NIBI requested permissions to read from /etc/hosts, but you haven't granted it yet."
        )
    );
    assert_eq!(
        verdict(
            PermissionMode::Default,
            &[(RuleBehavior::Allow, "Read(//etc/**)")],
            Access::Read,
            "/etc/hosts"
        ),
        Check::Allow
    );
    assert_eq!(
        verdict(
            PermissionMode::Default,
            &[(RuleBehavior::Deny, "Read(*.env)")],
            Access::Read,
            ".env"
        ),
        Check::deny("Permission to read /w/.env has been denied.")
    );
}

#[test]
fn writes_need_accept_edits_inside_and_always_ask_for_sensitive_paths() {
    assert_eq!(
        verdict(PermissionMode::Default, &[], Access::Write, "src/a.rs"),
        Check::ask(
            "NIBI requested permissions to write to /w/src/a.rs, but you haven't granted it yet."
        )
    );
    assert_eq!(
        verdict(PermissionMode::AcceptEdits, &[], Access::Write, "src/a.rs"),
        Check::Allow
    );
    assert_eq!(
        verdict(PermissionMode::AcceptEdits, &[], Access::Write, "/tmp/x"),
        Check::ask(
            "NIBI requested permissions to write to /tmp/x, but it is outside the workspace and additional directories for this session ('/w'). Allowing runs the write as requested."
        )
    );
    assert_eq!(
        verdict(
            PermissionMode::AcceptEdits,
            &[],
            Access::Write,
            ".git/config"
        ),
        Check::Ask {
            message:
                "NIBI requested permissions to edit /w/.git/config which is a sensitive file."
                    .to_owned(),
            kind: AskKind::Safety,
            suggestions: Vec::new(),
        }
    );
    assert_eq!(
        verdict(
            PermissionMode::Default,
            &[(RuleBehavior::Allow, "Edit(src/**)")],
            Access::Write,
            "src/a.rs"
        ),
        Check::Allow
    );
    assert_eq!(
        verdict(
            PermissionMode::AcceptEdits,
            &[(RuleBehavior::Deny, "Edit(src/**)")],
            Access::Write,
            "src/a.rs"
        ),
        Check::deny("Permission to edit /w/src/a.rs has been denied.")
    );
}

/// 敏感文件表用 zcode 的文件名（修复线 F58，README §4.1）：项目配置是
/// `nibi.json`（带 MCP 服务器与 hooks），zcode 没有 `.nibi.json`。以前表里是机械替换出来的 `.nibi.json`。
#[test]
fn the_project_config_is_a_sensitive_file() {
    assert_eq!(
        verdict(
            PermissionMode::AcceptEdits,
            &[],
            Access::Write,
            "nibi.json"
        ),
        Check::Ask {
            message: "NIBI requested permissions to edit /w/nibi.json which is a sensitive file."
                .to_owned(),
            kind: AskKind::Safety,
            suggestions: Vec::new(),
        }
    );
    assert_eq!(
        verdict(
            PermissionMode::AcceptEdits,
            &[],
            Access::Write,
            ".nibi.json"
        ),
        Check::Allow
    );
    assert!(matches!(
        verdict(PermissionMode::AcceptEdits, &[], Access::Write, ".mcp.json"),
        Check::Ask { .. }
    ));
}

/// F14：判定与工具用同一条路径规则（权限检查与执行都先规范化路径，
/// tools-files.md §3.2）。工具会去掉首尾空白，判定若不去，`" /etc/hosts"` 会被当成工作区里的相对路径而放行。
#[test]
fn file_paths_are_resolved_like_the_tools_resolve_them() {
    assert_eq!(
        verdict(PermissionMode::Default, &[], Access::Read, " /etc/hosts\n"),
        Check::ask(
            "NIBI requested permissions to read from /etc/hosts, but you haven't granted it yet."
        )
    );
    // 规则按 NFC 的路径匹配：分解形式的 `é` 也命中按合成形式写的 deny 规则。
    assert_eq!(
        verdict(
            PermissionMode::Default,
            &[(RuleBehavior::Deny, "Read(caf\u{e9}.env)")],
            Access::Read,
            "cafe\u{301}.env"
        ),
        Check::deny("Permission to read /w/caf\u{e9}.env has been denied.")
    );
    // 只认 `~/`：`~x` 是工作区里的文件。
    assert_eq!(
        verdict(PermissionMode::Default, &[], Access::Read, "~x"),
        Check::Allow
    );
}

/// Phase 6：workspace 外的写入仍然询问，不硬拒绝；完全访问由判决链放行。
#[test]
fn writes_outside_the_workspace_ask_in_every_mode() {
    for mode in [
        PermissionMode::Default,
        PermissionMode::AcceptEdits,
        PermissionMode::BypassPermissions,
        PermissionMode::Plan,
    ] {
        assert!(
            matches!(
                verdict(mode, &[], Access::Write, "/tmp/x"),
                Check::Ask { .. }
            ),
            "{mode:?} 下工作区外写入应询问"
        );
    }
}

/// additionalDirectories 仍在边界内：Default 下询问、AcceptEdits 下放行（不是拒绝）。
#[test]
fn additional_directories_are_inside_the_boundary() {
    let mut paths = crate::test_support::paths();
    paths.roots.push("/tmp/work".to_owned());
    let write = |mode| {
        crate::test_support::run_in(&paths, mode, &[], |inputs| {
            check(Access::Write, Some("/tmp/work/a.txt"), inputs)
        })
    };
    assert_eq!(write(PermissionMode::AcceptEdits), Check::Allow);
    assert!(matches!(
        write(PermissionMode::Default),
        Check::Ask { .. }
    ));
}

/// 符号链接逃逸：workspace 里的链接指向外部时，写入按真实路径询问，不当作工作区内放行。
#[cfg(unix)]
#[test]
fn symlink_escape_asks() {
    use std::os::unix::fs::symlink;

    let base = std::env::temp_dir().join(format!(
        "nibi-ws-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let workspace = base.join("ws");
    let outside = base.join("outside");
    std::fs::create_dir_all(&workspace).expect("workspace");
    std::fs::create_dir_all(&outside).expect("outside");
    let link = workspace.join("link");
    symlink(&outside, &link).expect("symlink");

    let mut paths = crate::test_support::paths();
    paths.roots = vec![workspace.to_string_lossy().into_owned()];
    let target = link.join("x.txt").to_string_lossy().into_owned();
    let result = crate::test_support::run_in(
        &paths,
        PermissionMode::AcceptEdits,
        &[],
        |inputs| check(Access::Write, Some(&target), inputs),
    );
    assert!(matches!(result, Check::Ask { .. }), "{result:?}");

    let _ = std::fs::remove_dir_all(&base);
}
