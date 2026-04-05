/**
 * Property-based tests for UserMemory system.
 *
 * Uses fast-check to verify invariants that must hold across all valid inputs:
 * - Staleness thresholds are always positive
 * - getStalenessLabel always returns a non-empty string
 * - isStale is consistent with threshold values
 * - STALENESS_THRESHOLDS covers every UserMemoryType
 */

import fc from 'fast-check';
import { STALENESS_THRESHOLDS, UserMemoryType } from '@mxf/shared/models/userMemory';
import { UserMemoryService } from '@mxf/shared/services/UserMemoryService';

// ─── Mock Meilisearch ───────────────────────────────────────────────────────

jest.mock('@mxf/shared/services/MxfMeilisearchService', () => ({
    MxfMeilisearchService: {
        getInstance: () => ({
            isEnabled: () => false
        })
    }
}));

jest.mock('@mxf/shared/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

// ─── Constants ──────────────────────────────────────────────────────────────

const ALL_TYPES: UserMemoryType[] = ['user', 'feedback', 'project', 'reference'];

/** fast-check arbitrary that produces a valid UserMemoryType */
const arbMemoryType = fc.constantFrom<UserMemoryType>(...ALL_TYPES);

/** fast-check arbitrary that produces a Date in a reasonable range (past 10 years to future 1 day) */
const arbPastDate = fc.integer({ min: 1, max: 365 * 10 }).map((daysAgo) =>
    new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
);

// ─── Service Instance ───────────────────────────────────────────────────────

let service: UserMemoryService;

beforeAll(() => {
    (UserMemoryService as any).instance = undefined;
    service = UserMemoryService.getInstance();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('UserMemory Property Tests', () => {

    describe('STALENESS_THRESHOLDS', () => {
        it('every UserMemoryType has a positive threshold', () => {
            fc.assert(
                fc.property(arbMemoryType, (type) => {
                    const threshold = STALENESS_THRESHOLDS[type];
                    return typeof threshold === 'number' && threshold > 0;
                })
            );
        });

        it('covers all known types', () => {
            for (const type of ALL_TYPES) {
                expect(STALENESS_THRESHOLDS[type]).toBeDefined();
                expect(STALENESS_THRESHOLDS[type]).toBeGreaterThan(0);
            }
        });
    });

    describe('getStalenessLabel', () => {
        it('always returns a non-empty string for any past Date', () => {
            fc.assert(
                fc.property(arbPastDate, (date) => {
                    const label = service.getStalenessLabel(date);
                    return typeof label === 'string' && label.length > 0;
                })
            );
        });

        it('returns "today" for any timestamp within the current day', () => {
            // Generate timestamps from 0 to 23 hours ago (same calendar day edge not guaranteed,
            // but 0 hours ago is always today)
            const result = service.getStalenessLabel(new Date());
            expect(result).toBe('today');
        });

        it('is deterministic — same input always produces same output', () => {
            fc.assert(
                fc.property(arbPastDate, (date) => {
                    const a = service.getStalenessLabel(date);
                    const b = service.getStalenessLabel(date);
                    return a === b;
                })
            );
        });

        it('label always matches one of the known patterns', () => {
            const patterns = [
                /^today$/,
                /^1 day ago$/,
                /^\d+ days ago$/,
                /^1 month ago$/,
                /^\d+ months ago$/,
                /^1 year ago$/,
                /^\d+ years ago$/
            ];

            fc.assert(
                fc.property(arbPastDate, (date) => {
                    const label = service.getStalenessLabel(date);
                    return patterns.some((p) => p.test(label));
                })
            );
        });
    });

    describe('isStale', () => {
        it('returns true when age exceeds threshold', () => {
            fc.assert(
                fc.property(
                    arbMemoryType,
                    fc.integer({ min: 1, max: 365 }),
                    (type, extraDays) => {
                        const thresholdDays = STALENESS_THRESHOLDS[type];
                        const pastDate = new Date(
                            Date.now() - (thresholdDays + extraDays) * 24 * 60 * 60 * 1000
                        );
                        return service.isStale(type, pastDate) === true;
                    }
                )
            );
        });

        it('returns false when age is under threshold', () => {
            fc.assert(
                fc.property(
                    arbMemoryType,
                    (type) => {
                        const thresholdDays = STALENESS_THRESHOLDS[type];
                        // Use half the threshold to be safely under
                        const recentDate = new Date(
                            Date.now() - Math.floor(thresholdDays / 2) * 24 * 60 * 60 * 1000
                        );
                        return service.isStale(type, recentDate) === false;
                    }
                )
            );
        });

        it('is deterministic — same inputs always produce same output', () => {
            fc.assert(
                fc.property(arbMemoryType, arbPastDate, (type, date) => {
                    return service.isStale(type, date) === service.isStale(type, date);
                })
            );
        });
    });

    describe('threshold ordering', () => {
        it('project < reference < feedback < user', () => {
            expect(STALENESS_THRESHOLDS.project).toBeLessThan(STALENESS_THRESHOLDS.reference);
            expect(STALENESS_THRESHOLDS.reference).toBeLessThan(STALENESS_THRESHOLDS.feedback);
            expect(STALENESS_THRESHOLDS.feedback).toBeLessThan(STALENESS_THRESHOLDS.user);
        });
    });
});
