package savvagent

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
				SDKKey:      "test-sdk-key",
				Environment: "test",
			},
			wantErr: false,
		},
		{
			name: "missing SDK key",
			config: Config{
				Environment: "test",
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

func TestClient_IsEnabled(t *testing.T) {
	tests := []struct {
		name           string
		flagKey        string
		statusCode     int
		responseBody   string
		expectedResult bool
		expectError    bool
	}{
		{
			name:           "flag enabled",
			flagKey:        "test-flag",
			statusCode:     200,
			responseBody:   `{"enabled":true,"flagKey":"test-flag"}`,
			expectedResult: true,
			expectError:    false,
		},
		{
			name:           "flag disabled",
			flagKey:        "test-flag",
			statusCode:     200,
			responseBody:   `{"enabled":false,"flagKey":"test-flag"}`,
			expectedResult: false,
			expectError:    false,
		},
		{
			name:           "404 error",
			flagKey:        "missing-flag",
			statusCode:     404,
			responseBody:   `{"error":"Flag not found"}`,
			expectedResult: false,
			expectError:    true,
		},
		{
			name:           "500 error",
			flagKey:        "test-flag",
			statusCode:     500,
			responseBody:   "Internal server error",
			expectedResult: false,
			expectError:    true,
		},
		{
			name:           "invalid JSON",
			flagKey:        "test-flag",
			statusCode:     200,
			responseBody:   "invalid json",
			expectedResult: false,
			expectError:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Verify request method and path
				if r.Method != "POST" {
					t.Errorf("Expected POST request, got %s", r.Method)
				}
				if r.URL.Path != "/v1/flags/"+tt.flagKey+"/evaluate" {
					t.Errorf("Expected path /v1/flags/%s/evaluate, got %s", tt.flagKey, r.URL.Path)
				}

				// Verify headers
				if auth := r.Header.Get("Authorization"); auth != "Bearer test-sdk-key" {
					t.Errorf("Expected Authorization header 'Bearer test-sdk-key', got '%s'", auth)
				}

				w.WriteHeader(tt.statusCode)
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte(tt.responseBody))
			}))
			defer server.Close()

			client, err := NewClient(Config{
				APIUrl:          server.URL,
				SDKKey:          "test-sdk-key",
				Environment:     "test",
				EnableWebSocket: false,
				PollingInterval: 0,
			})
			if err != nil {
				t.Fatalf("Failed to create client: %v", err)
			}
			defer client.Close()

			ctx := Context{
				UserID: "user-123",
			}

			result, err := client.IsEnabled(tt.flagKey, ctx)

			if tt.expectError {
				if err == nil {
					t.Error("Expected error but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
				if result != tt.expectedResult {
					t.Errorf("Expected result %v, got %v", tt.expectedResult, result)
				}
			}
		})
	}
}

func TestClient_GetVariation(t *testing.T) {
	tests := []struct {
		name         string
		responseBody string
		statusCode   int
		defaultValue interface{}
		expected     interface{}
	}{
		{
			name:         "string variation",
			responseBody: `{"value":"dark-mode"}`,
			statusCode:   200,
			defaultValue: "light",
			expected:     "dark-mode",
		},
		{
			name:         "integer variation",
			responseBody: `{"value":100}`,
			statusCode:   200,
			defaultValue: 10,
			expected:     100,
		},
		{
			name:         "error returns default",
			responseBody: "error",
			statusCode:   500,
			defaultValue: "light",
			expected:     "light",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tt.statusCode)
				w.Write([]byte(tt.responseBody))
			}))
			defer server.Close()

			client, _ := NewClient(Config{
				APIUrl:          server.URL,
				SDKKey:          "test-sdk-key",
				Environment:     "test",
				EnableWebSocket: false,
				PollingInterval: 0,
			})
			defer client.Close()

			ctx := Context{UserID: "user-123"}

			result := client.GetVariation("test-flag", ctx, tt.defaultValue)

			// Type assertion based on default value type
			switch v := tt.expected.(type) {
			case string:
				if result.(string) != v {
					t.Errorf("Expected %v, got %v", v, result)
				}
			case int:
				if result.(int) != v {
					t.Errorf("Expected %v, got %v", v, result)
				}
			}
		})
	}
}

func TestClient_Track(t *testing.T) {
	requestReceived := false

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestReceived = true

		if r.Method != "POST" {
			t.Errorf("Expected POST request, got %s", r.Method)
		}
		if r.URL.Path != "/v1/events" {
			t.Errorf("Expected path /v1/events, got %s", r.URL.Path)
		}

		// Verify request body
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("Failed to decode request body: %v", err)
		}

		if body["event"] != "button_click" {
			t.Errorf("Expected event 'button_click', got %v", body["event"])
		}

		w.WriteHeader(200)
	}))
	defer server.Close()

	client, err := NewClient(Config{
		APIUrl:          server.URL,
		SDKKey:          "test-sdk-key",
		Environment:     "test",
		EnableWebSocket: false,
		PollingInterval: 0,
	})
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	ctx := Context{UserID: "user-123"}
	properties := map[string]interface{}{
		"button": "checkout",
		"value":  99.99,
	}

	client.Track("button_click", ctx, properties)

	// Give some time for async operation
	time.Sleep(100 * time.Millisecond)

	if !requestReceived {
		t.Error("Track request was not received")
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

func TestConfig_Defaults(t *testing.T) {
	config := Config{
		SDKKey:      "test-key",
		Environment: "",
	}

	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	// Test that defaults are applied
	// This would require exposing client config or testing behavior
}

func TestClient_Concurrent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"enabled":true}`))
	}))
	defer server.Close()

	client, err := NewClient(Config{
		APIUrl:          server.URL,
		SDKKey:          "test-sdk-key",
		Environment:     "test",
		EnableWebSocket: false,
		PollingInterval: 0,
	})
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	ctx := Context{UserID: "user-123"}

	// Test concurrent requests
	done := make(chan bool, 10)
	for i := 0; i < 10; i++ {
		go func(id int) {
			_, err := client.IsEnabled("test-flag", ctx)
			if err != nil {
				t.Errorf("Request %d failed: %v", id, err)
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}
}

func TestClient_Caching(t *testing.T) {
	callCount := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.WriteHeader(200)
		w.Write([]byte(`{"enabled":true}`))
	}))
	defer server.Close()

	client, err := NewClient(Config{
		APIUrl:          server.URL,
		SDKKey:          "test-sdk-key",
		Environment:     "test",
		EnableWebSocket: false,
		PollingInterval: 0,
		CacheTTL:        time.Second * 5,
	})
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	ctx := Context{UserID: "user-123"}

	// First call
	_, err = client.IsEnabled("test-flag", ctx)
	if err != nil {
		t.Fatalf("First request failed: %v", err)
	}

	// Second call should use cache
	_, err = client.IsEnabled("test-flag", ctx)
	if err != nil {
		t.Fatalf("Second request failed: %v", err)
	}

	// Should only have called API once due to caching
	if callCount != 1 {
		t.Errorf("Expected 1 API call, got %d", callCount)
	}
}
