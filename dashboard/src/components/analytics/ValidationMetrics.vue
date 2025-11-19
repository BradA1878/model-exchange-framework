<template>
  <div class="validation-metrics">
    <v-card class="mb-4">
      <v-card-title>
        <v-icon left>mdi-shield-check</v-icon>
        Validation Performance Metrics
      </v-card-title>
      
      <v-card-text>
        <!-- Health Score Overview -->
        <v-row>
          <v-col cols="12" md="3">
            <v-card outlined>
              <v-card-text class="text-center">
                <div class="text-h2" :class="healthScoreColor">
                  {{ (validationHealth * 100).toFixed(0) }}%
                </div>
                <div class="text-subtitle-1">Validation Health</div>
              </v-card-text>
            </v-card>
          </v-col>
          
          <v-col cols="12" md="3">
            <v-card outlined>
              <v-card-text class="text-center">
                <div class="text-h3 error--text">
                  {{ totalErrors }}
                </div>
                <div class="text-subtitle-1">Total Errors</div>
              </v-card-text>
            </v-card>
          </v-col>
          
          <v-col cols="12" md="3">
            <v-card outlined>
              <v-card-text class="text-center">
                <div class="text-h3 success--text">
                  {{ selfCorrectionRate }}%
                </div>
                <div class="text-subtitle-1">Self-Correction Rate</div>
              </v-card-text>
            </v-card>
          </v-col>
          
          <v-col cols="12" md="3">
            <v-card outlined>
              <v-card-text class="text-center">
                <div class="text-h3 info--text">
                  {{ helpToolUsage }}
                </div>
                <div class="text-subtitle-1">Help Tools Used</div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <v-divider class="my-4"></v-divider>

        <!-- Error Types Breakdown -->
        <v-row>
          <v-col cols="12" md="6">
            <v-card outlined>
              <v-card-title class="subtitle-1">Error Types Distribution</v-card-title>
              <v-card-text>
                <v-progress-linear
                  v-for="(count, type) in errorTypes"
                  :key="type"
                  :value="(count / totalErrors) * 100"
                  :color="getErrorTypeColor(type)"
                  height="25"
                  class="mb-2"
                >
                  <template v-slot:default>
                    <strong>{{ formatErrorType(type) }}: {{ count }}</strong>
                  </template>
                </v-progress-linear>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12" md="6">
            <v-card outlined>
              <v-card-title class="subtitle-1">Help Tool Usage</v-card-title>
              <v-card-text>
                <v-list dense>
                  <v-list-item v-for="(count, tool) in helpTools" :key="tool">
                    <v-list-item-icon>
                      <v-icon small>mdi-tools</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                      <v-list-item-title>{{ tool }}</v-list-item-title>
                    </v-list-item-content>
                    <v-list-item-action>
                      <v-chip small>{{ count }}</v-chip>
                    </v-list-item-action>
                  </v-list-item>
                </v-list>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <v-divider class="my-4"></v-divider>

        <!-- Problem Tools -->
        <v-row>
          <v-col cols="12">
            <v-card outlined>
              <v-card-title class="subtitle-1">
                Tools with Most Validation Errors
                <v-spacer></v-spacer>
                <v-btn small text color="primary" @click="showRecommendations = true">
                  View Recommendations
                </v-btn>
              </v-card-title>
              <v-card-text>
                <v-data-table
                  :headers="problemToolHeaders"
                  :items="problemTools"
                  :items-per-page="5"
                  dense
                >
                  <template v-slot:item.errorRate="{ item }">
                    <v-chip
                      :color="item.errorRate > 0.5 ? 'error' : item.errorRate > 0.2 ? 'warning' : 'success'"
                      small
                    >
                      {{ (item.errorRate * 100).toFixed(0) }}%
                    </v-chip>
                  </template>
                  <template v-slot:item.actions="{ item }">
                    <v-btn
                      small
                      text
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
            <v-card outlined>
              <v-card-title class="subtitle-1">Recovery Time Analysis</v-card-title>
              <v-card-text>
                <canvas ref="recoveryChart"></canvas>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Recommendations Dialog -->
    <v-dialog v-model="showRecommendations" max-width="800">
      <v-card>
        <v-card-title>
          Validation Improvement Recommendations
          <v-spacer></v-spacer>
          <v-btn icon @click="showRecommendations = false">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-card-text>
          <v-list>
            <v-list-item
              v-for="(rec, idx) in recommendations"
              :key="idx"
              three-line
            >
              <v-list-item-icon>
                <v-icon :color="getPriorityColor(rec.priority)">
                  {{ getPriorityIcon(rec.priority) }}
                </v-icon>
              </v-list-item-icon>
              <v-list-item-content>
                <v-list-item-title>{{ rec.action }}</v-list-item-title>
                <v-list-item-subtitle>
                  Expected: {{ rec.expectedImprovement }}
                </v-list-item-subtitle>
                <v-list-item-subtitle>
                  Tools: {{ rec.tools.join(', ') }}
                </v-list-item-subtitle>
              </v-list-item-content>
            </v-list-item>
          </v-list>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

