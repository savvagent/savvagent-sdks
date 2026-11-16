//! Telemetry against a mock server speaking the documented contract
//! (`docs/SDK-DEVELOPER-GUIDE.md`, Telemetry): `POST /api/telemetry/evaluations` and
//! `/api/telemetry/errors` with the client's key, batched (#93).

use savvagent_flags::{Config, Context, ErrorReport, FlagClient};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::time::Duration;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const KEY: &str = "srv_test_key";

async fn server_with(enabled: bool, telemetry_status: u16) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/flags/test-flag/evaluate"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "key": "test-flag", "enabled": enabled, "variation": "blue", "version": 1
        })))
        .mount(&server)
        .await;
    for kind in ["evaluations", "errors"] {
        Mock::given(method("POST"))
            .and(path(format!("/api/telemetry/{kind}")))
            .and(header("Authorization", format!("Bearer {KEY}").as_str()))
            .respond_with(ResponseTemplate::new(telemetry_status))
            .mount(&server)
            .await;
    }
    server
}

fn client(server: &MockServer) -> FlagClient {
    FlagClient::new(Config::new(KEY).with_base_url(server.uri())).unwrap()
}

/// The bodies of the telemetry requests of one kind, each checked to carry the client's key.
async fn bodies(server: &MockServer, kind: &str) -> Vec<Value> {
    let suffix = format!("/api/telemetry/{kind}");
    server
        .received_requests()
        .await
        .unwrap_or_default()
        .iter()
        .filter(|r: &&Request| r.url.path() == suffix)
        .map(|r| {
            let auth = r.headers.get("authorization").map(|v| v.to_str().unwrap());
            assert_eq!(auth, Some(format!("Bearer {KEY}").as_str()));
            serde_json::from_slice(&r.body).unwrap()
        })
        .collect()
}

fn keys(event: &Value) -> BTreeSet<&str> {
    event
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect()
}

#[tokio::test]
async fn answered_lookups_are_reported_without_user_data() {
    let server = server_with(true, 202).await;
    let client = client(&server);
    let ctx = || {
        Some(
            Context::new()
                .with_user_id("user-1")
                .with_environment("staging")
                .with_attribute("email", json!("a@example.com")),
        )
    };

    assert!(client.evaluate("test-flag", ctx()).await.unwrap().value);
    let cached = client.evaluate("test-flag", ctx()).await.unwrap();
    assert_eq!(cached.reason, "cached");
    client.flush().await;

    let sent = bodies(&server, "evaluations").await;
    assert_eq!(sent.len(), 1);
    let events = sent[0]["evaluations"].as_array().unwrap();
    assert_eq!(events.len(), 2);
    for event in events {
        // Exactly these fields: nothing about the user leaves the process.
        assert_eq!(
            keys(event),
            BTreeSet::from([
                "environment",
                "flag_key",
                "result",
                "timestamp",
                "variation"
            ])
        );
        assert_eq!(event["flag_key"], "test-flag");
        assert_eq!(event["result"], true);
        assert_eq!(event["variation"], "blue");
        assert_eq!(event["environment"], "staging");
        assert!(event["timestamp"].is_u64());
    }
    let raw = sent[0].to_string();
    assert!(!raw.contains("user-1") && !raw.contains("a@example.com"));
}

#[tokio::test]
async fn the_servers_answer_is_reported_not_an_override() {
    let server = server_with(true, 202).await;
    let client = client(&server);
    client.set_variation_override("test-flag", "green");

    let result = client.evaluate("test-flag", None).await.unwrap();
    assert_eq!(result.variation.as_deref(), Some("green"));
    client.flush().await;

    let sent = bodies(&server, "evaluations").await;
    let event = &sent[0]["evaluations"][0];
    assert_eq!(event["variation"], "blue");
    // No environment in the context: the field is absent, not null.
    assert!(event.get("environment").is_none());
}

#[tokio::test]
async fn fallbacks_and_refused_keys_are_not_reported() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/flags/test-flag/evaluate"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/telemetry/evaluations"))
        .respond_with(ResponseTemplate::new(202))
        .expect(0)
        .mount(&server)
        .await;
    let client = client(&server);

    assert_eq!(
        client.evaluate("test-flag", None).await.unwrap().reason,
        "error"
    );
    assert_eq!(client.evaluate("a/b", None).await.unwrap().reason, "error");
    client.flush().await;
}

