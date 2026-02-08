<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import axios from '../../plugins/axios';

// State
const loading = ref(false);
const healthStatus = ref<{ success: boolean; status: string; service: string; timestamp: number } | null>(null);
const testResult = ref<{ success: boolean; message: string; data?: any } | null>(null);

// Snackbar
const snackbar = ref(false);
const snackbarMessage = ref('');
const snackbarColor = ref('success');

// Test dialog
const testDialogOpen = ref(false);
const selectedEndpoint = ref('task');
const testPayload = ref('');

// Webhook endpoints documentation
const webhookEndpoints = [
    {
        name: 'Task Creation',
        method: 'POST',
        path: '/api/webhooks/n8n/task',
        description: 'Create a single task from n8n workflow',
        fields: [
            { name: 'channelId', type: 'string', required: true, description: 'Target channel ID' },
            { name: 'title', type: 'string', required: true, description: 'Task title' },
            { name: 'description', type: 'string', required: true, description: 'Task description' },
            { name: 'assignTo', type: 'string', required: false, description: 'Agent ID to assign (optional)' },
            { name: 'priority', type: 'string', required: false, description: 'low | medium | high | urgent (default: medium)' },
            { name: 'coordinationMode', type: 'string', required: false, description: 'collaborative | sequential | hierarchical' },
            { name: 'metadata', type: 'object', required: false, description: 'Additional metadata' }
        ],
        example: {
            channelId: 'content-distribution',
            title: 'Weather Alert: Heavy Rain',
            description: 'Create and distribute weather advisory',
            assignTo: 'content-distributor',
            priority: 'high',
            metadata: {
                source: 'weather-api',
                temperature: 45,
                conditions: 'heavy rain'
            }
        }
    },
    {
        name: 'Batch Task Creation',
        method: 'POST',
        path: '/api/webhooks/n8n/task/batch',
        description: 'Create a single task with multiple items (prevents race conditions)',
        fields: [
            { name: 'channelId', type: 'string', required: true, description: 'Target channel ID' },
            { name: 'title', type: 'string', required: true, description: 'Task title' },
            { name: 'description', type: 'string', required: true, description: 'Task description' },
            { name: 'items', type: 'array', required: true, description: 'Array of items to process' },
            { name: 'assignTo', type: 'string', required: false, description: 'Agent ID to assign' },
            { name: 'priority', type: 'string', required: false, description: 'Task priority' }
        ],
        example: {
            channelId: 'solar-storm-response',
            title: 'Multiple Solar Storms Detected',
            description: 'Process multiple storms in coordinated response',
            assignTo: 'storm-coordinator',
            priority: 'high',
            items: [
                { stormId: 'GST-001', kpIndex: 6.67, startTime: '2024-01-15T10:00:00Z' },
                { stormId: 'GST-002', kpIndex: 7.33, startTime: '2024-01-15T11:30:00Z' }
            ]
        }
    },
    {
        name: 'Custom Event',
        method: 'POST',
        path: '/api/webhooks/n8n/event',
        description: 'Trigger custom events in MXF from external workflows',
        fields: [
            { name: 'channelId', type: 'string', required: true, description: 'Target channel ID' },
            { name: 'eventType', type: 'string', required: true, description: 'Custom event type name' },
            { name: 'data', type: 'object', required: false, description: 'Event payload data' }
        ],
        example: {
            channelId: 'devops-channel',
            eventType: 'deployment_completed',
            data: {
                repository: 'mxf-production',
                branch: 'main',
                commit: 'abc123',
                status: 'success'
            }
        }
    },
    {
        name: 'Direct Message',
        method: 'POST',
        path: '/api/webhooks/n8n/message',
        description: 'Send messages directly to agents or channels',
        fields: [
            { name: 'channelId', type: 'string', required: true, description: 'Target channel ID' },
            { name: 'message', type: 'string', required: true, description: 'Message content' },
            { name: 'agentId', type: 'string', required: false, description: 'Specific agent ID (optional, defaults to broadcast)' },
            { name: 'metadata', type: 'object', required: false, description: 'Message metadata' }
        ],
        example: {
            channelId: 'team-channel',
            agentId: 'scheduler-agent',
            message: 'Daily standup in 15 minutes',
            metadata: {
                type: 'reminder',
                importance: 'high'
            }
        }
    },
    {
        name: 'Health Check',
        method: 'GET',
        path: '/api/webhooks/n8n/health',
        description: 'Verify webhook connectivity',
        fields: [],
        example: null
    }
];

