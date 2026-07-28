import type { RateSpec } from './config.js';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counters keyed by whatever the caller wants (usually an IP).
 *
 * Deliberately simple and in-process: it is a shield for a 0.25 vCPU container
 * against casual abuse, not a distributed quota system.
 */
export class RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #spec: RateSpec;
  readonly #now: () => number;
  #lastSweep = 0;

  constructor(spec: RateSpec, now: () => number = Date.now) {
    this.#spec = spec;
    this.#now = now;
  }

  /** True when the action is allowed; consumes one unit when it is. */
  tryConsume(key: string, cost = 1): boolean {
    const now = this.#now();
    this.#sweep(now);

    const bucket = this.#buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.#buckets.set(key, { count: cost, resetAt: now + this.#spec.windowMs });
      return cost <= this.#spec.limit;
    }
    if (bucket.count + cost > this.#spec.limit) return false;
    bucket.count += cost;
    return true;
  }

  /** Drops expired buckets so a long-running process does not leak keys. */
  #sweep(now: number): void {
    if (now - this.#lastSweep < this.#spec.windowMs) return;
    this.#lastSweep = now;
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) this.#buckets.delete(key);
    }
  }

  get size(): number {
    return this.#buckets.size;
  }
}

/** Counts concurrent things (connections per IP) rather than rate. */
export class ConcurrencyLimiter {
  readonly #counts = new Map<string, number>();
  readonly #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  acquire(key: string): boolean {
    const current = this.#counts.get(key) ?? 0;
    if (current >= this.#limit) return false;
    this.#counts.set(key, current + 1);
    return true;
  }

  release(key: string): void {
    const current = this.#counts.get(key);
    if (current === undefined) return;
    if (current <= 1) this.#counts.delete(key);
    else this.#counts.set(key, current - 1);
  }

  get size(): number {
    return this.#counts.size;
  }
}
