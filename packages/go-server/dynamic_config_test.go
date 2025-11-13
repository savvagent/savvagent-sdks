package savvagent

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDynamicConfiguration(t *testing.T) {
	t.Run("Evaluate returns configuration when flag is enabled", func(t *testing.T) {
		mockConfig := map[string]interface{}{
			"theme": map[string]interface{}{
				"primaryColor": "#007bff",
				"fontSize":     float64(16),
			},
			"limits": map[string]interface{}{
				"maxItems": float64(100),
			},
		}

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			response := map[string]interface{}{
				"value":         true,
				"configuration": mockConfig,
				"flag_id":       "flag-123",
			}
			json.NewEncoder(w).Encode(response)
		}))
		defer server.Close()

		client, _ := NewClient(Config{
			APIKey:  "sdk_test_key",
			BaseURL: server.URL,
		})

		result, err := client.Evaluate("test-flag", nil)

		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}
		if !result.Value {
			t.Error("Expected flag to be enabled")
		}
		if result.Configuration == nil {
			t.Error("Expected configuration to be present")
		}
		if result.Configuration["theme"] == nil {
			t.Error("Expected theme in configuration")
		}
	})

	t.Run("GetConfig returns configuration when flag is enabled", func(t *testing.T) {
		mockConfig := map[string]interface{}{
			"apiEndpoint": "https://api.example.com",
			"timeout":     float64(5000),
			"retries":     float64(3),
		}

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			response := map[string]interface{}{
				"value":         true,
				"configuration": mockConfig,
			}
			json.NewEncoder(w).Encode(response)
		}))
		defer server.Close()

		client, _ := NewClient(Config{
			APIKey:  "sdk_test_key",
			BaseURL: server.URL,
		})

		config, err := client.GetConfig("api-settings", nil)

		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}
		if config == nil {
			t.Fatal("Expected configuration to be present")
		}
		if config["apiEndpoint"] != "https://api.example.com" {
			t.Error("Configuration value mismatch")
		}
	})

	t.Run("GetConfig returns nil when flag is disabled", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			response := map[string]interface{}{
				"value": false,
				"configuration": map[string]interface{}{
					"some": "config",
				},
			}
			json.NewEncoder(w).Encode(response)
		}))
		defer server.Close()

		client, _ := NewClient(Config{
			APIKey:  "sdk_test_key",
			BaseURL: server.URL,
		})

		config, err := client.GetConfig("api-settings", nil)

		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}
		if config != nil {
			t.Error("Expected nil configuration when flag is disabled")
		}
	})

	t.Run("GetVariation returns variation details", func(t *testing.T) {
		mockConfig := map[string]interface{}{
			"algorithm": "ml_v2",
			"weight":    float64(2.0),
		}

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			response := map[string]interface{}{
				"value":         true,
				"variation":     "variant_b",
				"configuration": mockConfig,
			}
			json.NewEncoder(w).Encode(response)
		}))
		defer server.Close()

		client, _ := NewClient(Config{
			APIKey:  "sdk_test_key",
			BaseURL: server.URL,
		})

		result, err := client.GetVariation("search-algorithm", nil)

		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}
		if result.Variation != "variant_b" {
			t.Errorf("Expected variation 'variant_b', got '%s'", result.Variation)
		}
		if !result.Enabled {
			t.Error("Expected flag to be enabled")
		}
		if result.Configuration == nil {
			t.Error("Expected configuration to be present")
		}
	})

	t.Run("GetVariation defaults to 'control' when not specified", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			response := map[string]interface{}{
				"value": true,
			}
			json.NewEncoder(w).Encode(response)
		}))
		defer server.Close()

		client, _ := NewClient(Config{
			APIKey:  "sdk_test_key",
			BaseURL: server.URL,
		})

		result, err := client.GetVariation("test-flag", nil)

		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}
		if result.Variation != "control" {
			t.Errorf("Expected default variation 'control', got '%s'", result.Variation)
		}
	})

	t.Run("Configuration is cached along with flag value", func(t *testing.T) {
		mockConfig := map[string]interface{}{
			"setting": "value",
		}

		callCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++
			response := map[string]interface{}{
				"value":         true,
				"configuration": mockConfig,
			}
			json.NewEncoder(w).Encode(response)
		}))
		defer server.Close()

		client, _ := NewClient(Config{
			APIKey:   "sdk_test_key",
			BaseURL:  server.URL,
			CacheTTL: 5 * time.Second,
		})

		// First call
		result1, _ := client.Evaluate("test-flag", nil)
		if result1.Reason != "evaluated" {
			t.Error("First call should be evaluated")
		}

		// Second call should be cached
		result2, _ := client.Evaluate("test-flag", nil)
		if result2.Reason != "cached" {
			t.Error("Second call should be cached")
		}

		if callCount != 1 {
			t.Errorf("Expected 1 API call, got %d", callCount)
		}

		// Both should have configuration
		if result1.Configuration == nil || result2.Configuration == nil {
			t.Error("Both results should have configuration")
		}
	})

	t.Run("Backward compatibility with IsEnabled", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			response := map[string]interface{}{
				"value": true,
				"configuration": map[string]interface{}{
					"some": "config",
				},
			}
			json.NewEncoder(w).Encode(response)
		}))
		defer server.Close()

		client, _ := NewClient(Config{
			APIKey:  "sdk_test_key",
			BaseURL: server.URL,
		})

		enabled := client.IsEnabled("test-flag", nil)

		if !enabled {
			t.Error("Expected flag to be enabled")
		}
	})

	t.Run("Works with API responses without configuration", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			response := map[string]interface{}{
				"value": true,
			}
			json.NewEncoder(w).Encode(response)
		}))
		defer server.Close()

		client, _ := NewClient(Config{
			APIKey:  "sdk_test_key",
			BaseURL: server.URL,
		})

		result, err := client.Evaluate("test-flag", nil)

		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}
		if !result.Value {
			t.Error("Expected flag to be enabled")
		}
		// Configuration should be nil or empty
	})
}
