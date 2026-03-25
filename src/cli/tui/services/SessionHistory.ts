/**
 * MXF CLI TUI — Session History Service
 *
 * File-based persistence for session data in ~/.mxf/sessions/.
 * Each session is saved as a JSON file containing metadata,
 * conversation entries, and cost tracking data.
 *
 * This allows users to browse past sessions via /history without
 * needing the MXF server to be running.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ConversationEntry } from '../types';
import type { SessionCostData } from './CostTracker';

/** Persisted session record saved to disk */
export interface SessionRecord {
    /** Session identifier */
    sessionId: string;
    /** Channel ID used for the session */
    channelId: string;
    /** Session start timestamp (epoch ms) */
    startTime: number;
    /** Session end timestamp (epoch ms, set on disconnect) */
    endTime: number;
    /** Model used during the session */
    model: string;
    /** All conversation entries */
    entries: ConversationEntry[];
    /** Iteration and cost tracking data */
    costData: SessionCostData;
    /** Number of entries (for quick listing without loading full data) */
    entryCount: number;
}

/** Summary info for listing sessions (no entries loaded) */
export interface SessionSummary {
    sessionId: string;
    startTime: number;
    endTime: number;
    model: string;
    entryCount: number;
    totalIterations: number;
    totalTasks: number;
}

/** Default directory for session history files */
const SESSIONS_DIR = path.join(os.homedir(), '.mxf', 'sessions');

/** Maximum number of sessions to retain (oldest are pruned) */
const MAX_SESSIONS = 50;

/**
 * Session history service — manages file-based session persistence.
 */
export class SessionHistoryService {
    private sessionsDir: string;

    constructor(sessionsDir: string = SESSIONS_DIR) {
        this.sessionsDir = sessionsDir;
    }

    /**
     * Save a session record to disk.
     * Creates the sessions directory if it doesn't exist.
     * Prunes old sessions if count exceeds MAX_SESSIONS.
     */
    async save(record: SessionRecord): Promise<void> {
        await this.ensureDir();

        const filename = `${record.sessionId}.json`;
        const filepath = path.join(this.sessionsDir, filename);

        const data = JSON.stringify(record, null, 2);
        fs.writeFileSync(filepath, data, 'utf-8');

        // Prune old sessions
        await this.prune(MAX_SESSIONS);
    }

    /**
     * List all saved sessions as summaries (metadata only, no entries).
     * Returns sorted by startTime descending (most recent first).
     */
    async list(): Promise<SessionSummary[]> {
        await this.ensureDir();

        const files = fs.readdirSync(this.sessionsDir)
            .filter((f) => f.endsWith('.json'))
            .sort()
            .reverse();

        const summaries: SessionSummary[] = [];

        for (const file of files) {
            try {
                const filepath = path.join(this.sessionsDir, file);
                const raw = fs.readFileSync(filepath, 'utf-8');
                const record: SessionRecord = JSON.parse(raw);

                summaries.push({
                    sessionId: record.sessionId,
                    startTime: record.startTime,
                    endTime: record.endTime,
                    model: record.model,
                    entryCount: record.entryCount,
                    totalIterations: record.costData?.totalIterations || 0,
                    totalTasks: record.costData?.totalTasks || 0,
                });
            } catch {
                // Skip corrupted session files
            }
        }

        return summaries;
    }

    /**
     * Load a specific session's full data by session ID.
     * Returns null if not found.
     */
    async load(sessionId: string): Promise<SessionRecord | null> {
        const filepath = path.join(this.sessionsDir, `${sessionId}.json`);

        if (!fs.existsSync(filepath)) {
            return null;
        }

        try {
            const raw = fs.readFileSync(filepath, 'utf-8');
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    /**
     * Delete old sessions beyond the retention limit.
     * Keeps the most recent maxSessions files.
     */
    async prune(maxSessions: number): Promise<void> {
        const files = fs.readdirSync(this.sessionsDir)
            .filter((f) => f.endsWith('.json'))
            .sort();

        if (files.length <= maxSessions) return;

        const toDelete = files.slice(0, files.length - maxSessions);
        for (const file of toDelete) {
            try {
                fs.unlinkSync(path.join(this.sessionsDir, file));
            } catch {
                // Ignore deletion errors
            }
        }
    }

    /** Ensure the sessions directory exists */
    private async ensureDir(): Promise<void> {
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
    }
}

/**
 * Format a session summary list for the /history command display.
 */
export function formatSessionList(summaries: SessionSummary[]): string {
    if (summaries.length === 0) {
        return 'No session history found.';
    }

    const lines: string[] = ['Recent sessions:', ''];

    for (const s of summaries.slice(0, 20)) {
        const date = new Date(s.startTime).toLocaleDateString();
        const time = new Date(s.startTime).toLocaleTimeString();
        const durationMs = s.endTime - s.startTime;
        const durationMin = Math.floor(durationMs / 60000);
        const durationSec = Math.floor((durationMs % 60000) / 1000);
        const duration = durationMin > 0 ? `${durationMin}m ${durationSec}s` : `${durationSec}s`;

        lines.push(`  ${s.sessionId}  ${date} ${time}  ${duration}  ${s.entryCount} entries  ${s.totalIterations} iterations`);
    }

    if (summaries.length > 20) {
        lines.push(`  ... and ${summaries.length - 20} more`);
    }

    return lines.join('\n');
}
