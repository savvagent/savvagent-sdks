package savvagent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// FlagClient is the main client for evaluating feature flags
type FlagClient struct {
	config     Config
	httpClient *http.Client
	cache      *cache
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
		cache: newCache(config.CacheTTL),
	}

	return client, nil
}

// Evaluate evaluates a feature flag and returns the result
func (c *FlagClient) Evaluate(flagKey string, ctx *Context) (*EvaluationResult, error) {
	// Check cache first
	if cachedValue, found := c.cache.Get(flagKey); found {
		return &EvaluationResult{
			Key:    flagKey,
			Value:  cachedValue,
			Reason: "cached",
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
		Value       bool      `json:"value"`
		FlagID      string    `json:"flag_id"`
		Description string    `json:"description"`
		Variant     string    `json:"variant"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		c.config.OnError(err)
		return c.getDefaultResult(flagKey, err), err
	}

	// Cache the result
	c.cache.Set(flagKey, response.Value)

	return &EvaluationResult{
		Key:    flagKey,
		Value:  response.Value,
		Reason: "evaluated",
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
