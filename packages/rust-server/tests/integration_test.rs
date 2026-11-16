//! The SDK against a mock savvagent-flags server speaking the documented contract
//! (`docs/SDK-DEVELOPER-GUIDE.md`, Flag Evaluation): `POST /api/flags/{key}/evaluate`
//! with `Authorization: Bearer <key>` and `{"context": ...}`, answered with `enabled`.

use savvagent_flags::{Config, Context, FlagClient, SavvagentFlagsError, VariationResult};
use serde_json::json;
use std::time::Duration;
use wiremock::matchers::{any, body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const KEY: &str = "sdk_test_key";

fn client(server: &MockServer) -> FlagClient {
    FlagClient::new(Config::new(KEY).with_base_url(server.uri())).unwrap()
}

async fn mock_evaluate(server: &MockServer, flag: &str, status: u16, body: serde_json::Value) {
    Mock::given(method("POST"))
        .and(path(format!("/api/flags/{flag}/evaluate")))
        .and(header("Authorization", format!("Bearer {KEY}").as_str()))
        .respond_with(ResponseTemplate::new(status).set_body_json(body))
        .mount(server)
        .await;
}

#[tokio::test]
async fn is_enabled_returns_true_when_the_server_enables_the_flag() {
    let server = MockServer::start().await;
    mock_evaluate(
        &server,
        "test-flag",
        200,
        json!({ "key": "test-flag", "enabled": true }),
    )
    .await;

    let ctx = Context::new().with_user_id("user-123");
    assert!(client(&server).is_enabled("test-flag", Some(ctx)).await);
}

#[tokio::test]
async fn is_enabled_returns_false_when_the_server_disables_the_flag() {
    let server = MockServer::start().await;
    mock_evaluate(
        &server,
        "test-flag",
        200,
        json!({ "key": "test-flag", "enabled": false }),
    )
    .await;

    // A configured default of true proves `false` came from the server, not a fallback.
    let client = FlagClient::new(
        Config::new(KEY)
            .with_base_url(server.uri())
            .with_default("test-flag", true),
    )
    .unwrap();
    let ctx = Context::new().with_user_id("user-123");
    assert!(!client.is_enabled("test-flag", Some(ctx)).await);
}

#[tokio::test]
async fn evaluate_sends_the_context_and_reports_the_server_result() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/flags/test-flag/evaluate"))
        .and(header("Authorization", format!("Bearer {KEY}").as_str()))
        .and(body_partial_json(json!({
            "context": {
                "user_id": "user-123",
                "environment": "staging",
                "attributes": { "email": "test@example.com", "plan": "pro" }
            }
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "key": "test-flag",
            "enabled": true,
            "scope": "application",
            "variation": null,
            "configuration": null,
            "timestamp": 1_700_000_000,
            "version": 3
        })))
        .expect(1)
        .mount(&server)
        .await;

    let ctx = Context::new()
        .with_user_id("user-123")
        .with_environment("staging")
        .with_attribute("email", json!("test@example.com"))
        .with_attribute("plan", json!("pro"));
    let result = client(&server)
        .evaluate("test-flag", Some(ctx))
        .await
        .unwrap();

    assert!(result.value);
    assert_eq!(result.key, "test-flag");
    assert_eq!(result.reason, "evaluated");
    // The server sends `"configuration": null` for a flag without one; that is absent.
    assert!(result.configuration.is_none());
    assert!(result.variation.is_none());
}

#[tokio::test]
async fn get_config_is_none_for_an_enabled_flag_without_configuration() {
    let server = MockServer::start().await;
    mock_evaluate(
        &server,
        "test-flag",
        200,
        json!({ "key": "test-flag", "enabled": true, "variation": null, "configuration": null }),
    )
    .await;

    let config = client(&server).get_config("test-flag", None).await.unwrap();
    assert!(config.is_none());
}

#[tokio::test]
async fn evaluate_sends_the_configured_application_id() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/flags/test-flag/evaluate"))
        .and(body_partial_json(
            json!({ "context": { "application_id": "app-1" } }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "enabled": true })))
        .expect(1)
        .mount(&server)
        .await;

    let client = FlagClient::new(
        Config::new(KEY)
            .with_base_url(server.uri())
            .with_application_id("app-1"),
    )
    .unwrap();
    assert!(client.is_enabled("test-flag", None).await);
}

