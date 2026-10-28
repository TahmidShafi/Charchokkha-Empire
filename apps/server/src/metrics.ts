/**
 * Lightweight, in-memory latency & error metrics collector (Phase 5).
 * Bounded sample window; zero dependencies; no sensitive PII logged.
 */
export interface ActionMetricsSummary {
  totalActions: number;
  totalErrors: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  reconnections: number;
  reconnectionFailures: number;
  duplicateRequests: number;
  rejectedMutations: number;
  sampleCount: number;
}

export class MetricsCollector {
  private latencies: number[] = [];
  private readonly maxSamples: number;

  public totalActions = 0;
  public totalErrors = 0;
  public totalReconnections = 0;
  public totalReconnectionFailures = 0;
  public totalDuplicateRequests = 0;
  public totalRejectedMutations = 0;

  constructor(maxSamples = 1000) {
    this.maxSamples = maxSamples;
  }

  public recordAction(
    durationMs: number,
    success: boolean,
    isDuplicate = false,
    isRejected = false
  ): void {
    this.totalActions += 1;
    if (!success) {
      this.totalErrors += 1;
      if (isRejected) {
        this.totalRejectedMutations += 1;
      }
    }
    if (isDuplicate) {
      this.totalDuplicateRequests += 1;
    }

    this.latencies.push(durationMs);
    if (this.latencies.length > this.maxSamples) {
      this.latencies.shift();
    }
  }

  public recordReconnection(success: boolean): void {
    if (success) {
      this.totalReconnections += 1;
    } else {
      this.totalReconnectionFailures += 1;
    }
  }

  public getSummary(): ActionMetricsSummary {
    if (this.latencies.length === 0) {
      return {
        totalActions: this.totalActions,
        totalErrors: this.totalErrors,
        errorRate: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        reconnections: this.totalReconnections,
        reconnectionFailures: this.totalReconnectionFailures,
        duplicateRequests: this.totalDuplicateRequests,
        rejectedMutations: this.totalRejectedMutations,
        sampleCount: 0,
      };
    }

    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.5))];
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
    const errorRate = this.totalActions > 0 ? this.totalErrors / this.totalActions : 0;

    return {
      totalActions: this.totalActions,
      totalErrors: this.totalErrors,
      errorRate: Number(errorRate.toFixed(4)),
      p50Ms: Number(p50.toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
      p99Ms: Number(p99.toFixed(2)),
      reconnections: this.totalReconnections,
      reconnectionFailures: this.totalReconnectionFailures,
      duplicateRequests: this.totalDuplicateRequests,
      rejectedMutations: this.totalRejectedMutations,
      sampleCount: this.latencies.length,
    };
  }

  public reset(): void {
    this.latencies = [];
    this.totalActions = 0;
    this.totalErrors = 0;
    this.totalReconnections = 0;
    this.totalReconnectionFailures = 0;
    this.totalDuplicateRequests = 0;
    this.totalRejectedMutations = 0;
  }
}

export const serverMetrics = new MetricsCollector();

