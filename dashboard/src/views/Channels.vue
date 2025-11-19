<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useChannelsStore } from '../stores/channels';

const route = useRoute();
const router = useRouter();
const channelsStore = useChannelsStore();

// Tab navigation
const tabs = [
    { name: 'Memory', route: 'memory', icon: 'mdi-brain' },
    { name: 'Context', route: 'context', icon: 'mdi-text-box-multiple' },
    { name: 'Docs', route: 'docs', icon: 'mdi-file-document-multiple' },
    { name: 'Agents', route: 'agents', icon: 'mdi-robot' },
    { name: 'Tools', route: 'tools', icon: 'mdi-tools' },
    { name: 'Tasks', route: 'tasks', icon: 'mdi-clipboard-list' }
];

// Computed properties using channels store
const selectedChannelData = computed(() => {
    return channelsStore.selectedChannel;
});

const activeTab = computed(() => {
    const currentPath = route.path;
    // Extract the last segment of the path to match against tab routes
    const pathSegments = currentPath.split('/').filter(Boolean);
    const lastSegment = pathSegments[pathSegments.length - 1];
    return tabs.find(tab => tab.route === lastSegment)?.name || 'Memory';
});

// Channel methods using real backend API
const switchChannel = async (channelId: string): Promise<void> => {
    channelsStore.setSelectedChannel(channelId);
    await channelsStore.fetchChannelById(channelId);
};

// Dialog state
const createChannelDialog = ref(false);
const newChannelName = ref('');
const newChannelDescription = ref('');
const newChannelId = ref('');

// Channel key generation state
const generatedChannelKey = ref<{ keyId: string; secretKey: string; tempChannelId: string } | null>(null);
const keyGenerationLoading = ref(false);

// Generate channel ID preview from name
const previewChannelId = computed(() => {
    if (!newChannelName.value.trim()) return '';
    return newChannelName.value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
        .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
        .substring(0, 50); // Limit length
});

// Channel creation with real API call
const createChannel = async (): Promise<void> => {
    if (!newChannelName.value.trim()) return;
    
    const channelData = {
        name: newChannelName.value,
        description: newChannelDescription.value || undefined,
        ...(newChannelId.value && { channelId: newChannelId.value })
    };
    
    const createdChannel = await channelsStore.createChannel(channelData);
    
    if (createdChannel) {
        // Associate the generated key with the actual channel
        if (generatedChannelKey.value) {
            try {
                await fetch(`/api/channel-keys/${generatedChannelKey.value.keyId}/associate`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify({ channelId: createdChannel.id })
                });
            } catch (error) {
                console.error('Error associating channel key:', error);
            }
        }
        
        // Clear form and close dialog
        newChannelName.value = '';
        newChannelDescription.value = '';
        newChannelId.value = '';
        generatedChannelKey.value = null;
        createChannelDialog.value = false;
        
        // Select the newly created channel
        channelsStore.setSelectedChannel(createdChannel.id);
    }
};

// Refresh functionality with real API call
const refreshChannel = async (): Promise<void> => {
    await channelsStore.fetchChannels();
    if (channelsStore.selectedChannelId) {
        await channelsStore.fetchChannelMetrics(channelsStore.selectedChannelId);
    }
};

// Generate channel keys for preview
const generateChannelKeys = async (): Promise<void> => {
    if (!newChannelName.value.trim()) return;
    
    keyGenerationLoading.value = true;
    try {
        const response = await fetch('/api/channel-keys/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ channelName: newChannelName.value })
        });
        
        if (response.ok) {
            const data = await response.json();
            generatedChannelKey.value = {
                keyId: data.data.keyId,
                secretKey: data.data.secretKey,
                tempChannelId: data.data.tempChannelId
            };
        } else {
            console.error('Failed to generate channel key');
        }
    } catch (error) {
        console.error('Error generating channel key:', error);
    } finally {
        keyGenerationLoading.value = false;
    }
};

