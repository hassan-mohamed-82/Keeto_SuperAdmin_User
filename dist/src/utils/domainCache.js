"use strict";
/**
 * Lightweight in-memory TTL cache for domain resolution results.
 * Keys are lowercase hostnames.
 * Values can be a resolved record or `null` (negative cache).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.domainResolutionCache = exports.DomainCache = void 0;
class DomainCache {
    constructor(ttlMs, negativeTtlMs) {
        this.ttlMs = ttlMs;
        this.negativeTtlMs = negativeTtlMs;
        this.store = new Map();
    }
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return undefined; // cache miss
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined; // expired
        }
        return entry.value;
    }
    set(key, value) {
        this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    }
    setNegative(key) {
        this.store.set(key, {
            value: null,
            expiresAt: Date.now() + this.negativeTtlMs,
        });
    }
    delete(key) {
        this.store.delete(key);
    }
    /** Remove all expired entries (optional housekeeping). */
    prune() {
        const now = Date.now();
        for (const [k, v] of this.store) {
            if (now > v.expiresAt)
                this.store.delete(k);
        }
    }
}
exports.DomainCache = DomainCache;
// Singleton instance: 60s positive TTL, 15s negative TTL
exports.domainResolutionCache = new DomainCache(60000, 15000);
