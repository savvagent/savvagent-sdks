use savvagent_sdk::{Config, ConfigOverrideOptions, FlagClient};
use serde_json::json;
use wiremock::{Mock, MockServer, ResponseTemplate};
use wiremock::matchers::{method, path};

#[tokio::test]
async fn test_override_configuration_completely() {
    let mock_server = MockServer::start().await;

    let config_json = json!({
        "theme": {
            "primaryColor": "#007bff",
            "fontSize": 16
        },
        "limits": {
            "maxItems": 100
        }
    });

    Mock::given(method("POST"))
        .and(path("/api/evaluate/test-flag"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "value": true,
            "configuration": config_json
        })))
        .mount(&mock_server)
        .await;

    let config = Config::new("sdk_test_key")
        .with_base_url(mock_server.uri());

    let client = FlagClient::new(config).unwrap();

    // Set override (merge = false by default)
    client.set_config_override(
        "test-flag",
        json!({
            "theme": {
                "primaryColor": "#ff0000"
            }
        }),
        None,
    ).unwrap();

    let result = client.evaluate("test-flag", None).await.unwrap();

    assert!(result.value);
    assert!(result.configuration.is_some());

    let config = result.configuration.unwrap();
    assert_eq!(config["theme"]["primaryColor"], "#ff0000");
    assert!(config["theme"].get("fontSize").is_none());
}

#[tokio::test]
async fn test_merge_configuration() {
    let mock_server = MockServer::start().await;

    let config_json = json!({
        "theme": {
            "primaryColor": "#007bff",
            "fontSize": 16
        },
        "limits": {
            "maxItems": 100
        }
    });

    Mock::given(method("POST"))
        .and(path("/api/evaluate/test-flag"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "value": true,
            "configuration": config_json
        })))
        .mount(&mock_server)
        .await;

    let config = Config::new("sdk_test_key")
        .with_base_url(mock_server.uri());

    let client = FlagClient::new(config).unwrap();

    // Set override with merge = true
    client.set_config_override(
        "test-flag",
        json!({
            "theme": {
                "primaryColor": "#ff0000"
            },
            "newField": "added"
        }),
        Some(ConfigOverrideOptions::new().with_merge(true)),
    ).unwrap();

    let result = client.evaluate("test-flag", None).await.unwrap();

    assert!(result.value);

    let config = result.configuration.unwrap();
    assert_eq!(config["theme"]["primaryColor"], "#ff0000");
    assert_eq!(config["theme"]["fontSize"], 16);
    assert_eq!(config["newField"], "added");
    assert!(config.get("limits").is_some());
}

#[tokio::test]
async fn test_override_variation() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/evaluate/test-flag"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "value": true,
            "variation": "control",
            "configuration": {
                "algorithm": "standard"
            }
        })))
        .mount(&mock_server)
        .await;

    let config = Config::new("sdk_test_key")
        .with_base_url(mock_server.uri());

    let client = FlagClient::new(config).unwrap();

    // Set variation override
    client.set_variation_override("test-flag", "variant_b");

    let result = client.evaluate("test-flag", None).await.unwrap();

    assert!(result.value);
    assert_eq!(result.variation.unwrap(), "variant_b");
}

#[tokio::test]
async fn test_clear_configuration_override() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/evaluate/test-flag"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "value": true,
            "configuration": {
                "original": "config"
            }
        })))
        .mount(&mock_server)
        .await;

    let config = Config::new("sdk_test_key")
        .with_base_url(mock_server.uri());

    let client = FlagClient::new(config).unwrap();

    // Set override
    client.set_config_override(
        "test-flag",
        json!({ "overridden": "value" }),
        None,
    ).unwrap();

    // First call should have override
    let result1 = client.evaluate("test-flag", None).await.unwrap();
    assert_eq!(result1.configuration.unwrap()["overridden"], "value");

    // Clear override
    client.clear_config_override("test-flag");

    // Second call should have original config
    let result2 = client.evaluate("test-flag", None).await.unwrap();
    assert_eq!(result2.configuration.unwrap()["original"], "config");
}

#[tokio::test]
async fn test_has_override() {
    let config = Config::new("sdk_test_key");
    let client = FlagClient::new(config).unwrap();

    assert!(!client.has_config_override("test-flag"));

    client.set_config_override(
        "test-flag",
        json!({ "test": "value" }),
        None,
    ).unwrap();

    assert!(client.has_config_override("test-flag"));

    client.clear_config_override("test-flag");

    assert!(!client.has_config_override("test-flag"));
}

#[tokio::test]
async fn test_clear_all_overrides() {
    let config = Config::new("sdk_test_key");
    let client = FlagClient::new(config).unwrap();

    client.set_config_override("flag1", json!({ "config": "a" }), None).unwrap();
    client.set_variation_override("flag2", "variant_a");

    assert!(client.has_config_override("flag1"));
    assert!(client.has_variation_override("flag2"));

    client.clear_all_overrides();

    assert!(!client.has_config_override("flag1"));
    assert!(!client.has_variation_override("flag2"));
}

#[tokio::test]
async fn test_deep_merge_nested_configurations() {
    let mock_server = MockServer::start().await;

    let config_json = json!({
        "theme": {
            "colors": {
                "primary": "#007bff",
                "secondary": "#6c757d"
            },
            "fontSize": 16
        }
    });

    Mock::given(method("POST"))
        .and(path("/api/evaluate/test-flag"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "value": true,
            "configuration": config_json
        })))
        .mount(&mock_server)
        .await;

    let config = Config::new("sdk_test_key")
        .with_base_url(mock_server.uri());

    let client = FlagClient::new(config).unwrap();

    // Override nested configuration
    client.set_config_override(
        "test-flag",
        json!({
            "theme": {
                "colors": {
                    "primary": "#ff0000"
                }
            }
        }),
        Some(ConfigOverrideOptions::new().with_merge(true)),
    ).unwrap();

    let result = client.evaluate("test-flag", None).await.unwrap();

    let config = result.configuration.unwrap();
    assert_eq!(config["theme"]["colors"]["primary"], "#ff0000");
    assert_eq!(config["theme"]["colors"]["secondary"], "#6c757d");
    assert_eq!(config["theme"]["fontSize"], 16);
}

#[tokio::test]
async fn test_get_all_overrides() {
    let config = Config::new("sdk_test_key");
    let client = FlagClient::new(config).unwrap();

    client.set_config_override("flag1", json!({ "config": "a" }), None).unwrap();
    client.set_config_override(
        "flag2",
        json!({ "config": "b" }),
        Some(ConfigOverrideOptions::new().with_merge(true)),
    ).unwrap();
    client.set_variation_override("flag3", "variant_a");

    let config_overrides = client.get_config_overrides();
    assert_eq!(config_overrides.len(), 2);
    assert!(config_overrides.contains_key("flag1"));
    assert!(config_overrides.contains_key("flag2"));

    let variation_overrides = client.get_variation_overrides();
    assert_eq!(variation_overrides.len(), 1);
    assert!(variation_overrides.contains_key("flag3"));
}
