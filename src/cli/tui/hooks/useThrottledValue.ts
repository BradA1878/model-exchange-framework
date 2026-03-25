/**
 * MXF CLI TUI — Throttled Value Hook
 *
 * Returns a throttled version of a value that updates at most every
 * `intervalMs` milliseconds. Uses leading-edge + trailing-edge throttle:
 * the first update is immediate, subsequent updates within the interval
 * are batched and delivered after the interval expires.
 *
 * Used to throttle ConversationArea entry updates during rapid agent
 * activity, reducing visual churn from Ink's full-screen redraws.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { useState, useEffect, useRef } from 'react';

/**
 * Throttle a value to update at most every `intervalMs` milliseconds.
 *
 * Leading-edge: First change is applied immediately.
 * Trailing-edge: Final change within the throttle window is applied
 * after the interval expires, ensuring no updates are lost.
 *
 * @param value - The value to throttle
 * @param intervalMs - Minimum milliseconds between updates
 * @returns The throttled value
 */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
    const [throttled, setThrottled] = useState(value);
    const lastUpdateRef = useRef(Date.now());
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latestRef = useRef(value);

    latestRef.current = value;

    useEffect(() => {
        const now = Date.now();
        const elapsed = now - lastUpdateRef.current;

        if (elapsed >= intervalMs) {
            // Enough time has passed — update immediately (leading edge)
            setThrottled(value);
            lastUpdateRef.current = now;
        } else {
            // Within throttle window — schedule trailing-edge update
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                setThrottled(latestRef.current);
                lastUpdateRef.current = Date.now();
                timerRef.current = null;
            }, intervalMs - elapsed);
        }

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [value, intervalMs]);

    return throttled;
}
