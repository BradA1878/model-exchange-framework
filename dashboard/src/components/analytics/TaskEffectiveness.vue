<template>
  <div class="task-effectiveness">
    <!-- Summary Cards -->
    <div class="effectiveness-summary">
      <div class="summary-card">
        <div class="card-header">
          <svg class="card-icon" viewBox="0 0 24 24">
            <path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>
          </svg>
          <h3>Total Tasks</h3>
        </div>
        <div class="card-value">{{ totalTasks }}</div>
        <div class="card-change" :class="tasksChangeClass">
          {{ tasksChange }}% from last period
        </div>
      </div>

      <div class="summary-card">
        <div class="card-header">
          <svg class="card-icon" viewBox="0 0 24 24">
            <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14l-5-5 1.41-1.41L12 12.17l3.59-3.58L17 10l-5 5z"/>
          </svg>
          <h3>Success Rate</h3>
        </div>
        <div class="card-value">{{ successRate }}%</div>
        <div class="card-progress">
          <div class="progress-bar">
            <div class="progress-fill success" :style="{ width: successRate + '%' }"></div>
          </div>
        </div>
      </div>

      <div class="summary-card">
        <div class="card-header">
          <svg class="card-icon" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
          <h3>Avg Autonomy</h3>
        </div>
        <div class="card-value">{{ avgAutonomy }}%</div>
        <div class="card-subtext">{{ autonomyTrend }}</div>
      </div>

      <div class="summary-card">
        <div class="card-header">
          <svg class="card-icon" viewBox="0 0 24 24">
            <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
          </svg>
          <h3>Avg Time Saved</h3>
        </div>
        <div class="card-value">{{ avgTimeSaved }}</div>
        <div class="card-subtext">vs baseline</div>
      </div>
    </div>

    <!-- Task Type Performance -->
    <div class="effectiveness-section">
      <h2>Performance by Task Type</h2>
      <div class="task-type-grid">
        <div 
          v-for="taskType in taskTypes" 
          :key="taskType.type"
          class="task-type-card"
          :class="{ 'high-performance': taskType.successRate > 80 }"
        >
          <div class="type-header">
            <h4>{{ formatTaskType(taskType.type) }}</h4>
            <span class="task-count">{{ taskType.count }} tasks</span>
          </div>
          
          <div class="type-metrics">
            <div class="metric">
              <span class="metric-label">Success Rate</span>
              <span class="metric-value">{{ taskType.successRate }}%</span>
            </div>
            <div class="metric">
              <span class="metric-label">Autonomy</span>
              <span class="metric-value">{{ taskType.avgAutonomy }}%</span>
            </div>
            <div class="metric">
              <span class="metric-label">Avg Time</span>
              <span class="metric-value">{{ taskType.avgTime }}</span>
            </div>
          </div>

          <div class="type-tools">
            <span class="tools-label">Common Tools:</span>
            <div class="tool-tags">
              <span 
                v-for="tool in taskType.commonTools.slice(0, 3)" 
                :key="tool"
                class="tool-tag"
              >
                {{ tool }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Effectiveness Trends -->
    <div class="effectiveness-section">
      <h2>Effectiveness Trends</h2>
      <div class="trends-chart">
        <canvas ref="trendsCanvas"></canvas>
      </div>
      <div class="trend-summary">
        <div class="trend-item" :class="overallTrendClass">
          <span class="trend-label">Overall Trend:</span>
          <span class="trend-value">{{ overallTrend }}</span>
        </div>
        <div class="trend-item">
          <span class="trend-label">Peak Performance:</span>
          <span class="trend-value">{{ peakPerformance }}</span>
        </div>
      </div>
    </div>

    <!-- Agent Rankings -->
    <div class="effectiveness-section">
      <h2>Top Performing Agents</h2>
      <div class="agent-rankings">
        <div 
          v-for="(agent, index) in topAgents" 
          :key="agent.agentId"
          class="agent-rank"
        >
          <div class="rank-number">{{ index + 1 }}</div>
          <div class="agent-info">
            <div class="agent-name">{{ agent.name }}</div>
            <div class="agent-stats">
              {{ agent.tasksCompleted }} tasks • {{ agent.successRate }}% success • {{ agent.avgScore }}/10 score
            </div>
          </div>
          <div class="agent-badge" v-if="index === 0">👑</div>
        </div>
      </div>
    </div>

    <!-- Recommendations -->
    <div class="effectiveness-section" v-if="recommendations.length > 0">
      <h2>Optimization Recommendations</h2>
      <div class="recommendations">
        <div 
          v-for="rec in recommendations" 
          :key="rec.id"
          class="recommendation"
          :class="`priority-${rec.priority}`"
        >
          <div class="rec-header">
            <h4>{{ rec.title }}</h4>
            <span class="rec-priority">{{ rec.priority }}</span>
          </div>
          <p class="rec-description">{{ rec.description }}</p>
          <div class="rec-impact">
            Expected improvement: <strong>{{ rec.expectedImprovement }}%</strong>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { Chart, registerables } from 'chart.js';
import { useEffectivenessStore } from '@/stores/effectiveness';
import { useChannelsStore } from '@/stores/channels';

// Register Chart.js components
Chart.register(...registerables);

// Props
interface Props {
  channelId?: string;
  timeRange?: 'hour' | 'day' | 'week' | 'month';
}

const props = withDefaults(defineProps<Props>(), {
  timeRange: 'week'
});

// Store
const effectivenessStore = useEffectivenessStore();
const channelsStore = useChannelsStore();

// Refs
const trendsCanvas = ref<HTMLCanvasElement>();
let trendsChart: Chart | null = null;

// Computed
const totalTasks = computed(() => effectivenessStore.summary?.totalTasks || 0);
const successRate = computed(() => Math.round((effectivenessStore.summary?.successRate || 0) * 100));
const avgAutonomy = computed(() => Math.round((effectivenessStore.summary?.avgAutonomy || 0) * 100));
const avgTimeSaved = computed(() => formatTimeSaved(effectivenessStore.summary?.avgTimeSaved || 0));

const tasksChange = computed(() => {
  const change = effectivenessStore.summary?.tasksChange || 0;
  return change >= 0 ? `+${change}` : change.toString();
});

const tasksChangeClass = computed(() => ({
  positive: effectivenessStore.summary?.tasksChange > 0,
  negative: effectivenessStore.summary?.tasksChange < 0
}));

const autonomyTrend = computed(() => {
  const trend = effectivenessStore.summary?.autonomyTrend || 'stable';
  const icons = {
    improving: '📈 Improving',
    stable: '➡️ Stable',
    declining: '📉 Declining'
  };
  return icons[trend] || 'Stable';
});

const taskTypes = computed(() => effectivenessStore.taskTypes || []);
const topAgents = computed(() => effectivenessStore.topAgents || []);
const recommendations = computed(() => effectivenessStore.recommendations || []);

const overallTrend = computed(() => {
  const trend = effectivenessStore.trends?.overall || 'stable';
  return trend.charAt(0).toUpperCase() + trend.slice(1);
});

const overallTrendClass = computed(() => ({
  improving: effectivenessStore.trends?.overall === 'improving',
  declining: effectivenessStore.trends?.overall === 'declining'
}));

const peakPerformance = computed(() => {
  const peak = effectivenessStore.trends?.peak;
  if (!peak) return 'N/A';
  return `${Math.round(peak.score * 100)}% on ${formatDate(peak.date)}`;
});

// Methods
const formatTaskType = (type: string): string => {
  return type.split('_').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
};

const formatTimeSaved = (ms: number): string => {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
};

const formatDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric' 
  });
};

