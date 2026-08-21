import type { Subscription } from 'rxjs';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { PatternLearningService } from '@mxf-dev/core/services/PatternLearningService';
import { AutoCorrectionService } from '@mxf-dev/core/services/AutoCorrectionService';
import { ToolExecutionInterceptor } from '@mxf-dev/core/services/ToolExecutionInterceptor';
import { ProactiveValidationService } from '@mxf-dev/core/services/ProactiveValidationService';
import { ValidationCacheService } from '@mxf-dev/core/services/ValidationCacheService';
import { ValidationMiddleware } from '@mxf-dev/core/services/ValidationMiddleware';
import { ValidationAnalyticsService } from '@mxf-dev/core/services/ValidationAnalyticsService';
import { PerformanceOptimizationService } from '@mxf-dev/core/services/PerformanceOptimizationService';
import { PredictiveAnalyticsService } from '@mxf-dev/core/services/PredictiveAnalyticsService';
import { ValidationPerformanceService } from '@mxf-dev/core/services/ValidationPerformanceService';
import { AgentPerformanceService } from '@mxf-dev/core/services/AgentPerformanceService';

interface IntervalHandle {
    hasRef?: () => boolean;
}

describe('validation analytics lifecycle', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        EventBus.reset();
    });

    afterEach(() => {
        EventBus.reset();
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('does not start background workers merely by importing the REST controller', async () => {
        await import('../../../src/server/api/controllers/validationAnalyticsController');

        expect(jest.getTimerCount()).toBe(0);
    });

    it('unrefs and releases every owned background timer and subscription', async () => {
        const patternLearning = PatternLearningService.getInstance();
        const autoCorrection = AutoCorrectionService.getInstance();
        const toolExecutionInterceptor = ToolExecutionInterceptor.getInstance();
        const proactiveValidation = ProactiveValidationService.getInstance();
        const validationCache = ValidationCacheService.getInstance();
        const validationMiddleware = ValidationMiddleware.getInstance();
        const validationAnalytics = ValidationAnalyticsService.getInstance();
        const performanceOptimization = PerformanceOptimizationService.getInstance();
        const predictiveAnalytics = PredictiveAnalyticsService.getInstance();

        const patternState = patternLearning as unknown as {
            validationEventSubscription?: Subscription;
            patternCleanupInterval?: IntervalHandle;
            cacheCleanupInterval?: IntervalHandle;
        };
        const proactiveState = proactiveValidation as unknown as {
            eventSubscriptions: Subscription[];
            metricsInterval?: IntervalHandle;
            riskProfileInterval?: IntervalHandle;
            cacheCleanupInterval?: IntervalHandle;
        };
        const autoCorrectionState = autoCorrection as unknown as {
            eventSubscriptions: Subscription[];
            retryTimers: Map<string, ReturnType<typeof setTimeout>>;
        };
        const interceptorState = toolExecutionInterceptor as unknown as {
            subscriptions: Subscription[];
            pendingDelays: Map<ReturnType<typeof setTimeout>, (reason?: unknown) => void>;
            delay: (milliseconds: number) => Promise<void>;
        };
        const cacheState = validationCache as unknown as {
            cleanupInterval?: IntervalHandle;
            mongoCleanupInterval?: IntervalHandle;
            statisticsInterval?: IntervalHandle;
        };
        const middlewareState = validationMiddleware as unknown as {
            subscriptions: Subscription[];
            pendingValidationTimeouts: Map<
                ReturnType<typeof setTimeout>,
                (reason?: unknown) => void
            >;
            withTimeout: <T>(promise: Promise<T>, timeoutMs: number) => Promise<T>;
            metricsInterval?: IntervalHandle;
            interceptionCleanupInterval?: IntervalHandle;
            healthCheckInterval?: IntervalHandle;
        };
        const analyticsState = validationAnalytics as unknown as {
            eventSubscriptions: Subscription[];
            aggregationInterval?: IntervalHandle;
        };
        const optimizationState = performanceOptimization as unknown as {
            eventSubscriptions: Subscription[];
            resourceMonitorInterval?: IntervalHandle;
            autoTuningInterval?: IntervalHandle;
        };
        const predictiveState = predictiveAnalytics as unknown as {
            eventSubscriptions: Subscription[];
            retrainInterval?: IntervalHandle;
        };

        // Exercise transient timer cancellation as well as periodic ownership.
        const retryTimer = setTimeout(() => undefined, 60_000);
        retryTimer.unref?.();
        autoCorrectionState.retryTimers.set('test-retry', retryTimer);
        const pendingDelay = interceptorState.delay(60_000).then(
            () => 'resolved',
            error => error instanceof Error ? error.message : String(error)
        );
        const pendingValidation = middlewareState.withTimeout(
            new Promise<void>(() => undefined),
            60_000
        ).then(
            () => 'resolved',
            error => error instanceof Error ? error.message : String(error)
        );
        performanceOptimization.enableAutoTuning({ tuningInterval: 60_000 });

        const timers = [
            patternState.patternCleanupInterval,
            patternState.cacheCleanupInterval,
            proactiveState.metricsInterval,
            proactiveState.riskProfileInterval,
            proactiveState.cacheCleanupInterval,
            cacheState.cleanupInterval,
            cacheState.mongoCleanupInterval,
            cacheState.statisticsInterval,
            middlewareState.metricsInterval,
            middlewareState.interceptionCleanupInterval,
            middlewareState.healthCheckInterval,
            analyticsState.aggregationInterval,
            optimizationState.resourceMonitorInterval,
            optimizationState.autoTuningInterval,
            predictiveState.retrainInterval,
            retryTimer,
            ...middlewareState.pendingValidationTimeouts.keys(),
            ...interceptorState.pendingDelays.keys()
        ].filter((timer): timer is IntervalHandle => timer !== undefined);
        const subscriptions = [
            patternState.validationEventSubscription,
            ...autoCorrectionState.eventSubscriptions,
            ...interceptorState.subscriptions,
            ...proactiveState.eventSubscriptions,
            ...middlewareState.subscriptions,
            ...analyticsState.eventSubscriptions,
            ...optimizationState.eventSubscriptions,
            ...predictiveState.eventSubscriptions
        ].filter((subscription): subscription is Subscription => subscription !== undefined);

        expect(timers).toHaveLength(18);
        expect(jest.getTimerCount()).toBe(18);
        expect(timers.every(timer => timer.hasRef?.() === false)).toBe(true);
        expect(subscriptions.length).toBeGreaterThan(0);

        performanceOptimization.shutdown();
        predictiveAnalytics.cleanup();
        validationAnalytics.shutdown();
        validationMiddleware.shutdown();
        toolExecutionInterceptor.shutdown();
        autoCorrection.shutdown();
        validationCache.shutdown();
        proactiveValidation.shutdown();
        patternLearning.shutdown();

        // Every lifecycle operation is safe to repeat.
        performanceOptimization.shutdown();
        predictiveAnalytics.cleanup();
        validationAnalytics.shutdown();
        validationMiddleware.shutdown();
        toolExecutionInterceptor.shutdown();
        autoCorrection.shutdown();
        validationCache.shutdown();
        proactiveValidation.shutdown();
        patternLearning.shutdown();

        expect(jest.getTimerCount()).toBe(0);
        expect(subscriptions.every(subscription => subscription.closed)).toBe(true);

        // ValidationPerformanceService and its AgentPerformanceService dependency
        // release their own listeners like every other validation service.
        expect(EventBus.server.listenerCount(Events.Mcp.TOOL_ERROR)).toBeGreaterThan(0);
        ValidationPerformanceService.getInstance().shutdown();
        AgentPerformanceService.getInstance().shutdown();
        expect(EventBus.server.listenerCount(Events.Mcp.TOOL_ERROR)).toBe(0);
        expect(EventBus.server.listenerCount(Events.Mcp.TOOL_RESULT)).toBe(0);
        expect(EventBus.server.listenerCount(Events.Mcp.TOOL_CALL)).toBe(0);

        await expect(pendingDelay).resolves.toBe('Tool execution interceptor is shutting down');
        await expect(pendingValidation).resolves.toBe('Validation middleware is shutting down');
    });
});
