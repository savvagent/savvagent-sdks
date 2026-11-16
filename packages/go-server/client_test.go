package savvagentflags

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewClient(t *testing.T) {
	tests := []struct {
		name    string
		config  Config
		wantErr bool
	}{
		{
			name: "valid config",
			config: Config{
				APIKey: "sdk_test_key",
			},
			wantErr: false,
		},
		{
			name:    "missing API key",
			config:  Config{},
			wantErr: true,
		},
		{
			name: "API key without sdk_ prefix",
			config: Config{
				APIKey: "test-key",
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, err := NewClient(tt.config)
			if (err != nil) != tt.wantErr {
				t.Errorf("NewClient() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && client == nil {
				t.Error("NewClient() returned nil client")
			}
			if client != nil {
				client.Close()
			}
		})
	}
}

func TestConfig_Defaults(t *testing.T) {
	client, err := NewClient(Config{APIKey: "sdk_test_key"})
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	if client.config.BaseURL != "https://api.savvagent.com/flags" {
		t.Errorf("BaseURL = %q, want the default", client.config.BaseURL)
	}
	if client.config.CacheTTL != 60*time.Second {
		t.Errorf("CacheTTL = %v, want 60s", client.config.CacheTTL)
	}
	if client.config.Timeout != 5*time.Second {
		t.Errorf("Timeout = %v, want 5s", client.config.Timeout)
	}
	if client.config.Defaults == nil {
		t.Error("Defaults is nil, want an empty map")
	}
	if client.config.OnError == nil {
		t.Error("OnError is nil, want the default handler")
	}
}

func TestClient_Evaluate(t *testing.T) {
	tests := []struct {
		name         string
		flagKey      string
		statusCode   int
		responseBody string
		wantValue    bool
		wantReason   string
		wantErr      bool
	}{
		{
			name:         "flag enabled",
			flagKey:      "test-flag",
			statusCode:   http.StatusOK,
			responseBody: `{"enabled":true,"flag_id":"flag-123"}`,
			wantValue:    true,
			wantReason:   "evaluated",
		},
		{
			name:         "flag disabled",
			flagKey:      "test-flag",
			statusCode:   http.StatusOK,
			responseBody: `{"enabled":false}`,
			wantValue:    false,
			wantReason:   "evaluated",
		},
		{
			name:         "404 error",
			flagKey:      "missing-flag",
			statusCode:   http.StatusNotFound,
			responseBody: `{"error":"Flag not found"}`,
			wantValue:    false,
			wantReason:   "error",
			wantErr:      true,
		},
		{
			name:         "500 error",
			flagKey:      "test-flag",
			statusCode:   http.StatusInternalServerError,
			responseBody: "Internal server error",
			wantValue:    false,
			wantReason:   "error",
			wantErr:      true,
		},
		{
			name:         "invalid JSON",
			flagKey:      "test-flag",
			statusCode:   http.StatusOK,
			responseBody: "invalid json",
			wantValue:    false,
			wantReason:   "error",
			wantErr:      true,
		},
		{
			name:         "missing enabled field",
			flagKey:      "test-flag",
			statusCode:   http.StatusOK,
			responseBody: `{"flag_id":"flag-123"}`,
			wantValue:    false,
			wantReason:   "error",
			wantErr:      true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost {
					t.Errorf("Expected POST request, got %s", r.Method)
				}
				if want := "/api/flags/" + tt.flagKey + "/evaluate"; r.URL.Path != want {
					t.Errorf("Expected path %s, got %s", want, r.URL.Path)
				}
				if auth := r.Header.Get("Authorization"); auth != "Bearer sdk_test_key" {
					t.Errorf("Expected Authorization header 'Bearer sdk_test_key', got '%s'", auth)
				}

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tt.statusCode)
				_, _ = w.Write([]byte(tt.responseBody))
			}))
			defer server.Close()

			client, err := NewClient(Config{
				APIKey:  "sdk_test_key",
				BaseURL: server.URL,
				OnError: func(error) {},
			})
			if err != nil {
				t.Fatalf("Failed to create client: %v", err)
			}
			defer client.Close()

			result, err := client.Evaluate(tt.flagKey, &Context{UserID: "user-123"})
			if (err != nil) != tt.wantErr {
				t.Fatalf("Evaluate() error = %v, wantErr %v", err, tt.wantErr)
			}
			if result == nil {
				t.Fatal("Evaluate() returned a nil result")
			}
			if result.Value != tt.wantValue {
				t.Errorf("Value = %v, want %v", result.Value, tt.wantValue)
			}
			if result.Reason != tt.wantReason {
				t.Errorf("Reason = %q, want %q", result.Reason, tt.wantReason)
			}
		})
	}
}

