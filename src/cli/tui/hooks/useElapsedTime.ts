/**
 * MXF CLI TUI — Elapsed Time Hook
 *
 * Tracks elapsed time since session start. Updates every second
 * for display in the status bar.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { useState, useEffect, useRef } from 'react';

/**
 * Hook that returns elapsed seconds since mount, updating every second.
 *
 * @returns Current elapsed time in seconds
 */
export function useElapsedTime(): number {
    const [elapsed, setElapsed] = useState(0);
    const startTime = useRef(Date.now());

    useEffect(() => {
        const interval = setInterval(() => {
            setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    return elapsed;
}

/**
 * Format elapsed seconds as a human-readable string.
 *
 * @param seconds - Total elapsed seconds
 * @returns Formatted string (e.g., "34s", "2m 15s", "1h 5m")
 */
export function formatElapsedTime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}
