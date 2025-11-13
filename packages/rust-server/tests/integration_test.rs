use savvagent::{Config, Context, FlagClient};
use wiremock::{MockServer, Mock, ResponseTemplate};
use wiremock::matchers::{method, path, header};

#[tokio::test]
async fn test_is_enabled_returns_true() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/flags/test-flag/evaluate"))
        .and(header("Authorization", "Bearer test-sdk-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "enabled": true,
            "flagKey": "test-flag"
        })))
        .mount(&mock_server)
        .await;

    let config = Config {
        api_url: mock_server.uri(),
        sdk_key: "test-sdk-key".to_string(),
        environment: "test".to_string(),
        enable_websocket: false,
        polling_interval: 0,
        timeout: 30,
    };

    let client = FlagClient::new(config).unwrap();

    let context = Context {
        user_id: "user-123".to_string(),
        attributes: std::collections::HashMap::new(),
    };

    let result = client.is_enabled("test-flag", &context).await;

    assert!(result.is_ok());
    assert_eq!(result.unwrap(), true);
}

#[tokio::test]
async fn test_is_enabled_returns_false() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/flags/test-flag/evaluate"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "enabled": false,
            "flagKey": "test-flag"
        })))
        .mount(&mock_server)
        .await;

    let config = Config {
        api_url: mock_server.uri(),
        sdk_key: "test-sdk-key".to_string(),
        environment: "test".to_string(),
        enable_websocket: false,
        polling_interval: 0,
        timeout: 30,
    };

    let client = FlagClient::new(config).unwrap();

    let context = Context {
        user_id: "user-123".to_string(),
        attributes: std::collections::HashMap::new(),
    };

    let result = client.is_enabled("test-flag", &context).await;

    assert!(result.is_ok());
    assert_eq!(result.unwrap(), false);
}

#[tokio::test]
async fn test_is_enabled_with_attributes() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/flags/test-flag/evaluate"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "enabled": true
        })))
        .mount(&mock_server)
        .await;

    let config = Config {
        api_url: mock_server.uri(),
        sdk_key: "test-sdk-key".to_string(),
        environment: "test".to_string(),
        enable_websocket: false,
        polling_interval: 0,
        timeout: 30,
    };

    let client = FlagClient::new(config).unwrap();

    let mut attributes = std::collections::HashMap::new();
    attributes.insert("email".to_string(), serde_json::json!("test@example.com"));
    attributes.insert("plan".to_string(), serde_json::json!("pro"));

    let context = Context {
        user_id: "user-123".to_string(),
        attributes,
    };

    let result = client.is_enabled("test-flag", &context).await;

    assert!(result.is_ok());
    assert_eq!(result.unwrap(), true);
}

#[tokio::test]
async fn test_is_enabled_handles_404() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/flags/missing-flag/evaluate"))
        .respond_with(ResponseTemplate::new(404).set_body_json(serde_json::json!({
            "error": "Flag not found"
        })))
        .mount(&mock_server)
        .await;

    let config = Config {
        api_url: mock_server.uri(),
        sdk_key: "test-sdk-key".to_string(),
        environment: "test".to_string(),
        enable_websocket: false,
        polling_interval: 0,
        timeout: 30,
    };

    let client = FlagClient::new(config).unwrap();

    let context = Context {
        user_id: "user-123".to_string(),
        attributes: std::collections::HashMap::new(),
    };

    let result = client.is_enabled("missing-flag", &context).await;

    assert!(result.is_err());
}

#[tokio::test]
async fn test_is_enabled_handles_500() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/flags/test-flag/evaluate"))
        .respond_with(ResponseTemplate::new(500).set_body_string("Internal server error"))
        .mount(&mock_server)
        .await;

    let config = Config {
        api_url: mock_server.uri(),
        sdk_key: "test-sdk-key".to_string(),
        environment: "test".to_string(),
        enable_websocket: false,
        polling_interval: 0,
        timeout: 30,
    };

    let client = FlagClient::new(config).unwrap();

    let context = Context {
        user_id: "user-123".to_string(),
        attributes: std::collections::HashMap::new(),
    };

    let result = client.is_enabled("test-flag", &context).await;

    assert!(result.is_err());
}

#[tokio::test]
async fn test_get_variation_string() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/flags/theme/variation"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "value": "dark-mode"
        })))
        .mount(&mock_server)
        .await;

    let config = Config {
        api_url: mock_server.uri(),
        sdk_key: "test-sdk-key".to_string(),
        environment: "test".to_string(),
        enable_websocket: false,
        polling_interval: 0,
        timeout: 30,
    };

    let client = FlagClient::new(config).unwrap();

    let context = Context {
        user_id: "user-123".to_string(),
        attributes: std::collections::HashMap::new(),
    };

    let result: String = client.get_variation("theme", &context, "light".to_string()).await;

    assert_eq!(result, "dark-mode");
}

#[tokio::test]
async fn test_get_variation_returns_default_on_error() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/flags/theme/variation"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&mock_server)
        .await;

    let config = Config {
        api_url: mock_server.uri(),
        sdk_key: "test-sdk-key".to_string(),
        environment: "test".to_string(),
        enable_websocket: false,
        polling_interval: 0,
        timeout: 30,
    };

    let client = FlagClient::new(config).unwrap();

    let context = Context {
        user_id: "user-123".to_string(),
        attributes: std::collections::HashMap::new(),
    };

    let result: String = client.get_variation("theme", &context, "light".to_string()).await;

    assert_eq!(result, "light");
}

#[tokio::test]
async fn test_track_event() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/events"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&mock_server)
        .await;

    let config = Config {
        api_url: mock_server.uri(),
        sdk_key: "test-sdk-key".to_string(),
        environment: "test".to_string(),
        enable_websocket: false,
        polling_interval: 0,
        timeout: 30,
    };

    let client = FlagClient::new(config).unwrap();

    let context = Context {
        user_id: "user-123".to_string(),
        attributes: std::collections::HashMap::new(),
    };

    let mut properties = std::collections::HashMap::new();
    properties.insert("button".to_string(), serde_json::json!("checkout"));
    properties.insert("value".to_string(), serde_json::json!(99.99));

    client.track("button_click", &context, properties).await.unwrap();
}

#[test]
fn test_config_creation() {
    let config = Config {
        api_url: "https://beta.savvagent.com".to_string(),
        sdk_key: "test-key".to_string(),
        environment: "production".to_string(),
        enable_websocket: true,
        polling_interval: 60,
        timeout: 30,
    };

    assert_eq!(config.api_url, "https://beta.savvagent.com");
    assert_eq!(config.sdk_key, "test-key");
    assert_eq!(config.environment, "production");
    assert!(config.enable_websocket);
    assert_eq!(config.polling_interval, 60);
    assert_eq!(config.timeout, 30);
}

#[test]
fn test_context_creation() {
    let mut attributes = std::collections::HashMap::new();
    attributes.insert("email".to_string(), serde_json::json!("test@example.com"));
    attributes.insert("plan".to_string(), serde_json::json!("pro"));
    attributes.insert("age".to_string(), serde_json::json!(30));

    let context = Context {
        user_id: "user-123".to_string(),
        attributes,
    };

    assert_eq!(context.user_id, "user-123");
    assert_eq!(context.attributes.get("email").unwrap(), "test@example.com");
    assert_eq!(context.attributes.get("plan").unwrap(), "pro");
    assert_eq!(context.attributes.get("age").unwrap(), 30);
}
