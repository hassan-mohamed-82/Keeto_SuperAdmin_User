/**
 * Lightweight in-memory TTL cache for domain resolution results.
 * Keys are lowercase hostnames.
 * Values can be a resolved record or `null` (negative cache).
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class DomainCache<T> {
  private readonly store = new Map<string, CacheEntry<T | null>>();

  constructor(
    private readonly ttlMs: number,
    private readonly negativeTtlMs: number
  ) {}

  get(key: string): T | null | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined; // cache miss
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined; // expired
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  setNegative(key: string): void {
    this.store.set(key, {
      value: null,
      expiresAt: Date.now() + this.negativeTtlMs,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  /** Remove all expired entries (optional housekeeping). */
  prune(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (now > v.expiresAt) this.store.delete(k);
    }
  }
}

export interface ResolvedDomain {
  restaurantSlug: string;
  name: string;
}

// Singleton instance: 60s positive TTL, 15s negative TTL
export const domainResolutionCache = new DomainCache<ResolvedDomain>(
  60_000,
  15_000
);
