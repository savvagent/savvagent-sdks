package savvagent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// FlagClient is the main client for evaluating feature flags
type FlagClient struct {
	config              Config
	httpClient          *http.Client
	cache               *cache
	configOverrides     map[string]configOverrideEntry
	variationOverrides  map[string]variationOverrideEntry
	overrideMutex       sync.RWMutex
}

// NewClient creates a new FlagClient with the given configuration
func NewClient(config Config) (*FlagClient, error) {
	// Validate API key
	if config.APIKey == "" || !strings.HasPrefix(config.APIKey, "sdk_") {
		return nil, fmt.Errorf("invalid API key: must start with 'sdk_'")
	}

	// Apply defaults
	if config.BaseURL == "" {
		config.BaseURL = "https://api.savvagent.com"
	}
	if config.CacheTTL == 0 {
		config.CacheTTL = 60 * time.Second
	}
	if config.Timeout == 0 {
		config.Timeout = 5 * time.Second
	}
	if config.Defaults == nil {
		config.Defaults = make(map[string]bool)
	}
	if config.OnError == nil {
		config.OnError = func(err error) {
			fmt.Printf("[Savvagent] Error: %v\n", err)
		}
	}

	client := &FlagClient{
		config: config,
		httpClient: &http.Client{
			Timeout: config.Timeout,
		},
		cache:              newCache(config.CacheTTL),
		configOverrides:    make(map[string]configOverrideEntry),
		variationOverrides: make(map[string]variationOverrideEntry),
	}

	return client, nil
}

