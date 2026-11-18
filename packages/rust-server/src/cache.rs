use crate::types::{Context, Metadata};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

/// Most entries cached across every flag and context. Past it the least recently used entry is
/// evicted (a hit counts as a use), so the bound costs cache misses, never a wrong answer.
pub(crate) const MAX_ENTRIES: usize = 10_000;

/// Most per-flag invalidation counters kept. Past it a new epoch replaces them all, which
/// invalidates every outstanding generation at once, so the stale re-cache guard still holds and
/// the map cannot grow without limit.
pub(crate) const MAX_GENERATIONS: usize = 10_000;

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
/// A context is stored only as the SHA-256 hex digest of its canonical JSON (`context_key`), so
/// the cache never holds user IDs or attributes (#30). One least-recently-used bound,
/// `MAX_ENTRIES`, covers every flag.
#[derive(Clone)]
pub(crate) struct Cache {
    store: Arc<Mutex<Store>>,
    /// Bumped by every invalidation, so a write from a request that started before it can be
    /// dropped. Lock order: `store` first, so a check-then-store and a bump-then-remove cannot
    /// interleave.
    generations: Arc<RwLock<Generations>>,
    ttl: Duration,
    max_entries: usize,
    max_generations: usize,
}

struct Slot {
    entry: CacheEntry,
    /// This entry's key in `Store::recency`.
    tick: u64,
}

/// The entries by flag key and context digest, and the same entries by last use.
#[derive(Default)]
struct Store {
    flags: HashMap<String, HashMap<String, Slot>>,
    /// Last-use tick to (flag key, context digest); the first is the least recently used.
    recency: BTreeMap<u64, (String, String)>,
    tick: u64,
}

impl Store {
    fn next_tick(&mut self) -> u64 {
        self.tick += 1;
        self.tick
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.recency.len()
    }

    fn remove(&mut self, flag_key: &str, digest: &str) {
        if let Some(slots) = self.flags.get_mut(flag_key) {
            if let Some(slot) = slots.remove(digest) {
                self.recency.remove(&slot.tick);
            }
            if slots.is_empty() {
                self.flags.remove(flag_key);
            }
        }
    }

    fn remove_flag(&mut self, flag_key: &str) {
        if let Some(slots) = self.flags.remove(flag_key) {
            for slot in slots.values() {
                self.recency.remove(&slot.tick);
            }
        }
    }

    fn clear(&mut self) {
        self.flags.clear();
        self.recency.clear();
    }

    /// The unexpired entry, made the most recently used. An expired one is removed.
    fn get(&mut self, flag_key: &str, digest: &str) -> Option<CacheEntry> {
        let tick = self.next_tick();
        let slot = self.flags.get_mut(flag_key)?.get_mut(digest)?;
        if Instant::now() > slot.entry.expires_at {
            self.remove(flag_key, digest);
            return None;
        }
        let old = std::mem::replace(&mut slot.tick, tick);
        let entry = slot.entry.clone();
        if let Some(key) = self.recency.remove(&old) {
            self.recency.insert(tick, key);
        }
        Some(entry)
    }

    fn insert(&mut self, flag_key: &str, digest: String, entry: CacheEntry, max_entries: usize) {
        let tick = self.next_tick();
        let previous = self
            .flags
            .entry(flag_key.to_string())
            .or_default()
            .insert(digest.clone(), Slot { entry, tick });
        if let Some(previous) = previous {
            self.recency.remove(&previous.tick);
        }
        self.recency.insert(tick, (flag_key.to_string(), digest));
        while self.recency.len() > max_entries.max(1) {
            let Some((_, (flag, digest))) = self.recency.pop_first() else {
                break;
            };
            if let Some(slots) = self.flags.get_mut(&flag) {
                slots.remove(&digest);
                if slots.is_empty() {
                    self.flags.remove(&flag);
                }
            }
        }
    }
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

/// The canonical JSON of a context: its JSON with every object's keys sorted, so two contexts
/// that serialize to the same request body match whatever the `HashMap` iteration order of their
/// attributes (and whether or not serde_json's `preserve_order` is on). The cache stores only its
/// digest. `None` means "do not cache this call"; serializing a `Context` cannot fail, so it is
/// not expected.
pub(crate) fn context_key(context: &Context) -> Option<String> {
    let value = serde_json::to_value(context).ok()?;
    serde_json::to_string(&sorted(value)).ok()
}

/// The lowercase hex SHA-256 of a context key's UTF-8 bytes: the key the cache stores it under.
fn digest(context_key: &str) -> String {
    let hash = Sha256::digest(context_key.as_bytes());
    let mut hex = String::with_capacity(hash.len() * 2);
    for byte in hash {
        let _ = write!(hex, "{byte:02x}");
    }
    hex
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
        Self::with_max_entries(ttl, MAX_ENTRIES)
    }

