use crate::types::{Context, Metadata};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

/// Most contexts cached for one flag. When a new context finds the flag full, its expired
/// entries are swept, and if more than half the bound is still live the flag is cleared. Either
/// way at least half the bound is free afterwards, so a sweep (O(n), under the write lock) runs
/// at most once per `MAX_CONTEXTS_PER_FLAG / 2` new contexts. The cost of the bound is cache
/// misses, never a wrong answer.
pub(crate) const MAX_CONTEXTS_PER_FLAG: usize = 10_000;

#[derive(Clone)]
pub(crate) struct CacheEntry {
    pub value: bool,
    pub configuration: Option<serde_json::Value>,
    pub variation: Option<String>,
    pub metadata: Option<Metadata>,
    pub expires_at: Instant,
}

/// Thread-safe cache of evaluation results, keyed by flag key and then by evaluation context.
///
/// The server's answer depends on the context (targeting rules, percentage rollouts), so a
/// result is reused only for the context that produced it. Keying by flag alone handed one
/// user's targeted result to every other user within the TTL (#91).
///
/// Contexts are bounded per flag (`MAX_CONTEXTS_PER_FLAG`); the number of flags is not, and is
/// bounded only by the flag keys the host code evaluates.
#[derive(Clone)]
pub(crate) struct Cache {
    entries: Arc<RwLock<HashMap<String, HashMap<String, CacheEntry>>>>,
    /// Bumped by every invalidation, so a write from a request that started before it can be
    /// dropped. Lock order: `entries` first, so a check-then-store and a bump-then-remove cannot
    /// interleave.
    generations: Arc<RwLock<Generations>>,
    ttl: Duration,
    max_contexts_per_flag: usize,
}

#[derive(Default)]
struct Generations {
    epoch: u64,
    flags: HashMap<String, u64>,
}

impl Generations {
    fn of(&self, flag_key: &str) -> (u64, u64) {
        (self.epoch, self.flags.get(flag_key).copied().unwrap_or(0))
    }
}

/// The cache key for a context: its JSON with every object's keys sorted, so two contexts that
/// serialize to the same request body share a key whatever the `HashMap` iteration order of
/// their attributes (and whether or not serde_json's `preserve_order` is on). `None` means "do
/// not cache this call"; serializing a `Context` cannot fail, so it is not expected.
pub(crate) fn context_key(context: &Context) -> Option<String> {
    let value = serde_json::to_value(context).ok()?;
    serde_json::to_string(&sorted(value)).ok()
}

fn sorted(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut entries: Vec<_> = map.into_iter().collect();
            entries.sort_by(|(a, _), (b, _)| a.cmp(b));
            serde_json::Value::Object(entries.into_iter().map(|(k, v)| (k, sorted(v))).collect())
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.into_iter().map(sorted).collect())
        }
        other => other,
    }
}

impl Cache {
    /// Create a new cache with the specified TTL
    pub fn new(ttl: Duration) -> Self {
        Self::with_max_contexts_per_flag(ttl, MAX_CONTEXTS_PER_FLAG)
    }

    fn with_max_contexts_per_flag(ttl: Duration, max_contexts_per_flag: usize) -> Self {
        Self {
            entries: Arc::new(RwLock::new(HashMap::new())),
            generations: Arc::new(RwLock::new(Generations::default())),
            ttl,
            max_contexts_per_flag,
        }
    }

    /// The unexpired entry for this flag and context, if any.
    pub fn get_entry(&self, flag_key: &str, context_key: &str) -> Option<CacheEntry> {
        let entries = self.entries.read().ok()?;
        let entry = entries.get(flag_key)?.get(context_key)?;

        if Instant::now() > entry.expires_at {
            return None;
        }

        Some(entry.clone())
    }

    /// The flag's invalidation generation. Read it before sending the evaluate request and pass
    /// it to `set`, which drops the write if the flag was invalidated since (#137).
    pub fn generation(&self, flag_key: &str) -> (u64, u64) {
        self.generations
            .read()
            .map(|g| g.of(flag_key))
            .unwrap_or_default()
    }

