/**
 * Event Helpers for Testing
 *
 * Utilities for capturing and asserting on events during tests.
 */

import { sleep } from './waitFor';

export interface CapturedEvent {
    eventType: string;
    timestamp: number;
    data: any;
}

/**
 * Event capture utility for recording events during tests
 *
 * @example
 * const capture = new EventCapture();
 * capture.capture(agent, ['agent:registered', 'agent:connected']);
 *
 * await agent.connect();
 *
 * expect(capture.hasEvent('agent:registered')).toBe(true);
 * capture.cleanup();
 */
export class EventCapture {
    private events: CapturedEvent[] = [];
    private handlers: Map<string, { emitter: any; handler: (...args: any[]) => void }[]> = new Map();

    /**
     * Start capturing events from an emitter
     */
    capture(emitter: any, eventNames: string[]): void {
        for (const eventName of eventNames) {
            const handler = (...args: any[]): void => {
                this.events.push({
                    eventType: eventName,
                    timestamp: Date.now(),
                    data: args.length === 1 ? args[0] : args
                });
            };

            // Store handler for cleanup
            if (!this.handlers.has(eventName)) {
                this.handlers.set(eventName, []);
            }
            this.handlers.get(eventName)!.push({ emitter, handler });

            // Subscribe to event
            if (typeof emitter.on === 'function') {
                emitter.on(eventName, handler);
            } else if (typeof emitter.addEventListener === 'function') {
                emitter.addEventListener(eventName, handler);
            }
        }
    }

    /**
     * Get all captured events, optionally filtered by type
     */
    getEvents(eventType?: string): CapturedEvent[] {
        if (eventType) {
            return this.events.filter(e => e.eventType === eventType);
        }
        return [...this.events];
    }

    /**
     * Get the first event of a specific type
     */
    getFirstEvent(eventType: string): CapturedEvent | undefined {
        return this.events.find(e => e.eventType === eventType);
    }

    /**
     * Get the last event of a specific type
     */
    getLastEvent(eventType: string): CapturedEvent | undefined {
        const filtered = this.events.filter(e => e.eventType === eventType);
        return filtered[filtered.length - 1];
    }

    /**
     * Check if a specific event type was captured
     */
    hasEvent(eventType: string): boolean {
        return this.events.some(e => e.eventType === eventType);
    }

    /**
     * Get count of events for a specific type
     */
    getEventCount(eventType?: string): number {
        if (eventType) {
            return this.events.filter(e => e.eventType === eventType).length;
        }
        return this.events.length;
    }

    /**
     * Wait for a specific event to be captured
     */
    async waitForEvent(eventType: string, timeout: number = 5000): Promise<CapturedEvent> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const found = this.events.find(e => e.eventType === eventType);
            if (found) {
                return found;
            }
            await sleep(50);
        }

        throw new Error(`Timeout (${timeout}ms) waiting for event: ${eventType}`);
    }

    /**
     * Wait for N events of a specific type
     */
    async waitForEventCount(
        eventType: string,
        count: number,
        timeout: number = 10000
    ): Promise<CapturedEvent[]> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const events = this.events.filter(e => e.eventType === eventType);
            if (events.length >= count) {
                return events.slice(0, count);
            }
            await sleep(50);
        }

        const actual = this.events.filter(e => e.eventType === eventType).length;
        throw new Error(
            `Timeout (${timeout}ms) waiting for ${count} events of type "${eventType}", only got ${actual}`
        );
    }

    /**
     * Wait for any of the specified events
     */
    async waitForAnyEvent(eventTypes: string[], timeout: number = 5000): Promise<CapturedEvent> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const found = this.events.find(e => eventTypes.includes(e.eventType));
            if (found) {
                return found;
            }
            await sleep(50);
        }

        throw new Error(
            `Timeout (${timeout}ms) waiting for any of: ${eventTypes.join(', ')}`
        );
    }

    /**
     * Clear all captured events
     */
    clear(): void {
        this.events = [];
    }

    /**
     * Clean up all event listeners
     */
    cleanup(): void {
        for (const [eventName, handlerList] of this.handlers) {
            for (const { emitter, handler } of handlerList) {
                if (typeof emitter.off === 'function') {
                    emitter.off(eventName, handler);
                } else if (typeof emitter.removeListener === 'function') {
                    emitter.removeListener(eventName, handler);
                } else if (typeof emitter.removeEventListener === 'function') {
                    emitter.removeEventListener(eventName, handler);
                }
            }
        }

        this.handlers.clear();
        this.events = [];
    }

    /**
     * Get events in chronological order
     */
    getEventTimeline(): CapturedEvent[] {
        return [...this.events].sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Assert events occurred in a specific order
     */
    assertEventOrder(expectedOrder: string[]): void {
        const timeline = this.getEventTimeline();
        const actualOrder = timeline
            .map(e => e.eventType)
            .filter(type => expectedOrder.includes(type));

        // Remove duplicates while preserving order
        const uniqueActual: string[] = [];
        for (const type of actualOrder) {
            if (!uniqueActual.includes(type)) {
                uniqueActual.push(type);
            }
        }

        const matches = expectedOrder.every((type, index) => uniqueActual[index] === type);

        if (!matches) {
            throw new Error(
                `Event order mismatch.\nExpected: ${expectedOrder.join(' -> ')}\nActual: ${uniqueActual.join(' -> ')}`
            );
        }
    }
}

/**
 * Create a new EventCapture instance
 */
export function createEventCapture(): EventCapture {
    return new EventCapture();
}

/**
 * Utility to collect events from multiple sources
 */
export class MultiSourceEventCapture {
    private captures: Map<string, EventCapture> = new Map();

    /**
     * Add a source to capture events from
     */
    addSource(name: string, emitter: any, eventNames: string[]): void {
        const capture = new EventCapture();
        capture.capture(emitter, eventNames);
        this.captures.set(name, capture);
    }

    /**
     * Get events from a specific source
     */
    getSourceEvents(name: string, eventType?: string): CapturedEvent[] {
        const capture = this.captures.get(name);
        if (!capture) {
            return [];
        }
        return capture.getEvents(eventType);
    }

    /**
     * Get all events from all sources
     */
    getAllEvents(): Array<CapturedEvent & { source: string }> {
        const allEvents: Array<CapturedEvent & { source: string }> = [];

        for (const [name, capture] of this.captures) {
            for (const event of capture.getEvents()) {
                allEvents.push({ ...event, source: name });
            }
        }

        return allEvents.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Clean up all captures
     */
    cleanup(): void {
        for (const capture of this.captures.values()) {
            capture.cleanup();
        }
        this.captures.clear();
    }
}
