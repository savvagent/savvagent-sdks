//! The flag-change stream against a mock server speaking the documented contract
//! (`docs/SDK-DEVELOPER-GUIDE.md`, Real-time Updates): `GET /api/flags/stream` with the client's
//! key, `connected` on every connect, `flag.*` events naming the changed flag (#167).

use savvagent_flags::{Config, FlagClient};
use serde_json::json;
use std::future::Future;
use std::time::Duration;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const KEY: &str = "sdk_test_key";
const LONG_TTL: Duration = Duration::from_secs(600);

/// Answer `POST /api/flags/{flag}/evaluate`; a later answer for the same flag is mounted at a
/// higher priority so it wins over an earlier one.
async fn mock_evaluate(server: &MockServer, flag: &str, enabled: bool, priority: u8) {
    Mock::given(method("POST"))
        .and(path(format!("/api/flags/{flag}/evaluate")))
        .and(header("Authorization", format!("Bearer {KEY}").as_str()))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "key": flag, "enabled": enabled })),
        )
        .with_priority(priority)
        .mount(server)
        .await;
}

async fn mock_stream(server: &MockServer, body: &str, delay: Duration) {
    Mock::given(method("GET"))
        .and(path("/api/flags/stream"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(body.to_string(), "text/event-stream")
                .set_delay(delay),
        )
        .mount(server)
        .await;
}

async fn stream_requests(server: &MockServer) -> Vec<Request> {
    server
        .received_requests()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|r| r.method.as_str() == "GET" && r.url.path() == "/api/flags/stream")
        .collect()
}

fn config(server: &MockServer, ttl: Duration) -> Config {
    Config::new(KEY)
        .with_base_url(server.uri())
        .with_telemetry(false)
        .with_cache_ttl(ttl)
}