    fn with_max_entries(ttl: Duration, max_entries: usize) -> Self {
        Self {
            store: Arc::new(Mutex::new(Store::default())),
            generations: Arc::new(RwLock::new(Generations::default())),
            ttl,
            max_entries,
            max_generations: MAX_GENERATIONS,
        }
    }

    /// The unexpired entry for this flag and context, if any. A hit makes it the most recently
    /// used.
    pub fn get_entry(&self, flag_key: &str, context_key: &str) -> Option<CacheEntry> {
        let digest = digest(context_key);
        self.store.lock().ok()?.get(flag_key, &digest)
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
        let entry = self.entry(value, configuration, variation, metadata);
        let digest = digest(&context_key);
        if let Ok(mut store) = self.store.lock() {
            let current = self
                .generations
                .read()
                .map(|g| g.of(flag_key))
                .unwrap_or_default();
            if current != generation {
                return;
            }
            store.insert(flag_key, digest, entry, self.max_entries);
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
        let entry = self.entry(value, configuration, variation, metadata);
        let digest = digest(&context_key);
        if let Ok(mut store) = self.store.lock() {
            store.insert(flag_key, digest, entry, self.max_entries);
        }
    }

    fn entry(
        &self,
        value: bool,
        configuration: Option<serde_json::Value>,
        variation: Option<String>,
        metadata: Option<Metadata>,
    ) -> CacheEntry {
        CacheEntry {
            value,
            configuration,
            variation,
            metadata,
            expires_at: Instant::now() + self.ttl,
        }
    }

    /// Invalidate one flag, for every context, or with `None` every flag
    pub fn invalidate(&self, flag_key: Option<&str>) {
        if let Ok(mut store) = self.store.lock() {
            if let Ok(mut generations) = self.generations.write() {
                match flag_key {
                    Some(k) => {
                        *generations.flags.entry(k.to_string()).or_insert(0) += 1;
                        if generations.flags.len() > self.max_generations {
                            generations.epoch += 1;
                            generations.flags.clear();
                        }
                    }
                    None => {
                        generations.epoch += 1;
                        generations.flags.clear();
                    }
                }
            }
            match flag_key {
                Some(k) => store.remove_flag(k),
                None => store.clear(),
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

    /// SHA-256 of "abc" (FIPS 180-2, appendix B.1).
    const SHA256_ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    fn total(cache: &Cache) -> usize {
        cache.store.lock().unwrap().len()
    }

    /// Every key the cache holds for a context, from both the per-flag map and the recency index.
    fn stored_keys(cache: &Cache) -> Vec<(String, String)> {
        let store = cache.store.lock().unwrap();
        let mut keys: Vec<(String, String)> = store
            .flags
            .iter()
            .flat_map(|(flag, slots)| slots.keys().map(move |d| (flag.clone(), d.clone())))
            .collect();
        keys.extend(store.recency.values().cloned());
        keys
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
    fn digest_is_lowercase_sha256_hex() {
        assert_eq!(digest("abc"), SHA256_ABC);
        assert_eq!(
            digest(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn stored_key_for_a_context_is_its_sha256_hex() {
        let cache = Cache::new(Duration::from_secs(60));
        cache.set("f", "abc".into(), true, None, None, None);

        assert_eq!(
            stored_keys(&cache),
            vec![("f".to_string(), SHA256_ABC.to_string()); 2]
        );
        assert_eq!(cache.get_entry("f", "abc").map(|e| e.value), Some(true));
    }

    #[test]
    fn equal_contexts_share_one_entry_and_different_contexts_do_not() {
        let cache = Cache::new(Duration::from_secs(60));
        let a = Context::new()
            .with_user_id("u")
            .with_attribute("x", json!(1))
            .with_attribute("y", json!(2));
        let b = Context::new()
            .with_attribute("y", json!(2))
            .with_attribute("x", json!(1))
            .with_user_id("u");
        let c = Context::new()
            .with_user_id("u")
            .with_attribute("x", json!(3));

        cache.set("f", context_key(&a).unwrap(), true, None, None, None);
        cache.set("f", context_key(&b).unwrap(), false, None, None, None);
        assert_eq!(total(&cache), 1);
        assert_eq!(
            cache
                .get_entry("f", &context_key(&a).unwrap())
                .map(|e| e.value),
            Some(false)
        );

        cache.set("f", context_key(&c).unwrap(), true, None, None, None);
        assert_eq!(total(&cache), 2);
    }

    #[test]
    fn raw_user_id_is_in_no_cache_key() {
        let secret = "alice-secret-user-id";
        let cache = Cache::new(Duration::from_secs(60));
        let key = context_key(&Context::new().with_user_id(secret)).unwrap();
        assert!(key.contains(secret));

        cache.set("f", key.clone(), true, None, None, None);
        cache.set("g", key.clone(), true, None, None, None);

        let keys = stored_keys(&cache);
        assert_eq!(keys.len(), 4);
        for (flag, digest_key) in keys {
            assert!(!flag.contains(secret));
            assert!(!digest_key.contains(secret));
            assert_eq!(digest_key, digest(&key));
        }
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
        // The recency index forgets the flag's entries too.
        assert_eq!(
            stored_keys(&cache),
            vec![("g".to_string(), digest("c1")); 2]
        );
    }

    #[test]
    fn default_total_bound_is_10_000_entries() {
        assert_eq!(MAX_ENTRIES, 10_000);
        assert_eq!(Cache::new(Duration::from_secs(60)).max_entries, MAX_ENTRIES);
    }

    #[test]
    fn entries_across_flags_never_exceed_the_cap_and_the_lru_goes_first() {
        let cache = Cache::with_max_entries(Duration::from_secs(60), 3);
        let flags = ["f", "g", "h"];
        for i in 0..10 {
            cache.set(flags[i % 3], i.to_string(), true, None, None, None);
            assert!(total(&cache) <= 3);
            assert!(cache.store.lock().unwrap().recency.len() <= 3);
        }
        // Only the three most recent writes remain, across three flags.
        for i in 0..7 {
            assert!(cache.get_entry(flags[i % 3], &i.to_string()).is_none());
        }
        for i in 7..10 {
            assert!(cache.get_entry(flags[i % 3], &i.to_string()).is_some());
        }
    }

    #[test]
    fn a_hit_refreshes_recency() {
        let cache = Cache::with_max_entries(Duration::from_secs(60), 2);
        cache.set("f", "a".into(), true, None, None, None);
        cache.set("g", "b".into(), true, None, None, None);

        // Reading f/a makes g/b the least recently used.
        assert!(cache.get_entry("f", "a").is_some());
        cache.set("h", "c".into(), true, None, None, None);

        assert!(cache.get_entry("f", "a").is_some());
        assert!(cache.get_entry("g", "b").is_none());
        assert!(cache.get_entry("h", "c").is_some());
    }

    #[test]
    fn refreshing_an_existing_context_at_the_cap_keeps_the_others() {
        let cache = Cache::with_max_entries(Duration::from_secs(60), 2);
        cache.set("f", "a".into(), true, None, None, None);
        cache.set("g", "b".into(), true, None, None, None);

        cache.set("f", "a".into(), false, None, None, None);

        assert_eq!(cache.get_entry("f", "a").map(|e| e.value), Some(false));
        assert!(cache.get_entry("g", "b").is_some());
        assert_eq!(total(&cache), 2);
    }

    #[test]
    fn an_expired_entry_is_dropped_when_read() {
        let cache = Cache::new(Duration::from_secs(60));
        cache.set("f", "a".into(), true, None, None, None);
        {
            let mut store = cache.store.lock().unwrap();
            let slot = store
                .flags
                .get_mut("f")
                .and_then(|slots| slots.get_mut(&digest("a")))
                .unwrap();
            slot.entry.expires_at = Instant::now() - Duration::from_secs(1);
        }

        assert!(cache.get_entry("f", "a").is_none());
        assert_eq!(total(&cache), 0);
        assert!(stored_keys(&cache).is_empty());
    }

    #[test]
    fn a_write_from_before_an_invalidation_is_dropped() {
        let cache = Cache::new(Duration::from_secs(60));
        let before = cache.generation("f");
        cache.invalidate(Some("f"));

        cache.set_at(before, "f", "a".into(), true, None, None, None);
        assert!(cache.get_entry("f", "a").is_none());

        cache.set_at(
            cache.generation("f"),
            "f",
            "a".into(),
            true,
            None,
            None,
            None,
        );
        assert!(cache.get_entry("f", "a").is_some());
    }

    #[test]
    fn the_generations_map_is_bounded_and_the_guard_holds_across_the_reset() {
        let mut cache = Cache::new(Duration::from_secs(60));
        cache.max_generations = 3;

        cache.invalidate(Some("f"));
        let before = cache.generation("f"); // a request for "f" starts here
        for i in 0..10 {
            cache.invalidate(Some(&format!("other-{i}")));
            let held = cache.generations.read().unwrap().flags.len();
            assert!(held <= 3, "generations held {held} counters, cap is 3");
        }
        // The reset cleared "f"'s counter; invalidating "f" again brings it back to the value the
        // request read. The new epoch still tells the two apart.
        cache.invalidate(Some("f"));
        cache.set_at(before, "f", "a".into(), true, None, None, None);
        assert!(cache.get_entry("f", "a").is_none());

        assert_eq!(Cache::new(Duration::from_secs(60)).max_generations, 10_000);
    }
}
