use savvagent_sdk::{Config, Context, FlagClient};
use serde_json::json;
use wiremock::{Mock, MockServer, ResponseTemplate};
use wiremock::matchers::{method, path};

#[tokio::test]
async fn test_evaluate_returns_configuration() {
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
            "configuration": config_json,
            "flag_id": "flag-123"
        })))
        .mount(&mock_server)
        .await;

    let config = Config::new("sdk_test_key")
        .with_base_url(mock_server.uri());

    let client = FlagClient::new(config).unwrap();
    let result = client.evaluate("test-flag", None).await.unwrap();

    assert!(result.value);
    assert!(result.configuration.is_some());

    let config = result.configuration.unwrap();
    assert_eq!(config["theme"]["primaryColor"], "#007bff");
}

#[tokio::test]
async fn test_get_config_returns_value_when_enabled() {
    let mock_server = MockServer::start().await;

    let config_json = json!({
        "apiEndpoint": "https://api.example.com",
        "timeout": 5000,
        "retries": 3
    });

    Mock::given(method("POST"))
        .and(path("/api/evaluate/api-settings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "value": true,
            "configuration": config_json
        })))
        .mount(&mock_server)
        .await;

    let config = Config::new("sdk_test_key")
        .with_base_url(mock_server.uri());

    let client = FlagClient::new(config).unwrap();
    let result = client.get_config("api-settings", None).await.unwrap();

    assert!(result.is_some());
    let config = result.unwrap();
    assert_eq!(config["apiEndpoint"], "https://api.example.com");
}

#[tokio::test]
async fn test_get_config_returns_none_when_disabled() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/evaluate/api-settings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "value": false,
            "configuration": { "some": "config" }
        })))
        .mount(&mock_server)
        .await;

    let config = Config::new("sdk_test_key")
        .with_base_url(mock_server.uri());

    let client = FlagClient::new(config).unwrap();
    let result = client.get_config("api-settings", None).await.unwrap();

    assert!(result.is_none());
}

#[tokio::test]
async fn test_get_variation_returns_details() {
    let mock_server = MockServer::start().await;

    let config_json = json!({
        "algorithm": "ml_v2",
        "weight": 2.0
    });

    Mock::given(method("POST"))
        .and(path("/api/evaluate/search-algorithm"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "value": true,
            "variation": "variant_b",
            "configuration": config_json
        })))
        .mount(&mock_server)
        .await;

    let config = Config::new("sdk_test_key")
        .with_base_url(mock_server.uri());

    let client = FlagClient::new(config).unwrap();
    let result = client.get_variation("search-algorithm", None).await.unwrap();

    assert_eq!(result.variation, "variant_b");
    assert!(result.enabled);
    assert!(result.configuration.is_some());
}

#[tokio::test]
async fn test_variation_defaults_to_control() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/evaluate/test-flag"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "value": true
        })))
        .mount(&mock_server)
        .await;

    let config = Config::new("sdk_test_key")
        .with_base_url(mock_server.uri());

    let client = FlagClient::new(config).unwrap();
    let result = client.get_variation("test-flag", None).await.unwrap();

    assert_eq!(result.variation, "control");
    assert!(result.enabled);
}

#[tokio::test]
async fn test_backward_compatibility_with_is_enabled() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/evaluate/test-flag"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "value": true,
            "configuration": { "some": "config" }
        })))
        .mount(&mock_server)
        .await;

    let config = Config::new("sdk_test_key")
        .with_base_url(mock_server.uri());

    let client = FlagClient::new(config).unwrap();
    let enabled = client.is_enabled("test-flag", None).await;

    assert!(enabled);
}
