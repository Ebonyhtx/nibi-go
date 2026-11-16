//! 子进程环境的投影（shell-permissions.md §2.3）与 `SHELL` 的唯一来源（修复线 F58，README §4.1）。

use std::collections::BTreeMap;

use crate::LocalEnvironment;
use crate::shell::ShellConfig;

fn snapshot(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
        .collect()
}

fn environment(pairs: &[(&str, &str)]) -> LocalEnvironment {
    LocalEnvironment::new(None).with_shell(ShellConfig {
        env: snapshot(pairs).into(),
        ..ShellConfig::default()
    })
}

/// git、pdf、worktree 的子进程继承 `SHELL`，没有缺省值（继承进程环境）。以前没设时写成空串。
#[test]
fn git_children_get_shell_only_when_it_is_set() {
    let unset = environment(&[("PATH", "/usr/bin")]).git_env();
    assert_eq!(unset.get("SHELL"), None, "{unset:?}");
    let set = environment(&[("PATH", "/usr/bin"), ("SHELL", "/bin/zsh")]).git_env();
    assert_eq!(set.get("SHELL").map(String::as_str), Some("/bin/zsh"));
}

/// MCP stdio 服务器同样继承，没有 `/bin/sh` 的缺省值；配置的 `env` 在后。
#[test]
fn mcp_servers_get_shell_only_when_it_is_set() {
    let none = BTreeMap::new();
    let unset = crate::mcp::stdio::child_env(
        &snapshot(&[("PATH", "/usr/bin")]),
        &Default::default(),
        &none,
    );
    assert_eq!(unset.get("SHELL"), None, "{unset:?}");
    let set = crate::mcp::stdio::child_env(
        &snapshot(&[("SHELL", "/bin/zsh")]),
        &Default::default(),
        &none,
    );
    assert_eq!(set.get("SHELL").map(String::as_str), Some("/bin/zsh"));
    let configured = BTreeMap::from([("SHELL".to_owned(), "/bin/fish".to_owned())]);
    let overridden = crate::mcp::stdio::child_env(
        &snapshot(&[("SHELL", "/bin/zsh")]),
        &Default::default(),
        &configured,
    );
    assert_eq!(
        overridden.get("SHELL").map(String::as_str),
        Some("/bin/fish")
    );
}

/// Bash 命令写实际执行的 shell（不变）。
#[test]
fn commands_get_the_shell_that_runs_them() {
    let env = super::project(&snapshot(&[("SHELL", "/bin/zsh")]), Some("/bin/bash"));
    assert_eq!(env.get("SHELL").map(String::as_str), Some("/bin/bash"));
    assert_eq!(env.get("GIT_EDITOR").map(String::as_str), Some("true"));
    assert_eq!(env.get("ZCODE").map(String::as_str), Some("1"));
    // 工具子进程默认 UTF-8（Node `applyExecutionTextEnv` 同口径）：Windows 上 Python 否则按
    // cp936 写 stdout，一个 `✓` 就 UnicodeEncodeError。
    assert_eq!(
        env.get("PYTHONIOENCODING").map(String::as_str),
        Some("utf-8")
    );
    assert_eq!(env.get("PYTHONUTF8").map(String::as_str), Some("1"));
}

/// Android 随包运行时（D25 Phase 2/3）：Bash 工具的环境是白名单投影，Node/Python/
/// git 依赖的路径变量必须通过；模型凭据必须继续被挡住。
#[test]
fn android_runtime_variables_pass_but_credentials_do_not() {
    let env = super::project(
        &snapshot(&[
            ("PATH", "/data/user/0/p/files/runtime/bin:/system/bin"),
            ("LD_LIBRARY_PATH", "/data/app/p/lib/arm64"),
            ("NIBI_RUNTIME_DIR", "/data/user/0/p/files/runtime"),
            ("NIBI_BIN", "/data/user/0/p/files/runtime/bin"),
            ("PYTHONHOME", "/data/user/0/p/files/runtime/python"),
            (
                "GIT_CONFIG_GLOBAL",
                "/data/user/0/p/files/runtime/etc/gitconfig",
            ),
            (
                "GIT_SSL_CAINFO",
                "/data/user/0/p/files/runtime/etc/cacert.pem",
            ),
            ("NIBI_API_KEY", "sk-secret"),
            ("NIBI_MODEL_BASE_URL", "http://127.0.0.1:9099/v1"),
        ]),
        None,
    );
    assert_eq!(
        env.get("LD_LIBRARY_PATH").map(String::as_str),
        Some("/data/app/p/lib/arm64")
    );
    assert_eq!(
        env.get("NIBI_RUNTIME_DIR").map(String::as_str),
        Some("/data/user/0/p/files/runtime")
    );
    assert_eq!(
        env.get("GIT_CONFIG_GLOBAL").map(String::as_str),
        Some("/data/user/0/p/files/runtime/etc/gitconfig")
    );
    assert!(!env.contains_key("NIBI_API_KEY"), "{env:?}");
    assert!(!env.contains_key("NIBI_MODEL_BASE_URL"), "{env:?}");
}

/// MCP node fallback（docs/design/v2/mcp-node-fallback.md）：Host 注入的两个变量必须随
/// PATH 一起投影给 stdio 子进程，否则 shim 以 127 失败；它们不是凭据。
#[test]
fn mcp_children_get_the_node_fallback_variables() {
    let snapshot = snapshot(&[
        ("PATH", "/opt/nibi/node-fallback/v1:/usr/bin"),
        ("NIBI_NODE_FALLBACK_EXEC_PATH", "/Applications/NIBI.app/NIBI"),
        ("NIBI_NODE_FALLBACK_NPM_ROOT", "/Applications/NIBI.app/glm/node-runtime/npm"),
    ]);
    let env = crate::mcp::stdio::child_env(&snapshot, &Default::default(), &BTreeMap::new());
    assert_eq!(
        env.get("PATH").map(String::as_str),
        Some("/opt/nibi/node-fallback/v1:/usr/bin")
    );
    assert_eq!(
        env.get("NIBI_NODE_FALLBACK_EXEC_PATH").map(String::as_str),
        Some("/Applications/NIBI.app/NIBI")
    );
    assert_eq!(
        env.get("NIBI_NODE_FALLBACK_NPM_ROOT").map(String::as_str),
        Some("/Applications/NIBI.app/glm/node-runtime/npm")
    );
}