#[tokio::test]
async fn a_response_without_enabled_falls_back_to_the_default() {
    let server = MockServer::start().await;
    // `value` is the field the SDK used to read; the server never sends it.
    mock_evaluate(&server, "test-flag", 200, json!({ "value": false })).await;

    let client = FlagClient::new(
        Config::new(KEY)
            .with_base_url(server.uri())
            .with_default("test-flag", true),
    )
    .unwrap();
    assert!(client.is_enabled("test-flag", None).await);
    let result = client.evaluate("test-flag", None).await.unwrap();
    assert_eq!(result.reason, "error");
}

#[tokio::test]
async fn a_second_evaluation_is_served_from_the_cache() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/flags/test-flag/evaluate"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "enabled": true })))
        .expect(1)
        .mount(&server)
        .await;

    let client = client(&server);
    assert_eq!(
        client.evaluate("test-flag", None).await.unwrap().reason,
        "evaluated"
    );
    let cached = client.evaluate("test-flag", None).await.unwrap();
    assert!(cached.value);
    assert_eq!(cached.reason, "cached");
}

#[tokio::test]
async fn an_unreachable_server_falls_back_to_the_default() {
    // Bind a port, then free it, so nothing is listening there. (A dropped `MockServer`
    // goes back to wiremock's pool and keeps listening.)
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let uri = format!("http://127.0.0.1:{port}");

    let client = FlagClient::new(
        Config::new(KEY)
            .with_base_url(uri)
            // Zero cooldown: the later calls must reach the server (the cooldown is #111).
            .with_failure_cooldown(Duration::ZERO)
            .with_default("test-flag", true),
    )
    .unwrap();
    // A lookup never returns `Err` (#96): every method falls back to the default.
    let result = client.evaluate("test-flag", None).await.unwrap();
    assert!(result.value);
    assert_eq!(result.reason, "error");
    assert!(client.is_enabled("test-flag", None).await);
    assert!(client
        .get_config("test-flag", None)
        .await
        .unwrap()
        .is_none());
    let variation = client.get_variation("test-flag", None).await.unwrap();
    assert_eq!(variation.variation, "control");
    assert!(variation.enabled);
}

#[tokio::test]
async fn unknown_flag_falls_back_to_the_default() {
    let server = MockServer::start().await;
    // Errors are not cached: `evaluate` and `is_enabled` each reach the server.
    Mock::given(method("POST"))
        .and(path("/api/flags/missing-flag/evaluate"))
        .and(header("Authorization", format!("Bearer {KEY}").as_str()))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "error": "flag_not_found" })),
        )
        .expect(2)
        .mount(&server)
        .await;

    let client = FlagClient::new(
        Config::new(KEY)
            .with_base_url(server.uri())
            // Zero cooldown: the later calls must reach the server (the cooldown is #111).
            .with_failure_cooldown(Duration::ZERO)
            .with_default("missing-flag", true),
    )
    .unwrap();

    let result = client.evaluate("missing-flag", None).await.unwrap();
    assert!(result.value);
    assert_eq!(result.reason, "error");
    assert!(client.is_enabled("missing-flag", None).await);
}

#[tokio::test]
async fn server_error_falls_back_to_the_default() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/flags/test-flag/evaluate"))
        .respond_with(ResponseTemplate::new(500).set_body_string("Internal server error"))
        .mount(&server)
        .await;

    let client = FlagClient::new(
        Config::new(KEY)
            .with_base_url(server.uri())
            // Zero cooldown: the later calls must reach the server (the cooldown is #111).
            .with_failure_cooldown(Duration::ZERO)
            .with_default("test-flag", true),
    )
    .unwrap();
    let result = client.evaluate("test-flag", None).await.unwrap();
    assert!(result.value);
    assert_eq!(result.reason, "error");
    assert!(client.is_enabled("test-flag", None).await);
}

#[tokio::test]
async fn get_variation_returns_the_server_variation() {
    let server = MockServer::start().await;
    mock_evaluate(
        &server,
        "theme",
        200,
        json!({
            "key": "theme",
            "enabled": true,
            "variation": "dark-mode",
            "configuration": { "background": "#000" }
        }),
    )
    .await;

    let VariationResult {
        variation,
        enabled,
        configuration,
    } = client(&server).get_variation("theme", None).await.unwrap();
    assert_eq!(variation, "dark-mode");
    assert!(enabled);
    assert_eq!(configuration.unwrap()["background"], "#000");
}

#[tokio::test]
async fn get_variation_falls_back_to_control_on_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/flags/theme/evaluate"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;

    let result = client(&server).get_variation("theme", None).await.unwrap();
    assert_eq!(result.variation, "control");
    assert!(!result.enabled);
    assert!(result.configuration.is_none());
}

