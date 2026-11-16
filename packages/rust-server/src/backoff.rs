//! A cooldown after a failed flag lookup, so an outage costs one request and one warning per
//! window instead of one per lookup (#111).
//!
//! A failure has one of three scopes. `Scope::Client` says the service, or the path to it, is
//! unhealthy (a transport error, a 5xx, a rejected key, a body that is not an evaluate
//! response): every lookup waits. `Scope::Flag` says only this flag's lookup failed (the server
//! answers 404 for a key with no active flag): only that flag waits, so a single stale key in a
//! hot path cannot black out every other flag. `Scope::Request` says this request itself was
//! refused (a 400, 413 or 422 for its body, or a response over the size cap, which can be the
//! server echoing a large context): nothing waits. Host code builds the context from end-user
//! input, so letting such a failure open a window would let one end user switch flags to their
//! defaults for every other user of the client, and keep them there by repeating it.
//!
//! Host code can build flag keys from input, so the per-flag map is bounded at
//! `MAX_FLAG_ENTRIES`: expired entries are pruned before an insert, and when it is still full
//! the failure is not recorded (that flag then asks the server each time, as without a
//! cooldown). The clock is a parameter so the logic is tested without sleeping.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The longest a `Retry-After` can hold a window, so a proxy cannot turn flags off for hours.
const MAX_RETRY_AFTER: Duration = Duration::from_secs(60);

/// The most per-flag windows kept at once.
const MAX_FLAG_ENTRIES: usize = 256;

/// What a failed lookup says about the rest of the lookups.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Scope {
    /// The service or the path to it is unhealthy: every flag waits.
    Client,
    /// Only this flag's lookup failed: only this flag waits.
    Flag,
    /// This request was refused for its own content: no cooldown.
    Request,
}

#[derive(Default)]
struct State {
    client_until: Option<Instant>,
    flags: HashMap<String, Instant>,
}

/// The cooldown state of one `FlagClient`, shared by its clones. The mutex is only locked
/// inside the sync `remaining` and `record`, never across an `.await`.
#[derive(Clone)]
pub(crate) struct Backoff {
    cooldown: Duration,
    state: Arc<Mutex<State>>,
}

impl Backoff {
    /// A zero `cooldown` turns the whole mechanism off.
    pub(crate) fn new(cooldown: Duration) -> Self {
        Self {
            cooldown,
            state: Arc::new(Mutex::new(State::default())),
        }
    }

    /// How long a lookup of `flag` must still wait, or `None` when it may go out. A poisoned
    /// lock means no cooldown: the SDK never panics into the host.
    pub(crate) fn remaining(&self, flag: &str, now: Instant) -> Option<Duration> {
        if self.cooldown.is_zero() {
            return None;
        }
        let state = self.state.lock().ok()?;
        let left = |until: &Instant| until.checked_duration_since(now).filter(|d| !d.is_zero());
        state
            .client_until
            .as_ref()
            .and_then(left)
            .or_else(|| state.flags.get(flag).and_then(left))
    }

    /// Start a window after a failed lookup and return its length (for the log line); zero when
    /// nothing was recorded. The window is `max(cooldown, min(retry_after, 60 s))`. A later
    /// client window never shortens an earlier one.
    pub(crate) fn record(
        &self,
        flag: &str,
        scope: Scope,
        retry_after: Option<Duration>,
        now: Instant,
    ) -> Duration {
        if self.cooldown.is_zero() {
            return Duration::ZERO;
        }
        let window = self
            .cooldown
            .max(retry_after.unwrap_or(Duration::ZERO).min(MAX_RETRY_AFTER));
        let Some(until) = now.checked_add(window) else {
            return Duration::ZERO;
        };
        let Ok(mut state) = self.state.lock() else {
            return Duration::ZERO;
        };
        match scope {
            Scope::Request => return Duration::ZERO,
            Scope::Client => {
                state.client_until = Some(state.client_until.map_or(until, |old| old.max(until)));
            }
            Scope::Flag => {
                if state.flags.len() >= MAX_FLAG_ENTRIES && !state.flags.contains_key(flag) {
                    state.flags.retain(|_, end| *end > now);
                    if state.flags.len() >= MAX_FLAG_ENTRIES {
                        return Duration::ZERO;
                    }
                }
                state.flags.insert(flag.to_string(), until);
            }
        }
        window
    }
}

