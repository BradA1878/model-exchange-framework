<template>
  <div class="validation-metrics">
    <v-card class="mb-4" elevation="0">
      <v-card-title>
        <div class="d-flex align-center">
          <v-icon class="mr-2">mdi-shield-check</v-icon>
          Validation Performance Metrics
        </div>
      </v-card-title>

      <v-card-text>
        <!-- Health Score Overview -->
        <v-row>
          <v-col cols="12" md="3">
            <v-card variant="outlined">
              <v-card-text class="text-center">
                <div class="text-h2" :class="healthScoreColor">
                  {{ (validationHealth * 100).toFixed(0) }}%
                </div>
                <div class="text-subtitle-1">Validation Health</div>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12" md="3">
            <v-card variant="outlined">
              <v-card-text class="text-center">
                <div class="text-h3 text-error">
                  {{ totalErrors }}
                </div>
                <div class="text-subtitle-1">Total Errors</div>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12" md="3">
            <v-card variant="outlined">
              <v-card-text class="text-center">
                <div class="text-h3 text-success">
                  {{ selfCorrectionRate }}%
                </div>
                <div class="text-subtitle-1">Self-Correction Rate</div>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12" md="3">
            <v-card variant="outlined">
              <v-card-text class="text-center">
                <div class="text-h3 text-info">
                  {{ helpToolUsage }}
                </div>
                <div class="text-subtitle-1">Help Tools Used</div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <v-divider class="my-4" />

        <!-- Error Types Breakdown -->
        <v-row>
          <v-col cols="12" md="6">
            <v-card variant="outlined">
              <v-card-title class="text-subtitle-1">Error Types Distribution</v-card-title>
              <v-card-text>
                <div v-if="totalErrors > 0">
                  <div
                    v-for="(count, type) in errorTypes"
                    :key="type"
                    class="mb-3"
                  >
                    <div class="d-flex justify-space-between mb-1">
                      <span class="text-body-2">{{ formatErrorType(String(type)) }}</span>
                      <span class="text-body-2 font-weight-medium">{{ count }}</span>
                    </div>
                    <v-progress-linear
                      :model-value="(Number(count) / totalErrors) * 100"
                      :color="getErrorTypeColor(String(type))"
                      height="8"
                      rounded
                    />
                  </div>
                </div>
                <div v-else class="text-center py-4 text-medium-emphasis">
                  No errors recorded
                </div>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12" md="6">
            <v-card variant="outlined">
              <v-card-title class="text-subtitle-1">Help Tool Usage</v-card-title>
              <v-card-text>
                <v-list density="compact">
                  <v-list-item
                    v-for="(count, tool) in helpTools"
                    :key="tool"
                    :prepend-icon="'mdi-tools'"
                  >
                    <v-list-item-title>{{ tool }}</v-list-item-title>
                    <template v-slot:append>
                      <v-chip size="small" variant="tonal">{{ count }}</v-chip>
                    </template>
                  </v-list-item>
                </v-list>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <v-divider class="my-4" />

        <!-- Problem Tools -->
        <v-row>
          <v-col cols="12">
            <v-card variant="outlined">
              <v-card-title class="text-subtitle-1">
                <div class="d-flex align-center justify-space-between w-100">
                  <span>Tools with Most Validation Errors</span>
                  <v-btn size="small" variant="text" color="primary" @click="showRecommendations = true">
                    View Recommendations
                  </v-btn>
                </div>
              </v-card-title>
              <v-card-text>
                <v-data-table
                  :headers="problemToolHeaders"
                  :items="problemTools"
                  :items-per-page="5"
                  density="compact"
                >
                  <template v-slot:item.errorRate="{ item }">
                    <v-chip
                      :color="item.errorRate > 0.5 ? 'error' : item.errorRate > 0.2 ? 'warning' : 'success'"
                      size="small"
                      variant="tonal"
                    >
                      {{ (item.errorRate * 100).toFixed(0) }}%
                    </v-chip>
                  </template>
                  <template v-slot:item.actions="{ item }">
                    <v-btn
                      size="small"
                      variant="text"
                      color="primary"
                      @click="viewToolDetails(item)"
                    >
                      Details
                    </v-btn>
                  </template>
                </v-data-table>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <!-- Recovery Time Chart -->
        <v-row class="mt-4">
          <v-col cols="12">
            <v-card variant="outlined">
              <v-card-title class="text-subtitle-1">Recovery Time Analysis</v-card-title>
              <v-card-text>
                <canvas ref="recoveryChartRef"></canvas>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Recommendations Dialog -->
    <v-dialog v-model="showRecommendations" max-width="800">
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between">
          <span>Validation Improvement Recommendations</span>
          <v-btn icon="mdi-close" variant="text" size="small" @click="showRecommendations = false" />
        </v-card-title>
        <v-divider />
        <v-card-text>
          <v-list>
            <v-list-item
              v-for="(rec, idx) in recommendations"
              :key="idx"
              :prepend-icon="getPriorityIcon(rec.priority)"
              lines="three"
            >
              <v-list-item-title>{{ rec.action }}</v-list-item-title>
              <v-list-item-subtitle>
                Expected: {{ rec.expectedImprovement }}
              </v-list-item-subtitle>
              <v-list-item-subtitle v-if="rec.tools?.length">
                Tools: {{ rec.tools.join(', ') }}
              </v-list-item-subtitle>
              <template v-slot:prepend>
                <v-icon :color="getPriorityColor(rec.priority)">
                  {{ getPriorityIcon(rec.priority) }}
                </v-icon>
              </template>
            </v-list-item>
          </v-list>
          <div v-if="recommendations.length === 0" class="text-center py-4 text-medium-emphasis">
            No recommendations available
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Tool Details Dialog -->
    <v-dialog v-model="showToolDialog" max-width="600">
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between">
          <div class="d-flex align-center">
            <v-icon class="mr-2">mdi-tools</v-icon>
            Tool Details
          </div>
          <v-btn icon="mdi-close" variant="text" size="small" @click="showToolDialog = false" />
        </v-card-title>
        <v-divider />
        <v-card-text v-if="selectedTool">
          <div class="mb-4">
            <h3 class="text-h6 mb-2">{{ selectedTool.tool }}</h3>
            <v-chip
              :color="selectedTool.errorRate > 0.5 ? 'error' : selectedTool.errorRate > 0.2 ? 'warning' : 'success'"
              variant="tonal"
              class="mr-2"
            >
              {{ (selectedTool.errorRate * 100).toFixed(0) }}% Error Rate
            </v-chip>
          </div>

          <v-table density="compact" class="mb-4">
            <tbody>
              <tr>
                <td class="text-medium-emphasis font-weight-medium" style="width: 140px;">Tool Name</td>
                <td>{{ selectedTool.tool }}</td>
              </tr>
              <tr>
                <td class="text-medium-emphasis font-weight-medium">Error Rate</td>
                <td>{{ (selectedTool.errorRate * 100).toFixed(1) }}%</td>
              </tr>
              <tr>
                <td class="text-medium-emphasis font-weight-medium">Common Errors</td>
                <td>{{ selectedTool.commonErrors || 'None recorded' }}</td>
              </tr>
            </tbody>
          </v-table>

          <div v-if="selectedTool.recommendations?.length" class="mt-3">
            <h4 class="text-subtitle-1 mb-2">Recommendations</h4>
            <v-list density="compact">
              <v-list-item
                v-for="(rec, idx) in selectedTool.recommendations"
                :key="idx"
                prepend-icon="mdi-lightbulb-outline"
              >
                <v-list-item-title>{{ rec }}</v-list-item-title>
              </v-list-item>
            </v-list>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="text" @click="showToolDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Chart, registerables } from 'chart.js';
