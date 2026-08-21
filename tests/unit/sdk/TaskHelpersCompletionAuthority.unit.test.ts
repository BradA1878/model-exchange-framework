/**
 * TaskHelpers.isCurrentTaskCompletionAgent decides whether this agent may
 * report the terminal outcome of its current task. Both automatic failure
 * paths in the SDK (the iteration limit in MxfAgent and a rejected task
 * handler in TaskHandlers) consult it before sending task:fail_request, so
 * the rule is pinned here on its own.
 */

import { Logger } from '@mxf-dev/core/utils/Logger';
import { TaskHelpers, type AgentContext } from '@mxf-dev/sdk/MxfAgentHelpers';

const logger = new Logger('error', 'TaskHelpersCompletionAuthority.test', 'client');
const decide = (currentTask: AgentContext['currentTask']): boolean =>
    TaskHelpers.isCurrentTaskCompletionAgent({ agentId: 'agent-1', currentTask }, logger);

describe('TaskHelpers.isCurrentTaskCompletionAgent', () => {
    it('grants authority when there is no current task', () => {
        expect(decide(undefined)).toBe(true);
    });

    it('follows the task\'s completionAgentId, which the server enforces, over anything else', () => {
        // A task created with assignedAgentIds + completionAgentId carries no role
        // metadata at all; the designation is the only signal and it is decisive.
        expect(decide({ id: 't', completionAgentId: 'agent-1', metadata: {} })).toBe(true);
        expect(decide({ id: 't', completionAgentId: 'agent-2', metadata: {} })).toBe(false);
        expect(decide({ id: 't', completionAgentId: 'agent-2' })).toBe(false);
        expect(decide({ id: 't', completionAgentId: 'agent-1', metadata: { multiAgentTask: true, isCompletionAgent: false } })).toBe(true);
    });

    it('grants authority to every assignee of a multi-agent task with no designation and no role metadata', () => {
        // The server accepts a terminal report from any assignee in that case.
        expect(decide({ id: 't', assignedAgentIds: ['agent-1', 'agent-2'], metadata: {} })).toBe(true);
    });

    it('follows the server-computed designation when present', () => {
        expect(decide({ id: 't', metadata: { multiAgentTask: true, isCompletionAgent: true } })).toBe(true);
        expect(decide({ id: 't', metadata: { multiAgentTask: true, isCompletionAgent: false } })).toBe(false);
    });

    it('grants authority for a single-agent task without a designation', () => {
        expect(decide({ id: 't', metadata: {} })).toBe(true);
        expect(decide({ id: 't' })).toBe(true);
    });

    it('falls back to the lead agent for a multi-agent task without a designation', () => {
        expect(decide({ id: 't', leadAgentId: 'agent-1', metadata: { multiAgentTask: true } })).toBe(true);
        expect(decide({ id: 't', leadAgentId: 'agent-2', metadata: { multiAgentTask: true } })).toBe(false);
        expect(decide({ id: 't', metadata: { multiAgentTask: true } })).toBe(false);
    });
});
