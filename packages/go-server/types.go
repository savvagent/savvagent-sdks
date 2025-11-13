package savvagent

import "time"

// Config holds the configuration for the FlagClient
type Config struct {
	// APIKey is the SDK API key (starts with sdk_)
	APIKey string

	// ApplicationID for application-scoped flags (optional)
	ApplicationID string

	// BaseURL is the Savvagent API base URL (default: https://api.savvagent.com)
	BaseURL string

	// EnableRealtime enables real-time flag updates via SSE (default: true)
	EnableRealtime bool

	// CacheTTL is the cache time-to-live duration (default: 60 seconds)
	CacheTTL time.Duration

	// EnableTelemetry enables telemetry tracking (default: true)
	EnableTelemetry bool

	// Defaults provides default flag values when evaluation fails
	Defaults map[string]bool

	// OnError is a custom error handler
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

	// Reason indicates why this value was returned
	Reason string `json:"reason"` // "cached", "evaluated", "default", "error"

	// Metadata about the flag
	Metadata *Metadata `json:"metadata,omitempty"`
}

// Metadata contains additional information about a flag
type Metadata struct {
	FlagID      string `json:"flag_id,omitempty"`
	Description string `json:"description,omitempty"`
	Variant     string `json:"variant,omitempty"`
}

// cacheEntry represents a cached flag value
type cacheEntry struct {
	Value     bool
	ExpiresAt time.Time
}