#[test]
fn config_builder_sets_its_fields() {
    let config = Config::new("sdk_key")
        .with_application_id("app-1")
        .with_base_url("https://flags.example.com")
        .with_cache_ttl(std::time::Duration::from_secs(30))
        .with_timeout(std::time::Duration::from_secs(2))
        .with_default("beta", true);

    assert_eq!(config.api_key, "sdk_key");
    assert_eq!(config.application_id.as_deref(), Some("app-1"));
    assert_eq!(config.base_url, "https://flags.example.com");
    assert_eq!(config.cache_ttl, std::time::Duration::from_secs(30));
    assert_eq!(config.timeout, std::time::Duration::from_secs(2));
    assert_eq!(config.defaults.get("beta"), Some(&true));
}

#[test]
fn client_accepts_a_server_key() {
    assert!(FlagClient::new(Config::new("srv_server_key")).is_ok());
}

#[test]
fn the_invalid_key_error_names_both_key_kinds() {
    let message = SavvagentFlagsError::InvalidApiKey.to_string();
    assert!(message.contains("sdk_"), "{message}");
    assert!(message.contains("srv_"), "{message}");
}

#[test]
fn client_rejects_a_key_without_the_sdk_prefix() {
    assert!(matches!(
        FlagClient::new(Config::new("not-an-sdk-key")),
        Err(SavvagentFlagsError::InvalidApiKey)
    ));
}

#[test]
fn context_builder_sets_its_fields() {
    let context = Context::new()
        .with_user_id("user-123")
        .with_session_id("session-1")
        .with_environment("production")
        .with_attribute("email", json!("test@example.com"))
        .with_attribute("plan", json!("pro"))
        .with_attribute("age", json!(30));

    assert_eq!(context.user_id.as_deref(), Some("user-123"));
    assert_eq!(context.session_id.as_deref(), Some("session-1"));
    assert_eq!(context.environment.as_deref(), Some("production"));
    let attributes = context.attributes.unwrap();
    assert_eq!(attributes["email"], "test@example.com");
    assert_eq!(attributes["plan"], "pro");
    assert_eq!(attributes["age"], 30);
}

#[tokio::test]
async fn different_users_each_get_their_own_cached_answer() {
    let server = MockServer::start().await;
    for (user, enabled) in [("user-a", true), ("user-b", false)] {
        Mock::given(method("POST"))
            .and(path("/api/flags/targeted/evaluate"))
            .and(body_partial_json(json!({ "context": { "user_id": user } })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "enabled": enabled })))
            .expect(1)
            .mount(&server)
            .await;
    }

    let client = client(&server);
    let a = || Some(Context::new().with_user_id("user-a"));
    let b = || Some(Context::new().with_user_id("user-b"));

    let first_a = client.evaluate("targeted", a()).await.unwrap();
    let first_b = client.evaluate("targeted", b()).await.unwrap();
    assert!(first_a.value);
    assert!(!first_b.value);
    assert_eq!(first_b.reason, "evaluated");

    // Within the TTL each context is served its own cached answer.
    let again_a = client.evaluate("targeted", a()).await.unwrap();
    let again_b = client.evaluate("targeted", b()).await.unwrap();
    assert!(again_a.value);
    assert!(!again_b.value);
    assert_eq!(again_a.reason, "cached");
    assert_eq!(again_b.reason, "cached");
}

#[tokio::test]
async fn contexts_differing_in_an_attribute_each_get_their_own_answer() {
    let server = MockServer::start().await;
    for (plan, enabled) in [("pro", true), ("free", false)] {
        Mock::given(method("POST"))
            .and(path("/api/flags/targeted/evaluate"))
            .and(body_partial_json(
                json!({ "context": { "attributes": { "plan": plan } } }),
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "enabled": enabled })))
            .expect(1)
            .mount(&server)
            .await;
    }

    let client = client(&server);
    let ctx = |plan: &str| {
        Some(
            Context::new()
                .with_user_id("user-1")
                .with_attribute("plan", json!(plan)),
        )
    };
    assert!(client.evaluate("targeted", ctx("pro")).await.unwrap().value);
    assert!(
        !client
            .evaluate("targeted", ctx("free"))
            .await
            .unwrap()
            .value
    );
}

#[tokio::test]
async fn an_identical_context_hits_the_cache_whatever_the_attribute_order() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/flags/test-flag/evaluate"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "enabled": true })))
        .expect(1)
        .mount(&server)
        .await;

    let client = client(&server);
    let first = Context::new()
        .with_user_id("user-1")
        .with_attribute("a", json!(1))
        .with_attribute("b", json!({ "x": 1, "y": 2 }));
    let second = Context::new()
        .with_attribute("b", json!({ "y": 2, "x": 1 }))
        .with_attribute("a", json!(1))
        .with_user_id("user-1");
    client.evaluate("test-flag", Some(first)).await.unwrap();
    let cached = client.evaluate("test-flag", Some(second)).await.unwrap();
    assert_eq!(cached.reason, "cached");
}

