//! 子代理的模型选择（工作线 F49）与权限模式收紧（修复线 A2）。

use nibi_kernel_api::model::{ModelConnection, ModelSelection};
use nibi_kernel_api::permission::{ExecutionState, PermissionMode};

use super::{execution, mode, restrict, selection};

#[test]
fn a_child_keeps_the_team_project_of_the_parent() {
    let parent = ModelSelection {
        provider: "account:bigmodel-team-coding-plan".to_owned(),
        model: "GLM-5.3".to_owned(),
        reasoning: Some("high".to_owned()),
        connection: Some(Box::new(ModelConnection {
            product_id: "prod-1".to_owned(),
            organization_id: "org-t".to_owned(),
            project_id: "p-t".to_owned(),
        })),
    };
    assert_eq!(selection(&parent, Some("inherit"), None), parent);
    let child = selection(&parent, Some("GLM-5.3-Flash"), Some("low".to_owned()));
    assert_eq!(child.model, "GLM-5.3-Flash");
    assert_eq!(child.reasoning.as_deref(), Some("low"));
    assert_eq!(child.connection, parent.connection);
}

/// Node 3.17.2 `restrictPermissionMode` 的整张表（从严到宽 plan < build < edit < guarded < yolo；auto 不参与）。
#[test]
fn a_declared_mode_only_restricts_the_parent() {
    use PermissionMode as P;
    let cases = [
        (P::Default, P::BypassPermissions, P::Default),
        (P::Default, P::Guarded, P::Default),
        (P::Default, P::AcceptEdits, P::Default),
        (P::Default, P::Default, P::Default),
        (P::Default, P::Plan, P::Plan),
        (P::Default, P::Auto, P::Default),
        (P::Plan, P::AcceptEdits, P::Plan),
        (P::Plan, P::BypassPermissions, P::Plan),
        (P::AcceptEdits, P::BypassPermissions, P::AcceptEdits),
        (P::AcceptEdits, P::Default, P::Default),
        (P::AcceptEdits, P::Plan, P::Plan),
        (P::Guarded, P::BypassPermissions, P::Guarded),
        (P::Guarded, P::AcceptEdits, P::AcceptEdits),
        (P::Guarded, P::Plan, P::Plan),
        (P::BypassPermissions, P::BypassPermissions, P::BypassPermissions),
        (P::BypassPermissions, P::Guarded, P::Guarded),
        (P::BypassPermissions, P::Plan, P::Plan),
        (P::BypassPermissions, P::Auto, P::BypassPermissions),
        (P::Auto, P::Plan, P::Auto),
        (P::Auto, P::BypassPermissions, P::Auto),
    ];
    for (parent, child, expected) in cases {
        assert_eq!(restrict(parent, child), expected, "{parent:?} + {child:?}");
    }
}

/// 没有声明时继承父运行（含 plan）；declared 的 `bypassPermissions` 在父不是 yolo 时不会生效
/// （修复线 A2 的原契约，现在由整张收紧表覆盖）。
#[test]
fn a_child_without_a_declared_mode_inherits_the_parent() {
    use PermissionMode as P;
    for parent in [
        P::Default,
        P::AcceptEdits,
        P::Plan,
        P::Guarded,
        P::BypassPermissions,
        P::DontAsk,
        P::Auto,
    ] {
        assert_eq!(mode(parent, None), parent, "{parent:?}");
    }
    assert_eq!(mode(P::Default, Some(P::BypassPermissions)), P::Default);
    assert_eq!(mode(P::Guarded, Some(P::AcceptEdits)), P::AcceptEdits);
    assert_eq!(mode(P::Plan, Some(P::Default)), P::Plan);
}

