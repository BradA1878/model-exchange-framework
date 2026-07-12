/**
 * MXF CLI TUI — Stop Controller
 *
 * The single cancel path for in-flight agent work, shared by `/stop`, Esc, and
 * Ctrl+S.
 *
 * Clearing `isAgentWorking` only changes what the TUI draws — the agents keep
 * iterating server-side and keep spending LLM credits. The only thing that
 * actually kills an in-flight LLM call is dropping the agent's socket, which is
 * what `InteractiveSessionManager.reconnectAgents()` does: it disconnects every
 * agent (killing the call), then reconnects them idle and ready for a new task.
 *
 * The "stopped" message is emitted only after that succeeds. If it fails, the
 * user is told the agents may still be running, because they are.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import type { Dispatch } from 'react';
import type { AppAction } from '../state';
import type { InteractiveSessionManager } from '../services/InteractiveSessionManager';

/**
 * Sessions with a stop already in flight.
 *
 * Esc/Ctrl+S can fire faster than the reconnect completes; overlapping
 * reconnects would race over the agent map. Held per-session so multiple
 * sessions (tests, future multi-session use) do not block each other.
 */
const stopInFlight = new WeakSet<InteractiveSessionManager>();

/**
 * Cancel all in-flight agent work for a session.
 *
 * Safe to call when nothing is running and safe to call concurrently — a second
 * call while a stop is in flight is ignored rather than racing the first.
 *
 * @param session - The session whose agents should be stopped
 * @param dispatch - TUI dispatch, used to report progress and the outcome
 */
export async function stopAgentActivity(
    session: InteractiveSessionManager,
    dispatch: Dispatch<AppAction>,
): Promise<void> {
    if (stopInFlight.has(session)) return;

    // Nothing is connected, so nothing is billing. Say so rather than claiming a stop.
    if (!session.isConnected()) {
        dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: 'No connected agents to stop.' },
        });
        return;
    }

    stopInFlight.add(session);
    try {
        const agentIds = session.getConnectedDefinitions().map(d => d.agentId);

        dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: 'Stopping agent activity...' },
        });

        await session.reconnectAgents();

        // Reconnect succeeded: in-flight calls are dead and agents are idle again.
        dispatch({
            type: 'TASK_RESOLVED',
            resultEntry: {
                type: 'system',
                content: 'Agent activity stopped. You can submit a new task.',
            },
            agentIds,
            clearTaskId: true,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        dispatch({
            type: 'ADD_ENTRY',
            entry: {
                type: 'error',
                content: `Failed to stop agent activity: ${message}. Agents may still be running — use /exit if they keep working.`,
            },
        });
    } finally {
        stopInFlight.delete(session);
    }
}
