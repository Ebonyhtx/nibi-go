//! 解析结果与 Node 一致（platform.md §7）：同一份内置配置、个人配置夹具与账号 overlay，Node 的 Provider
//! registry 给出的可执行模型（`tests/fixtures/node-registry.json`，由 `scripts/rust-cli/provider-registry-golden.mts`
//! 生成）与这里的解析结果逐项相同。

use serde_json::{Map, Value, json};

use super::*;
use crate::providers::BUNDLED_BUILTIN;
use crate::providers::resolve::{AccountLayer, resolve};

const PERSONAL: &str = include_str!("../../tests/fixtures/personal.json");
const NODE_REGISTRY: &str = include_str!("../../tests/fixtures/node-registry.json");
const ENTITLED: &str = "account:zai-individual-coding-plan";

fn layer(builtin: &Value, entitled: &str) -> AccountLayer {
    let mut providers = Map::new();
    for rule in builtin["config"]["providerConfigRules"]["providerRules"]
        .as_array()
        .unwrap()
    {
        if rule["config"]["access"]["type"] == "zhipu-account" {
            let id = rule["providerId"].as_str().unwrap();
            providers.insert(
                id.to_owned(),
                json!({"access": {"type": "zhipu-account", "entitled": id == entitled}}),
            );
        }
    }
    AccountLayer {
        providers,
        states: Map::new(),
    }
}

fn fixture_snapshot() -> Snapshot {
    // 账号 provider 的规则只存在于测试夹具；随包资产已移除上游会员套餐登录。
    let builtin: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/account-plan-builtin.json"
    ))
    .unwrap();
    let personal: Value = serde_json::from_str(PERSONAL).unwrap();
    let account = layer(&builtin, ENTITLED);
    snapshot(
        &resolve(&builtin["config"], &personal["config"], Some(&account)),
        &Default::default(),
    )
}

#[test]
fn executable_models_match_the_node_registry() {
    let ours: Vec<Value> = fixture_snapshot()
        .templates
        .iter()
        .map(|template| {
            json!({
                "provider": template.provider,
                "model": template.model,
                "apiType": template.protocol,
                "baseUrl": template.base_url,
                "hidden": template.hidden,
                "reasoningLevels": template.levels,
                "contextWindow": template.capabilities.context_window,
                "maxOutputTokens": template.max_output_tokens,
            })
        })
        .collect();
    let node: Vec<Value> = serde_json::from_str(NODE_REGISTRY).unwrap();
    assert_eq!(ours, node);
}

#[test]
fn the_bundled_builtin_parses_and_keeps_the_upstream_shape() {
    // 随包配置与 Node 源同源（模板/模型规则跟随上游），但 `providerRules` 为空：
    // Rust 不保留上游会员套餐账号登录。这里只校验自身可解析、模板未丢。
    let bundled: Value = serde_json::from_str(BUNDLED_BUILTIN).unwrap();
    assert_eq!(bundled["schemaVersion"], 1);
    assert!(
        bundled["config"]["providerConfigRules"]["templateRules"]
            .as_array()
            .is_some_and(|rules| !rules.is_empty()),
        "the bundled copy carries the upstream provider templates"
    );
}

#[test]
fn without_an_account_layer_account_providers_are_closed() {
    let builtin: Value = serde_json::from_str(BUNDLED_BUILTIN).unwrap();
    let resolved = resolve(&builtin["config"], &json!({}), None);
    let snapshot = snapshot(&resolved, &Default::default());
    assert!(snapshot.templates.is_empty(), "{:?}", snapshot.templates);
    assert_eq!(snapshot.default, None);
}

#[test]
fn the_default_selection_follows_the_personal_config() {
    let snapshot = fixture_snapshot();
    assert_eq!(
        snapshot.default,
        Some(ModelSelection {
            provider: "personal:gateway".to_owned(),
            model: "custom-chat".to_owned(),
            reasoning: Some("low".to_owned()),
            connection: None,
        })
    );
}