// Cleanup unused channel keys
const cleanupChannelKeys = async (): Promise<void> => {
    if (!generatedChannelKey.value) return;
    
    try {
        await fetch(`/api/channel-keys/cleanup/${generatedChannelKey.value.keyId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
    } catch (error) {
        console.error('Error cleaning up channel key:', error);
    }
    
    generatedChannelKey.value = null;
};

// Regenerate channel keys manually
const regenerateChannelKeys = async (): Promise<void> => {
    if (generatedChannelKey.value) {
        await cleanupChannelKeys();
    }
    await generateChannelKeys();
};

// Initialize component with real API calls
onMounted(async () => {
    await channelsStore.fetchChannels();
    
    // Set initial selected channel
    if (channelsStore.channels.length > 0 && !channelsStore.selectedChannelId) {
        channelsStore.setSelectedChannel(channelsStore.channels[0].id);
    }
});

// Loading states
const loading = ref(false);
const channelLoading = ref(false);

// Watchers for dialog state and key generation
watch(createChannelDialog, async (isOpen, wasOpen) => {
    if (!isOpen && wasOpen) {
        // Dialog closed - cleanup any unused keys
        await cleanupChannelKeys();
    }
});

// Regenerate keys when channel name changes (if keys already exist)
watch(newChannelName, async (newName, oldName) => {
    if (createChannelDialog.value && generatedChannelKey.value && newName.trim() && newName !== oldName) {
        // Only regenerate if keys already exist and name actually changed
        await generateChannelKeys();
    }
});

// Copy to clipboard functionality
const copyToClipboard = async (text: string): Promise<void> => {
    try {
        await navigator.clipboard.writeText(text);
        // Could add toast/snackbar notification here
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
    }
};

// Navigate to tab using path parameters
const navigateToTab = (tabRoute: string): void => {
    const channelId = selectedChannelData.value?.id || channelsStore.selectedChannelId;
    if (channelId) {
        router.push(`/dashboard/channels/${channelId}/${tabRoute}`);
    }
};
</script>

<template>
    <div class="channels-container">
        <!-- Header Section -->
        <div class="channels-header mb-6">
            <div class="d-flex align-center justify-space-between mb-4">
                <div>
                    <h1 class="text-h4 mb-2">Channel Management</h1>
                    <p class="text-body-1 text-medium-emphasis">
                        Manage agents, tools, memory, and context across communication channels
                    </p>
                </div>
                <div class="d-flex align-center gap-3">
                    <v-btn
                        variant="outlined"
                        prepend-icon="mdi-refresh"
                        :loading="channelLoading"
                        @click="refreshChannel"
                    >
                        Refresh
                    </v-btn>
                    <v-btn
                        color="primary"
                        prepend-icon="mdi-plus"
                        @click="createChannelDialog = true"
                    >
                        New Channel
                    </v-btn>
                </div>
            </div>

            <!-- Channel Selection & Metrics -->
            <v-row>
                <!-- Channel Selector -->
                <v-col cols="12" md="4">
                    <v-card elevation="0" class="channel-selector">
                        <v-card-text>
                            <div class="d-flex align-center justify-space-between mb-3">
                                <span class="text-body-2 text-medium-emphasis">Active Channel</span>
                                <v-chip
                                    :color="selectedChannelData?.status === 'active' ? 'success' : 'warning'"
                                    size="small"
                                    variant="tonal"
                                >
                                    {{ selectedChannelData?.status || 'inactive' }}
                                </v-chip>
                            </div>
                            <v-select
                                v-model="channelsStore.selectedChannelId"
                                :items="channelsStore.channels"
                                item-title="name"
                                item-value="id"
                                variant="outlined"
                                density="comfortable"
                                :loading="loading"
                                @update:model-value="switchChannel"
                            >
                                <template #item="{ props, item }">
                                    <v-list-item v-bind="props" :key="item.raw.id">
                                        <template #prepend>
                                            <v-avatar size="32" color="primary">
                                                <v-icon>mdi-pound</v-icon>
                                            </v-avatar>
                                        </template>
                                        <template #append>
                                            <v-chip
                                                :color="item.raw.status === 'active' ? 'success' : 'warning'"
                                                size="small"
                                                variant="tonal"
                                            >
                                                {{ item.raw.participants }}
                                            </v-chip>
                                        </template>
                                    </v-list-item>
                                </template>
                            </v-select>
                        </v-card-text>
                    </v-card>
                </v-col>

                <!-- Channel Metrics -->
                <v-col cols="12" md="8">
                    <v-card elevation="0" class="metrics-card">
                        <v-card-text>
                            <v-row>
                                <v-col cols="6" sm="3">
                                    <div class="metric-item">
                                        <div class="metric-icon mb-2">
                                            <v-icon color="primary">mdi-message-text</v-icon>
                                        </div>
                                        <div class="metric-value">{{ channelsStore.channelMetrics.totalMessages.toLocaleString() }}</div>
                                        <div class="metric-label">Messages</div>
                                    </div>
                                </v-col>
                                <v-col cols="6" sm="3">
                                    <div class="metric-item">
                                        <div class="metric-icon mb-2">
                                            <v-icon color="success">mdi-robot</v-icon>
                                        </div>
                                        <div class="metric-value">{{ channelsStore.channelMetrics.activeAgents }}</div>
                                        <div class="metric-label">Active Agents</div>
                                    </div>
                                </v-col>
                                <v-col cols="6" sm="3">
                                    <div class="metric-item">
                                        <div class="metric-icon mb-2">
                                            <v-icon color="warning">mdi-check-circle</v-icon>
                                        </div>
                                        <div class="metric-value">{{ channelsStore.channelMetrics.completedTasks }}</div>
                                        <div class="metric-label">Tasks</div>
                                    </div>
                                </v-col>
                                <v-col cols="6" sm="3">
                                    <div class="metric-item">
                                        <div class="metric-icon mb-2">
                                            <v-icon color="info">mdi-clock-fast</v-icon>
                                        </div>
                                        <div class="metric-value">{{ channelsStore.channelMetrics.avgResponseTime }}s</div>
                                        <div class="metric-label">Avg Response</div>
                                    </div>
                                </v-col>
                            </v-row>
                        </v-card-text>
                    </v-card>
                </v-col>
            </v-row>
        </div>

        <!-- Navigation Tabs -->
        <div class="channel-navigation mb-6">
            <v-card elevation="0" class="nav-card">
                <v-tabs
                    :model-value="activeTab"
                    color="primary"
                    grow
                    show-arrows
                >
                    <v-tab
                        v-for="tab in tabs"
                        :key="tab.name"
                        :value="tab.name"
                        @click="navigateToTab(tab.route)"
                    >
                        <v-icon class="mr-2">{{ tab.icon }}</v-icon>
                        {{ tab.name }}
                    </v-tab>
                </v-tabs>
            </v-card>
        </div>

        <!-- Content Area -->
        <div class="channel-content">
            <div v-if="channelLoading" class="content-loading">
                <v-card elevation="0" class="pa-8 text-center">
                    <v-progress-circular
                        indeterminate
                        color="primary"
                        size="64"
                    />
                    <p class="text-body-1 mt-4">Loading channel data...</p>
                </v-card>
            </div>
            <router-view v-else v-slot="{ Component }">
                <v-fade-transition mode="out-in">
                    <component :is="Component" :channel="selectedChannelData" />
                </v-fade-transition>
            </router-view>
        </div>
    </div>

    <!-- Create Channel Dialog -->
    <v-dialog v-model="createChannelDialog" max-width="500">
        <v-card>
            <v-card-title>
                <span class="text-h5">Create New Channel</span>
            </v-card-title>
            <v-card-text>
                <v-container>
                    <v-row>
                        <v-col cols="12">
                            <v-text-field
                                v-model="newChannelName"
                                label="Channel Name*"
                                variant="outlined"
                                :error-messages="!newChannelName.trim() && newChannelName ? ['Channel name is required'] : []"
                                required
                            />
                        </v-col>
                        <v-col cols="12">
                            <v-text-field
                                :model-value="newChannelId || previewChannelId"
                                @update:model-value="newChannelId = $event"
                                label="Channel ID"
                                variant="outlined"
                                :placeholder="previewChannelId"
                                hint="Auto-generated from name, but you can customize it"
                                persistent-hint
                            />
                        </v-col>
                        <v-col cols="12">
                            <v-textarea
                                v-model="newChannelDescription"
                                label="Description (optional)"
                                variant="outlined"
                                rows="3"
                                no-resize
                            />
                        </v-col>
                        
                        <!-- Channel Authentication Keys Section -->
                        <v-col cols="12">
                            <v-card elevation="0" class="pa-4" style="background-color: rgba(var(--v-theme-primary), 0.05); border: 1px solid rgba(var(--v-theme-primary), 0.2);">
                                <div class="d-flex align-center justify-space-between mb-3">
                                    <h4 class="text-subtitle-1">Channel Authentication Keys</h4>
                                    <v-btn
                                        v-if="generatedChannelKey"
                                        size="small"
                                        variant="outlined"
                                        color="primary"
                                        :loading="keyGenerationLoading"
                                        @click="regenerateChannelKeys"
                                    >
                                        Regenerate
                                    </v-btn>
                                </div>
                                
                                <div v-if="keyGenerationLoading" class="text-center py-4">
                                    <v-progress-circular
                                        indeterminate
                                        color="primary"
                                        size="32"
                                    />
                                    <div class="mt-2 text-body-2">Generating keys...</div>
                                </div>
                                
                                <div v-else-if="generatedChannelKey">
                                    <div class="mb-3">
                                        <label class="text-caption text-medium-emphasis">Key ID</label>
                                        <div class="d-flex align-center mt-1">
                                            <v-text-field
                                                :model-value="generatedChannelKey.keyId"
                                                readonly
                                                variant="outlined"
                                                density="compact"
                                                hide-details
                                                class="flex-grow-1 mr-2"
                                            />
                                            <v-btn
                                                icon="mdi-content-copy"
                                                size="small"
                                                variant="text"
                                                @click="copyToClipboard(generatedChannelKey.keyId)"
                                            />
                                        </div>
                                    </div>
                                    
                                    <div class="mb-3">
                                        <label class="text-caption text-medium-emphasis">Secret Key</label>
                                        <div class="d-flex align-center mt-1">
                                            <v-text-field
                                                :model-value="generatedChannelKey.secretKey"
                                                readonly
                                                variant="outlined"
                                                density="compact"
                                                hide-details
                                                class="flex-grow-1 mr-2"
                                                type="password"
                                            />
                                            <v-btn
                                                icon="mdi-content-copy"
                                                size="small"
                                                variant="text"
                                                @click="copyToClipboard(generatedChannelKey.secretKey)"
                                            />
                                        </div>
                                    </div>
                                    
                                    <v-alert
                                        type="info"
                                        variant="tonal"
                                        density="compact"
                                    >
                                        <template #text>
                                            <span class="text-caption">
                                                These keys will be associated with your channel upon creation. 
                                                Save them securely as they won't be shown again.
                                            </span>
                                        </template>
                                    </v-alert>
                                </div>
                                
                                <div v-else class="text-center py-4">
                                    <v-icon color="primary" size="48" class="mb-3">mdi-key-plus</v-icon>
                                    <div class="text-h6 mb-2">Channel Authentication Keys</div>
                                    <div class="text-body-2 text-medium-emphasis mb-4">Generate secure keys for your channel to enable authentication</div>
                                    <v-btn
                                        color="primary"
                                        variant="flat"
                                        :disabled="!newChannelName.trim()"
                                        :loading="keyGenerationLoading"
                                        @click="generateChannelKeys"
                                    >
                                        Generate Keys
                                    </v-btn>
                                    <div v-if="!newChannelName.trim()" class="text-caption text-medium-emphasis mt-2">
                                        Enter a channel name first to generate keys
                                    </div>
                                </div>
                            </v-card>
                        </v-col>
                    </v-row>
                </v-container>
                <small class="text-caption">*indicates required field</small>
            </v-card-text>
            <v-card-actions>
                <v-spacer />
                <v-btn
                    color="grey"
                    variant="text"
                    @click="createChannelDialog = false"
                >
                    Cancel
                </v-btn>
                <v-btn
                    color="primary"
                    variant="flat"
                    :disabled="!newChannelName.trim()"
                    :loading="channelsStore.loading"
                    @click="createChannel"
                >
                    Create Channel
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<style scoped>
.channels-container {
    max-width: 1400px;
    margin: 0 auto;
}

.channel-selector,
.metrics-card,
.nav-card {
    background: var(--v-theme-card-bg);
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.metric-item {
    text-align: center;
    padding: 0.5rem;
}

.metric-icon {
    display: flex;
    justify-content: center;
}

.metric-value {
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.2;
    margin-bottom: 0.25rem;
}

.metric-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
}

.channel-navigation {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--v-theme-surface);
    padding-top: 1rem;
    margin-top: -1rem;
}

.content-loading {
    min-height: 400px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.gap-3 {
    gap: 0.75rem;
}

/* Responsive adjustments */
@media (max-width: 768px) {
    .channels-header .d-flex {
        flex-direction: column;
        align-items: stretch;
        gap: 1rem;
    }
    
    .metric-value {
        font-size: 1.25rem;
    }
}
</style>