#[tokio::test]
async fn invalidating_a_flag_drops_its_cached_answer_for_every_context() {
    let server = MockServer::start().await;
    for user in ["user-a", "user-b"] {
        Mock::given(method("POST"))
            .and(path("/api/flags/targeted/evaluate"))
            .and(body_partial_json(json!({ "context": { "user_id": user } })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "enabled": true })))
            .expect(2)
            .mount(&server)
            .await;
    }

    let client = client(&server);
    for user in ["user-a", "user-b"] {
        let ctx = Some(Context::new().with_user_id(user));
        client.evaluate("targeted", ctx).await.unwrap();
    }
    client.invalidate_cache(Some("targeted"));
    for user in ["user-a", "user-b"] {
        let ctx = Some(Context::new().with_user_id(user));
        let result = client.evaluate("targeted", ctx).await.unwrap();
        assert_eq!(result.reason, "evaluated");
    }
}

#[tokio::test]
async fn the_configured_application_id_is_part_of_the_cached_context() {
    let server = MockServer::start().await;
    for app in ["app-1", "app-2"] {
        Mock::given(method("POST"))
            .and(path("/api/flags/test-flag/evaluate"))
            .and(body_partial_json(
                json!({ "context": { "application_id": app } }),
            ))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({ "enabled": app == "app-1" })),
            )
            .expect(1)
            .mount(&server)
            .await;
    }

    let client = FlagClient::new(
        Config::new(KEY)
            .with_base_url(server.uri())
            .with_application_id("app-1"),
    )
    .unwrap();

    // `None`, an empty context, and one naming the configured app are the same request.
    assert!(client.evaluate("test-flag", None).await.unwrap().value);
    let empty = client
        .evaluate("test-flag", Some(Context::new()))
        .await
        .unwrap();
    assert_eq!(empty.reason, "cached");
    let mut same_app = Context::new();
    same_app.application_id = Some("app-1".into());
    let same = client.evaluate("test-flag", Some(same_app)).await.unwrap();
    assert_eq!(same.reason, "cached");

    // Another app is another context.
    let mut other_app = Context::new();
    other_app.application_id = Some("app-2".into());
    let other = client.evaluate("test-flag", Some(other_app)).await.unwrap();
    assert_eq!(other.reason, "evaluated");
    assert!(!other.value);
}

/// A key that no flag can have makes no request and falls back to its default (#95).
async fn refuses_without_a_request(flag: &str) {
    let server = MockServer::start().await;
    Mock::given(any())
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "enabled": false })))
        .expect(0)
        .mount(&server)
        .await;
    let client = FlagClient::new(
        Config::new(KEY)
            .with_base_url(server.uri())
            .with_realtime(false)
            .with_default(flag, true),
    )
    .unwrap();

    let result = client.evaluate(flag, None).await.unwrap();
    assert!(result.value, "{flag:?} should fall back to its default");
    assert_eq!(result.reason, "error");
    assert!(client.is_enabled(flag, None).await);
}

#[tokio::test]
async fn a_key_with_path_or_query_characters_is_refused_without_a_request() {
    for flag in [
        "a/b?c",
        "../../api/sdk/flags",
        "x#y",
        "50%",
        "two words",
        "",
        ".",
        "..",
    ] {
        refuses_without_a_request(flag).await;
    }
}

#[tokio::test]
async fn a_key_using_every_allowed_character_reaches_its_own_path() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/flags/My.flag_1-x/evaluate"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "enabled": true })))
        .expect(1)
        .mount(&server)
        .await;
    assert!(client(&server).is_enabled("My.flag_1-x", None).await);
}

#[tokio::test]
async fn a_base_url_path_prefix_is_kept_with_or_without_a_trailing_slash() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/flags/api/flags/test-flag/evaluate"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "enabled": true })))
        .expect(2)
        .mount(&server)
        .await;
    for base in [
        format!("{}/flags/", server.uri()),
        format!("{}/flags", server.uri()),
    ] {
        let client = FlagClient::new(Config::new(KEY).with_base_url(base)).unwrap();
        assert!(client.is_enabled("test-flag", None).await);
    }
}

