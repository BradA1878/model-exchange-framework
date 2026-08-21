export interface RateLimitDecision {
    allowed: boolean;
    retryAfterMs: number;
}

interface WindowState {
    count: number;
    startedAt: number;
}

/**
 * Process-wide fixed-window limiter with a hard key bound. When the map is
 * saturated it fails closed instead of evicting attacker-selected keys and
 * reopening their budget.
 */
export class BoundedFixedWindowRateLimiter {
    private readonly windows = new Map<string, WindowState>();

    public constructor(
        private readonly maximum: number,
        private readonly windowMs: number,
        private readonly maximumKeys: number
    ) {
        if (!Number.isSafeInteger(maximum) || maximum <= 0 ||
            !Number.isSafeInteger(windowMs) || windowMs <= 0 ||
            !Number.isSafeInteger(maximumKeys) || maximumKeys <= 0) {
            throw new Error('Rate limiter bounds must be positive safe integers');
        }
    }

    public consume(key: string, cost: number = 1, now: number = Date.now()): RateLimitDecision {
        return this.consumeMany([key], cost, now);
    }

    /** Atomically charge several independent buckets or charge none. */
    public consumeMany(
        keys: readonly string[],
        cost: number = 1,
        now: number = Date.now()
    ): RateLimitDecision {
        if (!Number.isSafeInteger(cost) || cost <= 0) {
            throw new Error('Rate limiter cost must be a positive safe integer');
        }
        const uniqueKeys = [...new Set(keys)];
        if (uniqueKeys.length === 0 || uniqueKeys.some(key => key.length === 0)) {
            throw new Error('Rate limiter keys must be non-empty');
        }
        if (cost > this.maximum) {
            return { allowed: false, retryAfterMs: this.windowMs };
        }

        const active = new Map<string, WindowState>();
        for (const key of uniqueKeys) {
            const existing = this.windows.get(key);
            if (existing && now - existing.startedAt < this.windowMs) {
                if (existing.count + cost > this.maximum) {
                    return {
                        allowed: false,
                        retryAfterMs: Math.max(1, this.windowMs - (now - existing.startedAt))
                    };
                }
                active.set(key, existing);
            } else if (existing) {
                this.windows.delete(key);
            }
        }

        const newKeyCount = uniqueKeys.length - active.size;
        if (this.windows.size + newKeyCount > this.maximumKeys) {
            for (const [entryKey, state] of this.windows) {
                if (now - state.startedAt >= this.windowMs) {
                    this.windows.delete(entryKey);
                }
            }
        }
        if (this.windows.size + newKeyCount > this.maximumKeys) {
            return { allowed: false, retryAfterMs: this.windowMs };
        }

        for (const key of uniqueKeys) {
            const existing = active.get(key);
            if (existing) {
                existing.count += cost;
            } else {
                this.windows.set(key, { count: cost, startedAt: now });
            }
        }
        return { allowed: true, retryAfterMs: 0 };
    }

    public reset(): void {
        this.windows.clear();
    }
}
