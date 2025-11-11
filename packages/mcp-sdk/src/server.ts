/**
 * Savvagent MCP SDK - Base Server Class
 * Abstract base class for implementing MCP integrations
 */

import {
  FlagEvaluation,
  FlagError,
  MCPConfig,
  ErrorQuery,
  ExternalError,
  ErrorCorrelation,
  MCPHealthStatus,
} from './types';

/**
 * Abstract base class for MCP servers
 * Implement this class to create custom MCP integrations
 */
export abstract class MCPServer {
  protected config: MCPConfig;
  protected initialized: boolean = false;

  constructor(config: MCPConfig) {
    this.config = config;
  }

  /**
   * Initialize the MCP server (connect to external service, validate config, etc.)
   * Must be called before any other methods
   */
  abstract initialize(): Promise<void>;

  /**
   * Handle flag evaluation event
   * Called when a flag is evaluated in the application
   *
   * @param evaluation - Flag evaluation data
   */
  abstract onFlagEvaluation(evaluation: FlagEvaluation): Promise<void>;

  /**
   * Handle flag error event
   * Called when an error occurs in flagged code
   *
   * @param error - Error data with flag context
   */
  abstract onFlagError(error: FlagError): Promise<void>;

  /**
   * Query errors from external observability service
   * Used for correlation analysis
   *
   * @param query - Query parameters
   * @returns Array of external errors
   */
  abstract queryErrors(query: ErrorQuery): Promise<ExternalError[]>;

  /**
   * Correlate external errors with flag states
   * Optional: Override for custom correlation logic
   *
   * @param externalErrors - Errors from external service
   * @param flagEvaluations - Flag evaluations from Savvagent
   * @returns Array of error correlations
   */
  async correlateErrors(
    externalErrors: ExternalError[],
    flagEvaluations: FlagEvaluation[]
  ): Promise<ErrorCorrelation[]> {
    const correlations: ErrorCorrelation[] = [];

    // Group evaluations by flag
    const flagMap = new Map<string, FlagEvaluation[]>();
    for (const evaluation of flagEvaluations) {
      const evals = flagMap.get(evaluation.flagId) || [];
      evals.push(evaluation);
      flagMap.set(evaluation.flagId, evals);
    }

    // Simple correlation: match by time proximity
    for (const error of externalErrors) {
      const errorTime = new Date(error.timestamp).getTime();

      for (const [flagId, evals] of flagMap.entries()) {
        const nearbyEvals = evals.filter((e) => {
          const evalTime = new Date(e.timestamp).getTime();
          const timeDiff = Math.abs(errorTime - evalTime);
          return timeDiff < 60000; // Within 1 minute
        });

        if (nearbyEvals.length > 0) {
          const flagKey = nearbyEvals[0].flagKey;
          const enabledCount = nearbyEvals.filter((e) => e.result).length;
          const totalCount = nearbyEvals.length;
          const correlationScore = enabledCount / totalCount;

          correlations.push({
            flagId,
            flagKey,
            externalError: error,
            correlationScore,
            errorRateBefore: 0, // Implement based on historical data
            errorRateAfter: 0, // Implement based on historical data
            confidence: correlationScore > 0.7 ? 'high' : correlationScore > 0.4 ? 'medium' : 'low',
          });
        }
      }
    }

    return correlations;
  }

  /**
   * Check health of MCP server
   * Override for custom health checks
   *
   * @returns Health status
   */
  async healthCheck(): Promise<MCPHealthStatus> {
    return {
      healthy: this.initialized,
      message: this.initialized ? 'Server initialized' : 'Server not initialized',
      lastCheck: new Date().toISOString(),
    };
  }

  /**
   * Shutdown the MCP server (close connections, cleanup, etc.)
   */
  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  /**
   * Get current configuration
   */
  getConfig(): MCPConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   *
   * @param newConfig - Updated configuration
   */
  async updateConfig(newConfig: Partial<MCPConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig };
    // Re-initialize if needed
    if (this.initialized) {
      await this.shutdown();
      await this.initialize();
    }
  }

  /**
   * Check if server is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
