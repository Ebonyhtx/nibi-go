use serde_json::json;

use crate::mcp_slot::{read_slot, SLOT_DATA_MAX_BYTES, SLOT_ID_MAX_CHARS};

#[test]
fn a_valid_slot_push_is_read() {
    let (slot, data) = read_slot(&json!({
        "slot": "focus-live",
        "data": {"status": "专注中 12:34", "remaining": 754}
    }))
    .expect("valid");
    assert_eq!(slot, "focus-live");
    assert_eq!(data["remaining"], 754);
}

#[test]
fn bad_slots_and_data_are_rejected() {
    assert!(read_slot(&json!({"data": {}})).is_err());
    assert!(read_slot(&json!({"slot": "Bad Slot", "data": {}})).is_err());
    assert!(read_slot(&json!({"slot": "x".repeat(SLOT_ID_MAX_CHARS + 1), "data": {}})).is_err());
    assert!(read_slot(&json!({"slot": "ok", "data": []})).is_err());
    assert!(read_slot(&json!({"slot": "ok"})).is_err());
}

#[test]
fn oversized_data_is_rejected() {
    let value = "x".repeat(SLOT_DATA_MAX_BYTES + 64);
    assert!(read_slot(&json!({"slot": "ok", "data": {"big": value}})).is_err());
}
