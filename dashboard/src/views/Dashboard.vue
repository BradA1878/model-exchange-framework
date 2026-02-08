<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useDashboardStore } from '../stores/dashboard';

const authStore = useAuthStore();
const dashboardStore = useDashboardStore();

const showErrorSnackbar = ref(false);

const stats = computed(() => dashboardStore.stats);
const recentActivity = computed(() => dashboardStore.recentActivity);
const systemOverview = computed(() => dashboardStore.systemOverview);
const isLoading = computed(() => dashboardStore.isLoading);
const errorMessage = computed(() => dashboardStore.error);

const greeting = computed(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
});

const currentDate = computed(() => {
    return new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
});

const currentTime = ref('');
const updateTime = () => {
    currentTime.value = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
};
let timeInterval: ReturnType<typeof setInterval>;

const systemHealthColor = computed(() => {
    const health = 98;
    if (health >= 95) return 'var(--status-ok, #10B981)';
    if (health >= 80) return 'var(--status-warn, #F59E0B)';
    return 'var(--status-error, #EF4444)';
});

const loadDashboardData = async (): Promise<void> => {
    try {
        await dashboardStore.refreshAllData();
    } catch (error) {
        console.error('Failed to load dashboard data:', error);
        showErrorSnackbar.value = true;
    }
};

const refreshData = async (): Promise<void> => {
    await loadDashboardData();
};

const clearError = (): void => {
    dashboardStore.clearError();
    showErrorSnackbar.value = false;
};

watch(errorMessage, (newError) => {
    if (newError) {
        showErrorSnackbar.value = true;
    }
});

onMounted(async () => {
    updateTime();
    timeInterval = setInterval(updateTime, 1000);
    await loadDashboardData();
});

onUnmounted(() => {
    clearInterval(timeInterval);
});
</script>