/// FIX 1：配置的缺省指向存在的 provider + model 时，始终返回它，绝不悄悄换成目录第一项（另一个 provider）。
/// 需求背景：`defaultModelSelection` 没写 `options.reasoningLevel` 时，旧逻辑（Node `resolveInitialModelSelection`）
/// 判它不可选、返回 `providerOrder[0]`。用户的 `personal:deepseek/deepseek-flash` 因此启动成
/// `personal:mockgateway`，冷启动失败后还把错的选择写进会话。
#[test]
fn a_configured_default_without_options_keeps_its_provider() {
    let builtin: Value = serde_json::from_str(BUNDLED_BUILTIN).unwrap();
    let personal = json!({
        "providerOrder": ["personal:mockgateway", "personal:deepseek"],
        "providerConfigRules": {
            "providerRules": [
                {
                    "providerId": "personal:mockgateway",
                    "providerName": "Mock Gateway",
                    "enabled": true,
                    "templateId": "deepseek",
                    "config": {
                        "group": "standard-personal",
                        "access": {"type": "api-key", "apiKey": "sk-mock"},
                        "personalModelIds": ["deepseek-flash"]
                    }
                },
                {
                    "providerId": "personal:deepseek",
                    "providerName": "DeepSeek",
                    "enabled": true,
                    "templateId": "deepseek",
                    "config": {
                        "group": "standard-personal",
                        "access": {"type": "api-key", "apiKey": "sk-deepseek"},
                        "personalModelIds": ["deepseek-flash"]
                    }
                }
            ]
        },
        "modelConfigRules": {"providerModelRules": [], "manualProviderModelRules": []},
        // 登录写的形状：没有 options。
        "defaultModelSelection": {"providerId": "personal:deepseek", "modelId": "deepseek-flash"}
    });
    let snapshot = snapshot(
        &resolve(&builtin["config"], &personal, None),
        &Default::default(),
    );
    assert_eq!(snapshot.templates[0].provider, "personal:mockgateway");
    let levels = snapshot
        .templates
        .iter()
        .find(|template| {
            template.provider == "personal:deepseek" && template.model == "deepseek-flash"
        })
        .map(|template| template.levels.clone())
        .expect("deepseek-flash is executable");
    let selection = snapshot
        .default
        .expect("the configured default is selected");
    assert_eq!(selection.provider, "personal:deepseek");
    assert_eq!(selection.model, "deepseek-flash");
    assert!(
        !selection
            .reasoning
            .as_deref()
            .unwrap_or_default()
            .is_empty()
    );
    assert_eq!(
        selection.reasoning.as_deref(),
        levels.last().map(String::as_str)
    );
    assert_ne!(selection.provider, "personal:mockgateway");
}

/// 没有配置、或点名的 provider/model 不存在时才走目录第一项（第一个非隐藏 provider 的第一个有档位的模型）、
/// 最后一个档位（Node `completeNewModelSelection`）。
#[test]
fn a_missing_default_falls_back_to_the_first_model() {
    let snapshot = fixture_snapshot();
    let first = Some(ModelSelection {
        provider: ENTITLED.to_owned(),
        model: "GLM-5.3".to_owned(),
        reasoning: Some("max".to_owned()),
        connection: None,
    });
    let resolve = |configured: Value| default_selection(&snapshot.templates, &configured);
    // 模型不在目录里。
    assert_eq!(
        resolve(
            json!({"providerId": "personal:gateway", "modelId": "gone", "options": {"reasoningLevel": "low"}})
        ),
        first
    );
    assert_eq!(resolve(Value::Null), first);
    // 档位有效：原样用它。
    assert_eq!(
        resolve(
            json!({"providerId": "personal:gateway", "modelId": "glm-5", "options": {"reasoningLevel": "enabled"}})
        ),
        Some(ModelSelection {
            provider: "personal:gateway".to_owned(),
            model: "glm-5".to_owned(),
            reasoning: Some("enabled".to_owned()),
            connection: None,
        })
    );
    // FIX 1：已经存在的配置项即使档位无效也用这个模型（取它的最后一个档位），不再回到目录第一项。
    assert_eq!(
        resolve(
            json!({"providerId": "personal:gateway", "modelId": "custom-chat", "options": {"reasoningLevel": "max"}})
        ),
        Some(ModelSelection {
            provider: "personal:gateway".to_owned(),
            model: "custom-chat".to_owned(),
            reasoning: Some("high".to_owned()),
            connection: None,
        })
    );
    // 隐藏 provider 的模型也可按显式选择解析，所以配置点名时同样生效。
    let mut templates = snapshot.templates.clone();
    for template in &mut templates {
        if template.provider == ENTITLED || template.provider == "personal:gateway" {
            template.hidden = true;
        }
    }
    assert_eq!(
        default_selection(
            &templates,
            &json!({"providerId": "personal:gateway", "modelId": "glm-5"})
        ),
        Some(ModelSelection {
            provider: "personal:gateway".to_owned(),
            model: "glm-5".to_owned(),
            reasoning: Some("enabled".to_owned()),
            connection: None,
        })
    );
}