import axios from '@/plugins/axios';

Chart.register(...registerables);

// Props
interface Props {
  agentId: string;
  channelId: string;
}

const props = defineProps<Props>();

// Reactive state
const validationHealth = ref(0.75);
const totalErrors = ref(0);
const selfCorrectionRate = ref(0);
const helpToolUsage = ref(0);
const errorTypes = ref<Record<string, number>>({
  missingRequired: 0,
  unknownProperties: 0,
  typeMismatch: 0,
  constraintViolation: 0,
  other: 0
});
const helpTools = ref<Record<string, number>>({
  tool_help: 0,
  tool_validate: 0,
  tool_quick_reference: 0,
  tool_validation_tips: 0
});
const problemTools = ref<any[]>([]);
const recommendations = ref<any[]>([]);
const showRecommendations = ref(false);
const showToolDialog = ref(false);
const selectedTool = ref<any>(null);

// Chart refs
const recoveryChartRef = ref<HTMLCanvasElement>();
let recoveryChart: Chart | null = null;
let pollingInterval: ReturnType<typeof setInterval> | null = null;

// Table headers for problem tools
const problemToolHeaders = [
  { title: 'Tool', key: 'tool' },
  { title: 'Error Rate', key: 'errorRate' },
  { title: 'Common Errors', key: 'commonErrors' },
  { title: 'Actions', key: 'actions', sortable: false }
];

