/**
 * MXF Desktop — Session History Service
 *
 * Saves and loads conversation sessions to ~/.mxf/sessions/ via Tauri IPC.
 * Each session is stored as a JSON file containing messages, cost data,
 * timestamps, and model info. Sessions are pruned to keep the most recent 50.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { invoke } from '@tauri-apps/api/core';
import type { ConversationMessage, CostData } from '../types';

/** Maximum number of sessions to retain on disk */
const MAX_SESSIONS = 50;

/** Full session record saved to disk */
export interface SessionRecord {
    sessionId: string;
    startTime: number;
    endTime: number;
    model: string;
    messages: ConversationMessage[];
    costData: CostData;
    messageCount: number;
}

/** Lightweight summary for listing sessions without loading messages */
export interface SessionSummary {
    sessionId: string;
    startTime: number;
    endTime: number;
    model: string;
    messageCount: number;
    totalIterations: number;
    estimatedCost: number;
}

/**
 * Save a session record to disk.
 * Automatically prunes old sessions beyond MAX_SESSIONS.
 */
export async function saveSession(record: SessionRecord): Promise<void> {
    await invoke('save_session', {
        sessionId: record.sessionId,
        data: record,
    });

    // Prune old sessions
    await pruneSessions(MAX_SESSIONS);
}

/**
 * List all saved sessions as lightweight summaries.
 * Returns most recent sessions first.
 */
export async function listSessions(): Promise<SessionSummary[]> {
    const sessionIds = await invoke<string[]>('list_sessions');
    const summaries: SessionSummary[] = [];

    for (const sessionId of sessionIds) {
        try {
            const record = await invoke<SessionRecord>('load_session', { sessionId });
            summaries.push({
                sessionId: record.sessionId,
                startTime: record.startTime,
                endTime: record.endTime,
                model: record.model || 'unknown',
                messageCount: record.messageCount || record.messages?.length || 0,
                totalIterations: record.costData?.totalIterations || 0,
                estimatedCost: record.costData?.estimatedCost || 0,
            });
        } catch {
            // Skip corrupted session files
        }
    }

    // Sort most recent first
    summaries.sort((a, b) => b.startTime - a.startTime);
    return summaries;
}

/**
 * Load a full session record from disk.
 * Returns null if the session doesn't exist.
 */
export async function loadSession(sessionId: string): Promise<SessionRecord | null> {
    try {
        return await invoke<SessionRecord>('load_session', { sessionId });
    } catch {
        return null;
    }
}

/**
 * Delete sessions beyond the maximum count, keeping the most recent.
 */
async function pruneSessions(maxSessions: number): Promise<void> {
    const sessionIds = await invoke<string[]>('list_sessions');
    if (sessionIds.length <= maxSessions) return;

    // Session IDs are sorted alphabetically by Rust — we need to sort by
    // actual timestamps to prune correctly. Load minimal data to find oldest.
    const sessionsWithTime: Array<{ id: string; startTime: number }> = [];
    for (const id of sessionIds) {
        try {
            const record = await invoke<SessionRecord>('load_session', { sessionId: id });
            sessionsWithTime.push({ id, startTime: record.startTime || 0 });
        } catch {
            // Corrupted — mark for deletion with oldest timestamp
            sessionsWithTime.push({ id, startTime: 0 });
        }
    }

    // Sort oldest first, delete excess
    sessionsWithTime.sort((a, b) => a.startTime - b.startTime);
    const toDelete = sessionsWithTime.slice(0, sessionsWithTime.length - maxSessions);

    for (const session of toDelete) {
        try {
            await invoke('delete_session', { sessionId: session.id });
        } catch {
            // Ignore deletion failures
        }
    }
}

/**
 * Format session list as a human-readable string for the /history command.
 */
export function formatSessionList(summaries: SessionSummary[]): string {
    if (summaries.length === 0) {
        return 'No saved sessions found.';
    }

    const lines: string[] = ['Recent Sessions:', ''];

    for (const s of summaries.slice(0, 20)) {
        const date = new Date(s.startTime).toLocaleString();
        const cost = s.estimatedCost > 0 ? ` ~$${s.estimatedCost.toFixed(4)}` : '';
        lines.push(`  ${s.sessionId}  ${date}  ${s.messageCount} msgs  ${s.totalIterations} iters${cost}`);
    }

    if (summaries.length > 20) {
        lines.push(`  ... and ${summaries.length - 20} more`);
    }

    lines.push('', 'Use /history load <id> to load a session.');
    return lines.join('\n');
}