/// A `Retry-After` header in its delta-seconds form. The HTTP-date form, a negative number, or
/// anything else gives `None` (the configured cooldown applies); the server never sends a date.
pub(crate) fn parse_retry_after(value: &str) -> Option<Duration> {
    let value = value.trim();
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    value.parse::<u64>().ok().map(Duration::from_secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    #[test]
    fn a_client_window_blocks_every_flag_until_it_ends() {
        let t0 = Instant::now();
        let b = Backoff::new(ms(1000));
        assert_eq!(b.record("a", Scope::Client, None, t0), ms(1000));
        assert_eq!(b.remaining("a", t0 + ms(100)), Some(ms(900)));
        assert_eq!(b.remaining("other", t0 + ms(100)), Some(ms(900)));
        assert_eq!(b.remaining("other", t0 + ms(999)), Some(ms(1)));
        assert_eq!(b.remaining("a", t0 + ms(1000)), None);
        assert_eq!(b.remaining("other", t0 + ms(5000)), None);
    }

    #[test]
    fn a_flag_window_blocks_only_that_flag() {
        let t0 = Instant::now();
        let b = Backoff::new(ms(1000));
        b.record("missing", Scope::Flag, None, t0);
        assert_eq!(b.remaining("missing", t0 + ms(10)), Some(ms(990)));
        assert_eq!(b.remaining("present", t0 + ms(10)), None);
        assert_eq!(b.remaining("missing", t0 + ms(1000)), None);
    }

    #[test]
    fn retry_after_lengthens_the_window_up_to_sixty_seconds() {
        let t0 = Instant::now();
        let b = Backoff::new(ms(100));
        let secs = Duration::from_secs;
        assert_eq!(b.record("a", Scope::Client, Some(secs(5)), t0), secs(5));
        assert_eq!(b.remaining("a", t0 + ms(4999)), Some(ms(1)));

        let b = Backoff::new(ms(100));
        assert_eq!(b.record("a", Scope::Client, Some(secs(3600)), t0), secs(60));
        assert_eq!(b.remaining("a", t0 + secs(59)), Some(secs(1)));
        assert_eq!(b.remaining("a", t0 + secs(60)), None);
    }

    #[test]
    fn a_retry_after_shorter_than_the_cooldown_gives_the_cooldown() {
        let t0 = Instant::now();
        let b = Backoff::new(ms(1000));
        assert_eq!(
            b.record("a", Scope::Client, Some(Duration::ZERO), t0),
            ms(1000)
        );
        assert_eq!(b.record("a", Scope::Client, Some(ms(200)), t0), ms(1000));
        assert_eq!(b.remaining("a", t0 + ms(999)), Some(ms(1)));
    }

    #[test]
    fn a_zero_cooldown_never_blocks_even_with_retry_after() {
        let t0 = Instant::now();
        let b = Backoff::new(Duration::ZERO);
        let ra = Some(Duration::from_secs(30));
        assert_eq!(b.record("a", Scope::Client, ra, t0), Duration::ZERO);
        assert_eq!(b.record("a", Scope::Flag, ra, t0), Duration::ZERO);
        assert_eq!(b.remaining("a", t0), None);
        assert_eq!(b.remaining("a", t0 + ms(1)), None);
    }

    #[test]
    fn a_later_shorter_client_failure_does_not_shorten_the_window() {
        let t0 = Instant::now();
        let b = Backoff::new(ms(100));
        b.record("a", Scope::Client, Some(Duration::from_secs(10)), t0);
        b.record("a", Scope::Client, None, t0 + ms(500));
        assert_eq!(b.remaining("a", t0 + ms(9999)), Some(ms(1)));
    }

    #[test]
    fn a_request_scoped_failure_opens_no_window() {
        let t0 = Instant::now();
        let b = Backoff::new(ms(1000));
        let ra = Some(Duration::from_secs(30));
        assert_eq!(b.record("a", Scope::Request, ra, t0), Duration::ZERO);
        assert_eq!(b.remaining("a", t0 + ms(1)), None);
        assert_eq!(b.remaining("b", t0 + ms(1)), None);
    }

    #[test]
    fn an_unrepresentable_window_records_nothing_and_says_so() {
        let t0 = Instant::now();
        let b = Backoff::new(Duration::MAX);
        assert_eq!(b.record("a", Scope::Client, None, t0), Duration::ZERO);
        assert_eq!(b.remaining("a", t0), None);
    }

    #[test]
    fn the_flag_map_is_bounded_and_pruned() {
        let t0 = Instant::now();
        let b = Backoff::new(ms(1000));
        for i in 0..MAX_FLAG_ENTRIES {
            b.record(&format!("f{i}"), Scope::Flag, None, t0);
        }
        // Full of live windows: a new flag is not recorded, and `record` says so.
        assert_eq!(
            b.record("one-more", Scope::Flag, None, t0 + ms(10)),
            Duration::ZERO
        );
        assert_eq!(b.remaining("one-more", t0 + ms(20)), None);
        // An existing flag can still be overwritten while full.
        b.record("f0", Scope::Flag, None, t0 + ms(10));
        assert_eq!(b.remaining("f0", t0 + ms(1005)), Some(ms(5)));
        // After the rest expire, a new flag is recorded (the map was pruned).
        b.record("one-more", Scope::Flag, None, t0 + ms(1500));
        assert_eq!(b.remaining("one-more", t0 + ms(1600)), Some(ms(900)));
        assert!(b.state.lock().unwrap().flags.len() <= MAX_FLAG_ENTRIES);
    }

    #[test]
    fn retry_after_is_delta_seconds_only() {
        let s = Duration::from_secs;
        assert_eq!(parse_retry_after("5"), Some(s(5)));
        assert_eq!(parse_retry_after(" 7 "), Some(s(7)));
        assert_eq!(parse_retry_after("0"), Some(s(0)));
        assert_eq!(parse_retry_after("-1"), None);
        assert_eq!(parse_retry_after(""), None);
        assert_eq!(parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT"), None);
    }
}
