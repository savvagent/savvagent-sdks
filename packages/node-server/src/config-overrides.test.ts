import { FlagClient } from './client';
import { FlagClientConfig } from './types';

// Mock EventSource
global.EventSource = jest.fn(() => ({
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  close: jest.fn(),
  readyState: 0,
  url: '',
  withCredentials: false,
  CONNECTING: 0,
  OPEN: 1,
  CLOSED: 2,
  onopen: null,
  onmessage: null,
  onerror: null,
  dispatchEvent: jest.fn(),
})) as any;

describe('Configuration Overrides', () => {
  let client: FlagClient;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    const config: FlagClientConfig = {
      apiKey: 'sdk_test_key',
      baseUrl: 'https://api.test.com',
      enableRealtime: false,
      enableTelemetry: false,
    };

    client = new FlagClient(config);
  });

  it('should override configuration completely when merge is false', async () => {
    // Mock API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: true,
        configuration: {
          theme: { primaryColor: '#007bff', fontSize: 16 },
          limits: { maxItems: 100 },
        },
      }),
    });

    // Set override (merge = false by default)
    client.setConfigOverride('test-flag', {
      theme: { primaryColor: '#ff0000' },
    });

    const result = await client.evaluate('test-flag');

    expect(result.value).toBe(true);
    expect(result.configuration).toEqual({
      theme: { primaryColor: '#ff0000' },
    });
  });

  it('should merge configuration when merge is true', async () => {
    // Mock API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: true,
        configuration: {
          theme: { primaryColor: '#007bff', fontSize: 16 },
          limits: { maxItems: 100 },
        },
      }),
    });

    // Set override with merge = true
    client.setConfigOverride(
      'test-flag',
      {
        theme: { primaryColor: '#ff0000' },
        newField: 'added',
      },
      { merge: true }
    );

    const result = await client.evaluate('test-flag');

    expect(result.value).toBe(true);
    expect(result.configuration).toEqual({
      theme: { primaryColor: '#ff0000', fontSize: 16 },
      limits: { maxItems: 100 },
      newField: 'added',
    });
  });

  it('should override variation', async () => {
    // Mock API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: true,
        variation: 'control',
        configuration: { algorithm: 'standard' },
      }),
    });

    // Set variation override
    client.setVariationOverride('test-flag', 'variant_b');

    const result = await client.evaluate('test-flag');

    expect(result.value).toBe(true);
    expect(result.variation).toBe('variant_b');
  });

  it('should clear configuration override', async () => {
    // Mock API responses
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        value: true,
        configuration: { original: 'config' },
      }),
    });

    // Set override
    client.setConfigOverride('test-flag', { overridden: 'value' });

    // First call should have override
    let result = await client.evaluate('test-flag');
    expect(result.configuration).toEqual({ overridden: 'value' });

    // Clear override
    client.clearConfigOverride('test-flag');

    // Second call should have original config
    result = await client.evaluate('test-flag');
    expect(result.configuration).toEqual({ original: 'config' });
  });

  it('should check if override exists', () => {
    expect(client.hasConfigOverride('test-flag')).toBe(false);

    client.setConfigOverride('test-flag', { test: 'value' });
    expect(client.hasConfigOverride('test-flag')).toBe(true);

    client.clearConfigOverride('test-flag');
    expect(client.hasConfigOverride('test-flag')).toBe(false);
  });

  it('should get all overrides', () => {
    client.setConfigOverride('flag1', { config: 'a' });
    client.setConfigOverride('flag2', { config: 'b' }, { merge: true });
    client.setVariationOverride('flag3', 'variant_a');

    const configOverrides = client.getConfigOverrides();
    expect(Object.keys(configOverrides)).toHaveLength(2);
    expect(configOverrides['flag1'].config).toEqual({ config: 'a' });
    expect(configOverrides['flag2'].merge).toBe(true);

    const variationOverrides = client.getVariationOverrides();
    expect(Object.keys(variationOverrides)).toHaveLength(1);
    expect(variationOverrides['flag3'].variation).toBe('variant_a');
  });

  it('should clear all overrides', () => {
    client.setConfigOverride('flag1', { config: 'a' });
    client.setVariationOverride('flag2', 'variant_a');

    expect(client.hasConfigOverride('flag1')).toBe(true);
    expect(client.hasVariationOverride('flag2')).toBe(true);

    client.clearAllOverrides();

    expect(client.hasConfigOverride('flag1')).toBe(false);
    expect(client.hasVariationOverride('flag2')).toBe(false);
  });

  it('should validate configuration structure', () => {
    // Create circular reference to test validation
    const circular: any = { a: 'b' };
    circular.self = circular;

    expect(() => {
      client.setConfigOverride('test-flag', circular);
    }).toThrow();
  });

  it('should apply overrides and merge with fetched configuration', async () => {
    // Mock API response - use mockResolvedValue since cache is invalidated on override
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        value: true,
        configuration: { original: 'value' },
      }),
    });

    // First call fetches the result
    const firstResult = await client.evaluate('test-flag');
    expect(firstResult.value).toBe(true);
    expect(firstResult.configuration).toEqual({ original: 'value' });

    // Set override - this invalidates cache, so next call will fetch again
    client.setConfigOverride('test-flag', { overridden: 'value' }, { merge: true });

    // Second call fetches again (cache was invalidated) and applies override
    const result = await client.evaluate('test-flag');

    expect(result.configuration).toEqual({
      original: 'value',
      overridden: 'value',
    });
  });
});
