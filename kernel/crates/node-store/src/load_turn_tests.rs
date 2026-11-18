//! 冷读取的“当前轮以错误结束”（session-lifecycle.md §6.3.1）：按当前轮输入的 `turn_usage.status`。

use nibi_kernel_api::ids::{CommandId, MessageId, OwnerEpoch, SessionId, TurnId};
use nibi_kernel_api::metering::CallStatus;
use nibi_kernel_api::store::{Fact, FactBatch, SessionStore, TurnAnchor};

use crate::tests::{TestStore, started, user};

fn batch(facts: Vec<Fact>, prompt: &str, turn: &str) -> FactBatch {
    FactBatch {
        owner_epoch: OwnerEpoch::LOCAL,
        command: None::<CommandId>,
        facts,
        turn: Some(TurnAnchor {
            prompt: MessageId::new(prompt),
            turn: Some(TurnId::new(turn)),
        }),
    }
}

#[tokio::test]
async fn a_turn_that_ended_with_an_error_is_reported_until_the_next_input() {
    let t = TestStore::new();
    started(&t, "sess_1").await;
    let session = SessionId::new("sess_1");
    let ended = |status| Fact::TurnEnded { status };
    t.store
        .commit(
            &session,
            batch(vec![user("msg_u1", "one")], "msg_u1", "turn_1"),
        )
        .await
        .unwrap();
    assert!(!t.store.load(&session).await.unwrap().last_turn_failed);
    t.store
        .commit(
            &session,
            batch(vec![ended(CallStatus::Error)], "msg_u1", "turn_1"),
        )
        .await
        .unwrap();
    assert!(t.store.load(&session).await.unwrap().last_turn_failed);
    t.store
        .commit(
            &session,
            batch(vec![user("msg_u2", "two")], "msg_u2", "turn_2"),
        )
        .await
        .unwrap();
    assert!(!t.store.load(&session).await.unwrap().last_turn_failed);
    t.store
        .commit(
            &session,
            batch(vec![ended(CallStatus::Cancelled)], "msg_u2", "turn_2"),
        )
        .await
        .unwrap();
    assert!(!t.store.load(&session).await.unwrap().last_turn_failed);
}

/// 每轮结束落库的 `/context` 分析（`Fact::Entry` 的 `context_usage`）：冷读取带回
/// usedTokens 与分项，上下文环与侧边面板不能退回“只数消息”的估算。同一 id 只留最后一次。
#[tokio::test]
async fn the_last_context_analysis_survives_a_cold_read() {
    let t = TestStore::new();
    started(&t, "sess_1").await;
    let session = SessionId::new("sess_1");
    let entry = |used: u64| Fact::Entry {
        kind: "context_usage".to_owned(),
        id: "latest".to_owned(),
        data: serde_json::json!({
            "used_tokens": used,
            "max_tokens": 1_000_000,
            "window_tokens": 1_000_000,
            "breakdown": [
                { "source": "system_prompt", "chars": 8_000 },
                { "source": "system_tool_schemas", "chars": 24_000 },
            ],
        }),
    };
    t.store
        .commit(
            &session,
            batch(
                vec![user("msg_u1", "one"), entry(17_300)],
                "msg_u1",
                "turn_1",
            ),
        )
        .await
        .unwrap();
    let loaded = t.store.load(&session).await.unwrap();
    let usage = loaded.context_usage.expect("the stored analysis");
    assert_eq!(usage.used_tokens, 17_300);
    assert_eq!(usage.window_tokens, Some(1_000_000));
    assert_eq!(usage.breakdown.len(), 2);
    assert_eq!(usage.breakdown[0].source, "system_prompt");

    // 同一 id（latest）覆盖：第二次分析取代第一次。
    t.store
        .commit(
            &session,
            batch(vec![entry(19_100)], "msg_u1", "turn_1"),
        )
        .await
        .unwrap();
    let loaded = t.store.load(&session).await.unwrap();
    assert_eq!(loaded.context_usage.unwrap().used_tokens, 19_100);
}