/// A 200 the SDK cannot read is a failed lookup: default, `reason: "error"`, and not cached, so
/// the next call asks again (#92, #96).
async fn falls_back_uncached_on(response: ResponseTemplate) {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/flags/test-flag/evaluate"))
        .respond_with(response)
        .expect(2)
        .mount(&server)
        .await;
    let client = FlagClient::new(
        Config::new(KEY)
            .with_base_url(server.uri())
            // Zero cooldown: the later calls must reach the server (the cooldown is #111).
            .with_failure_cooldown(Duration::ZERO)
            .with_default("test-flag", true),
    )
    .unwrap();

    for _ in 0..2 {
        let result = client.evaluate("test-flag", None).await.unwrap();
        assert!(result.value);
        assert_eq!(result.reason, "error");
        assert!(result.metadata.is_none());
    }
}

#[tokio::test]
async fn a_non_json_body_falls_back_and_is_not_cached() {
    falls_back_uncached_on(ResponseTemplate::new(200).set_body_string("<html>portal</html>")).await;
}

#[tokio::test]
async fn a_body_without_a_boolean_enabled_falls_back_and_is_not_cached() {
    falls_back_uncached_on(
        ResponseTemplate::new(200).set_body_json(json!({ "enabled": "yes", "value": true })),
    )
    .await;
}

#[tokio::test]
async fn an_invalid_base_url_falls_back() {
    let client = FlagClient::new(
        Config::new(KEY)
            .with_base_url("not a url")
            .with_default("test-flag", true),
    )
    .unwrap();
    let result = client.evaluate("test-flag", None).await.unwrap();
    assert!(result.value);
    assert_eq!(result.reason, "error");
}

#[tokio::test]
async fn metadata_carries_the_version_and_scope_the_server_sends() {
    let server = MockServer::start().await;
    mock_evaluate(
        &server,
        "test-flag",
        200,
        json!({ "key": "test-flag", "enabled": true, "scope": "application", "version": 7 }),
    )
    .await;

    let client = client(&server);
    for expected_reason in ["evaluated", "cached"] {
        let result = client.evaluate("test-flag", None).await.unwrap();
        assert_eq!(result.reason, expected_reason);
        let metadata = result.metadata.expect("metadata");
        assert_eq!(metadata.version, Some(7));
        assert_eq!(metadata.scope.as_deref(), Some("application"));
        assert!(metadata.flag_id.is_none());
        assert!(metadata.description.is_none());
        assert!(metadata.variant.is_none());
    }
}

#[tokio::test]
async fn a_timeout_falls_back() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/flags/test-flag/evaluate"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "enabled": false }))
                .set_delay(std::time::Duration::from_millis(500)),
        )
        .mount(&server)
        .await;
    let client = FlagClient::new(
        Config::new(KEY)
            .with_base_url(server.uri())
            .with_timeout(std::time::Duration::from_millis(50))
            .with_default("test-flag", true),
    )
    .unwrap();

    let result = client.evaluate("test-flag", None).await.unwrap();
    assert!(result.value);
    assert_eq!(result.reason, "error");
}

#[tokio::test]
async fn an_invalidation_during_the_request_drops_its_result() {
    // The first answer (enabled) is slow; the kill switch flips while it is in flight.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/flags/kill/evaluate"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "enabled": true }))
                .set_delay(Duration::from_millis(300)),
        )
        .up_to_n_times(1)
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/flags/kill/evaluate"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "enabled": false })))
        .expect(1)
        .mount(&server)
        .await;

    let client = client(&server);
    let ctx = || Some(Context::new().with_user_id("u"));
    let (first, ()) = tokio::join!(client.evaluate("kill", ctx()), async {
        tokio::time::sleep(Duration::from_millis(100)).await;
        client.invalidate_cache(Some("kill"));
    });
    assert!(first.unwrap().value);

    let second = client.evaluate("kill", ctx()).await.unwrap();
    assert_eq!(second.reason, "evaluated");
    assert!(!second.value);
}

#[tokio::test]
async fn an_invalidation_of_another_flag_keeps_the_result() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/flags/kill/evaluate"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "enabled": true }))
                .set_delay(Duration::from_millis(300)),
        )
        .expect(1)
        .mount(&server)
        .await;

    let client = client(&server);
    let ctx = || Some(Context::new().with_user_id("u"));
    let (_, ()) = tokio::join!(client.evaluate("kill", ctx()), async {
        tokio::time::sleep(Duration::from_millis(100)).await;
        client.invalidate_cache(Some("other"));
    });
    assert_eq!(
        client.evaluate("kill", ctx()).await.unwrap().reason,
        "cached"
    );
}
