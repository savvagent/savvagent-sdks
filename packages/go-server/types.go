package savvagentflags

import "time"

// Config holds the configuration for the FlagClient
type Config struct {
	// APIKey is the API key: a server key (srv_), recommended for server apps, or a client key
	// (sdk_). A server key is a secret: NewClient logs a warning when it would be sent to a
	// base URL that is not https, unless the host is localhost, 127.0.0.1 or [::1].
	APIKey string

	// ApplicationID for application-scoped flags (optional)
	ApplicationID string

	// BaseURL is the Savvagent Flags API base URL (default: https://api.savvagent.com/flags)
	BaseURL string

	// EnableRealtime opens the flag-change stream (GET /api/flags/stream, server-sent
	// events) in a background goroutine. Each change drops that flag's cached evaluations, so
	// a change, a kill switch above all, reaches this client in about a round trip instead of
	// after CacheTTL. Default: off, because a bool's zero value cannot mean on; set it to true
	// to open the stream, and call Close to stop it. While the stream is down, CacheTTL
	// bounds how stale a cached result can be.
	EnableRealtime bool

	// CacheTTL is the cache time-to-live duration (default: 60 seconds)
	CacheTTL time.Duration

	// EnableTelemetry has no effect: this SDK sends no telemetry. It is kept so existing
	// code that sets it still compiles.
	EnableTelemetry bool

	// Defaults provides default flag values when evaluation fails. A missing flag defaults to
	// false. SetDefaultFromEnv and SetDefaultFunc add defaults that are not constants.
	Defaults map[string]bool

	// OnError is a custom error handler. With EnableRealtime it can also be called from the
	// stream goroutine, at the same time as calls from lookups, so it must be safe for concurrent
	// use, and it must not call Close.
	OnError func(error)

	// Timeout is the HTTP request timeout (default: 5 seconds)
	Timeout time.Duration
}

// Context holds the context for flag evaluation
type Context struct {
	// UserID for targeted rollouts
	UserID string `json:"user_id,omitempty"`

	// SessionID for session-based rollouts
	SessionID string `json:"session_id,omitempty"`

	// ApplicationID for application-scoped flags
	ApplicationID string `json:"application_id,omitempty"`

	// Attributes for custom targeting rules
	Attributes map[string]interface{} `json:"attributes,omitempty"`

	// Environment (dev, staging, production)
	Environment string `json:"environment,omitempty"`

	// IPAddress for geo-targeting
	IPAddress string `json:"ip_address,omitempty"`

	// UserAgent string
	UserAgent string `json:"user_agent,omitempty"`
}

// EvaluationResult is the result from flag evaluation
type EvaluationResult struct {
	// Key is the flag key
	Key string `json:"key"`

	// Value is the evaluated value
	Value bool `json:"value"`

	// Configuration is the dynamic configuration attached to the flag (Phase 1)
	Configuration map[string]interface{} `json:"configuration,omitempty"`

	// Variation is the identifier for multi-variant flags (Phase 2)
	Variation string `json:"variation,omitempty"`

	// Reason indicates why this value was returned
	Reason string `json:"reason"` // "cached", "evaluated", "error", or "static" (NewStaticClient)

	// Metadata about the flag
	Metadata *Metadata `json:"metadata,omitempty"`
}

// Metadata contains additional information about a flag
type Metadata struct {
	// FlagID is not sent by the savvagent-flags server, so it is empty.
	FlagID string `json:"flag_id,omitempty"`

	// Description is not sent by the savvagent-flags server, so it is empty.
	Description string `json:"description,omitempty"`

	// Variant is not sent by the savvagent-flags server, so it is empty.
	Variant string `json:"variant,omitempty"`

	// Version is the flag version that produced the result; 0 when the server sent none.
	Version int64 `json:"version,omitempty"`

	// Scope is the scope the server reports for the flag (for example "application"); empty
	// when the server sent none.
	Scope string `json:"scope,omitempty"`
}

// VariationResult contains variation information for multi-variant flags
type VariationResult struct {
	// Variation is the variation identifier (e.g., "control", "variant_a")
	Variation string `json:"variation"`

	// Enabled indicates if the flag is enabled
	Enabled bool `json:"enabled"`

	// Configuration is the dynamic configuration for this variation
	Configuration map[string]interface{} `json:"configuration,omitempty"`
}

// cacheEntry represents a cached flag value
type cacheEntry struct {
	Value         bool
	Configuration map[string]interface{}
	Variation     string
	Version       int64
	Scope         string
	ExpiresAt     time.Time
}

// ConfigOverrideOptions holds options for setting configuration overrides
type ConfigOverrideOptions struct {
	// Merge indicates whether to merge with API configuration (default: false)
	Merge bool

	// Validate indicates whether to validate configuration structure (default: true)
	Validate bool
}

// configOverrideEntry stores a configuration override
type configOverrideEntry struct {
	Config    map[string]interface{}
	Merge     bool
	Timestamp time.Time
}

// variationOverrideEntry stores a variation override
type variationOverrideEntry struct {
	Variation string
	Timestamp time.Time
}
