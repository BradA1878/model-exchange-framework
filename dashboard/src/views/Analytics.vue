<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAnalyticsStore } from '@/stores/analytics';
import { useChannelsStore } from '@/stores/channels';

// Stores
const analyticsStore = useAnalyticsStore();
const channelsStore = useChannelsStore();
const router = useRouter();

// Tab state
const currentTab = ref('data');

// Computed properties from store
const analyticsStats = computed(() => analyticsStore.stats);
const isLoading = computed(() => analyticsStore.isLoading);
const hasError = computed(() => !!analyticsStore.error);

// Methods
const navigateToSubView = (view: 'data' | 'charts'): void => {
    router.push(`/dashboard/analytics/${view}`);
};

const loadAnalyticsData = async (): Promise<void> => {
    try {
        // Load all analytics data with current time range
        await analyticsStore.refreshAllData();
    } catch (error) {
        console.error('Failed to load analytics data:', error);
    }
};

const refreshData = async (): Promise<void> => {
    await loadAnalyticsData();
};

const exportAnalytics = async (): Promise<void> => {
    try {
        await analyticsStore.exportData('events');
    } catch (error) {
        console.error('Failed to export analytics:', error);
    }
};

const clearError = (): void => {
    analyticsStore.clearError();
};

onMounted(async () => {
    await loadAnalyticsData();
});
</script>

<template>
    <div class="an">
        <!-- ░░ Header Strip ░░ -->
        <header class="an-header">
            <div class="an-header__left">
                <h1 class="an-header__title">Analytics</h1>
                <span class="an-header__divider">/</span>
                <span class="an-header__sub">Monitor your MXF system performance and usage patterns.</span>
            </div>
            <div class="an-header__actions">
                <button class="an-btn an-btn--ghost" @click="exportAnalytics">
                    <v-icon size="14">mdi-download</v-icon>
                    <span>Export Report</span>
                </button>
            </div>
        </header>

        <!-- ░░ Summary Metrics Strip ░░ -->
        <section class="an-metrics">
            <div class="an-metric" data-accent="blue">
                <div class="an-metric__head">
                    <span class="an-metric__label">Total Events</span>
                    <v-icon size="13" class="an-metric__ico">mdi-pulse</v-icon>
                </div>
                <div class="an-metric__number" v-if="!isLoading">{{ analyticsStats.totalEvents.toLocaleString() }}</div>
                <v-skeleton-loader v-else type="text" width="40" />
            </div>
            <div class="an-metric" data-accent="green">
                <div class="an-metric__head">
                    <span class="an-metric__label">Active Channels</span>
                    <v-icon size="13" class="an-metric__ico">mdi-forum-outline</v-icon>
                </div>
                <div class="an-metric__number" v-if="!isLoading">{{ analyticsStats.activeChannels }}</div>
                <v-skeleton-loader v-else type="text" width="40" />
            </div>
            <div class="an-metric" data-accent="cyan">
                <div class="an-metric__head">
                    <span class="an-metric__label">Avg Response Time</span>
                    <v-icon size="13" class="an-metric__ico">mdi-timer-outline</v-icon>
                </div>
                <div class="an-metric__number" v-if="!isLoading">{{ analyticsStats.avgResponseTime }}<span class="an-metric__unit">s</span></div>
                <v-skeleton-loader v-else type="text" width="40" />
            </div>
            <div class="an-metric" data-accent="green">
                <div class="an-metric__head">
                    <span class="an-metric__label">Success Rate</span>
                    <v-icon size="13" class="an-metric__ico">mdi-check-circle-outline</v-icon>
                </div>
                <div class="an-metric__number" v-if="!isLoading">{{ analyticsStats.successRate }}<span class="an-metric__unit">%</span></div>
                <v-skeleton-loader v-else type="text" width="40" />
            </div>
        </section>

        <!-- ░░ Tab Navigation ░░ -->
        <nav class="an-tabs">
            <button
                class="an-tab"
                :class="{ 'an-tab--active': currentTab === 'data' }"
                @click="currentTab = 'data'; navigateToSubView('data')"
            >
                <v-icon size="16">mdi-database</v-icon>
                <span>Data View</span>
            </button>
            <button
                class="an-tab"
                :class="{ 'an-tab--active': currentTab === 'charts' }"
                @click="currentTab = 'charts'; navigateToSubView('charts')"
            >
                <v-icon size="16">mdi-chart-line</v-icon>
                <span>Charts & Visualizations</span>
            </button>
        </nav>

        <!-- ░░ Sub-route Content ░░ -->
        <section class="an-content">
            <router-view />

            <!-- Default content when no sub-route is active -->
            <div v-if="$route.path === '/dashboard/analytics'" class="an-overview">
                <div class="an-overview__grid">
                    <div class="an-overview__card" @click="navigateToSubView('data')">
                        <div class="an-overview__card-icon">
                            <v-icon size="28" color="primary">mdi-database-eye</v-icon>
                        </div>
                        <h3 class="an-overview__card-title">Data Analytics</h3>
                        <p class="an-overview__card-desc">
                            View detailed data tables, filter records, and analyze your system's data patterns.
                        </p>
                        <div class="an-overview__card-features">
                            <span>Real-time tables</span>
                            <span>Advanced filters</span>
                            <span>Export</span>
                            <span>Trend analysis</span>
                        </div>
                        <div class="an-overview__card-action">
                            View Data →
                        </div>
                    </div>

                    <div class="an-overview__card" @click="navigateToSubView('charts')">
                        <div class="an-overview__card-icon">
                            <v-icon size="28" color="primary">mdi-chart-multiple</v-icon>
                        </div>
                        <h3 class="an-overview__card-title">Charts & Visualizations</h3>
                        <p class="an-overview__card-desc">
                            Interactive charts and visual representations of your system metrics and performance.
                        </p>
                        <div class="an-overview__card-features">
                            <span>Performance charts</span>
                            <span>Usage patterns</span>
                            <span>Real-time</span>
                            <span>Dashboards</span>
                        </div>
                        <div class="an-overview__card-action">
                            View Charts →
                        </div>
                    </div>
                </div>
            </div>
        </section>
    </div>