#[test]
fn option_maps_become_request_patches() {
    let snapshot = fixture_snapshot();
    let glm = snapshot.find(&sel(ENTITLED, "GLM-5.3")).unwrap();
    assert_eq!(glm.protocol, WireProtocol::AnthropicMessages);
    assert_eq!(
        glm.access,
        Access::Account {
            account_type: "zai".to_owned(),
            mode: "individual-coding-plan".to_owned(),
        }
    );
    assert_eq!(
        glm.patches(Some("high"), None).unwrap(),
        vec![
            json!({"thinking": {"type": "enabled"}, "output_config": {"effort": "high"}}),
            json!({"max_tokens": 128000}),
        ]
    );
    let gateway = snapshot.find(&sel("personal:gateway", "glm-5")).unwrap();
    assert_eq!(
        gateway.access,
        Access::ApiKey(RedactedString::new("sk-personal-fixture"))
    );
    assert_eq!(
        gateway.headers,
        vec![("X-Team".to_owned(), RedactedString::new("dev"))]
    );
    // 没指定档位时用最后一个（enabled）。
    let patches = gateway.patches(None, None).unwrap();
    assert_eq!(patches[0]["reasoning_effort"], "high");
    assert_eq!(patches[1], json!({"max_completion_tokens": 64000}));
    assert!(matches!(
        gateway.patches(Some("max"), None),
        Err(ModelError::InvalidRequest { .. })
    ));
    // 目录不含隐藏 provider；可执行的模型都能按选择找到。
    assert_eq!(snapshot.catalog().len(), snapshot.templates.len());
    assert!(
        snapshot
            .find(&sel("personal:nokey", "claude-opus-5"))
            .is_none()
    );
}

/// `NIBI_MAX_OUTPUT_TOKENS`（cli-args.md §9.1，修复线 F42）：`maxOutputTokens.map` 用它与配置的 max 的较小值；协议
/// 自己的字段名不变（Anthropic `max_tokens`、Chat `max_completion_tokens`）。
#[test]
fn the_output_limit_caps_the_max_output_tokens_patch() {
    let snapshot = fixture_snapshot();
    let glm = snapshot.find(&sel(ENTITLED, "GLM-5.3")).unwrap();
    assert_eq!(
        glm.patches(Some("high"), Some(4096)).unwrap()[1],
        json!({"max_tokens": 4096})
    );
    assert_eq!(
        glm.patches(Some("high"), Some(500_000)).unwrap()[1],
        json!({"max_tokens": 128000})
    );
    let gateway = snapshot.find(&sel("personal:gateway", "glm-5")).unwrap();
    assert_eq!(
        gateway.patches(None, Some(4096)).unwrap()[1],
        json!({"max_completion_tokens": 4096})
    );
}

/// 显式覆盖没给模型时用的 `defaultModelSelection.modelId`（model.md §6，修复线 F42）：原样取，不看目录与档位。
#[test]
fn the_configured_model_is_the_raw_default_model_selection() {
    assert_eq!(
        configured_model(&json!({"providerId": "zai", "modelId": " GLM-5.3 "})),
        Some("GLM-5.3".to_owned())
    );
    assert_eq!(
        configured_model(&json!({"providerId": "old", "modelId": "m"})),
        Some("m".to_owned())
    );
    assert_eq!(configured_model(&json!({"modelId": ""})), None);
    assert_eq!(configured_model(&json!({"modelId": 3})), None);
    assert_eq!(configured_model(&serde_json::Value::Null), None);
    // 夹具的个人配置写了 `defaultModelSelection`：快照里带着它的模型 ID。
    let personal: Value = serde_json::from_str(PERSONAL).unwrap();
    assert_eq!(
        fixture_snapshot().configured_model,
        configured_model(&personal["config"]["defaultModelSelection"])
    );
    assert!(fixture_snapshot().configured_model.is_some());
}

/// 不带团队项目的选择（按 provider 与模型找模板）。
fn sel(provider: &str, model: &str) -> nibi_kernel_api::model::ModelSelection {
    nibi_kernel_api::model::ModelSelection {
        provider: provider.to_owned(),
        model: model.to_owned(),
        reasoning: None,
        connection: None,
    }
}
