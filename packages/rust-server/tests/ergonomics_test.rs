//! Env-derived defaults, the synchronous cached read and the static client (#159).

use savvagent_flags::{Config, Context, FlagClient};
use serde_json::json;
use std::time::Duration;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// A client whose server is unreachable (nothing listens on port 1), so every lookup fails.
fn unreachable_client(config: Config) -> FlagClient {
    FlagClient::new(
        config
            .with_base_url("http://127.0.0.1:1")
            .with_telemetry(false)
            .with_realtime(false)
            .with_failure_cooldown(Duration::ZERO),
    )
    .unwrap()
}

async fn serve(server: &MockServer, flag: &str, enabled: bool) {
    Mock::given(method("POST"))
        .and(path(format!("/api/flags/{flag}/evaluate")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "enabled": enabled })))
        .mount(server)
        .await;
}

fn warmable_client(server: &MockServer, ttl: Duration) -> FlagClient {
    FlagClient::new(
        Config::new("sdk_test_key")
            .with_base_url(server.uri())
            .with_cache_ttl(ttl)
            .with_telemetry(false)
            .with_realtime(false)
            .with_default("known-off-by-default", true),
    )
    .unwrap()
}

// Each env test names its own variable: the process environment is shared by parallel tests.

#[tokio::test]
async fn an_env_var_sets_the_default_served_when_the_server_is_unreachable() {
    std::env::set_var("OTTO_TEST_DEFAULT_ON", " TRUE ");
    let client = unreachable_client(
        Config::new("sdk_test_key").with_default_env("env-on", "OTTO_TEST_DEFAULT_ON"),
    );
    assert!(client.is_enabled("env-on", None).await);
}

#[tokio::test]
async fn an_env_var_can_turn_a_constant_default_off() {
    std::env::set_var("OTTO_TEST_DEFAULT_OFF", "off");
    let client = unreachable_client(
        Config::new("sdk_test_key")
            .with_default("env-off", true)
            .with_default_env("env-off", "OTTO_TEST_DEFAULT_OFF"),
    );
    assert!(!client.is_enabled("env-off", None).await);
}

#[test]
fn an_unset_or_unparsable_env_var_leaves_the_earlier_default() {
    std::env::remove_var("OTTO_TEST_DEFAULT_UNSET");
    std::env::set_var("OTTO_TEST_DEFAULT_JUNK", "maybe");
    std::env::set_var("OTTO_TEST_DEFAULT_EMPTY", "");
    let config = Config::new("sdk_test_key")
        .with_default("kept", true)
        .with_default_env("kept", "OTTO_TEST_DEFAULT_UNSET")
        .with_default_env("kept", "OTTO_TEST_DEFAULT_JUNK")
        .with_default_env("kept", "OTTO_TEST_DEFAULT_EMPTY")
        .with_default_env("never-set", "OTTO_TEST_DEFAULT_JUNK");
    assert_eq!(config.defaults.get("kept"), Some(&true));
    assert_eq!(config.defaults.get("never-set"), None);
}

#[test]
fn a_closure_sets_the_default_only_when_it_returns_some() {
    let config = Config::new("sdk_test_key")
        .with_default_fn("a", || Some(true))
        .with_default_fn("b", || None);
    assert_eq!(config.defaults.get("a"), Some(&true));
    assert_eq!(config.defaults.get("b"), None);
}

#[tokio::test]
async fn the_sync_read_returns_a_cached_value() {
    let server = MockServer::start().await;
    serve(&server, "cached-flag", true).await;
    let client = warmable_client(&server, Duration::from_secs(60));
    let ctx = Context::new().with_user_id("u1");

    assert!(client.is_enabled("cached-flag", Some(ctx.clone())).await);
    let requests = server.received_requests().await.unwrap().len();

    assert!(client.is_enabled_cached("cached-flag", Some(&ctx)));
    assert_eq!(
        server.received_requests().await.unwrap().len(),
        requests,
        "the sync read must not send a request"
    );
}