// Payload templates for common integrations
const payloadTemplates = [
    {
        name: 'GitHub Webhook',
        description: 'Transform GitHub webhook data for MXF task creation',
        template: `{
  "channelId": "devops-channel",
  "title": "PR Review: {{ $json.pull_request.title }}",
  "description": "Review pull request #{{ $json.number }} in {{ $json.repository.name }}",
  "priority": "medium",
  "metadata": {
    "source": "github",
    "prUrl": "{{ $json.pull_request.html_url }}",
    "author": "{{ $json.pull_request.user.login }}"
  }
}`
    },
    {
        name: 'Slack Alert',
        description: 'Forward Slack mentions as MXF tasks',
        template: `{
  "channelId": "notifications-channel",
  "title": "Slack Alert: {{ $json.event.text | truncate(50) }}",
  "description": "Slack message from {{ $json.event.user }}",
  "priority": "medium",
  "metadata": {
    "source": "slack",
    "slackChannel": "{{ $json.event.channel }}",
    "timestamp": "{{ $json.event.ts }}"
  }
}`
    },
    {
        name: 'Scheduled Task',
        description: 'Create recurring tasks from schedule trigger',
        template: `{
  "channelId": "maintenance-channel",
  "title": "Daily Report Generation",
  "description": "Generate and distribute daily system reports",
  "priority": "low",
  "coordinationMode": "sequential",
  "metadata": {
    "source": "scheduler",
    "scheduledAt": "{{ $now.toISO() }}",
    "recurring": true
  }
}`
    },
    {
        name: 'External API Response',
        description: 'Process external API data as MXF tasks',
        template: `{
  "channelId": "data-processing",
  "title": "Process API Data: {{ $json.dataType }}",
  "description": "New data received from external API requiring processing",
  "priority": "{{ $json.priority || 'medium' }}",
  "metadata": {
    "source": "external-api",
    "dataId": "{{ $json.id }}",
    "receivedAt": "{{ $now.toISO() }}"
  }
}`
    }
];

// n8n workflow examples
const workflowExamples = [
    {
        name: 'Weather Alert Pipeline',
        description: 'Monitor weather API and create tasks for alerts',
        steps: [
            'Schedule Trigger (every 15 min)',
            'HTTP Request to Weather API',
            'IF: Check for severe weather',
            'HTTP Request to MXF /task webhook'
        ]
    },
    {
        name: 'GitHub PR Review',
        description: 'Auto-assign PR reviews to MXF agents',
        steps: [
            'GitHub Trigger (pull_request opened)',
            'Set: Transform PR data',
            'HTTP Request to MXF /task webhook'
        ]
    },
    {
        name: 'Daily Report Generation',
        description: 'Scheduled task creation for recurring reports',
        steps: [
            'Cron Trigger (daily at 9 AM)',
            'Set: Build task payload',
            'HTTP Request to MXF /task webhook'
        ]
    }
];

// Check health
const checkHealth = async (): Promise<void> => {
    loading.value = true;
    try {
        const response = await axios.get('/api/webhooks/n8n/health');
        healthStatus.value = response.data;
        showSnackbar('Webhook service is healthy', 'success');
    } catch (err: any) {
        console.error('Health check failed:', err);
        healthStatus.value = { success: false, status: 'offline', service: 'n8n-webhooks', timestamp: Date.now() };
        showSnackbar('Webhook service is offline', 'error');
    } finally {
        loading.value = false;
    }
};

// Open test dialog
const openTestDialog = (endpointPath: string): void => {
    const endpoint = webhookEndpoints.find(e => e.path === endpointPath);
    if (endpoint) {
        selectedEndpoint.value = endpointPath;
        testPayload.value = endpoint.example ? JSON.stringify(endpoint.example, null, 2) : '';
        testDialogOpen.value = true;
    }
};

