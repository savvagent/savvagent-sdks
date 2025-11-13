use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

#[derive(Clone)]
pub(crate) struct CacheEntry {
    pub value: bool,
    pub expires_at: Instant,
}

/// Thread-safe cache for flag values
#[derive(Clone)]
pub(crate) struct Cache {
    entries: Arc<RwLock<HashMap<String, CacheEntry>>>,
    ttl: Duration,
}

impl Cache {
    /// Create a new cache with the specified TTL
    pub fn new(ttl: Duration) -> Self {
        Self {
            entries: Arc::new(RwLock::new(HashMap::new())),
            ttl,
        }
    }

    /// Get a cached value if it exists and hasn't expired
    pub fn get(&self, key: &str) -> Option<bool> {
        let entries = self.entries.read().ok()?;
        let entry = entries.get(key)?;

        if Instant::now() > entry.expires_at {
            return None;
        }

        Some(entry.value)
    }

    /// Set a value in the cache
    pub fn set(&self, key: String, value: bool) {
        if let Ok(mut entries) = self.entries.write() {
            entries.insert(
                key,
                CacheEntry {
                    value,
                    expires_at: Instant::now() + self.ttl,
                },
            );
        }
    }

    /// Invalidate a specific key or all entries
    pub fn invalidate(&self, key: Option<&str>) {
        if let Ok(mut entries) = self.entries.write() {
            if let Some(k) = key {
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
