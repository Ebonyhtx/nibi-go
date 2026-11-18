//! MCP 插件推给槽的实时数据（`notifications/nibiGo/slot`）。
//!
//! 与工具结果里的 `_meta.nibiGo.push` 不同，这条通道不需要模型回合：插件进程可以主动推一条
//! 会话级槽数据（状态条、面板），App 收到 `pluginSlot.data` 增量后合并到对应槽的 `data.push`。
//! 只有会话级 MCP 连接能路由（工作区级连接没有会话可投）；没有接收方（CLI/TUI）时直接丢弃。
//!
//! 形状：`{"jsonrpc":"2.0","method":"notifications/nibiGo/slot",
//!        "params":{"slot":"focus-live","data":{"status":"专注中 12:34"}}}`。

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ids::SessionId;

/// 单条槽数据的序列化上限（与工具结果推送同一预算）。
pub const SLOT_DATA_MAX_BYTES: usize = 16 * 1024;
/// 槽 id 的最大字符数（与 manifest 的 id 规则同一形状）。
pub const SLOT_ID_MAX_CHARS: usize = 64;

/// 插件推给某个会话槽的一条数据。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpSlotEvent {
    pub session: SessionId,
    /// 服务器绑定的插件 id（插件服务器取插件名，其余用服务器名；App 只做展示/过滤）。
    pub plugin_id: String,
    /// MCP 服务器名（App 用它匹配 manifest 的 `runtime.serverName`）。
    pub server: String,
    /// 槽贡献的 id（`turn.note` / `composer.strip` / 面板条目里的 id）。
    pub slot: String,
    /// 槽视图里 `data.push` 的根数据。
    pub data: Value,
}

/// 解析一条 `notifications/nibiGo/slot` 的 `params`；坏数据返回原因（只丢这一条）。
pub fn read_slot(params: &Value) -> Result<(String, Value), String> {
    let slot = params
        .get("slot")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|slot| !slot.is_empty())
        .ok_or_else(|| "slot is required".to_owned())?;
    if slot.chars().count() > SLOT_ID_MAX_CHARS {
        return Err(format!("slot is longer than {SLOT_ID_MAX_CHARS} characters"));
    }
    let valid = {
        let mut chars = slot.chars();
        matches!(chars.next(), Some(first) if first.is_ascii_lowercase() || first.is_ascii_digit())
            && chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '.' | '_' | '-'))
    };
    if !valid {
        return Err("slot must match [a-z0-9][a-z0-9._-]*".to_owned());
    }
    let data = params
        .get("data")
        .filter(|data| data.is_object())
        .cloned()
        .ok_or_else(|| "data must be an object".to_owned())?;
    let bytes = serde_json::to_vec(&data).map_err(|error| error.to_string())?;
    if bytes.len() > SLOT_DATA_MAX_BYTES {
        return Err(format!("data is larger than {SLOT_DATA_MAX_BYTES} bytes"));
    }
    Ok((slot.to_owned(), data))
}

#[cfg(test)]
#[path = "mcp_slot_tests.rs"]
mod tests;