#[tokio::test]
async fn errors_are_reported_with_their_text_truncated() {
    let server = server_with(true, 202).await;
    let client = client(&server);

    client.track_error(
        ErrorReport::new("test-flag", true, "TypeError", "\u{e9}".repeat(5_000))
            .with_stack_trace("at main")
            .with_environment("production"),
    );
    client.flush().await;

    let sent = bodies(&server, "errors").await;
    assert_eq!(sent.len(), 1);
    let event = &sent[0]["errors"][0];
    assert_eq!(
        keys(event),
        BTreeSet::from([
            "environment",
            "error_message",
            "error_type",
            "flag_enabled",
            "flag_key",
            "stack_trace",
            "timestamp"
        ])
    );
    assert_eq!(event["flag_key"], "test-flag");
    assert_eq!(event["flag_enabled"], true);
    assert_eq!(event["error_type"], "TypeError");
    assert_eq!(
        event["error_message"].as_str().unwrap(),
        "\u{e9}".repeat(2_000)
    );
    assert_eq!(event["stack_trace"], "at main");
    assert_eq!(event["environment"], "production");
    assert!(event["timestamp"].is_u64());
}

#[tokio::test]
async fn an_error_built_from_a_rust_error_names_its_type() {
    let server = server_with(true, 202).await;
    let client = client(&server);
    let error = "x".parse::<i32>().unwrap_err();

    client.track_error(ErrorReport::from_error("test-flag", false, &error));
    client.flush().await;

    let sent = bodies(&server, "errors").await;
    let event = &sent[0]["errors"][0];
    assert_eq!(event["flag_enabled"], false);
    assert_eq!(event["error_type"], "ParseIntError");
    assert!(event.get("stack_trace").is_none());
    assert_eq!(event["error_message"], error.to_string());
}

#[tokio::test]
async fn a_full_request_is_sent_without_waiting_for_flush() {
    let server = server_with(true, 202).await;
    let client = client(&server);
    for _ in 0..1_000 {
        client.evaluate("test-flag", None).await.unwrap();
    }

    let arrived = tokio::time::timeout(Duration::from_secs(2), async {
        while bodies(&server, "evaluations").await.is_empty() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    assert!(arrived.is_ok(), "no evaluations were sent");
    let sent = bodies(&server, "evaluations").await;
    let total: usize = sent
        .iter()
        .map(|b| b["evaluations"].as_array().unwrap().len())
        .sum();
    assert_eq!(total, 1_000);
}

#[tokio::test]
async fn disabled_telemetry_sends_nothing() {
    let server = server_with(true, 202).await;
    let client = FlagClient::new(
        Config::new(KEY)
            .with_base_url(server.uri())
            .with_telemetry(false),
    )
    .unwrap();
    client.evaluate("test-flag", None).await.unwrap();
    client.track_error(ErrorReport::new("test-flag", true, "E", "m"));
    client.flush().await;

    assert!(bodies(&server, "evaluations").await.is_empty());
    assert!(bodies(&server, "errors").await.is_empty());
}

#[tokio::test]
async fn a_failing_telemetry_endpoint_changes_no_lookup() {
    let server = server_with(true, 500).await;
    let client = FlagClient::new(
        Config::new(KEY)
            .with_base_url(server.uri())
            .with_timeout(Duration::from_millis(500)),
    )
    .unwrap();

    assert!(client.evaluate("test-flag", None).await.unwrap().value);
    client.track_error(ErrorReport::new("test-flag", true, "E", "m"));
    tokio::time::timeout(Duration::from_secs(5), client.flush())
        .await
        .expect("flush finished");
    assert!(client.is_enabled("test-flag", None).await);

    // The failed batches were dropped, not kept for a retry: only the lookup above is new.
    client.flush().await;
    let evaluations: usize = bodies(&server, "evaluations")
        .await
        .iter()
        .map(|b| b["evaluations"].as_array().unwrap().len())
        .sum();
    assert_eq!(evaluations, 2);
    assert_eq!(bodies(&server, "errors").await.len(), 1);
}

#[tokio::test]
async fn an_unreachable_telemetry_server_does_not_stall_flush() {
    // Bind a port, then free it, so nothing is listening there.
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let client = FlagClient::new(
        Config::new(KEY)
            .with_base_url(format!("http://127.0.0.1:{port}"))
            .with_timeout(Duration::from_millis(500)),
    )
    .unwrap();
    for _ in 0..5 {
        client.track_error(ErrorReport::new("test-flag", true, "E", "m"));
    }
    tokio::time::timeout(Duration::from_secs(3), client.flush())
        .await
        .expect("flush finished");
}
