//! 会话级 HOME/TMPDIR（Android 宿主 `NIBI_SESSION_HOME=1`）。不依赖 Unix shell，可在各平台跑。

use super::*;

fn config(env: Vec<(String, String)>, temp: &std::path::Path) -> ShellConfig {
    ShellConfig {
        scratch: temp.join("scratch"),
        ledger: temp.join("ledger"),
        bash: Some(PathBuf::from("/bin/bash")),
        bwrap: None,
        embedded: None,
        env: env.into(),
    }
}

#[test]
fn session_environment_follows_the_session_only_when_the_host_asks() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = std::path::Path::new("/data/user/0/p/files/workspaces/s1");
    let session = SessionId::new("s1");

    // 桌面不设 NIBI_SESSION_HOME：命令环境完全不变。
    assert!(session_environment(&config(Vec::new(), temp.path()), workspace, &session).is_empty());

    let values = session_environment(
        &config(
            vec![
                ("NIBI_SESSION_HOME".to_owned(), "1".to_owned()),
                (
                    "NIBI_SESSION_TMP_ROOT".to_owned(),
                    temp.path().join("cache").to_string_lossy().into_owned(),
                ),
            ],
            temp.path(),
        ),
        workspace,
        &session,
    );
    let map: BTreeMap<_, _> = values.into_iter().collect();
    assert_eq!(map["HOME"], workspace.to_string_lossy());
    assert_eq!(
        map["TMPDIR"],
        temp.path().join("cache").join("s1").to_string_lossy()
    );
    assert!(temp.path().join("cache").join("s1").is_dir());

    // 没给临时根时只改 HOME，TMPDIR 保持进程级。
    let values = session_environment(
        &config(
            vec![("NIBI_SESSION_HOME".to_owned(), "1".to_owned())],
            temp.path(),
        ),
        workspace,
        &session,
    );
    assert_eq!(values.len(), 1);
    assert_eq!(values[0].0, "HOME");
}