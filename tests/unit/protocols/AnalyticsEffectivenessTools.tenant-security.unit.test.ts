import {
    McpToolDefinition,
    McpToolHandlerContext,
    McpToolHandlerResult
} from '../../../packages/core/src/protocols/mcp/McpServerTypes';
import {
    analytics_agent_performance,
    analytics_channel_activity,
    analytics_compare_performance,
    analytics_dashboard_data,
    analytics_export_data,
    analytics_generate_report,
    analytics_system_health,
    analytics_task_completion,
    analytics_tool_usage,
    analytics_validation_metrics
} from '../../../packages/core/src/protocols/mcp/tools/AnalyticsTools';
import {
    task_effectiveness_complete,
    task_effectiveness_event,
    task_effectiveness_start
} from '../../../packages/core/src/protocols/mcp/tools/EffectivenessTools';
import { AgentPerformanceService } from '../../../packages/core/src/services/AgentPerformanceService';
import { TaskEffectivenessService } from '../../../packages/core/src/services/TaskEffectivenessService';

const context = (agentId?: string, channelId?: string): McpToolHandlerContext => ({
    requestId: 'request-1',
    agentId,
    channelId
});

const invoke = async (
    tool: McpToolDefinition,
    input: Record<string, unknown>,
    toolContext: McpToolHandlerContext
): Promise<McpToolHandlerResult> => await tool.handler(
    input,
    toolContext
) as McpToolHandlerResult;

const emptyAnalytics = {
    period: { start: 0, end: 1 },
    byTaskType: {},
    byChannel: {},
    trends: { effectivenessOverTime: [], improving: [], declining: [] },
    patterns: { highPerformanceTasks: [], lowPerformanceTasks: [], effectiveTeams: [] }
};