// Test webhook
const testWebhook = async (): Promise<void> => {
    loading.value = true;
    testResult.value = null;

    try {
        let payload = {};
        if (testPayload.value) {
            payload = JSON.parse(testPayload.value);
        }

        const endpoint = webhookEndpoints.find(e => e.path === selectedEndpoint.value);
        const method = endpoint?.method?.toLowerCase() || 'post';

        let response;
        if (method === 'get') {
            response = await axios.get(selectedEndpoint.value);
        } else {
            response = await axios.post(selectedEndpoint.value, payload);
        }

        testResult.value = {
            success: true,
            message: 'Webhook test successful',
            data: response.data
        };
        showSnackbar('Webhook test successful', 'success');
    } catch (err: any) {
        console.error('Webhook test failed:', err);
        testResult.value = {
            success: false,
            message: err.response?.data?.message || err.message || 'Webhook test failed',
            data: err.response?.data
        };
        showSnackbar('Webhook test failed', 'error');
    } finally {
        loading.value = false;
    }
};

// Copy to clipboard
const copyToClipboard = (text: string): void => {
    navigator.clipboard.writeText(text);
    showSnackbar('Copied to clipboard', 'success');
};

// Format JSON for display
const formatJson = (obj: any): string => {
    return JSON.stringify(obj, null, 2);
};

// Snackbar helper
const showSnackbar = (message: string, color: string): void => {
    snackbarMessage.value = message;
    snackbarColor.value = color;
    snackbar.value = true;
};

// Initialize
onMounted(async () => {
    await checkHealth();
});
</script>

