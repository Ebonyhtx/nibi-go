use nibi_kernel_api::ids::MessageId;
use nibi_kernel_api::message::{
    AssistantMessage, CompactBoundary, CompactTrigger, ContentBlock, Message, SystemMessage,
    Usage, UserMessage, UserOrigin,
};

use super::*;

fn user(text: &str) -> Message {
    Message::User(UserMessage {
        id: MessageId::new("u"),
        content: vec![ContentBlock::Text {
            text: text.to_owned(),
        }],
        origin: UserOrigin::Human,
    })
}

fn assistant(id: &str, input: u64) -> Message {
    Message::Assistant(AssistantMessage {
        id: MessageId::new(id),
        content: Vec::new(),
        model: "m".to_owned(),
        stop_reason: None,
        usage: Some(Usage {
            input_tokens: input,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        }),
    })
}

fn boundary(id: &str) -> Message {
    Message::System(SystemMessage::CompactBoundary(CompactBoundary {
        id: MessageId::new(id),
        trigger: CompactTrigger::Manual,
        pre_tokens: 100,
        summary: MessageId::new("summary"),
        preserved: None,
        discovered_tools: Vec::new(),
    }))
}

/// 压缩后保留段里的 assistant 带着压缩前那次请求的 input，不能当压缩后的锚点。
#[test]
fn restored_assistant_before_boundary_is_not_an_anchor() {
    let head = boundary("msg_5_boundary");
    let restored = assistant("msg_3_restored", 100_000);
    assert_eq!(measured(&[&head, &restored]), None);

    let after = assistant("msg_9_after", 5_000);
    let tail = user("hello");
    assert_eq!(
        measured(&[&head, &restored, &after, &tail]),
        Some((5_000, messages([&tail])))
    );
}

/// 没有压缩边界时行为不变：取最近一条带用量的 assistant。
#[test]
fn without_boundary_the_latest_usage_is_the_anchor() {
    let first = assistant("msg_1_a", 100_000);
    let last = assistant("msg_2_b", 5_000);
    assert_eq!(measured(&[&first, &last]), Some((5_000, 0)));
}

#[test]
fn rough_is_a_quarter_of_utf16_units_rounded() {
    assert_eq!(rough(""), 0);
    assert_eq!(rough("ab"), 1);
    assert_eq!(rough("abcdef"), 2);
    assert_eq!(rough("abcdefgh"), 2);
    assert_eq!(rough("😀😀"), 1);
}

/// 几条消息的估算是每条之和（每条的算法在 kernel-api 的 `message_tokens`，锚点与 attachment 的用例也在那里）。
#[test]
fn messages_sum_each_message() {
    let (a, b) = (user(&"y".repeat(4000)), user(&"z".repeat(40)));
    assert_eq!(messages([&a, &b]), 1000 + 10);
}