// Computed
const healthScoreColor = computed(() => {
  if (validationHealth.value >= 0.8) return 'text-success';
  if (validationHealth.value >= 0.6) return 'text-warning';
  return 'text-error';
});

// Methods
const loadValidationMetrics = async (): Promise<void> => {
  try {
    const response = await axios.get(
      `/api/analytics/validation/${props.agentId}/${props.channelId}`
    );

    const data = response.data;

    validationHealth.value = data.validationHealth || 0.75;
    totalErrors.value = data.totalErrors || 0;
    selfCorrectionRate.value = Math.round((data.selfCorrectionRate || 0) * 100);
    helpToolUsage.value = Object.values(data.helpToolUsage || {})
      .reduce((a: number, b: any) => a + Number(b), 0);

    if (data.errorTypes) {
      errorTypes.value = data.errorTypes;
    }

    if (data.helpToolUsage) {
      helpTools.value = data.helpToolUsage;
    }

    if (data.problemAreas) {
      problemTools.value = data.problemAreas.map((area: any) => ({
        ...area,
        commonErrors: area.commonErrors?.join(', ') || ''
      }));
    }

    if (data.recommendations) {
      recommendations.value = data.recommendations;
    }

    updateRecoveryChart(data.recoveryTimes);
  } catch (error) {
    console.error('Error loading validation metrics:', error);
  }
};

const setupRecoveryChart = (): void => {
  const ctx = recoveryChartRef.value?.getContext('2d');
  if (!ctx) return;

  recoveryChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: 'Recovery Time (seconds)',
        data: [],
        backgroundColor: 'rgba(99, 102, 241, 0.6)',
        borderColor: 'rgba(99, 102, 241, 1)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Recovery Time (seconds)'
          }
        }
      }
    }
  });
};

const updateRecoveryChart = (recoveryTimes: any): void => {
  if (!recoveryChart || !recoveryTimes) return;

  const sortedTools = Object.entries(recoveryTimes.byTool || {})
    .sort(([, a]: any, [, b]: any) => b - a)
    .slice(0, 10);

  recoveryChart.data.labels = sortedTools.map(([tool]) => tool);
  recoveryChart.data.datasets[0].data = sortedTools.map(([, time]: any) =>
    Number((time / 1000).toFixed(2))
  );

  recoveryChart.update();
};

const formatErrorType = (type: string): string => {
  const formatted: Record<string, string> = {
    missingRequired: 'Missing Required',
    unknownProperties: 'Unknown Properties',
    typeMismatch: 'Type Mismatch',
    constraintViolation: 'Constraint Violation',
    other: 'Other'
  };
  return formatted[type] || type;
};

const getErrorTypeColor = (type: string): string => {
  const colors: Record<string, string> = {
    missingRequired: 'error',
    unknownProperties: 'warning',
    typeMismatch: 'orange',
    constraintViolation: 'purple',
    other: 'grey'
  };
  return colors[type] || 'grey';
};

const getPriorityColor = (priority: string): string => {
  const colors: Record<string, string> = {
    high: 'error',
    medium: 'warning',
    low: 'info'
  };
  return colors[priority] || 'grey';
};

const getPriorityIcon = (priority: string): string => {
  const icons: Record<string, string> = {
    high: 'mdi-alert-circle',
    medium: 'mdi-alert',
    low: 'mdi-information'
  };
  return icons[priority] || 'mdi-help-circle';
};

/**
 * Open tool details dialog showing tool name, error rate, common errors,
 * and recommendations for improvement.
 */
const viewToolDetails = (tool: any): void => {
  selectedTool.value = tool;
  showToolDialog.value = true;
};

const startMetricsPolling = (): void => {
  pollingInterval = setInterval(() => {
    loadValidationMetrics();
  }, 30000);
};

const stopMetricsPolling = (): void => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
};

// Lifecycle
onMounted(() => {
  loadValidationMetrics();
  setupRecoveryChart();
  startMetricsPolling();
});

onUnmounted(() => {
  stopMetricsPolling();
  if (recoveryChart) {
    recoveryChart.destroy();
    recoveryChart = null;
  }
});
</script>

<style scoped>
.validation-metrics {
  height: 100%;
}

canvas {
  max-height: 300px;
}
</style>