const loadEffectivenessData = async (): Promise<void> => {
  await effectivenessStore.loadAnalytics(props.channelId, props.timeRange);
  await effectivenessStore.loadTrends(props.channelId, props.timeRange);
  updateTrendsChart();
};

const updateTrendsChart = (): void => {
  if (!trendsCanvas.value || !effectivenessStore.trends?.dataPoints) return;

  const ctx = trendsCanvas.value.getContext('2d');
  if (!ctx) return;

  // Destroy existing chart
  if (trendsChart) {
    trendsChart.destroy();
  }

  const dataPoints = effectivenessStore.trends.dataPoints;
  
  trendsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dataPoints.map(p => formatDate(p.timestamp)),
      datasets: [
        {
          label: 'Overall Score',
          data: dataPoints.map(p => p.averageScore * 100),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.3
        },
        {
          label: 'Success Rate',
          data: dataPoints.map(p => p.successRate * 100),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          tension: 0.3
        },
        {
          label: 'Autonomy',
          data: dataPoints.map(p => p.avgAutonomy * 100),
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom'
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (context) => {
              return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: (value) => `${value}%`
          }
        }
      }
    }
  });
};

// Lifecycle
onMounted(() => {
  loadEffectivenessData();
});

onUnmounted(() => {
  if (trendsChart) {
    trendsChart.destroy();
  }
});