</template>

<style scoped>
/* ════════════════════════════════════════════
   MXF Analytics — Polished UI
   Matches Channels command-center aesthetic
   ════════════════════════════════════════════ */

.an {
    --an-blue: #4A90C2;
    --an-green: #10B981;
    --an-amber: #F59E0B;
    --an-cyan: #22D3EE;
    position: relative;
}

/* ── Header Strip ─────────────────────── */
.an-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--space-4);
}

.an-header__left {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.an-header__title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
    margin: 0;
}

.an-header__divider {
    color: var(--text-muted);
    opacity: 0.4;
    font-weight: 300;
}

.an-header__sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.an-header__actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

/* ── Buttons ──────────────────────────── */
.an-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-base);
    border: 1px solid transparent;
    white-space: nowrap;
    font-family: var(--font-sans);
}

.an-btn--ghost {
    background: transparent;
    border-color: var(--border-default);
    color: var(--text-secondary);
}

.an-btn--ghost:hover {
    color: var(--text-primary);
    border-color: var(--an-blue);
    background: rgba(74, 144, 194, 0.08);
}

/* ── Metrics Grid ─────────────────────── */
.an-metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-4);
}

.an-metric {
    position: relative;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    transition: all var(--transition-base);
    overflow: hidden;
}

.an-metric::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    border-radius: 3px 0 0 3px;
    opacity: 0.6;
    transition: opacity var(--transition-base);
}

.an-metric[data-accent="blue"]::before  { background: var(--an-blue); }
.an-metric[data-accent="green"]::before { background: var(--an-green); }
.an-metric[data-accent="amber"]::before { background: var(--an-amber); }
.an-metric[data-accent="cyan"]::before  { background: var(--an-cyan); }

.an-metric:hover {
    border-color: var(--border-default);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.an-metric:hover::before {
    opacity: 1;
}

.an-metric__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-1);
}

.an-metric__label {
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.an-metric__ico {
    color: var(--text-muted);
    opacity: 0.5;
}

.an-metric__number {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
    letter-spacing: -0.02em;
}

.an-metric__unit {
    font-size: 0.6em;
    font-weight: 500;
    opacity: 0.7;
}

/* ── Tab Navigation ───────────────────── */
.an-tabs {
    display: flex;
    gap: 1px;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    margin-bottom: var(--space-4);
}

.an-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-2);
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 500;
    font-family: var(--font-sans);
    cursor: pointer;
    transition: all var(--transition-base);
    position: relative;
}

.an-tab:hover:not(.an-tab--active) {
    color: var(--text-primary);
    background: var(--bg-hover);
}

.an-tab--active {
    color: var(--an-blue);
    background: linear-gradient(180deg, transparent 0%, rgba(74, 144, 194, 0.08) 100%);
}

.an-tab--active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 20%;
    right: 20%;
    height: 2px;
    background: var(--an-blue);
    border-radius: 2px 2px 0 0;
}

/* ── Content ──────────────────────────── */
.an-content {
    min-height: 400px;
}

/* ── Overview Cards ───────────────────── */
.an-overview__grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-4);
}

.an-overview__card {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    cursor: pointer;
    transition: all var(--transition-base);
    display: flex;
    flex-direction: column;
}

.an-overview__card:hover {
    border-color: var(--an-blue);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.an-overview__card-icon {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-lg);
    background: rgba(74, 144, 194, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--space-4);
}

.an-overview__card-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 var(--space-2);
}

.an-overview__card-desc {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.6;
    margin: 0 0 var(--space-4);
    flex: 1;
}

.an-overview__card-features {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
}

.an-overview__card-features span {
    font-size: var(--text-xs);
    padding: 2px 10px;
    background: var(--bg-hover);
    border-radius: var(--radius-full);
    color: var(--text-muted);
    font-weight: 500;
}

.an-overview__card-action {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--an-blue);
    letter-spacing: 0.01em;
}

/* ── Responsive ───────────────────────── */
@media (max-width: 768px) {
    .an-header {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-2);
    }

    .an-header__actions {
        align-self: flex-end;
    }

    .an-metrics {
        grid-template-columns: repeat(2, 1fr);
    }

    .an-overview__grid {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 480px) {
    .an-metrics {
        grid-template-columns: 1fr;
    }
}
</style>
