import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FlagClient } from './client';
import { FlagClientConfig } from './types';

// Mock fetch globally
global.fetch = vi.fn();

describe('Dynamic Configuration Tests', () => {
  let client: FlagClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockClear();

    const config: FlagClientConfig = {
      apiKey: 'sdk_test_key',
      applicationId: 'test-app',
      baseUrl: 'https://api.test.com',
      enableRealtime: false,
      enableTelemetry: false,
    };

    client = new FlagClient(config);
  });

  describe('evaluate() with configuration', () => {
    it('should return configuration when flag is enabled', async () => {
      const mockConfig = {
        theme: { primaryColor: '#007bff', fontSize: 16 },
        limits: { maxItems: 100 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: true,
          configuration: mockConfig,
          flagId: 'flag-123',
        }),
      });

      const result = await client.evaluate('test-flag');

      expect(result.value).toBe(true);
      expect(result.configuration).toEqual(mockConfig);
      expect(result.reason).toBe('evaluated');
    });

    it('should return null configuration when not provided by API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: true,
          flagId: 'flag-123',
        }),
      });

      const result = await client.evaluate('test-flag');

      expect(result.value).toBe(true);
      expect(result.configuration).toBeUndefined();
    });

    it('should cache configuration along with flag value', async () => {
      const mockConfig = { setting: 'value' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: true,
          configuration: mockConfig,
        }),
      });

      // First call - fetches from API
      const result1 = await client.evaluate('test-flag');
      expect(result1.configuration).toEqual(mockConfig);
      expect(result1.reason).toBe('evaluated');

      // Second call - returns from cache
      const result2 = await client.evaluate('test-flag');
      expect(result2.configuration).toEqual(mockConfig);
      expect(result2.reason).toBe('cached');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getConfig()', () => {
    it('should return configuration when flag is enabled', async () => {
      const mockConfig = {
        apiEndpoint: 'https://api.example.com',
        timeout: 5000,
        retries: 3,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: true,
          configuration: mockConfig,
        }),
      });

      const config = await client.getConfig('api-settings');

      expect(config).toEqual(mockConfig);
    });

    it('should return null when flag is disabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: false,
          configuration: { some: 'config' },
        }),
      });

      const config = await client.getConfig('api-settings');

      expect(config).toBeNull();
    });

    it('should return default value when flag is disabled', async () => {
      const defaultConfig = { fallback: true };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: false }),
      });

      const config = await client.getConfig('api-settings', undefined, defaultConfig);

      expect(config).toEqual(defaultConfig);
    });

    it('should return default value when configuration is missing', async () => {
      const defaultConfig = { default: 'value' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: true }),
      });

      const config = await client.getConfig('api-settings', undefined, defaultConfig);

      expect(config).toEqual(defaultConfig);
    });
  });

  describe('getVariation()', () => {
    it('should return variation details with configuration', async () => {
      const mockConfig = {
        algorithm: 'ml_v2',
        weight: 2.0,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: true,
          variation: 'variant_b',
          configuration: mockConfig,
        }),
      });

      const result = await client.getVariation('search-algorithm');

      expect(result.variation).toBe('variant_b');
      expect(result.enabled).toBe(true);
      expect(result.configuration).toEqual(mockConfig);
    });

    it('should default to "control" when variation is not specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: true }),
      });

      const result = await client.getVariation('test-flag');

      expect(result.variation).toBe('control');
      expect(result.enabled).toBe(true);
    });

    it('should include disabled state in variation result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: false,
          variation: 'control',
        }),
      });

      const result = await client.getVariation('test-flag');

      expect(result.enabled).toBe(false);
      expect(result.variation).toBe('control');
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain isEnabled() behavior', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: true,
          configuration: { some: 'config' },
        }),
      });

      const enabled = await client.isEnabled('test-flag');

      expect(enabled).toBe(true);
    });

    it('should work with API responses without configuration field', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: true }),
      });

      const result = await client.evaluate('test-flag');

      expect(result.value).toBe(true);
      expect(result.configuration).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully in getConfig', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const config = await client.getConfig('test-flag');

      expect(config).toBeNull();
    });

    it('should return default value on network error', async () => {
      const defaultConfig = { fallback: true };

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const config = await client.getConfig('test-flag', undefined, defaultConfig);

      expect(config).toEqual(defaultConfig);
    });
  });
});