<template>
    <div class="cmd-center">

        <!-- ░░ Header Strip ░░ -->
        <header class="cc-header">
            <div class="cc-header__left">
                <span class="cc-header__greeting">{{ greeting }}, {{ authStore.user?.firstName || 'Operator' }}</span>
                <span class="cc-header__divider">/</span>
                <span class="cc-header__date">{{ currentDate }}</span>
            </div>
            <div class="cc-header__right">
                <span class="cc-header__clock">{{ currentTime }}</span>
                <button
                    class="cc-refresh"
                    :class="{ 'cc-refresh--loading': isLoading }"
                    @click="refreshData"
                    :disabled="isLoading"
                >
                    <v-icon size="14">mdi-refresh</v-icon>
                </button>
            </div>
        </header>

        <!-- ░░ Metrics Strip ░░ -->
        <section class="cc-metrics">
            <template v-if="isLoading && !stats.totalChannels">
                <div v-for="n in 4" :key="n" class="cc-metric cc-metric--skeleton">
                    <div class="cc-metric__shimmer" />
                </div>
            </template>
            <template v-else>
                <router-link to="/dashboard/channels" class="cc-metric" data-accent="blue">
                    <div class="cc-metric__head">
                        <span class="cc-metric__label">Channels</span>
                        <v-icon size="13" class="cc-metric__ico">mdi-forum-outline</v-icon>
                    </div>
                    <div class="cc-metric__number">{{ stats.totalChannels }}</div>
                    <div class="cc-metric__status">
                        <span class="cc-dot cc-dot--active" />
                        <span>Active</span>
                    </div>
                </router-link>

                <router-link to="/dashboard/admin/agents" class="cc-metric" data-accent="green">
                    <div class="cc-metric__head">
                        <span class="cc-metric__label">Agents</span>
                        <v-icon size="13" class="cc-metric__ico">mdi-robot-outline</v-icon>
                    </div>
                    <div class="cc-metric__number">{{ stats.activeAgents }}</div>
                    <div class="cc-metric__status">
                        <span class="cc-dot" :class="stats.activeAgents > 0 ? 'cc-dot--active' : 'cc-dot--idle'" />
                        <span>{{ stats.activeAgents > 0 ? 'Online' : 'Standby' }}</span>
                    </div>
                </router-link>

                <div class="cc-metric" data-accent="amber">
                    <div class="cc-metric__head">
                        <span class="cc-metric__label">Tasks</span>
                        <v-icon size="13" class="cc-metric__ico">mdi-check-circle-outline</v-icon>
                    </div>
                    <div class="cc-metric__number">{{ stats.completedTasks }}</div>
                    <div class="cc-metric__status">
                        <span class="cc-metric__sub">completed today</span>
                    </div>
                </div>

                <div class="cc-metric" data-accent="cyan">
                    <div class="cc-metric__head">
                        <span class="cc-metric__label">System</span>
                        <v-icon size="13" class="cc-metric__ico">mdi-pulse</v-icon>
                    </div>
                    <div class="cc-metric__number" :style="{ color: systemHealthColor }">
                        98<span class="cc-metric__unit">%</span>
                    </div>
                    <div class="cc-metric__status">
                        <span class="cc-dot cc-dot--active" />
                        <span>Healthy</span>
                    </div>
                </div>
            </template>
        </section>

        <!-- ░░ Main Grid ░░ -->
        <section class="cc-grid">

            <!-- Activity Stream -->
            <div class="cc-panel cc-panel--stream">
                <div class="cc-panel__bar">
                    <h2 class="cc-panel__title">Activity Stream</h2>
                    <span class="cc-live">
                        <span class="cc-dot cc-dot--active cc-dot--sm" />
                        live
                    </span>
                </div>

                <div class="cc-panel__body">
                    <!-- Loading state -->
                    <div v-if="isLoading && !recentActivity.length" class="cc-stream-skeleton">
                        <div v-for="n in 6" :key="n" class="cc-stream-skeleton__row">
                            <div class="cc-metric__shimmer" style="width: 60%; height: 12px;" />
                            <div class="cc-metric__shimmer" style="width: 25%; height: 10px; margin-top: 4px;" />
                        </div>
                    </div>

                    <!-- Empty state -->
                    <div v-else-if="!recentActivity.length" class="cc-empty">
                        <div class="cc-empty__icon">
                            <v-icon size="28" style="opacity: 0.3">mdi-radio-tower</v-icon>
                        </div>
                        <p class="cc-empty__title">No signals yet</p>
                        <p class="cc-empty__sub">Agent and channel events will stream here in real-time</p>
                    </div>

                    <!-- Activity rows -->
                    <div v-else class="cc-stream">
                        <div
                            v-for="(item, idx) in recentActivity"
                            :key="item.id"
                            class="cc-event"
                            :style="{ animationDelay: `${idx * 50}ms` }"
                        >
                            <span class="cc-event__dot" :data-color="item.color" />
                            <div class="cc-event__body">
                                <span class="cc-event__text">{{ item.title }}</span>
                                <span class="cc-event__meta">
                                    <span v-if="item.agent" class="cc-event__agent">{{ item.agent }}</span>
                                    <span class="cc-event__time">{{ item.timestamp }}</span>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right Column -->
            <div class="cc-sidebar">

                <!-- System Gauges -->
                <div class="cc-panel">
                    <div class="cc-panel__bar">
                        <h2 class="cc-panel__title">System Gauges</h2>
                    </div>
                    <div class="cc-panel__body">
                        <div v-if="isLoading && !systemOverview.length" class="cc-gauges-skeleton">
                            <div v-for="n in 4" :key="n" class="cc-metric__shimmer" style="height: 32px; margin-bottom: 8px;" />
                        </div>
                        <div v-else-if="!systemOverview.length" class="cc-empty cc-empty--compact">
                            <v-icon size="20" style="opacity: 0.3">mdi-gauge-empty</v-icon>
                            <p class="cc-empty__sub" style="margin-top: 6px;">No gauge data</p>
                        </div>
                        <div v-else class="cc-gauges">
                            <div v-for="item in systemOverview" :key="item.name" class="cc-gauge">
                                <div class="cc-gauge__row">
                                    <span class="cc-gauge__name">{{ item.name }}</span>
                                    <span class="cc-gauge__val">{{ item.value }}</span>
                                </div>
                                <div class="cc-gauge__track">
                                    <div
                                        class="cc-gauge__fill"
                                        :data-color="item.color"
                                        :style="{ width: `${Math.min(item.percentage || (item.value / 100) * 100, 100)}%` }"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Quick Commands -->
                <div class="cc-panel">
                    <div class="cc-panel__bar">
                        <h2 class="cc-panel__title">Quick Commands</h2>
                    </div>
                    <div class="cc-panel__body cc-panel__body--flush">
                        <router-link to="/dashboard/channels" class="cc-cmd">
                            <span class="cc-cmd__icon cc-cmd__icon--blue">
                                <v-icon size="15">mdi-plus</v-icon>
                            </span>
                            <span class="cc-cmd__text">New Channel</span>
                            <v-icon size="12" class="cc-cmd__arrow">mdi-arrow-right</v-icon>
                        </router-link>
                        <router-link to="/dashboard/admin/agents" class="cc-cmd">
                            <span class="cc-cmd__icon cc-cmd__icon--green">
                                <v-icon size="15">mdi-robot-outline</v-icon>
                            </span>
                            <span class="cc-cmd__text">Manage Agents</span>
                            <v-icon size="12" class="cc-cmd__arrow">mdi-arrow-right</v-icon>
                        </router-link>
                        <router-link to="/dashboard/analytics" class="cc-cmd">
                            <span class="cc-cmd__icon cc-cmd__icon--cyan">
                                <v-icon size="15">mdi-chart-timeline-variant</v-icon>
                            </span>
                            <span class="cc-cmd__text">Analytics</span>
                            <v-icon size="12" class="cc-cmd__arrow">mdi-arrow-right</v-icon>
                        </router-link>
                        <router-link to="/dashboard/admin/control-loop" class="cc-cmd">
                            <span class="cc-cmd__icon cc-cmd__icon--amber">
                                <v-icon size="15">mdi-sync</v-icon>
                            </span>
                            <span class="cc-cmd__text">ORPAR Loop</span>
                            <v-icon size="12" class="cc-cmd__arrow">mdi-arrow-right</v-icon>
                        </router-link>
                    </div>
                </div>
            </div>
        </section>

        <!-- Error Snackbar -->
        <v-snackbar v-model="showErrorSnackbar" color="error" timeout="6000" location="top">
            {{ errorMessage }}
            <template #actions>
                <v-btn color="white" variant="text" @click="clearError">Close</v-btn>
            </template>
        </v-snackbar>
    </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════
   MXF Neural Command Center — Dashboard
   ═══════════════════════════════════════════ */