    /// Cache the result for this flag and context, unless the flag was invalidated after
    /// `generation` was read.
    #[allow(clippy::too_many_arguments)]
    pub fn set_at(
        &self,
        generation: (u64, u64),
        flag_key: &str,
        context_key: String,
        value: bool,
        configuration: Option<serde_json::Value>,
        variation: Option<String>,
        metadata: Option<Metadata>,
    ) {
        if let Ok(mut entries) = self.entries.write() {
            let current = self
                .generations
                .read()
                .map(|g| g.of(flag_key))
                .unwrap_or_default();
            if current != generation {
                return;
            }
            self.store(
                &mut entries,
                flag_key,
                context_key,
                value,
                configuration,
                variation,
                metadata,
            );
        }
    }

    /// Cache the result for this flag and context, whatever the flag's generation.
    #[cfg(test)]
    pub fn set(
        &self,
        flag_key: &str,
        context_key: String,
        value: bool,
        configuration: Option<serde_json::Value>,
        variation: Option<String>,
        metadata: Option<Metadata>,
    ) {
        if let Ok(mut entries) = self.entries.write() {
            self.store(
                &mut entries,
                flag_key,
                context_key,
                value,
                configuration,
                variation,
                metadata,
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn store(
        &self,
        entries: &mut HashMap<String, HashMap<String, CacheEntry>>,
        flag_key: &str,
        context_key: String,
        value: bool,
        configuration: Option<serde_json::Value>,
        variation: Option<String>,
        metadata: Option<Metadata>,
    ) {
        {
            let contexts = entries.entry(flag_key.to_string()).or_default();
            if contexts.len() >= self.max_contexts_per_flag && !contexts.contains_key(&context_key)
            {
                let now = Instant::now();
                contexts.retain(|_, entry| entry.expires_at >= now);
                if contexts.len() > self.max_contexts_per_flag / 2 {
                    contexts.clear();
                }
            }
            contexts.insert(
                context_key,
                CacheEntry {
                    value,
                    configuration,
                    variation,
                    metadata,
                    expires_at: Instant::now() + self.ttl,
                },
            );
        }
    }

    /// Invalidate one flag, for every context, or with `None` every flag
    pub fn invalidate(&self, flag_key: Option<&str>) {
        if let Ok(mut entries) = self.entries.write() {
            if let Ok(mut generations) = self.generations.write() {
                match flag_key {
                    Some(k) => *generations.flags.entry(k.to_string()).or_insert(0) += 1,
                    None => {
                        generations.epoch += 1;
                        generations.flags.clear();
                    }
                }
            }
            if let Some(k) = flag_key {
                entries.remove(k);
            } else {
                entries.clear();
            }
        }
    }

    /// Clear all entries
    pub fn clear(&self) {
        self.invalidate(None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn len(cache: &Cache, flag_key: &str) -> usize {
        cache.entries.read().unwrap()[flag_key].len()
    }

    #[test]
    fn context_key_ignores_insertion_order_and_separates_values() {
        let a = Context::new()
            .with_attribute("x", json!(1))
            .with_attribute("y", json!({ "p": 1, "q": 2 }));
        let b = Context::new()
            .with_attribute("y", json!({ "q": 2, "p": 1 }))
            .with_attribute("x", json!(1));
        let c = Context::new()
            .with_attribute("x", json!(2))
            .with_attribute("y", json!({ "p": 1, "q": 2 }));

        assert!(context_key(&a).is_some());
        assert_eq!(context_key(&a), context_key(&b));
        assert_ne!(context_key(&a), context_key(&c));
        assert_ne!(
            context_key(&Context::new().with_user_id("a")),
            context_key(&Context::new().with_user_id("b"))
        );
    }

    #[test]
    fn entries_are_per_flag_and_context() {
        let cache = Cache::new(Duration::from_secs(60));
        cache.set("f", "c1".into(), true, None, None, None);
        cache.set("f", "c2".into(), false, None, None, None);

        assert_eq!(cache.get_entry("f", "c1").map(|e| e.value), Some(true));
        assert_eq!(cache.get_entry("f", "c2").map(|e| e.value), Some(false));
        assert!(cache.get_entry("f", "c3").is_none());
        assert!(cache.get_entry("g", "c1").is_none());
    }

    #[test]
    fn invalidating_a_flag_drops_every_context_of_that_flag_only() {
        let cache = Cache::new(Duration::from_secs(60));
        cache.set("f", "c1".into(), true, None, None, None);
        cache.set("f", "c2".into(), false, None, None, None);
        cache.set("g", "c1".into(), true, None, None, None);

        cache.invalidate(Some("f"));

        assert!(cache.get_entry("f", "c1").is_none());
        assert!(cache.get_entry("f", "c2").is_none());
        assert!(cache.get_entry("g", "c1").is_some());
    }

    #[test]
    fn a_full_flag_with_nothing_expired_is_cleared_and_takes_the_new_entry() {
        let cache = Cache::with_max_contexts_per_flag(Duration::from_secs(60), 3);
        for i in 0..3 {
            cache.set("f", i.to_string(), true, None, None, None);
        }
        cache.set("g", "0".into(), true, None, None, None);

        cache.set("f", "new".into(), false, None, None, None);

        assert_eq!(cache.get_entry("f", "new").map(|e| e.value), Some(false));
        assert!(cache.get_entry("f", "0").is_none());
        assert_eq!(len(&cache, "f"), 1);
        // Other flags are untouched.
        assert!(cache.get_entry("g", "0").is_some());
    }

    fn backdate(cache: &Cache, flag_key: &str, context_keys: &[&str]) {
        let mut entries = cache.entries.write().unwrap();
        let past = Instant::now() - Duration::from_secs(1);
        for key in context_keys {
            entries
                .get_mut(flag_key)
                .unwrap()
                .get_mut(*key)
                .unwrap()
                .expires_at = past;
        }
    }

    #[test]
    fn a_full_flag_sweeps_expired_entries_and_keeps_live_ones() {
        let cache = Cache::with_max_contexts_per_flag(Duration::from_secs(60), 4);
        for key in ["live", "old-0", "old-1", "old-2"] {
            cache.set("f", key.into(), true, None, None, None);
        }
        backdate(&cache, "f", &["old-0", "old-1", "old-2"]);

        cache.set("f", "new".into(), false, None, None, None);

        assert!(cache.get_entry("f", "live").is_some());
        assert!(cache.get_entry("f", "new").is_some());
        assert_eq!(len(&cache, "f"), 2);
    }

    #[test]
    fn a_sweep_that_frees_too_little_clears_the_flag() {
        // Without the half-bound rule, a flag whose live entries hover just under the bound
        // would be swept on nearly every new context.
        let cache = Cache::with_max_contexts_per_flag(Duration::from_secs(60), 4);
        for key in ["a", "b", "c", "old"] {
            cache.set("f", key.into(), true, None, None, None);
        }
        backdate(&cache, "f", &["old"]);

        cache.set("f", "new".into(), false, None, None, None);

        assert_eq!(len(&cache, "f"), 1);
        assert!(cache.get_entry("f", "new").is_some());
    }

    #[test]
    fn refreshing_an_existing_context_in_a_full_flag_keeps_the_others() {
        let cache = Cache::with_max_contexts_per_flag(Duration::from_secs(60), 2);
        cache.set("f", "a".into(), true, None, None, None);
        cache.set("f", "b".into(), true, None, None, None);

        cache.set("f", "a".into(), false, None, None, None);

        assert_eq!(cache.get_entry("f", "a").map(|e| e.value), Some(false));
        assert!(cache.get_entry("f", "b").is_some());
    }
}
