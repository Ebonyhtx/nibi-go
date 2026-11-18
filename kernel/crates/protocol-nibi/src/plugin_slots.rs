//! `pluginSlot.*` 增量：插件进程主动推的会话槽数据（`notifications/nibiGo/slot`）。
//!
//! ext 的连接任务把通知写成 [`McpSlotEvent`]；这里按会话投进它的 live 投影。与 `pluginUi.*`
//! 同一条路：**只进 live 帧**，不改快照、不进冷恢复（推送是瞬时数据，重开会话不应复活旧值）。

use std::sync::Arc;

use nibi_kernel_api::mcp_slot::McpSlotEvent;
use nibi_kernel_base::Spawner;
use serde_json::{Value, json};
use tokio::sync::mpsc::UnboundedReceiver;

use crate::server::Server;

/// 转投任务：通道关闭（ext 释放）时结束。
pub(crate) fn forward(
    server: Arc<Server>,
    spawner: &Spawner,
    mut events: UnboundedReceiver<McpSlotEvent>,
) {
    std::mem::drop(spawner.spawn("mcp-slot-events", async move {
        while let Some(event) = events.recv().await {
            let (session, delta) = split(event);
            let Ok(live) = server.live(&session).await else {
                continue;
            };
            live.sink.emit_delta(delta).await;
        }
    }));
}

/// 事件 → （会话, 一条 `pluginSlot.data` 增量）。App 的槽按 `serverName` 匹配 manifest，
/// `pluginId` 只做展示/过滤。
fn split(event: McpSlotEvent) -> (nibi_kernel_api::ids::SessionId, Value) {
    (
        event.session,
        json!({
            "op": "pluginSlot.data",
            "pluginId": event.plugin_id,
            "serverName": event.server,
            "slot": event.slot,
            "data": event.data,
        }),
    )
}

#[cfg(test)]
#[path = "plugin_slots_tests.rs"]
mod tests;