describe('Analytics and effectiveness MCP tenant boundaries', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('derives agent performance identity only from context and never creates missing metrics', async () => {
        const getTrackedPerformanceMetrics = jest.fn().mockReturnValue(null);
        jest.spyOn(AgentPerformanceService, 'getInstance').mockReturnValue({
            getTrackedPerformanceMetrics
        } as unknown as AgentPerformanceService);

        const selectedForeignAgent = await invoke(
            analytics_agent_performance,
            { agentId: 'agent-b' },
            context('agent-a', 'channel-a')
        );
        expect(selectedForeignAgent.content.data.success).toBe(false);
        expect(getTrackedPerformanceMetrics).not.toHaveBeenCalled();

        const missing = await invoke(
            analytics_agent_performance,
            {},
            context('agent-a', 'channel-a')
        );
        expect(getTrackedPerformanceMetrics).toHaveBeenCalledWith('agent-a', 'channel-a');
        expect(missing.content.data).toEqual(expect.objectContaining({
            success: false,
            error: expect.stringContaining('No tracked performance metrics')
        }));
        expect(missing.content.data).not.toHaveProperty('summary');
    });

    it('queries task analytics only for the authenticated agent-channel pair', async () => {
        const getAnalytics = jest.fn().mockResolvedValue(emptyAnalytics);
        jest.spyOn(TaskEffectivenessService, 'getInstance').mockReturnValue({
            getAnalytics
        } as unknown as TaskEffectivenessService);

        const foreign = await invoke(
            analytics_task_completion,
            { channelId: 'channel-b' },
            context('agent-a', 'channel-a')
        );
        expect(foreign.content.data.success).toBe(false);
        expect(getAnalytics).not.toHaveBeenCalled();

        const exact = await invoke(
            analytics_task_completion,
            { timeRange: '24h' },
            context('agent-a', 'channel-a')
        );
        expect(exact.content.data.success).toBe(true);
        expect(exact.content.data.tenant).toEqual({
            agentId: 'agent-a',
            channelId: 'channel-a'
        });
        expect(getAnalytics).toHaveBeenCalledWith(
            expect.any(Number),
            expect.any(Number),
            'agent-a',
            'channel-a'
        );
    });

    it('fails closed instead of returning mock reports or server-global analytics', async () => {
        const unavailableTools = [
            analytics_channel_activity,
            analytics_system_health,
            analytics_generate_report,
            analytics_validation_metrics,
            analytics_tool_usage,
            analytics_compare_performance,
            analytics_dashboard_data,
            analytics_export_data
        ];

        for (const tool of unavailableTools) {
            expect(tool.enabled).toBe(false);
            const result = await invoke(tool, {}, context('agent-a', 'channel-a'));
            expect(result.content.data.success).toBe(false);
            expect(result.content.data.error).toEqual(expect.any(String));
            expect(result.content.data).not.toHaveProperty('health');
            expect(result.content.data).not.toHaveProperty('report');
            expect(result.content.data).not.toHaveProperty('dashboard');
            expect(result.content.data).not.toHaveProperty('export');
        }
    });

    it('binds effectiveness creation and events to context and rejects caller-selected identity', async () => {
        const startTask = jest.fn().mockReturnValue('generated-task');
        const recordEvent = jest.fn();
        jest.spyOn(TaskEffectivenessService, 'getInstance').mockReturnValue({
            startTask,
            recordEvent
        } as unknown as TaskEffectivenessService);

        const rejectedStart = await invoke(
            task_effectiveness_start,
            {
                taskType: 'analysis',
                description: 'foreign attempt',
                agentId: 'agent-b'
            },
            context('agent-a', 'channel-a')
        );
        expect(rejectedStart.content.data.success).toBe(false);
        expect(startTask).not.toHaveBeenCalled();

        const started = await invoke(
            task_effectiveness_start,
            { taskType: 'analysis', description: 'exact task' },
            context('agent-a', 'channel-a')
        );
        expect(started.content.data.success).toBe(true);
        expect(startTask).toHaveBeenCalledWith(expect.objectContaining({
            agentId: 'agent-a',
            channelId: 'channel-a',
            taskType: 'analysis'
        }));

        const rejectedEvent = await invoke(
            task_effectiveness_event,
            { taskId: 'shared-task', eventType: 'step', channelId: 'channel-b' },
            context('agent-a', 'channel-a')
        );
        expect(rejectedEvent.content.data.success).toBe(false);
        expect(recordEvent).not.toHaveBeenCalled();

        const recorded = await invoke(
            task_effectiveness_event,
            { taskId: 'shared-task', eventType: 'step' },
            context('agent-a', 'channel-a')
        );
        expect(recorded.content.data.success).toBe(true);
        expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({
            taskId: 'shared-task',
            agentId: 'agent-a',
            channelId: 'channel-a',
            type: 'step'
        }));
    });

    it('reports missing or foreign completion honestly and passes exact identity to the service', async () => {
        const completeTask = jest.fn().mockResolvedValue(null);
        const compareWithBaseline = jest.fn();
        jest.spyOn(TaskEffectivenessService, 'getInstance').mockReturnValue({
            completeTask,
            compareWithBaseline
        } as unknown as TaskEffectivenessService);

        const result = await invoke(
            task_effectiveness_complete,
            { taskId: 'shared-task', success: true },
            context('agent-a', 'channel-a')
        );

        expect(result.content.data).toEqual(expect.objectContaining({
            success: false,
            error: 'Task not found or already completed'
        }));
        expect(completeTask).toHaveBeenCalledWith(
            'shared-task',
            'agent-a',
            'channel-a',
            true,
            undefined
        );
        expect(compareWithBaseline).not.toHaveBeenCalled();
    });

    it('fails closed when authenticated context is incomplete', async () => {
        const startTask = jest.fn();
        jest.spyOn(TaskEffectivenessService, 'getInstance').mockReturnValue({
            startTask
        } as unknown as TaskEffectivenessService);

        const result = await invoke(
            task_effectiveness_start,
            { taskType: 'analysis', description: 'missing channel' },
            context('agent-a', undefined)
        );

        expect(result.content.data.success).toBe(false);
        expect(result.content.data.error).toContain('Authenticated agent and channel context are required');
        expect(startTask).not.toHaveBeenCalled();
    });
});