// Evaluate evaluates a feature flag and returns the result
func (c *FlagClient) Evaluate(flagKey string, ctx *Context) (*EvaluationResult, error) {
	// Check cache first
	if cachedEntry, found := c.cache.GetEntry(flagKey); found {
		configuration := cachedEntry.Configuration
		variation := cachedEntry.Variation

		// Apply overrides
		c.overrideMutex.RLock()
		if configOverride, ok := c.configOverrides[flagKey]; ok {
			if configOverride.Merge && configuration != nil {
				configuration = c.mergeConfigurations(configuration, configOverride.Config)
			} else {
				configuration = configOverride.Config
			}
		}
		if variationOverride, ok := c.variationOverrides[flagKey]; ok {
			variation = variationOverride.Variation
		}
		c.overrideMutex.RUnlock()

		return &EvaluationResult{
			Key:           flagKey,
			Value:         cachedEntry.Value,
			Configuration: configuration,
			Variation:     variation,
			Reason:        "cached",
		}, nil
	}

	// Prepare context
	if ctx == nil {
		ctx = &Context{}
	}
	if ctx.ApplicationID == "" && c.config.ApplicationID != "" {
		ctx.ApplicationID = c.config.ApplicationID
	}

	// Prepare request
	requestBody := map[string]interface{}{
		"context": ctx,
	}
	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return c.getDefaultResult(flagKey, err), err
	}

	url := fmt.Sprintf("%s/api/evaluate/%s", c.config.BaseURL, flagKey)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return c.getDefaultResult(flagKey, err), err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.config.APIKey)

	// Make request
	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.config.OnError(err)
		return c.getDefaultResult(flagKey, err), err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		err := fmt.Errorf("API error: %d %s", resp.StatusCode, resp.Status)
		c.config.OnError(err)
		return c.getDefaultResult(flagKey, err), err
	}

	// Parse response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.config.OnError(err)
		return c.getDefaultResult(flagKey, err), err
	}

	var response struct {
		Value         bool                   `json:"value"`
		Configuration map[string]interface{} `json:"configuration"`
		Variation     string                 `json:"variation"`
		FlagID        string                 `json:"flag_id"`
		Description   string                 `json:"description"`
		Variant       string                 `json:"variant"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		c.config.OnError(err)
		return c.getDefaultResult(flagKey, err), err
	}

	// Cache the result (including configuration and variation)
	c.cache.Set(flagKey, response.Value, response.Configuration, response.Variation)

	// Apply overrides to evaluated result
	finalConfiguration := response.Configuration
	finalVariation := response.Variation

	c.overrideMutex.RLock()
	if configOverride, ok := c.configOverrides[flagKey]; ok {
		if configOverride.Merge && finalConfiguration != nil {
			finalConfiguration = c.mergeConfigurations(finalConfiguration, configOverride.Config)
		} else {
			finalConfiguration = configOverride.Config
		}
	}
	if variationOverride, ok := c.variationOverrides[flagKey]; ok {
		finalVariation = variationOverride.Variation
	}
	c.overrideMutex.RUnlock()

	return &EvaluationResult{
		Key:           flagKey,
		Value:         response.Value,
		Configuration: finalConfiguration,
		Variation:     finalVariation,
		Reason:        "evaluated",
		Metadata: &Metadata{
			FlagID:      response.FlagID,
			Description: response.Description,
			Variant:     response.Variant,
		},
	}, nil
}

// IsEnabled checks if a flag is enabled (convenience method)
func (c *FlagClient) IsEnabled(flagKey string, ctx *Context) bool {
	result, _ := c.Evaluate(flagKey, ctx)
	return result.Value
}

// GetConfig retrieves dynamic configuration for a flag (Phase 1)
// Returns configuration if flag is enabled, otherwise returns nil
func (c *FlagClient) GetConfig(flagKey string, ctx *Context) (map[string]interface{}, error) {
	result, err := c.Evaluate(flagKey, ctx)
	if err != nil {
		return nil, err
	}

	if !result.Value {
		return nil, nil
	}

	return result.Configuration, nil
}

// GetVariation retrieves variation details for multi-variant flags (Phase 2)
// Returns variation name, enabled status, and configuration
func (c *FlagClient) GetVariation(flagKey string, ctx *Context) (*VariationResult, error) {
	result, err := c.Evaluate(flagKey, ctx)
	if err != nil {
		return nil, err
	}

	variation := result.Variation
	if variation == "" {
		variation = "control"
	}

	return &VariationResult{
		Variation:     variation,
		Enabled:       result.Value,
		Configuration: result.Configuration,
	}, nil
}

// InvalidateCache invalidates the cache for a specific flag
// If flagKey is empty, it clears the entire cache
func (c *FlagClient) InvalidateCache(flagKey string) {
	c.cache.Invalidate(flagKey)
}

// Close cleans up resources
func (c *FlagClient) Close() error {
	c.cache.Clear()
	return nil
}

// getDefaultResult returns a default result for error cases
func (c *FlagClient) getDefaultResult(flagKey string, err error) *EvaluationResult {
	defaultValue := c.config.Defaults[flagKey]
	return &EvaluationResult{
		Key:    flagKey,
		Value:  defaultValue,
		Reason: "error",
	}
}

// SetConfigOverride sets a configuration override for a flag
// Useful for testing different configuration values without server changes
func (c *FlagClient) SetConfigOverride(flagKey string, config map[string]interface{}, options *ConfigOverrideOptions) error {
	if options == nil {
		options = &ConfigOverrideOptions{
			Merge:    false,
			Validate: true,
		}
	}

	// Validate JSON structure
	if options.Validate {
		if _, err := json.Marshal(config); err != nil {
			return fmt.Errorf("invalid configuration for flag '%s': %w", flagKey, err)
		}
	}

	c.overrideMutex.Lock()
	c.configOverrides[flagKey] = configOverrideEntry{
		Config:    config,
		Merge:     options.Merge,
		Timestamp: time.Now(),
	}
	c.overrideMutex.Unlock()

	// Invalidate cache to force re-evaluation with override
	c.cache.Invalidate(flagKey)

	return nil
}

// ClearConfigOverride clears the configuration override for a flag
func (c *FlagClient) ClearConfigOverride(flagKey string) {
	c.overrideMutex.Lock()
	delete(c.configOverrides, flagKey)
	c.overrideMutex.Unlock()

	// Invalidate cache to get fresh API values
	c.cache.Invalidate(flagKey)
}

// SetVariationOverride sets a variation override for a multi-variant flag
// Forces the flag to return a specific variation
func (c *FlagClient) SetVariationOverride(flagKey string, variation string) {
	c.overrideMutex.Lock()
	c.variationOverrides[flagKey] = variationOverrideEntry{
		Variation: variation,
		Timestamp: time.Now(),
	}
	c.overrideMutex.Unlock()

	// Invalidate cache to force re-evaluation with override
	c.cache.Invalidate(flagKey)
}

// ClearVariationOverride clears the variation override for a flag
func (c *FlagClient) ClearVariationOverride(flagKey string) {
	c.overrideMutex.Lock()
	delete(c.variationOverrides, flagKey)
	c.overrideMutex.Unlock()

	// Invalidate cache to get fresh API values
	c.cache.Invalidate(flagKey)
}

// HasConfigOverride checks if a flag has a configuration override
func (c *FlagClient) HasConfigOverride(flagKey string) bool {
	c.overrideMutex.RLock()
	defer c.overrideMutex.RUnlock()
	_, ok := c.configOverrides[flagKey]
	return ok
}

// HasVariationOverride checks if a flag has a variation override
func (c *FlagClient) HasVariationOverride(flagKey string) bool {
	c.overrideMutex.RLock()
	defer c.overrideMutex.RUnlock()
	_, ok := c.variationOverrides[flagKey]
	return ok
}

// GetConfigOverrides returns all configuration overrides (for debugging/inspection)
func (c *FlagClient) GetConfigOverrides() map[string]map[string]interface{} {
	c.overrideMutex.RLock()
	defer c.overrideMutex.RUnlock()

	overrides := make(map[string]map[string]interface{})
	for key, entry := range c.configOverrides {
		overrides[key] = map[string]interface{}{
			"config":    entry.Config,
			"merge":     entry.Merge,
			"timestamp": entry.Timestamp,
		}
	}
	return overrides
}

// GetVariationOverrides returns all variation overrides (for debugging/inspection)
func (c *FlagClient) GetVariationOverrides() map[string]map[string]interface{} {
	c.overrideMutex.RLock()
	defer c.overrideMutex.RUnlock()

	overrides := make(map[string]map[string]interface{})
	for key, entry := range c.variationOverrides {
		overrides[key] = map[string]interface{}{
			"variation": entry.Variation,
			"timestamp": entry.Timestamp,
		}
	}
	return overrides
}

// ClearAllOverrides clears all configuration and variation overrides
func (c *FlagClient) ClearAllOverrides() {
	c.overrideMutex.Lock()
	c.configOverrides = make(map[string]configOverrideEntry)
	c.variationOverrides = make(map[string]variationOverrideEntry)
	c.overrideMutex.Unlock()

	c.cache.Clear()
}

// mergeConfigurations merges two configuration maps (for partial overrides)
// Deep merge where override values take precedence
func (c *FlagClient) mergeConfigurations(base, override map[string]interface{}) map[string]interface{} {
	if base == nil {
		return override
	}
	if override == nil {
		return base
	}

	result := make(map[string]interface{})
	for k, v := range base {
		result[k] = v
	}

	for k, v := range override {
		if baseVal, ok := result[k]; ok {
			// If both are maps, merge recursively
			if baseMap, baseIsMap := baseVal.(map[string]interface{}); baseIsMap {
				if overrideMap, overrideIsMap := v.(map[string]interface{}); overrideIsMap {
					result[k] = c.mergeConfigurations(baseMap, overrideMap)
					continue
				}
			}
		}
		// Otherwise, override the value
		result[k] = v
	}

	return result
}