#[tokio::test]
async fn the_sync_read_falls_back_to_the_default_on_a_miss() {
    let server = MockServer::start().await;
    serve(&server, "other", true).await;
    let client = warmable_client(&server, Duration::from_secs(60));

    // Never looked up: the configured default, else false.
    assert!(client.is_enabled_cached("known-off-by-default", None));
    assert!(!client.is_enabled_cached("never-seen", None));

    // Cached for one context is a miss for another.
    assert!(
        client
            .is_enabled("other", Some(Context::new().with_user_id("a")))
            .await
    );
    assert!(!client.is_enabled_cached("other", Some(&Context::new().with_user_id("b"))));

    // Invalidated: a miss again.
    assert!(client.is_enabled_cached("other", Some(&Context::new().with_user_id("a"))));
    client.invalidate_cache(Some("other"));
    assert!(!client.is_enabled_cached("other", Some(&Context::new().with_user_id("a"))));
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn the_sync_read_ignores_an_expired_entry() {
    let server = MockServer::start().await;
    serve(&server, "ttl-flag", true).await;
    let client = warmable_client(&server, Duration::from_millis(300));

    assert!(client.is_enabled("ttl-flag", None).await);
    assert!(client.is_enabled_cached("ttl-flag", None));
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert!(!client.is_enabled_cached("ttl-flag", None));
}

#[test]
fn the_sync_read_works_outside_a_runtime() {
    let client = FlagClient::new(Config::new("sdk_test_key").with_default("d", true)).unwrap();
    assert!(client.is_enabled_cached("d", None));
}

#[test]
fn a_static_client_builds_and_answers_outside_a_runtime() {
    let client = FlagClient::static_flags([("on", true), ("off", false)]);
    assert!(client.is_enabled_cached("on", None));
    assert!(!client.is_enabled_cached("off", None));
    assert!(!client.is_enabled_cached("absent", None));
}

#[tokio::test]
async fn a_static_client_serves_fixed_values_without_the_network() {
    let client = FlagClient::static_flags([("on", true), ("off", false)]);

    assert!(client.is_enabled("on", None).await);
    assert!(!client.is_enabled("off", None).await);
    assert!(!client.is_enabled("absent", None).await);

    let result = client.evaluate("on", None).await.unwrap();
    assert!(result.value);
    assert_eq!(result.reason, "static");
}

#[tokio::test]
async fn a_static_client_still_applies_overrides() {
    let client = FlagClient::static_flags([("themed", true)]);
    client.set_variation_override("themed", "dark");
    client
        .set_config_override("themed", json!({"accent": "teal"}), None)
        .unwrap();

    let result = client.get_variation("themed", None).await.unwrap();
    assert!(result.enabled);
    assert_eq!(result.variation, "dark");
    assert_eq!(result.configuration, Some(json!({"accent": "teal"})));
}

#[tokio::test]
async fn the_sync_read_uses_the_configured_application_id_like_evaluate() {
    let server = MockServer::start().await;
    serve(&server, "scoped", true).await;
    let client = FlagClient::new(
        Config::new("sdk_test_key")
            .with_base_url(server.uri())
            .with_application_id("app-1")
            .with_telemetry(false)
            .with_realtime(false),
    )
    .unwrap();
    let ctx = Context::new().with_user_id("u1");

    assert!(client.is_enabled("scoped", Some(ctx.clone())).await);
    // The same context, as the caller wrote it: the application id is filled in on both paths.
    assert!(client.is_enabled_cached("scoped", Some(&ctx)));
}

#[test]
fn a_static_client_gives_an_invalid_flag_key_its_default_on_every_path() {
    let client = FlagClient::static_flags([("New Checkout", true)]);
    assert!(!client.is_enabled_cached("New Checkout", None));
}

#[tokio::test]
async fn a_sync_hit_counts_as_an_evaluation_and_a_miss_does_not() {
    let server = MockServer::start().await;
    serve(&server, "counted", true).await;
    Mock::given(method("POST"))
        .and(path("/api/telemetry/evaluations"))
        .respond_with(ResponseTemplate::new(202))
        .mount(&server)
        .await;
    let client = FlagClient::new(
        Config::new("srv_test_key")
            .with_base_url(server.uri())
            .with_realtime(false),
    )
    .unwrap();

    assert!(!client.is_enabled_cached("counted", None)); // miss: not counted
    assert!(client.is_enabled("counted", None).await); // evaluated: counted
    assert!(client.is_enabled_cached("counted", None)); // hit: counted
    client.flush().await;

    let events: usize = server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.url.path() == "/api/telemetry/evaluations")
        .map(|r| {
            let body: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
            body["evaluations"].as_array().unwrap().len()
        })
        .sum();
    assert_eq!(events, 2);
}
