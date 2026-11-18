use super::*;

fn closed() -> Notice {
    Notice::Closed {
        reason: Some("gone".to_owned()),
        session_expired: false,
        exited: false,
    }
}

/// F11（R1-18）：连接任务忙时，同一种 `list_changed` 只留一条（收到后重新拉整份清单），关闭排在最后且不丢。
#[tokio::test]
async fn list_changes_merge_by_kind_and_close_comes_last() {
    let (sender, mut receiver) = channel();
    for _ in 0..1000 {
        sender.send(Notice::ListChanged("tools".to_owned()));
        sender.send(Notice::ListChanged("prompts".to_owned()));
    }
    sender.send(closed());
    drop(sender);
    let mut seen = Vec::new();
    while let Some(notice) = receiver.recv().await {
        seen.push(notice);
    }
    assert_eq!(
        seen,
        [
            Notice::ListChanged("tools".to_owned()),
            Notice::ListChanged("prompts".to_owned()),
            closed(),
        ]
    );
}

/// 取走之后再来的同一种照常送达。
#[tokio::test]
async fn a_kind_taken_away_can_arrive_again() {
    let (sender, mut receiver) = channel();
    sender.send(Notice::ListChanged("tools".to_owned()));
    assert_eq!(
        receiver.recv().await,
        Some(Notice::ListChanged("tools".to_owned()))
    );
    sender.send(Notice::ListChanged("tools".to_owned()));
    assert_eq!(
        receiver.recv().await,
        Some(Notice::ListChanged("tools".to_owned()))
    );
}

/// 插件槽推送按槽合并：同一个槽只留最新一条，连接任务忙时不会被状态条刷爆。
#[tokio::test]
async fn slot_pushes_merge_by_slot_and_keep_the_latest() {
    let (sender, mut receiver) = channel();
    for second in 0..100 {
        sender.send(Notice::SlotData {
            slot: "focus-live".to_owned(),
            data: serde_json::json!({"second": second}),
        });
    }
    assert_eq!(
        receiver.recv().await,
        Some(Notice::SlotData {
            slot: "focus-live".to_owned(),
            data: serde_json::json!({"second": 99}),
        })
    );
    drop(sender);
    assert_eq!(receiver.recv().await, None);
}