.cmd-center {
    --cc-blue: #4A90C2;
    --cc-green: #10B981;
    --cc-amber: #F59E0B;
    --cc-cyan: #22D3EE;
    --cc-red: #EF4444;

    position: relative;
    min-height: calc(100vh - 48px);
}

/* Subtle dot-grid background texture */
.cmd-center::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: radial-gradient(circle, var(--border-subtle) 1px, transparent 1px);
    background-size: 24px 24px;
    opacity: 0.4;
    pointer-events: none;
    z-index: 0;
}

.cmd-center > * {
    position: relative;
    z-index: 1;
}

/* ── Header Strip ─────────────────────── */
.cc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--space-5);
}

.cc-header__left {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.cc-header__greeting {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
}

.cc-header__divider {
    color: var(--text-muted);
    opacity: 0.4;
    font-weight: 300;
}

.cc-header__date {
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.cc-header__right {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}

.cc-header__clock {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    letter-spacing: 0.04em;
    min-width: 70px;
    text-align: right;
}

.cc-refresh {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-default);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all var(--transition-base);
}

.cc-refresh:hover {
    color: var(--text-primary);
    border-color: var(--primary-500);
    background: rgba(74, 144, 194, 0.08);
}

.cc-refresh--loading .v-icon {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* ── Metrics Strip ────────────────────── */
.cc-metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-5);
}