export default {
  name: 'ValidationMetrics',
  
  props: {
    agentId: {
      type: String,
      required: true
    },
    channelId: {
      type: String,
      required: true
    }
  },

  data() {
    return {
      validationHealth: 0.75,
      totalErrors: 0,
      selfCorrectionRate: 0,
      helpToolUsage: 0,
      errorTypes: {
        missingRequired: 0,
        unknownProperties: 0,
        typeMismatch: 0,
        constraintViolation: 0,
        other: 0
      },
      helpTools: {
        tool_help: 0,
        tool_validate: 0,
        tool_quick_reference: 0,
        tool_validation_tips: 0
      },
      problemTools: [],
      recommendations: [],
      showRecommendations: false,
      recoveryChart: null,
      problemToolHeaders: [
        { text: 'Tool', value: 'tool' },
        { text: 'Error Rate', value: 'errorRate' },
        { text: 'Common Errors', value: 'commonErrors' },
        { text: 'Actions', value: 'actions', sortable: false }
      ]
    };
  },

  computed: {
    healthScoreColor() {
      if (this.validationHealth >= 0.8) return 'success--text';
      if (this.validationHealth >= 0.6) return 'warning--text';
      return 'error--text';
    }
  },

  mounted() {
    this.loadValidationMetrics();
    this.setupRecoveryChart();
    this.startMetricsPolling();
  },

  beforeDestroy() {
    this.stopMetricsPolling();
    if (this.recoveryChart) {
      this.recoveryChart.destroy();
    }
  },

  methods: {
    async loadValidationMetrics() {
      try {
        // Fetch validation metrics from API
        const response = await this.$axios.get(
          `/api/analytics/validation/${this.agentId}/${this.channelId}`
        );
        
        const data = response.data;
        
        // Update metrics
        this.validationHealth = data.validationHealth || 0.75;
        this.totalErrors = data.totalErrors || 0;
        this.selfCorrectionRate = Math.round((data.selfCorrectionRate || 0) * 100);
        this.helpToolUsage = Object.values(data.helpToolUsage || {})
          .reduce((a, b) => a + b, 0);
        
        // Update error types
        if (data.errorTypes) {
          this.errorTypes = data.errorTypes;
        }
        
        // Update help tools
        if (data.helpToolUsage) {
          this.helpTools = data.helpToolUsage;
        }
        
        // Update problem tools
        if (data.problemAreas) {
          this.problemTools = data.problemAreas.map(area => ({
            ...area,
            commonErrors: area.commonErrors.join(', ')
          }));
        }
        
        // Update recommendations
        if (data.recommendations) {
          this.recommendations = data.recommendations;
        }
        
        // Update recovery chart
        this.updateRecoveryChart(data.recoveryTimes);
        
      } catch (error) {
        console.error('Error loading validation metrics:', error);
      }
    },

    setupRecoveryChart() {
      const ctx = this.$refs.recoveryChart?.getContext('2d');
      if (!ctx) return;

      this.recoveryChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [{
            label: 'Recovery Time (seconds)',
            data: [],
            backgroundColor: 'rgba(33, 150, 243, 0.6)',
            borderColor: 'rgba(33, 150, 243, 1)',
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
    },

    updateRecoveryChart(recoveryTimes) {
      if (!this.recoveryChart || !recoveryTimes) return;

      const sortedTools = Object.entries(recoveryTimes.byTool || {})
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10);

      this.recoveryChart.data.labels = sortedTools.map(([tool]) => tool);
      this.recoveryChart.data.datasets[0].data = sortedTools.map(([, time]) => 
        (time / 1000).toFixed(2)
      );
      
      this.recoveryChart.update();
    },

    formatErrorType(type) {
      const formatted = {
        missingRequired: 'Missing Required',
        unknownProperties: 'Unknown Properties',
        typeMismatch: 'Type Mismatch',
        constraintViolation: 'Constraint Violation',
        other: 'Other'
      };
      return formatted[type] || type;
    },

    getErrorTypeColor(type) {
      const colors = {
        missingRequired: 'error',
        unknownProperties: 'warning',
        typeMismatch: 'orange',
        constraintViolation: 'purple',
        other: 'grey'
      };
      return colors[type] || 'grey';
    },

    getPriorityColor(priority) {
      const colors = {
        high: 'error',
        medium: 'warning',
        low: 'info'
      };
      return colors[priority] || 'grey';
    },

    getPriorityIcon(priority) {
      const icons = {
        high: 'mdi-alert-circle',
        medium: 'mdi-alert',
        low: 'mdi-information'
      };
      return icons[priority] || 'mdi-help-circle';
    },

    viewToolDetails(tool) {
      // Navigate to tool details or show dialog
      console.log('View details for:', tool);
    },

    startMetricsPolling() {
      this.pollingInterval = setInterval(() => {
        this.loadValidationMetrics();
      }, 30000); // Poll every 30 seconds
    },

    stopMetricsPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
      }
    }
  }
};
</script>

<style scoped>
.validation-metrics {
  height: 100%;
}

canvas {
  max-height: 300px;
}
</style>