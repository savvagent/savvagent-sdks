package savvagent

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestConfigurationOverrides(t *testing.T) {
	t.Run("Override configuration completely when merge is false", func(t *testing.T) {
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
			}
			json.NewEncoder(w).Encode(response)
		}))
		defer server.Close()

		client, _ := NewClient(Config{
			APIKey:  "sdk_test_key",
			BaseURL: server.URL,
		})

		// Set override (merge = false by default)
		overrideConfig := map[string]interface{}{
			"theme": map[string]interface{}{
				"primaryColor": "#ff0000",
			},
		}
		client.SetConfigOverride("test-flag", overrideConfig, nil)

		result, err := client.Evaluate("test-flag", nil)

		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}
		if !result.Value {
			t.Error("Expected flag to be enabled")
		}

		theme := result.Configuration["theme"].(map[string]interface{})
		if theme["primaryColor"] != "#ff0000" {
			t.Errorf("Expected primaryColor to be overridden")
		}
		if _, exists := theme["fontSize"]; exists {
			t.Error("fontSize should not exist in full override")
		}
	})

	t.Run("Merge configuration when merge is true", func(t *testing.T) {
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
			}
			json.NewEncoder(w).Encode(response)
		}))
		defer server.Close()

		client, _ := NewClient(Config{
			APIKey:  "sdk_test_key",
			BaseURL: server.URL,
		})

		// Set override with merge = true
		overrideConfig := map[string]interface{}{
			"theme": map[string]interface{}{
				"primaryColor": "#ff0000",
			},
			"newField": "added",
		}
		client.SetConfigOverride("test-flag", overrideConfig, &ConfigOverrideOptions{Merge: true})

		result, err := client.Evaluate("test-flag", nil)

		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}

		theme := result.Configuration["theme"].(map[string]interface{})
		if theme["primaryColor"] != "#ff0000" {
			t.Error("Expected primaryColor to be overridden")
		}
		if theme["fontSize"] != float64(16) {
			t.Error("Expected fontSize to be preserved from API")
		}
		if result.Configuration["newField"] != "added" {
			t.Error("Expected newField to be added")
		}
		if result.Configuration["limits"] == nil {
			t.Error("Expected limits to be preserved from API")
		}
	})

	t.Run("Override variation", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			response := map[string]interface{}{
				"value":     true,
				"variation": "control",
				"configuration": map[string]interface{}{
					"algorithm": "standard",
				},
			}
			json.NewEncoder(w).Encode(response)
		}))
		defer server.Close()

		client, _ := NewClient(Config{
			APIKey:  "sdk_test_key",
			BaseURL: server.URL,
		})

		// Set variation override
		client.SetVariationOverride("test-flag", "variant_b")

		result, err := client.Evaluate("test-flag", nil)

		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}
		if result.Variation != "variant_b" {
			t.Errorf("Expected variation 'variant_b', got '%s'", result.Variation)
		}
	})

	t.Run("Clear configuration override", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			response := map[string]interface{}{
				"value": true,
				"configuration": map[string]interface{}{
					"original": "config",
				},
			}
			json.NewEncoder(w).Encode(response)
		}))
		defer server.Close()

		client, _ := NewClient(Config{
			APIKey:  "sdk_test_key",
			BaseURL: server.URL,
		})

		// Set override
		client.SetConfigOverride("test-flag", map[string]interface{}{
			"overridden": "value",
		}, nil)

		// First call should have override
		result1, _ := client.Evaluate("test-flag", nil)
		if result1.Configuration["overridden"] != "value" {
			t.Error("Expected overridden configuration")
		}

		// Clear override
		client.ClearConfigOverride("test-flag")

		// Second call should have original config
		result2, _ := client.Evaluate("test-flag", nil)
		if result2.Configuration["original"] != "config" {
			t.Error("Expected original configuration")
		}
	})

	t.Run("Check if override exists", func(t *testing.T) {
		client, _ := NewClient(Config{
			APIKey:  "sdk_test_key",
			BaseURL: "https://api.test.com",
		})

		if client.HasConfigOverride("test-flag") {
			t.Error("Expected no override initially")
		}

		client.SetConfigOverride("test-flag", map[string]interface{}{"test": "value"}, nil)

		if !client.HasConfigOverride("test-flag") {
			t.Error("Expected override to exist")
		}

		client.ClearConfigOverride("test-flag")

		if client.HasConfigOverride("test-flag") {
			t.Error("Expected override to be cleared")
		}
	})

	t.Run("Clear all overrides", func(t *testing.T) {
		client, _ := NewClient(Config{
			APIKey:  "sdk_test_key",
			BaseURL: "https://api.test.com",
		})

		client.SetConfigOverride("flag1", map[string]interface{}{"config": "a"}, nil)
		client.SetVariationOverride("flag2", "variant_a")

		if !client.HasConfigOverride("flag1") || !client.HasVariationOverride("flag2") {
			t.Error("Expected overrides to exist")
		}

		client.ClearAllOverrides()

		if client.HasConfigOverride("flag1") || client.HasVariationOverride("flag2") {
			t.Error("Expected all overrides to be cleared")
		}
	})

	t.Run("Deep merge nested configurations", func(t *testing.T) {
		mockConfig := map[string]interface{}{
			"theme": map[string]interface{}{
				"colors": map[string]interface{}{
					"primary":   "#007bff",
					"secondary": "#6c757d",
				},
				"fontSize": float64(16),
			},
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

		// Override nested configuration
		overrideConfig := map[string]interface{}{
			"theme": map[string]interface{}{
				"colors": map[string]interface{}{
					"primary": "#ff0000",
				},
			},
		}
		client.SetConfigOverride("test-flag", overrideConfig, &ConfigOverrideOptions{Merge: true})

		result, _ := client.Evaluate("test-flag", nil)

		theme := result.Configuration["theme"].(map[string]interface{})
		colors := theme["colors"].(map[string]interface{})

		if colors["primary"] != "#ff0000" {
			t.Error("Expected primary color to be overridden")
		}
		if colors["secondary"] != "#6c757d" {
			t.Error("Expected secondary color to be preserved")
		}
		if theme["fontSize"] != float64(16) {
			t.Error("Expected fontSize to be preserved")
		}
	})
}