.cc-metric {
    position: relative;
    padding: var(--space-4);
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    text-decoration: none;
    color: inherit;
    transition: all var(--transition-base);
    overflow: hidden;
}

/* Left accent stripe */
.cc-metric::before {
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

.cc-metric[data-accent="blue"]::before  { background: var(--cc-blue); }
.cc-metric[data-accent="green"]::before { background: var(--cc-green); }
.cc-metric[data-accent="amber"]::before { background: var(--cc-amber); }
.cc-metric[data-accent="cyan"]::before  { background: var(--cc-cyan); }

.cc-metric:hover {
    border-color: var(--border-default);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.cc-metric:hover::before {
    opacity: 1;
}

.cc-metric__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
}

.cc-metric__label {
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.cc-metric__ico {
    color: var(--text-muted);
    opacity: 0.5;
}

.cc-metric__number {
    font-family: var(--font-mono);
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
    letter-spacing: -0.02em;
    margin-bottom: var(--space-2);
}

.cc-metric__unit {
    font-size: 0.6em;
    font-weight: 500;
    opacity: 0.7;
}

.cc-metric__status {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--text-secondary);
}

.cc-metric__sub {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.cc-metric--skeleton {
    min-height: 96px;
}

.cc-metric__shimmer {
    height: 100%;
    min-height: 16px;
    border-radius: var(--radius-sm);
    background: linear-gradient(
        90deg,
        var(--bg-hover) 25%,
        var(--bg-elevated) 50%,
        var(--bg-hover) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.8s infinite;
}

@keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

/* ── Dot Indicators ───────────────────── */
.cc-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--text-muted);
}

.cc-dot--active {
    background: var(--cc-green);
    box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
    animation: pulse-dot 2.5s ease-in-out infinite;
}

.cc-dot--idle {
    background: var(--text-muted);
    opacity: 0.5;
}

.cc-dot--sm {
    width: 5px;
    height: 5px;
}

@keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}

/* ── Main Grid ────────────────────────── */
.cc-grid {
    display: grid;
    grid-template-columns: 1fr 340px;
    gap: var(--space-5);
    align-items: start;
}

.cc-sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

/* ── Panels ───────────────────────────── */
.cc-panel {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
}

.cc-panel__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
}

.cc-panel__title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.005em;
}

.cc-panel__body {
    padding: var(--space-4);
}

.cc-panel__body--flush {
    padding: 0;
}

.cc-live {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.6875rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--cc-green);
    opacity: 0.8;
}

/* ── Activity Stream ──────────────────── */
.cc-panel--stream {
    min-height: 320px;
}

.cc-stream {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.cc-event {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--border-subtle);
    animation: event-in 0.3s ease-out both;
}

.cc-event:last-child {
    border-bottom: none;
}