func TestClient_IsEnabled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"enabled":true}`))
	}))
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:  "sdk_test_key",
		BaseURL: server.URL,
	})
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	if !client.IsEnabled("test-flag", &Context{UserID: "user-123"}) {
		t.Error("IsEnabled() = false, want true")
	}
}

func TestClient_IsEnabledUsesDefaultOnError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:   "sdk_test_key",
		BaseURL:  server.URL,
		Defaults: map[string]bool{"test-flag": true},
		OnError:  func(error) {},
	})
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	if !client.IsEnabled("test-flag", &Context{UserID: "user-123"}) {
		t.Error("IsEnabled() = false, want the configured default true")
	}
}

func TestClient_GetVariation(t *testing.T) {
	tests := []struct {
		name          string
		responseBody  string
		wantVariation string
		wantEnabled   bool
	}{
		{
			name:          "named variation",
			responseBody:  `{"enabled":true,"variation":"variant_a"}`,
			wantVariation: "variant_a",
			wantEnabled:   true,
		},
		{
			name:          "no variation falls back to control",
			responseBody:  `{"enabled":false}`,
			wantVariation: "control",
			wantEnabled:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tt.responseBody))
			}))
			defer server.Close()

			client, err := NewClient(Config{
				APIKey:  "sdk_test_key",
				BaseURL: server.URL,
			})
			if err != nil {
				t.Fatalf("Failed to create client: %v", err)
			}
			defer client.Close()

			result, err := client.GetVariation("test-flag", &Context{UserID: "user-123"})
			if err != nil {
				t.Fatalf("GetVariation() error = %v", err)
			}
			if result.Variation != tt.wantVariation {
				t.Errorf("Variation = %q, want %q", result.Variation, tt.wantVariation)
			}
			if result.Enabled != tt.wantEnabled {
				t.Errorf("Enabled = %v, want %v", result.Enabled, tt.wantEnabled)
			}
		})
	}
}

func TestContext(t *testing.T) {
	ctx := Context{
		UserID: "user-123",
		Attributes: map[string]interface{}{
			"email": "test@example.com",
			"plan":  "pro",
			"age":   30,
		},
	}

	if ctx.UserID != "user-123" {
		t.Errorf("Expected UserID 'user-123', got %s", ctx.UserID)
	}
	if ctx.Attributes["email"] != "test@example.com" {
		t.Errorf("Expected email 'test@example.com', got %v", ctx.Attributes["email"])
	}
	if ctx.Attributes["plan"] != "pro" {
		t.Errorf("Expected plan 'pro', got %v", ctx.Attributes["plan"])
	}
	if ctx.Attributes["age"] != 30 {
		t.Errorf("Expected age 30, got %v", ctx.Attributes["age"])
	}
}

func TestClient_Concurrent(t *testing.T) {
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"enabled":true}`))
	}))
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:  "sdk_test_key",
		BaseURL: server.URL,
	})
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	ctx := &Context{UserID: "user-123"}

	done := make(chan bool, 10)
	for i := 0; i < 10; i++ {
		go func(id int) {
			result, err := client.Evaluate("test-flag", ctx)
			if err != nil {
				t.Errorf("Request %d failed: %v", id, err)
			} else if !result.Value {
				t.Errorf("Request %d: Value = false, want true", id)
			}
			done <- true
		}(i)
	}

	for i := 0; i < 10; i++ {
		<-done
	}
}

func TestClient_Caching(t *testing.T) {
	var callCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&callCount, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"enabled":true}`))
	}))
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:   "sdk_test_key",
		BaseURL:  server.URL,
		CacheTTL: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	ctx := &Context{UserID: "user-123"}

	first, err := client.Evaluate("test-flag", ctx)
	if err != nil {
		t.Fatalf("First request failed: %v", err)
	}
	second, err := client.Evaluate("test-flag", ctx)
	if err != nil {
		t.Fatalf("Second request failed: %v", err)
	}

	if first.Reason != "evaluated" || second.Reason != "cached" {
		t.Errorf("reasons = %q, %q; want \"evaluated\", \"cached\"", first.Reason, second.Reason)
	}
	if n := atomic.LoadInt32(&callCount); n != 1 {
		t.Errorf("Expected 1 API call, got %d", n)
	}
}
