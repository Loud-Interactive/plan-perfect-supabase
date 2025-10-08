// Circuit Breaker Pattern for External API Resilience
// Prevents cascading failures and provides graceful degradation

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface CircuitBreakerConfig {
  failureThreshold?: number;  // Number of failures before opening
  resetTimeout?: number;      // Time in ms before attempting reset
  halfOpenRequests?: number;  // Number of requests to try in half-open state
}

export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  private readonly config: Required<CircuitBreakerConfig> = {
    failureThreshold: 5,
    resetTimeout: 300000, // 5 minutes
    halfOpenRequests: 3
  };

  constructor(
    private apiName: string,
    private supabase: SupabaseClient,
    config?: CircuitBreakerConfig
  ) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    this.loadState();
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Load current state from database
    await this.loadState();

    // Check if circuit is open
    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      
      if (timeSinceFailure < this.config.resetTimeout) {
        throw new CircuitBreakerError(
          `Circuit breaker OPEN for ${this.apiName}. Wait ${Math.ceil((this.config.resetTimeout - timeSinceFailure) / 1000)}s`,
          'open'
        );
      }
      
      // Move to half-open state
      console.log(`Circuit breaker for ${this.apiName} moving to half-open state`);
      await this.setState('half-open');
      this.halfOpenAttempts = 0;
    }

    // Check half-open state
    if (this.state === 'half-open') {
      if (this.halfOpenAttempts >= this.config.halfOpenRequests) {
        // Too many attempts in half-open, reopen circuit
        await this.setState('open');
        throw new CircuitBreakerError(
          `Circuit breaker reopened for ${this.apiName} after ${this.halfOpenAttempts} attempts`,
          'open'
        );
      }
      this.halfOpenAttempts++;
    }

    try {
      const result = await operation();
      await this.recordSuccess();
      return result;
    } catch (error) {
      await this.recordFailure();
      throw error;
    }
  }

  private async loadState(): Promise<void> {
    try {
      const { data } = await this.supabase
        .from('synopsis_api_health')
        .select('*')
        .eq('api_name', this.apiName)
        .single();

      if (data) {
        this.state = data.circuit_breaker_state as any;
        this.failures = data.consecutive_failures || 0;
        this.lastFailureTime = data.last_failure_at ? 
          new Date(data.last_failure_at).getTime() : 0;
      }
    } catch (error) {
      console.error(`Failed to load circuit breaker state for ${this.apiName}:`, error);
    }
  }

  private async setState(newState: 'closed' | 'open' | 'half-open'): Promise<void> {
    this.state = newState;
    
    try {
      await this.supabase
        .from('synopsis_api_health')
        .upsert({
          api_name: this.apiName,
          circuit_breaker_state: newState,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'api_name'
        });
    } catch (error) {
      console.error(`Failed to update circuit breaker state for ${this.apiName}:`, error);
    }
  }

  private async recordSuccess(): Promise<void> {
    this.failures = 0;
    this.halfOpenAttempts = 0;
    
    if (this.state !== 'closed') {
      console.log(`Circuit breaker for ${this.apiName} closing after successful operation`);
      await this.setState('closed');
    }

    try {
      await this.supabase
        .from('synopsis_api_health')
        .upsert({
          api_name: this.apiName,
          is_healthy: true,
          last_success_at: new Date().toISOString(),
          consecutive_failures: 0,
          circuit_breaker_state: 'closed',
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'api_name'
        });

      // Update quota usage if applicable
      await this.incrementQuotaUsage();
    } catch (error) {
      console.error(`Failed to record success for ${this.apiName}:`, error);
    }
  }

  private async recordFailure(): Promise<void> {
    this.failures++;
    this.lastFailureTime = Date.now();

    const shouldOpen = this.failures >= this.config.failureThreshold;
    
    try {
      await this.supabase
        .from('synopsis_api_health')
        .upsert({
          api_name: this.apiName,
          is_healthy: !shouldOpen,
          last_failure_at: new Date().toISOString(),
          consecutive_failures: this.failures,
          circuit_breaker_state: shouldOpen ? 'open' : this.state,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'api_name'
        });

      if (shouldOpen && this.state !== 'open') {
        console.error(`Circuit breaker OPENED for ${this.apiName} after ${this.failures} failures`);
        await this.setState('open');
      }
    } catch (error) {
      console.error(`Failed to record failure for ${this.apiName}:`, error);
    }
  }

  private async incrementQuotaUsage(): Promise<void> {
    try {
      // Get current quota
      const { data } = await this.supabase
        .from('synopsis_api_health')
        .select('daily_quota_used, daily_quota_limit, quota_reset_at')
        .eq('api_name', this.apiName)
        .single();

      if (!data) return;

      // Check if quota should reset
      const resetTime = data.quota_reset_at ? new Date(data.quota_reset_at) : null;
      const now = new Date();
      
      if (!resetTime || now > resetTime) {
        // Reset quota
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        await this.supabase
          .from('synopsis_api_health')
          .update({
            daily_quota_used: 1,
            quota_reset_at: tomorrow.toISOString()
          })
          .eq('api_name', this.apiName);
      } else {
        // Increment quota
        await this.supabase
          .from('synopsis_api_health')
          .update({
            daily_quota_used: (data.daily_quota_used || 0) + 1
          })
          .eq('api_name', this.apiName);
      }
    } catch (error) {
      console.error(`Failed to update quota for ${this.apiName}:`, error);
    }
  }

  // Check if API is available (considering circuit breaker and quota)
  async isAvailable(): Promise<boolean> {
    await this.loadState();

    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure < this.config.resetTimeout) {
        return false;
      }
    }

    // Check quota
    try {
      const { data } = await this.supabase
        .from('synopsis_api_health')
        .select('daily_quota_used, daily_quota_limit')
        .eq('api_name', this.apiName)
        .single();

      if (data && data.daily_quota_limit) {
        const quotaUsage = (data.daily_quota_used || 0) / data.daily_quota_limit;
        if (quotaUsage >= 0.95) { // 95% quota used
          console.warn(`${this.apiName} quota nearly exhausted: ${(quotaUsage * 100).toFixed(1)}%`);
          return false;
        }
      }
    } catch (error) {
      console.error(`Failed to check quota for ${this.apiName}:`, error);
    }

    return true;
  }

  // Get current state info
  async getStatus(): Promise<{
    state: string;
    failures: number;
    isAvailable: boolean;
    quotaUsage?: number;
  }> {
    await this.loadState();
    
    const { data } = await this.supabase
      .from('synopsis_api_health')
      .select('daily_quota_used, daily_quota_limit')
      .eq('api_name', this.apiName)
      .single();

    const quotaUsage = data && data.daily_quota_limit ? 
      data.daily_quota_used / data.daily_quota_limit : undefined;

    return {
      state: this.state,
      failures: this.failures,
      isAvailable: await this.isAvailable(),
      quotaUsage
    };
  }
}

export class CircuitBreakerError extends Error {
  constructor(message: string, public state: 'open' | 'half-open') {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

// Factory function for creating circuit breakers with default configs
export function createCircuitBreaker(
  apiName: string,
  supabase: SupabaseClient,
  customConfig?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  // API-specific default configurations
  const apiConfigs: Record<string, CircuitBreakerConfig> = {
    scraperapi: {
      failureThreshold: 3,
      resetTimeout: 180000, // 3 minutes
      halfOpenRequests: 2
    },
    openai: {
      failureThreshold: 5,
      resetTimeout: 300000, // 5 minutes
      halfOpenRequests: 3
    },
    deepseek: {
      failureThreshold: 4,
      resetTimeout: 240000, // 4 minutes
      halfOpenRequests: 2
    },
    playwright: {
      failureThreshold: 2,
      resetTimeout: 120000, // 2 minutes
      halfOpenRequests: 1
    }
  };

  const config = {
    ...apiConfigs[apiName],
    ...customConfig
  };

  return new CircuitBreaker(apiName, supabase, config);
}