@keyframes event-in {
    from {
        opacity: 0;
        transform: translateX(-8px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

.cc-event__dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 5px;
    background: var(--text-muted);
}

.cc-event__dot[data-color="success"] { background: var(--cc-green); box-shadow: 0 0 4px rgba(16,185,129,0.3); }
.cc-event__dot[data-color="info"]    { background: var(--cc-blue); box-shadow: 0 0 4px rgba(74,144,194,0.3); }
.cc-event__dot[data-color="primary"] { background: var(--cc-blue); box-shadow: 0 0 4px rgba(74,144,194,0.3); }
.cc-event__dot[data-color="warning"] { background: var(--cc-amber); box-shadow: 0 0 4px rgba(245,158,11,0.3); }
.cc-event__dot[data-color="error"]   { background: var(--cc-red); box-shadow: 0 0 4px rgba(239,68,68,0.3); }

.cc-event__body {
    flex: 1;
    min-width: 0;
}

.cc-event__text {
    display: block;
    font-size: var(--text-sm);
    color: var(--text-primary);
    line-height: 1.4;
}

.cc-event__meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: 2px;
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.cc-event__agent {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: var(--text-secondary);
    background: var(--bg-hover);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
}

.cc-event__time {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
}

/* ── Empty State ──────────────────────── */
.cc-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-10) var(--space-4);
    text-align: center;
}

.cc-empty--compact {
    padding: var(--space-6) var(--space-4);
}

.cc-empty__icon {
    margin-bottom: var(--space-3);
}

.cc-empty__title {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-secondary);
    margin: 0 0 var(--space-1);
}

.cc-empty__sub {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0;
    max-width: 260px;
    line-height: 1.5;
}

/* ── System Gauges ────────────────────── */
.cc-gauges {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.cc-gauge__row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: var(--space-1);
}

.cc-gauge__name {
    font-size: var(--text-xs);
    color: var(--text-secondary);
}

.cc-gauge__val {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-primary);
}

.cc-gauge__track {
    height: 3px;
    background: var(--bg-hover);
    border-radius: var(--radius-full);
    overflow: hidden;
}

.cc-gauge__fill {
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--cc-blue);
    transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

.cc-gauge__fill[data-color="primary"] { background: var(--cc-blue); }
.cc-gauge__fill[data-color="success"] { background: var(--cc-green); }
.cc-gauge__fill[data-color="warning"] { background: var(--cc-amber); }
.cc-gauge__fill[data-color="info"]    { background: var(--cc-cyan); }
.cc-gauge__fill[data-color="error"]   { background: var(--cc-red); }

/* ── Quick Commands ───────────────────── */
.cc-cmd {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    text-decoration: none;
    color: inherit;
    border-bottom: 1px solid var(--border-subtle);
    transition: all var(--transition-base);
}

.cc-cmd:last-child {
    border-bottom: none;
}

.cc-cmd:hover {
    background: var(--bg-hover);
}

.cc-cmd:hover .cc-cmd__arrow {
    opacity: 1;
    transform: translateX(2px);
}

.cc-cmd__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    flex-shrink: 0;
}

.cc-cmd__icon--blue  { background: rgba(74, 144, 194, 0.12); color: var(--cc-blue); }
.cc-cmd__icon--green { background: rgba(16, 185, 129, 0.12); color: var(--cc-green); }
.cc-cmd__icon--cyan  { background: rgba(34, 211, 238, 0.12); color: var(--cc-cyan); }
.cc-cmd__icon--amber { background: rgba(245, 158, 11, 0.12); color: var(--cc-amber); }

.cc-cmd__text {
    flex: 1;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
}

.cc-cmd__arrow {
    color: var(--text-muted);
    opacity: 0;
    transition: all var(--transition-base);
}

/* ── Skeleton States ──────────────────── */
.cc-stream-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-2) 0;
}

.cc-stream-skeleton__row {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.cc-gauges-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

/* ── Responsive ───────────────────────── */
@media (max-width: 1100px) {
    .cc-grid {
        grid-template-columns: 1fr;
    }

    .cc-sidebar {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-4);
    }
}

@media (max-width: 768px) {
    .cc-metrics {
        grid-template-columns: repeat(2, 1fr);
    }

    .cc-sidebar {
        grid-template-columns: 1fr;
    }

    .cc-header {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-2);
    }

    .cc-header__right {
        align-self: flex-end;
    }
}

@media (max-width: 480px) {
    .cc-metrics {
        grid-template-columns: 1fr;
    }
}
</style>
