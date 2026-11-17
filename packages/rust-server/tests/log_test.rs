//! What the client logs: the plain-HTTP warning for a server key (#44), and the warning that
//! is Rust's only report of an invalid flag key (#45). The client has no error callback, so
//! these log lines are the behaviour; the test captures them with a minimal subscriber.

use std::fmt;
use std::sync::{Arc, Mutex};

use savvagent_flags::{Config, FlagClient};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Level, Metadata, Subscriber};

/// Records each event's level and message.
#[derive(Clone, Default)]
struct Capture {
    lines: Arc<Mutex<Vec<(Level, String)>>>,
}

struct MessageVisitor(String);

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        if field.name() == "message" {
            self.0 = format!("{value:?}");
        }
    }
}

impl Subscriber for Capture {
    fn enabled(&self, _: &Metadata<'_>) -> bool {
        true
    }
    fn new_span(&self, _: &Attributes<'_>) -> Id {
        Id::from_u64(1)
    }
    fn record(&self, _: &Id, _: &Record<'_>) {}
    fn record_follows_from(&self, _: &Id, _: &Id) {}
    fn event(&self, event: &Event<'_>) {
        let mut visitor = MessageVisitor(String::new());
        event.record(&mut visitor);
        self.lines
            .lock()
            .unwrap()
            .push((*event.metadata().level(), visitor.0));
    }
    fn enter(&self, _: &Id) {}
    fn exit(&self, _: &Id) {}
}

impl Capture {
    fn warnings_containing(&self, needle: &str) -> Vec<String> {
        self.lines
            .lock()
            .unwrap()
            .iter()
            .filter(|(level, message)| *level == Level::WARN && message.contains(needle))
            .map(|(_, message)| message.clone())
            .collect()
    }
}

fn build(api_key: &str, base_url: &str) -> Capture {
    let capture = Capture::default();
    tracing::subscriber::with_default(capture.clone(), || {
        FlagClient::new(
            Config::new(api_key)
                .with_base_url(base_url)
                .with_realtime(false)
                .with_telemetry(false),
        )
        .unwrap();
    });
    capture
}

#[test]
fn a_server_key_over_plain_http_warns_once_naming_the_scheme() {
    for (base_url, scheme) in [
        ("http://flags.internal:8080/flags", "http"),
        ("ws://flags.example.com", "ws"),
    ] {
        let warnings = build("srv_secret_value", base_url).warnings_containing("server key");
        assert_eq!(
            warnings,
            vec![format!(
                "Savvagent Flags: the server key will be sent over {scheme}; use an https base_url"
            )],
            "{base_url}"
        );
        assert!(!warnings[0].contains("srv_secret_value"));
    }
}

#[test]
fn no_plain_http_warning_for_https_loopback_or_a_client_key() {
    for (api_key, base_url) in [
        ("srv_secret", "https://flags.example.com"),
        ("srv_secret", "https://api.savvagent.com/flags"),
        ("srv_secret", "http://localhost:8080"),
        ("srv_secret", "http://127.0.0.1:8080/flags"),
        ("srv_secret", "http://[::1]:8080"),
        ("sdk_public", "http://flags.example.com"),
    ] {
        assert!(
            build(api_key, base_url)
                .warnings_containing("will be sent over")
                .is_empty(),
            "{api_key} {base_url}"
        );
    }
}

#[tokio::test]
async fn an_invalid_flag_key_is_logged_and_answered_with_its_default_not_an_error() {
    let capture = Capture::default();
    let _guard = tracing::subscriber::set_default(capture.clone());
    let client = FlagClient::new(
        Config::new("sdk_test")
            // Nothing listens here: a request would fail, so the default proves none was sent.
            .with_base_url("http://127.0.0.1:9")
            .with_realtime(false)
            .with_telemetry(false)
            .with_default("a/b", true),
    )
    .unwrap();

    let result = client
        .evaluate("a/b", None)
        .await
        .expect("an invalid key is not an Err");
    assert!(result.value);
    assert_eq!(result.reason, "error");
    assert_eq!(
        capture.warnings_containing("is not a valid flag key"),
        vec!["Flag key \"a/b\" (3 bytes) is not a valid flag key; using its default".to_string()]
    );
}