// Watch for changes
watch(() => [props.channelId, props.timeRange], () => {
  loadEffectivenessData();
});
</script>

<style scoped>
.task-effectiveness {
  padding: 1.5rem;
}

/* Summary Cards */
.effectiveness-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.summary-card {
  background: var(--bg-secondary);
  padding: 1.5rem;
  border-radius: 0.75rem;
  border: 1px solid var(--border-color);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.card-icon {
  width: 24px;
  height: 24px;
  fill: var(--text-muted);
}

.card-header h3 {
  font-size: 0.875rem;
  color: var(--text-muted);
  font-weight: 500;
}

.card-value {
  font-size: 2rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.card-change {
  font-size: 0.875rem;
  color: var(--text-muted);
}

.card-change.positive {
  color: var(--success);
}

.card-change.negative {
  color: var(--danger);
}

.card-subtext {
  font-size: 0.875rem;
  color: var(--text-muted);
}

.progress-bar {
  height: 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--primary);
  transition: width 0.3s ease;
}

.progress-fill.success {
  background: var(--success);
}

/* Sections */
.effectiveness-section {
  background: var(--bg-secondary);
  padding: 1.5rem;
  border-radius: 0.75rem;
  border: 1px solid var(--border-color);
  margin-bottom: 1.5rem;
}

.effectiveness-section h2 {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 1.5rem;
}

/* Task Type Grid */
.task-type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.task-type-card {
  background: var(--bg-primary);
  padding: 1.25rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
  transition: all 0.2s;
}

.task-type-card:hover {
  border-color: var(--primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.task-type-card.high-performance {
  border-color: var(--success);
}

.type-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.type-header h4 {
  font-size: 1.125rem;
  font-weight: 600;
}

.task-count {
  font-size: 0.875rem;
  color: var(--text-muted);
}

.type-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.metric {
  text-align: center;
}

.metric-label {
  display: block;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-bottom: 0.25rem;
}

.metric-value {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.type-tools {
  font-size: 0.875rem;
}

.tools-label {
  color: var(--text-muted);
  margin-right: 0.5rem;
}

.tool-tags {
  display: inline-flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.tool-tag {
  background: var(--bg-tertiary);
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

/* Trends */
.trends-chart {
  height: 300px;
  margin-bottom: 1rem;
}

.trend-summary {
  display: flex;
  gap: 2rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}

.trend-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.trend-label {
  color: var(--text-muted);
  font-size: 0.875rem;
}

.trend-value {
  font-weight: 600;
}

.trend-item.improving .trend-value {
  color: var(--success);
}

.trend-item.declining .trend-value {
  color: var(--danger);
}

/* Agent Rankings */
.agent-rankings {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.agent-rank {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem;
  background: var(--bg-primary);
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
}

.rank-number {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border-radius: 50%;
  font-weight: 600;
}

.agent-info {
  flex: 1;
}

.agent-name {
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.agent-stats {
  font-size: 0.875rem;
  color: var(--text-muted);
}

.agent-badge {
  font-size: 1.5rem;
}

/* Recommendations */
.recommendations {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.recommendation {
  padding: 1rem;
  background: var(--bg-primary);
  border-radius: 0.5rem;
  border: 1px solid var(--border-color);
}

.recommendation.priority-high {
  border-color: var(--danger);
}

.recommendation.priority-medium {
  border-color: var(--warning);
}

.rec-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.rec-header h4 {
  font-size: 1rem;
  font-weight: 600;
}

.rec-priority {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  background: var(--bg-tertiary);
  text-transform: uppercase;
}

.rec-description {
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
}

.rec-impact {
  font-size: 0.875rem;
  color: var(--text-muted);
}

.rec-impact strong {
  color: var(--success);
}
</style>