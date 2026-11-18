use nibi_kernel_api::ids::SessionId;
use nibi_kernel_api::mcp_slot::McpSlotEvent;
use serde_json::json;

use super::split;

#[test]
fn a_slot_push_becomes_a_plugin_slot_delta() {
    let (session, delta) = split(McpSlotEvent {
        session: SessionId::new("s1"),
        plugin_id: "nibigo_focus".to_owned(),
        server: "nibigo_focus".to_owned(),
        slot: "focus-live".to_owned(),
        data: json!({"status": "专注中 12:34"}),
    });
    assert_eq!(session.as_str(), "s1");
    assert_eq!(delta["op"], "pluginSlot.data");
    assert_eq!(delta["serverName"], "nibigo_focus");
    assert_eq!(delta["slot"], "focus-live");
    assert_eq!(delta["data"]["status"], "专注中 12:34");
}