/// plan + guarded 的父会话：子代理保留 plan 开关与基础模式（修复线 A1/A2）；声明只能收紧。
#[test]
fn a_child_carries_the_parent_base_mode_and_plan() {
    let parent = ExecutionState::from(PermissionMode::Guarded).with_plan(true);
    assert_eq!(execution(parent, None), parent);
    // 声明 build/edit 不会把 plan 父会话变宽：仍是 plan，基础模式仍是 guarded。
    for declared in [PermissionMode::Default, PermissionMode::AcceptEdits] {
        assert_eq!(execution(parent, Some(declared)), parent, "{declared:?}");
    }
    // 其它基础模式下声明取更严格的一个，plan 关着。
    let parent = ExecutionState::from(PermissionMode::Default);
    assert_eq!(
        execution(parent, Some(PermissionMode::Guarded)),
        ExecutionState::from(PermissionMode::Default)
    );
    assert_eq!(
        execution(parent, Some(PermissionMode::Plan)),
        ExecutionState::from(PermissionMode::Plan)
    );
    // plan 是最严格的：yolo + plan 的父会话里声明 guarded 也还是 plan（基础模式仍是 yolo）。
    let parent = ExecutionState::from(PermissionMode::BypassPermissions).with_plan(true);
    assert_eq!(execution(parent, Some(PermissionMode::Guarded)), parent);
    // 没有 plan 时 yolo 可以收紧成 guarded。
    let parent = ExecutionState::from(PermissionMode::BypassPermissions);
    assert_eq!(
        execution(parent, Some(PermissionMode::Guarded)),
        ExecutionState::from(PermissionMode::Guarded)
    );
}

// ── 建子会话的原子性：写入失败不登记 ─────────────────────────────────────────

use std::sync::Arc;

use nibi_kernel_api::env::EnvPath;
use nibi_kernel_api::ids::{AgentId, SessionId};

use crate::live::{AgentState, LiveAgent, Shown};
use crate::report::Ending;
use crate::runs::RunInfo;
use crate::test_support::{harness, workspace};

/// 一次 `spawn::create` 的入参（`Agent` 工具里组装的那一份）。
fn spawn_agent(agent: &AgentId, child: &SessionId, parent: &SessionId) -> LiveAgent {
    LiveAgent {
        agent: agent.clone(),
        child: child.clone(),
        parent: parent.clone(),
        root: parent.clone(),
        owner: None,
        depth: 1,
        tool_use: None,
        description: "Find".to_owned(),
        definition: Arc::new(
            crate::definitions::builtins()
                .into_iter()
                .find(|definition| definition.agent_type == "Explore")
                .unwrap(),
        ),
        workspace: workspace(),
        selection: nibi_kernel_api::testing::selection(),
        execution: ExecutionState::default(),
        background: false,
        asks: None,
        state: AgentState::Finished(Ending::Completed),
        shown: Shown::default(),
        fork_prefix: None,
        machine: None,
    }
}

fn run_info(parent: &SessionId) -> RunInfo {
    RunInfo {
        session: parent.clone(),
        workspace: workspace(),
        selection: nibi_kernel_api::testing::selection(),
    }
}

/// 子会话的写入失败（`create_and_commit` 报错）时：库里没有会话行，`live` 与继承的附加目录里也
/// 没有它——登记全部放在写成功之后（以前先建行、再登记、最后提交，提交失败会同时留下孤儿行与登记）。
/// 前一半是成功对照：同样的调用在写成功时确实继承了目录。
#[tokio::test]
async fn a_failed_child_session_write_registers_nothing() {
    let harness = harness(None);
    let core = &*harness.agents.core;
    let parent = SessionId::new("sess_parent");
    harness
        .directories
        .set(&parent, vec![EnvPath::new("/extra")]);

    // 对照：写成功时子会话继承父会话的附加目录。
    let (agent_id, child) = super::ids(core);
    super::create(
        core,
        spawn_agent(&agent_id, &child, &parent),
        &run_info(&parent),
        "List.",
    )
    .await
    .unwrap();
    assert_eq!(
        harness.directories.get(&child),
        vec![EnvPath::new("/extra")]
    );

    // 写入失败：没有行、没有继承、没有 `live` 条目。
    harness.store.fail_next_create_and_commit();
    let (agent_id, failed) = super::ids(core);
    let error = super::create(
        core,
        spawn_agent(&agent_id, &failed, &parent),
        &run_info(&parent),
        "List.",
    )
    .await
    .err()
    .expect("the injected store failure must fail the spawn");
    assert!(
        error.to_string().contains("injected create_and_commit failure"),
        "{error}"
    );
    assert!(!harness.store.contains(&failed), "no session row");
    assert!(
        harness.directories.get(&failed).is_empty(),
        "the inheritance must run only after the write succeeds"
    );
    let (live, _) = core.live.snapshot_in(&parent);
    assert_eq!(live.len(), 1, "only the first child is live");
    assert_eq!(live[0].child, child);
}