<template>
    <div class="admin-webhooks">
        <!-- Header Section -->
        <div class="d-flex align-center justify-space-between mb-6">
            <div>
                <h2 class="text-h4 mb-2">
                    <v-icon class="mr-3" size="32">mdi-webhook</v-icon>
                    n8n Webhook Integration
                </h2>
                <p class="text-subtitle-1 text-medium-emphasis">
                    Webhook endpoints for n8n workflows to trigger MXF actions
                </p>
            </div>
            <div class="d-flex gap-2 align-center">
                <v-chip
                    :color="healthStatus?.status === 'healthy' ? 'success' : 'error'"
                    variant="flat"
                    class="mr-2"
                >
                    <v-icon start size="16">
                        {{ healthStatus?.status === 'healthy' ? 'mdi-check-circle' : 'mdi-alert-circle' }}
                    </v-icon>
                    {{ healthStatus?.status === 'healthy' ? 'Online' : 'Offline' }}
                </v-chip>
                <v-btn
                    color="primary"
                    prepend-icon="mdi-refresh"
                    variant="elevated"
                    @click="checkHealth"
                    :loading="loading"
                >
                    Check Health
                </v-btn>
            </div>
        </div>

        <!-- Stats Cards -->
        <div class="d-flex gap-4 mb-6">
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="primary" size="32" class="mb-2">mdi-api</v-icon>
                    <div class="text-h5">{{ webhookEndpoints.length }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Endpoints</div>
                </v-card-text>
            </v-card>
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="success" size="32" class="mb-2">mdi-file-document-outline</v-icon>
                    <div class="text-h5">{{ payloadTemplates.length }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Templates</div>
                </v-card-text>
            </v-card>
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="info" size="32" class="mb-2">mdi-chart-timeline-variant</v-icon>
                    <div class="text-h5">{{ workflowExamples.length }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Example Workflows</div>
                </v-card-text>
            </v-card>
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon :color="healthStatus?.status === 'healthy' ? 'success' : 'error'" size="32" class="mb-2">
                        {{ healthStatus?.status === 'healthy' ? 'mdi-check-network' : 'mdi-close-network' }}
                    </v-icon>
                    <div class="text-h5">{{ healthStatus?.status === 'healthy' ? 'Active' : 'Down' }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Service Status</div>
                </v-card-text>
            </v-card>
        </div>

        <!-- Webhook Endpoints Section -->
        <v-card class="mb-6" elevation="2">
            <v-card-title class="d-flex align-center">
                <v-icon class="mr-2">mdi-api</v-icon>
                Webhook Endpoints
            </v-card-title>
            <v-card-text>
                <v-expansion-panels variant="accordion">
                    <v-expansion-panel
                        v-for="endpoint in webhookEndpoints"
                        :key="endpoint.path"
                    >
                        <v-expansion-panel-title>
                            <div class="d-flex align-center gap-3">
                                <v-chip
                                    :color="endpoint.method === 'GET' ? 'success' : 'primary'"
                                    size="small"
                                    variant="flat"
                                >
                                    {{ endpoint.method }}
                                </v-chip>
                                <code class="text-body-2">{{ endpoint.path }}</code>
                                <span class="text-medium-emphasis">{{ endpoint.name }}</span>
                            </div>
                        </v-expansion-panel-title>
                        <v-expansion-panel-text>
                            <p class="text-body-2 mb-4">{{ endpoint.description }}</p>

                            <!-- Fields Table -->
                            <div v-if="endpoint.fields.length > 0" class="mb-4">
                                <div class="text-subtitle-2 mb-2">Request Fields</div>
                                <v-table density="compact">
                                    <thead>
                                        <tr>
                                            <th>Field</th>
                                            <th>Type</th>
                                            <th>Required</th>
                                            <th>Description</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr v-for="field in endpoint.fields" :key="field.name">
                                            <td><code>{{ field.name }}</code></td>
                                            <td><v-chip size="x-small" color="grey">{{ field.type }}</v-chip></td>
                                            <td>
                                                <v-icon :color="field.required ? 'error' : 'grey'" size="16">
                                                    {{ field.required ? 'mdi-asterisk' : 'mdi-minus' }}
                                                </v-icon>
                                            </td>
                                            <td class="text-caption">{{ field.description }}</td>
                                        </tr>
                                    </tbody>
                                </v-table>
                            </div>

                            <!-- Example Payload -->
                            <div v-if="endpoint.example" class="mb-4">
                                <div class="d-flex align-center justify-space-between mb-2">
                                    <div class="text-subtitle-2">Example Payload</div>
                                    <v-btn
                                        size="x-small"
                                        variant="text"
                                        @click="copyToClipboard(formatJson(endpoint.example))"
                                    >
                                        <v-icon size="14">mdi-content-copy</v-icon>
                                        Copy
                                    </v-btn>
                                </div>
                                <pre class="text-caption pa-3 bg-grey-darken-3 rounded overflow-auto">{{ formatJson(endpoint.example) }}</pre>
                            </div>

                            <!-- Test Button -->
                            <v-btn
                                color="primary"
                                prepend-icon="mdi-play"
                                variant="outlined"
                                size="small"
                                @click="openTestDialog(endpoint.path)"
                            >
                                Test Endpoint
                            </v-btn>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                </v-expansion-panels>
            </v-card-text>
        </v-card>

        <!-- Payload Templates Section -->
        <v-card class="mb-6" elevation="2">
            <v-card-title class="d-flex align-center">
                <v-icon class="mr-2">mdi-file-document-outline</v-icon>
                Payload Templates
                <v-chip size="x-small" class="ml-2" color="info">n8n Expressions</v-chip>
            </v-card-title>
            <v-card-subtitle>
                Copy these templates into your n8n HTTP Request nodes
            </v-card-subtitle>
            <v-card-text>
                <v-row>
                    <v-col
                        v-for="template in payloadTemplates"
                        :key="template.name"
                        cols="12"
                        md="6"
                    >
                        <v-card variant="outlined" class="h-100">
                            <v-card-title class="text-subtitle-1">
                                {{ template.name }}
                            </v-card-title>
                            <v-card-subtitle>{{ template.description }}</v-card-subtitle>
                            <v-card-text>
                                <pre class="text-caption pa-2 bg-grey-darken-4 rounded overflow-auto webhooks__template-code">{{ template.template }}</pre>
                            </v-card-text>
                            <v-card-actions>
                                <v-spacer />
                                <v-btn
                                    size="small"
                                    variant="text"
                                    @click="copyToClipboard(template.template)"
                                >
                                    <v-icon size="14" class="mr-1">mdi-content-copy</v-icon>
                                    Copy Template
                                </v-btn>
                            </v-card-actions>
                        </v-card>
                    </v-col>
                </v-row>
            </v-card-text>
        </v-card>

        <!-- Workflow Examples Section -->
        <v-card elevation="2">
            <v-card-title class="d-flex align-center">
                <v-icon class="mr-2">mdi-chart-timeline-variant</v-icon>
                Example n8n Workflows
            </v-card-title>
            <v-card-subtitle>
                Common workflow patterns for integrating n8n with MXF
            </v-card-subtitle>
            <v-card-text>
                <v-row>
                    <v-col
                        v-for="workflow in workflowExamples"
                        :key="workflow.name"
                        cols="12"
                        md="4"
                    >
                        <v-card variant="tonal" color="primary" class="h-100">
                            <v-card-title class="text-subtitle-1">
                                <v-icon class="mr-2" size="20">mdi-graph</v-icon>
                                {{ workflow.name }}
                            </v-card-title>
                            <v-card-subtitle>{{ workflow.description }}</v-card-subtitle>
                            <v-card-text>
                                <v-timeline density="compact" side="end">
                                    <v-timeline-item
                                        v-for="(step, index) in workflow.steps"
                                        :key="index"
                                        :dot-color="index === workflow.steps.length - 1 ? 'success' : 'primary'"
                                        size="x-small"
                                    >
                                        <div class="text-caption">{{ step }}</div>
                                    </v-timeline-item>
                                </v-timeline>
                            </v-card-text>
                        </v-card>
                    </v-col>
                </v-row>
            </v-card-text>
        </v-card>

        <!-- Test Dialog -->
        <v-dialog v-model="testDialogOpen" max-width="700">
            <v-card>
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2">mdi-play</v-icon>
                    Test Webhook Endpoint
                </v-card-title>
                <v-card-text>
                    <v-alert v-if="!testPayload && selectedEndpoint.includes('health')" type="info" variant="tonal" class="mb-4">
                        This endpoint does not require a request body.
                    </v-alert>

                    <div class="mb-4">
                        <div class="text-subtitle-2 mb-2">Endpoint</div>
                        <code class="text-body-1">{{ selectedEndpoint }}</code>
                    </div>

                    <div v-if="testPayload" class="mb-4">
                        <div class="text-subtitle-2 mb-2">Request Payload</div>
                        <v-textarea
                            v-model="testPayload"
                            variant="outlined"
                            rows="10"
                            class="font-monospace"
                            placeholder="Enter JSON payload"
                        />
                    </div>

                    <v-alert v-if="testResult" :type="testResult.success ? 'success' : 'error'" variant="tonal" class="mb-4">
                        <div class="text-subtitle-2 mb-2">{{ testResult.message }}</div>
                        <pre v-if="testResult.data" class="text-caption bg-grey-darken-3 pa-2 rounded overflow-auto">{{ formatJson(testResult.data) }}</pre>
                    </v-alert>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="testDialogOpen = false">Close</v-btn>
                    <v-btn
                        color="primary"
                        variant="elevated"
                        prepend-icon="mdi-play"
                        @click="testWebhook"
                        :loading="loading"
                    >
                        Send Request
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Snackbar -->
        <v-snackbar
            v-model="snackbar"
            :color="snackbarColor"
            timeout="5000"
            location="top"
        >
            {{ snackbarMessage }}
            <template #actions>
                <v-btn variant="text" @click="snackbar = false">Close</v-btn>
            </template>
        </v-snackbar>
    </div>
</template>

<style scoped>
.admin-webhooks {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1rem;
}

.gap-4 {
    gap: 1rem;
}

.gap-3 {
    gap: 0.75rem;
}

.gap-2 {
    gap: 0.5rem;
}

.font-monospace {
    font-family: var(--font-mono);
}

pre {
    white-space: pre-wrap;
    word-break: break-word;
}

.webhooks__template-code {
    max-height: 200px;
}
</style>