/// Poll `f` every 25 ms until it returns true or `timeout` passes.
async fn wait_until<F, Fut>(timeout: Duration, mut f: F) -> bool
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if f().await {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn reason(client: &FlagClient, flag: &str) -> String {
    client.evaluate(flag, None).await.unwrap().reason
}

#[tokio::test]
async fn an_update_event_drops_the_cached_evaluation() {
    let server = MockServer::start().await;
    mock_evaluate(&server, "f", true, 5).await;
    // No `connected` event: it would clear the cache by itself and prove nothing.
    mock_stream(
        &server,
        "event: flag.updated\ndata: {\"key\":\"f\"}\n\n",
        Duration::from_millis(700),
    )
    .await;
    let client = FlagClient::new(config(&server, LONG_TTL)).unwrap();

    assert_eq!(reason(&client, "f").await, "evaluated");
    assert_eq!(reason(&client, "f").await, "cached");
    mock_evaluate(&server, "f", false, 1).await;

    // The event, not the TTL, ended the cache entry.
    let last = std::sync::Mutex::new(None);
    let changed = wait_until(Duration::from_secs(5), || async {
        let r = client.evaluate("f", None).await.unwrap();
        let answer = (r.value, r.reason);
        let done = answer == (false, "evaluated".to_string());
        *last.lock().unwrap() = Some(answer);
        done
    })
    .await;
    assert!(changed, "last answer: {:?}", last.lock().unwrap());
}

#[tokio::test]
async fn a_dropped_stream_is_reconnected_and_the_cache_is_cleared() {
    let server = MockServer::start().await;
    mock_evaluate(&server, "g", true, 5).await;
    // The server closes the stream after the body, so the client must reconnect.
    mock_stream(
        &server,
        "event: connected\ndata: {}\n\n",
        Duration::from_millis(800),
    )
    .await;
    let client = FlagClient::new(config(&server, LONG_TTL)).unwrap();

    assert_eq!(reason(&client, "g").await, "evaluated");
    assert_eq!(reason(&client, "g").await, "cached");

    let reconnected = wait_until(Duration::from_secs(8), || async {
        stream_requests(&server).await.len() >= 2
    })
    .await;
    assert!(reconnected, "the stream was not requested again");

    // Each `connected` cleared the cache, so a read after the reconnect fetches again.
    let refetched = wait_until(Duration::from_secs(3), || async {
        reason(&client, "g").await == "evaluated"
    })
    .await;
    assert!(refetched, "the cache was not cleared on connect");
}

#[tokio::test]
async fn lookups_are_served_and_expire_by_ttl_while_the_stream_is_down() {
    let server = MockServer::start().await;
    mock_evaluate(&server, "f", true, 5).await;
    Mock::given(method("GET"))
        .and(path("/api/flags/stream"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;
    let client = FlagClient::new(config(&server, Duration::from_millis(300))).unwrap();

    assert_eq!(reason(&client, "f").await, "evaluated");
    assert_eq!(reason(&client, "f").await, "cached");
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(reason(&client, "f").await, "evaluated");
    assert!(client.is_enabled("f", None).await);
}

#[tokio::test]
async fn no_stream_is_opened_when_realtime_is_off() {
    let server = MockServer::start().await;
    mock_evaluate(&server, "f", true, 5).await;
    mock_stream(&server, "event: connected\ndata: {}\n\n", Duration::ZERO).await;
    let client = FlagClient::new(config(&server, LONG_TTL).with_realtime(false)).unwrap();

    assert_eq!(reason(&client, "f").await, "evaluated");
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert!(stream_requests(&server).await.is_empty());
}

#[tokio::test]
async fn a_lookup_does_not_wait_for_the_stream() {
    let server = MockServer::start().await;
    mock_evaluate(&server, "f", true, 5).await;
    mock_stream(&server, "", Duration::from_secs(30)).await;
    let client = FlagClient::new(config(&server, LONG_TTL)).unwrap();

    let answered = tokio::time::timeout(Duration::from_secs(2), client.evaluate("f", None)).await;
    assert!(answered.is_ok(), "the lookup waited on the stream");

    let attempted = wait_until(Duration::from_secs(3), || async {
        !stream_requests(&server).await.is_empty()
    })
    .await;
    assert!(attempted, "the stream was never attempted");
}

#[tokio::test]
async fn the_stream_request_carries_the_key_in_the_header_only() {
    let server = MockServer::start().await;
    mock_evaluate(&server, "f", true, 5).await;
    mock_stream(&server, "", Duration::from_secs(30)).await;
    let client = FlagClient::new(config(&server, LONG_TTL)).unwrap();
    client.evaluate("f", None).await.unwrap();

    let seen = wait_until(Duration::from_secs(3), || async {
        !stream_requests(&server).await.is_empty()
    })
    .await;
    assert!(seen, "the stream was never requested");
    for r in stream_requests(&server).await {
        let h = |name: &str| r.headers.get(name).map(|v| v.to_str().unwrap().to_string());
        assert_eq!(h("authorization").as_deref(), Some("Bearer sdk_test_key"));
        assert!(h("accept")
            .unwrap_or_default()
            .contains("text/event-stream"));
        assert_eq!(r.url.query(), None);
    }
}

#[tokio::test]
async fn events_for_other_flags_or_with_invalid_keys_leave_this_one_cached() {
    let server = MockServer::start().await;
    mock_evaluate(&server, "f", true, 5).await;
    mock_stream(
        &server,
        "event: flag.deleted\ndata: {\"key\":\"other\"}\n\n\
         event: flag.updated\ndata: {\"key\":\"a/b\"}\n\n",
        Duration::from_millis(500),
    )
    .await;
    let client = FlagClient::new(config(&server, LONG_TTL)).unwrap();

    assert_eq!(reason(&client, "f").await, "evaluated");
    let seen = wait_until(Duration::from_secs(3), || async {
        !stream_requests(&server).await.is_empty()
    })
    .await;
    assert!(seen, "the stream was never requested");
    // Past the delivery of the delayed body.
    tokio::time::sleep(Duration::from_millis(1200)).await;
    assert_eq!(reason(&client, "f").await, "cached");
}

#[tokio::test]
async fn a_200_that_is_not_an_event_stream_is_not_read_as_events() {
    let server = MockServer::start().await;
    mock_evaluate(&server, "h", true, 5).await;
    // A proxy's page that happens to look like an event.
    Mock::given(method("GET"))
        .and(path("/api/flags/stream"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw("event: connected\ndata: {}\n\n".to_string(), "text/html"),
        )
        .mount(&server)
        .await;
    let client = FlagClient::new(config(&server, LONG_TTL)).unwrap();

    assert_eq!(reason(&client, "h").await, "evaluated");
    assert!(
        wait_until(Duration::from_secs(2), || async {
            !stream_requests(&server).await.is_empty()
        })
        .await
    );
    tokio::time::sleep(Duration::from_millis(200)).await;
    // The `connected` event would have cleared the cache.
    assert_eq!(reason(&client, "h").await, "cached");
}
