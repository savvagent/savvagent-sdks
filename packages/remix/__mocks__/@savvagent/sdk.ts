/**
 * Mock implementation of @savvagent/sdk for testing
 */

export interface FlagClientConfig {
  apiKey: string;
  applicationId?: string;
  baseUrl?: string;
  enableRealtime?: boolean;
  cacheTtl?: number;
  enableTelemetry?: boolean;
  defaults?: Record<string, boolean>;
  onError?: (error: Error) => void;
  defaultLanguage?: string;
  disableLanguageDetection?: boolean;
}

export interface FlagContext {
  user_id?: string;
  anonymous_id?: string;
  session_id?: string;
  language?: string;
  attributes?: Record<string, any>;
  [key: string]: any;
}

export interface FlagEvaluationResult {
  value: boolean;
  flagKey: string;
  reason: string;
  context?: FlagContext;
}

export class FlagClient {
  private mockFlags: Map<string, boolean> = new Map();
  private mockEvaluations: Map<string, FlagEvaluationResult> = new Map();
  private mockErrors: Map<string, Error> = new Map();

  constructor(config: FlagClientConfig) {
    if (!config.apiKey || !config.apiKey.startsWith('sdk_')) {
      throw new Error('Invalid API key. SDK keys must start with "sdk_"');
    }
  }

  async isEnabled(flagKey: string, context?: FlagContext): Promise<boolean> {
    if (this.mockErrors.has(flagKey)) {
      throw this.mockErrors.get(flagKey);
    }
    return this.mockFlags.get(flagKey) ?? false;
  }

  async evaluate(
    flagKey: string,
    context?: FlagContext
  ): Promise<FlagEvaluationResult> {
    if (this.mockErrors.has(flagKey)) {
      throw this.mockErrors.get(flagKey);
    }

    if (this.mockEvaluations.has(flagKey)) {
      return this.mockEvaluations.get(flagKey)!;
    }

    return {
      value: this.mockFlags.get(flagKey) ?? false,
      flagKey,
      reason: 'mock_evaluation',
      context,
    };
  }

  async withFlag<T>(
    flagKey: string,
    callback: () => T | Promise<T>,
    context?: FlagContext
  ): Promise<T | null> {
    if (this.mockErrors.has(flagKey)) {
      throw this.mockErrors.get(flagKey);
    }

    const enabled = await this.isEnabled(flagKey, context);
    if (enabled) {
      return await callback();
    }
    return null;
  }

  trackError(flagKey: string, error: Error, context?: FlagContext): void {
    // Mock implementation - just store for verification
  }

  // Test helper methods
  __setMockFlag(flagKey: string, value: boolean): void {
    this.mockFlags.set(flagKey, value);
  }

  __setMockEvaluation(flagKey: string, result: FlagEvaluationResult): void {
    this.mockEvaluations.set(flagKey, result);
  }

  __setMockError(flagKey: string, error: Error): void {
    this.mockErrors.set(flagKey, error);
  }

  __clearMocks(): void {
    this.mockFlags.clear();
    this.mockEvaluations.clear();
    this.mockErrors.clear();
  }
}

// Re-export types
export type { FlagEvaluationResult as FlagEvaluationResult };
export type { FlagContext as FlagContext };
export type { FlagClientConfig as FlagClientConfig };
