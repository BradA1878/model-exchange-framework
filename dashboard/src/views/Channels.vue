<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useChannelsStore } from '../stores/channels';
import axios from '../plugins/axios';
import HelpTooltip from '../components/HelpTooltip.vue';

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

// Channel ID validation state
const channelIdValidating = ref(false);
const channelIdError = ref<string | null>(null);
const channelIdValid = ref(true);

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

// Validate channel ID uniqueness
const validateChannelId = async (channelId: string): Promise<void> => {
    if (!channelId.trim()) {
        channelIdError.value = null;
        channelIdValid.value = true;
        return;
    }

    channelIdValidating.value = true;
    channelIdError.value = null;

    try {
        // Check if channel ID already exists by looking through existing channels
        const existingChannel = channelsStore.channels.find(
            ch => ch.id.toLowerCase() === channelId.toLowerCase()
        );

        if (existingChannel) {
            channelIdError.value = `Channel ID "${channelId}" is already in use`;
            channelIdValid.value = false;
        } else {
            channelIdValid.value = true;
        }
    } catch (error) {
        console.error('Error validating channel ID:', error);
        channelIdError.value = 'Error validating channel ID';
        channelIdValid.value = false;
    } finally {
        channelIdValidating.value = false;
    }
};

// Debounced channel ID validation
let channelIdValidationTimeout: ReturnType<typeof setTimeout> | null = null;
const debouncedValidateChannelId = (channelId: string): void => {
    if (channelIdValidationTimeout) {
        clearTimeout(channelIdValidationTimeout);
    }
    channelIdValidationTimeout = setTimeout(() => {
        validateChannelId(channelId);
    }, 300);
};

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
                await axios.put(`/api/channel-keys/${generatedChannelKey.value.keyId}/associate`, {
                    channelId: createdChannel.id
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
        const response = await axios.post('/api/channel-keys/generate', {
            channelName: newChannelName.value
        });

        generatedChannelKey.value = {
            keyId: response.data.data.keyId,
            secretKey: response.data.data.secretKey,
            tempChannelId: response.data.data.tempChannelId
        };
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
        await axios.delete(`/api/channel-keys/cleanup/${generatedChannelKey.value.keyId}`);
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
    <div class="channels-page">
    <div class="ch">

        <!-- ░░ Header Strip ░░ -->
        <header class="ch-header">
            <div class="ch-header__left">
                <h1 class="ch-header__title">Channel Management</h1>
                <span class="ch-header__divider">/</span>
                <span class="ch-header__sub">Agents, tools, memory &amp; context</span>
            </div>
            <div class="ch-header__actions">
                <button
                    class="ch-btn ch-btn--ghost"
                    :class="{ 'ch-btn--loading': channelLoading }"
                    @click="refreshChannel"
                    :disabled="channelLoading"
                >
                    <v-icon size="14">mdi-refresh</v-icon>
                    <span>Refresh</span>
                </button>
                <button class="ch-btn ch-btn--primary" @click="createChannelDialog = true">
                    <v-icon size="14">mdi-plus</v-icon>
                    <span>New Channel</span>
                </button>
            </div>
        </header>

        <!-- ░░ Channel Selector + Metrics Strip ░░ -->
        <section class="ch-topbar">
            <div class="ch-selector">
                <div class="ch-selector__head">
                    <span class="ch-selector__label">Active Channel</span>
                    <span
                        class="ch-status-dot"
                        :class="selectedChannelData?.status === 'active' ? 'ch-status-dot--ok' : 'ch-status-dot--warn'"
                    />
                </div>
                <v-select
                    v-model="channelsStore.selectedChannelId"
                    :items="channelsStore.channels"
                    item-title="name"
                    item-value="id"
                    variant="outlined"
                    density="compact"
                    hide-details
                    :loading="loading"
                    @update:model-value="switchChannel"
                    class="ch-selector__input"
                >
                    <template #item="{ props, item }">
                        <v-list-item v-bind="props" :key="item.raw.id">
                            <template #prepend>
                                <v-avatar size="28" color="primary">
                                    <v-icon size="14">mdi-pound</v-icon>
                                </v-avatar>
                            </template>
                            <template #append>
                                <v-chip
                                    :color="item.raw.status === 'active' ? 'success' : 'warning'"
                                    size="x-small"
                                    variant="tonal"
                                >
                                    {{ item.raw.participants }}
                                </v-chip>
                            </template>
                        </v-list-item>
                    </template>
                </v-select>
            </div>

            <div class="ch-metrics">
                <div class="ch-metric" data-accent="blue">
                    <div class="ch-metric__head">
                        <span class="ch-metric__label">Messages</span>
                        <v-icon size="13" class="ch-metric__ico">mdi-message-text-outline</v-icon>
                    </div>
                    <div class="ch-metric__number">{{ channelsStore.channelMetrics.totalMessages.toLocaleString() }}</div>
                </div>
                <div class="ch-metric" data-accent="green">
                    <div class="ch-metric__head">
                        <span class="ch-metric__label">Agents</span>
                        <v-icon size="13" class="ch-metric__ico">mdi-robot-outline</v-icon>
                    </div>
                    <div class="ch-metric__number">{{ channelsStore.channelMetrics.activeAgents }}</div>
                </div>
                <div class="ch-metric" data-accent="amber">
                    <div class="ch-metric__head">
                        <span class="ch-metric__label">Tasks</span>
                        <v-icon size="13" class="ch-metric__ico">mdi-check-circle-outline</v-icon>
                    </div>
                    <div class="ch-metric__number">{{ channelsStore.channelMetrics.completedTasks }}</div>
                </div>
                <div class="ch-metric" data-accent="cyan">
                    <div class="ch-metric__head">
                        <span class="ch-metric__label">Avg Response</span>
                        <v-icon size="13" class="ch-metric__ico">mdi-clock-fast</v-icon>
                    </div>
                    <div class="ch-metric__number">{{ channelsStore.channelMetrics.avgResponseTime }}<span class="ch-metric__unit">s</span></div>
                </div>
            </div>
        </section>

        <!-- ░░ Tab Navigation ░░ -->
        <nav class="ch-tabs">
            <button
                v-for="tab in tabs"
                :key="tab.name"
                class="ch-tab"
                :class="{ 'ch-tab--active': activeTab === tab.name }"
                @click="navigateToTab(tab.route)"
            >
                <v-icon size="16">{{ tab.icon }}</v-icon>
                <span>{{ tab.name }}</span>
            </button>
        </nav>

        <!-- ░░ Content Area ░░ -->
        <section class="ch-content">
            <div v-if="channelLoading" class="ch-loading">
                <v-progress-circular indeterminate color="primary" size="40" width="3" />
                <p class="ch-loading__text">Loading channel data…</p>
            </div>
            <router-view v-else v-slot="{ Component }">
                <v-fade-transition mode="out-in">
                    <component v-if="Component" :is="Component" :channel="selectedChannelData" />
                    <div v-else class="ch-empty">
                        <div class="ch-empty__icon">
                            <v-icon size="32" style="opacity: 0.3">mdi-forum-outline</v-icon>
                        </div>
                        <p class="ch-empty__title">Select a channel tab</p>
                        <p class="ch-empty__sub">Choose a tab above to view channel details</p>
                    </div>
                </v-fade-transition>
            </router-view>
        </section>
    </div>

    <!-- Create Channel Dialog -->
    <v-dialog v-model="createChannelDialog" max-width="520" content-class="ch-create-dialog">
        <div class="ch-dialog">
            <header class="ch-dialog__header">
                <h2 class="ch-dialog__title">Create New Channel</h2>
                <button class="ch-dialog__close" @click="createChannelDialog = false">
                    <v-icon size="18">mdi-close</v-icon>
                </button>
            </header>

            <div class="ch-dialog__body">
                <div class="ch-dialog__field">
                    <v-text-field
                        v-model="newChannelName"
                        label="Channel Name*"
                        variant="outlined"
                        density="compact"
                        :error-messages="!newChannelName.trim() && newChannelName ? ['Channel name is required'] : []"
                        required
                        hide-details="auto"
                    >
                        <template #append>
                            <HelpTooltip
                                text="A human-readable name for your channel. This will be displayed in the channel list."
                                docLink="http://mxf.dev/sdk/channels.html"
                            />
                        </template>
                    </v-text-field>
                </div>

                <div class="ch-dialog__field">
                    <v-text-field
                        :model-value="newChannelId || previewChannelId"
                        @update:model-value="(val: string) => { newChannelId = val; debouncedValidateChannelId(val || previewChannelId); }"
                        label="Channel ID"
                        variant="outlined"
                        density="compact"
                        :placeholder="previewChannelId"
                        :hint="channelIdError || 'Auto-generated from name, but you can customize it'"
                        persistent-hint
                        :error="!!channelIdError"
                        :loading="channelIdValidating"
                        :append-inner-icon="channelIdValid && !channelIdValidating && (newChannelId || previewChannelId) ? 'mdi-check-circle' : undefined"
                    >
                        <template #append>
                            <HelpTooltip
                                text="A unique identifier for this channel. Must be URL-safe (lowercase letters, numbers, and hyphens only)."
                                docLink="http://mxf.dev/sdk/channels.html#channel-id"
                            />
                        </template>
                    </v-text-field>
                </div>

                <div class="ch-dialog__field">
                    <v-textarea
                        v-model="newChannelDescription"
                        label="Description (optional)"
                        variant="outlined"
                        density="compact"
                        rows="3"
                        no-resize
                        hide-details
                    />
                </div>

                <!-- Channel Authentication Keys -->
                <div class="ch-dialog__keys">
                    <div class="ch-dialog__keys-header">
                        <span class="ch-dialog__keys-title">Channel Authentication Keys</span>
                        <button
                            v-if="generatedChannelKey"
                            class="ch-btn ch-btn--ghost ch-btn--xs"
                            :disabled="keyGenerationLoading"
                            @click="regenerateChannelKeys"
                        >
                            <v-icon size="12">mdi-refresh</v-icon>
                            <span>Regenerate</span>
                        </button>
                    </div>

                    <!-- Loading -->
                    <div v-if="keyGenerationLoading" class="ch-dialog__keys-loading">
                        <v-progress-circular indeterminate color="primary" size="24" width="2" />
                        <span>Generating keys…</span>
                    </div>

                    <!-- Generated Keys -->
                    <div v-else-if="generatedChannelKey" class="ch-dialog__keys-generated">
                        <div class="ch-dialog__key-field">
                            <label>Key ID</label>
                            <div class="ch-dialog__key-input">
                                <v-text-field
                                    :model-value="generatedChannelKey.keyId"
                                    readonly
                                    variant="outlined"
                                    density="compact"
                                    hide-details
                                />
                                <button class="ch-dialog__copy-btn" @click="copyToClipboard(generatedChannelKey.keyId)">
                                    <v-icon size="14">mdi-content-copy</v-icon>
                                </button>
                            </div>
                        </div>

                        <div class="ch-dialog__key-field">
                            <label>Secret Key</label>
                            <div class="ch-dialog__key-input">
                                <v-text-field
                                    :model-value="generatedChannelKey.secretKey"
                                    readonly
                                    variant="outlined"
                                    density="compact"
                                    hide-details
                                    type="password"
                                />
                                <button class="ch-dialog__copy-btn" @click="copyToClipboard(generatedChannelKey.secretKey)">
                                    <v-icon size="14">mdi-content-copy</v-icon>
                                </button>
                            </div>
                        </div>

                        <div class="ch-dialog__keys-notice">
                            <v-icon size="14" color="info">mdi-information-outline</v-icon>
                            <span>Keys will be associated on creation. Save them securely — they won't be shown again.</span>
                        </div>
                    </div>

                    <!-- Empty / Generate -->
                    <div v-else class="ch-dialog__keys-empty">
                        <v-icon size="32" style="opacity: 0.25; color: var(--ch-blue)">mdi-key-variant</v-icon>
                        <p>Generate secure keys for your channel to enable authentication</p>
                        <button
                            class="ch-btn ch-btn--primary ch-btn--sm"
                            :disabled="!newChannelName.trim()"
                            @click="generateChannelKeys"
                        >
                            <v-icon size="14">mdi-key-plus</v-icon>
                            <span>Generate Keys</span>
                        </button>
                        <span v-if="!newChannelName.trim()" class="ch-dialog__keys-hint">
                            Enter a channel name first to generate keys
                        </span>
                    </div>
                </div>

                <p class="ch-dialog__required-note">*indicates required field</p>
            </div>

            <footer class="ch-dialog__footer">
                <button class="ch-btn ch-btn--ghost" @click="createChannelDialog = false">Cancel</button>
                <button
                    class="ch-btn ch-btn--primary"
                    :disabled="!newChannelName.trim() || !channelIdValid || channelIdValidating"
                    @click="createChannel"
                >
                    <v-icon size="14">mdi-plus</v-icon>
                    <span>Create Channel</span>
                </button>
            </footer>
        </div>
    </v-dialog>
    </div>
</template>

<style scoped>
/* ════════════════════════════════════════════
   MXF Channel Management — Polished UI
   Matches Dashboard command-center aesthetic
   ════════════════════════════════════════════ */

.ch {
    --ch-blue: #4A90C2;
    --ch-green: #10B981;
    --ch-amber: #F59E0B;
    --ch-cyan: #22D3EE;
    --ch-red: #EF4444;
    position: relative;
}

/* ── Header Strip ─────────────────────── */
.ch-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--space-4);
}

.ch-header__left {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.ch-header__title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
    margin: 0;
}

.ch-header__divider {
    color: var(--text-muted);
    opacity: 0.4;
    font-weight: 300;
}

.ch-header__sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.ch-header__actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

/* ── Buttons ──────────────────────────── */
.ch-btn {
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
}

.ch-btn--ghost {
    background: transparent;
    border-color: var(--border-default);
    color: var(--text-secondary);
}

.ch-btn--ghost:hover {
    color: var(--text-primary);
    border-color: var(--ch-blue);
    background: rgba(74, 144, 194, 0.08);
}

.ch-btn--primary {
    background: var(--ch-blue);
    color: #fff;
    border-color: var(--ch-blue);
}

.ch-btn--primary:hover {
    background: #3a7db0;
    box-shadow: 0 2px 8px rgba(74, 144, 194, 0.3);
}

.ch-btn--loading .v-icon {
    animation: ch-spin 1s linear infinite;
}

@keyframes ch-spin {
    to { transform: rotate(360deg); }
}

/* ── Topbar (Selector + Metrics) ──────── */
.ch-topbar {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
}

.ch-selector {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-3) var(--space-4);
    transition: border-color var(--transition-base);
}

.ch-selector:hover {
    border-color: var(--border-default);
}

.ch-selector__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
}

.ch-selector__label {
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.ch-status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-muted);
}

.ch-status-dot--ok {
    background: var(--ch-green);
    box-shadow: 0 0 6px rgba(16, 185, 129, 0.4);
}

.ch-status-dot--warn {
    background: var(--ch-amber);
    box-shadow: 0 0 6px rgba(245, 158, 11, 0.4);
}

.ch-selector__input :deep(.v-field) {
    border-radius: var(--radius-md);
}

/* ── Metrics Grid ─────────────────────── */
.ch-metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-3);
}

.ch-metric {
    position: relative;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    transition: all var(--transition-base);
    overflow: hidden;
}

/* Left accent stripe */
.ch-metric::before {
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

.ch-metric[data-accent="blue"]::before  { background: var(--ch-blue); }
.ch-metric[data-accent="green"]::before { background: var(--ch-green); }
.ch-metric[data-accent="amber"]::before { background: var(--ch-amber); }
.ch-metric[data-accent="cyan"]::before  { background: var(--ch-cyan); }

.ch-metric:hover {
    border-color: var(--border-default);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.ch-metric:hover::before {
    opacity: 1;
}

.ch-metric__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-1);
}

.ch-metric__label {
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.ch-metric__ico {
    color: var(--text-muted);
    opacity: 0.5;
}

.ch-metric__number {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
    letter-spacing: -0.02em;
}

.ch-metric__unit {
    font-size: 0.6em;
    font-weight: 500;
    opacity: 0.7;
}

/* ── Tab Navigation ───────────────────── */
.ch-tabs {
    display: flex;
    gap: 1px;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    margin-bottom: var(--space-4);
    position: sticky;
    top: 0;
    z-index: 10;
}

.ch-tab {
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
    cursor: pointer;
    transition: all var(--transition-base);
    position: relative;
}

.ch-tab:hover:not(.ch-tab--active) {
    color: var(--text-primary);
    background: var(--bg-hover);
}

.ch-tab--active {
    color: var(--ch-blue);
    background: linear-gradient(180deg, transparent 0%, rgba(74, 144, 194, 0.08) 100%);
}

.ch-tab--active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 20%;
    right: 20%;
    height: 2px;
    background: var(--ch-blue);
    border-radius: 2px 2px 0 0;
}

/* ── Content Area ─────────────────────── */
.ch-content {
    min-height: 400px;
}

.ch-loading {
    min-height: 400px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
}

.ch-loading__text {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
}

/* ── Empty State ──────────────────────── */
.ch-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-10) var(--space-4);
    text-align: center;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    min-height: 300px;
}

.ch-empty__icon {
    margin-bottom: var(--space-3);
}

.ch-empty__title {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-secondary);
    margin: 0 0 var(--space-1);
}

.ch-empty__sub {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0;
    max-width: 260px;
    line-height: 1.5;
}

/* ── Dialog Styling ───────────────────── */
.ch-dialog {
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xl);
    overflow: hidden;
}

.ch-dialog__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-5) var(--space-6);
    border-bottom: 1px solid var(--border-subtle);
}

.ch-dialog__title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
}

.ch-dialog__close {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all var(--transition-base);
}

.ch-dialog__close:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
}

.ch-dialog__body {
    padding: var(--space-5) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.ch-dialog__field {
    /* Fields get their spacing from the gap on __body */
}

.ch-dialog__keys {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
}

.ch-dialog__keys-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3);
}

.ch-dialog__keys-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.ch-dialog__keys-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.ch-dialog__keys-generated {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.ch-dialog__key-field label {
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    display: block;
    margin-bottom: var(--space-1);
}

.ch-dialog__key-input {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.ch-dialog__key-input .v-text-field {
    flex: 1;
}

.ch-dialog__copy-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all var(--transition-base);
    flex-shrink: 0;
}

.ch-dialog__copy-btn:hover {
    color: var(--ch-blue);
    border-color: var(--ch-blue);
    background: rgba(74, 144, 194, 0.08);
}

.ch-dialog__keys-notice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    background: rgba(74, 144, 194, 0.08);
    border: 1px solid rgba(74, 144, 194, 0.15);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: 1.4;
}

.ch-dialog__keys-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: var(--space-4) 0;
    gap: var(--space-2);
}

.ch-dialog__keys-empty p {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
    max-width: 280px;
}

.ch-dialog__keys-hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
    opacity: 0.7;
}

.ch-dialog__required-note {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0;
}

.ch-dialog__footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--border-subtle);
}

/* Button size variants */
.ch-btn--xs {
    padding: 3px 8px;
    font-size: var(--text-xs);
    gap: 4px;
}

.ch-btn--sm {
    padding: 5px 12px;
    font-size: var(--text-xs);
}

/* ── Responsive ───────────────────────── */
@media (max-width: 1024px) {
    .ch-topbar {
        grid-template-columns: 1fr;
    }

    .ch-metrics {
        grid-template-columns: repeat(2, 1fr);
    }
}

@media (max-width: 768px) {
    .ch-header {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-2);
    }

    .ch-header__actions {
        align-self: flex-end;
    }

    .ch-metrics {
        grid-template-columns: repeat(2, 1fr);
    }

    .ch-tabs {
        overflow-x: auto;
    }
}

@media (max-width: 480px) {
    .ch-metrics {
        grid-template-columns: 1fr;
    }
}
</style>

<!-- Non-scoped styles for teleported dialog -->
<style>
.ch-create-dialog {
    overflow: visible !important;
}

.ch-create-dialog > .v-overlay__content {
    max-width: 520px !important;
    width: 100%;
}

.ch-create-dialog .ch-dialog {
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xl);
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(148, 163, 184, 0.05);
    overflow: hidden;
}

.ch-create-dialog .ch-dialog__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-5) var(--space-6);
    border-bottom: 1px solid var(--border-subtle);
}

.ch-create-dialog .ch-dialog__title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: -0.01em;
}

.ch-create-dialog .ch-dialog__close {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all var(--transition-base);
}

.ch-create-dialog .ch-dialog__close:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
}

.ch-create-dialog .ch-dialog__body {
    padding: var(--space-5) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.ch-create-dialog .ch-dialog__keys {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
}

.ch-create-dialog .ch-dialog__keys-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3);
}

.ch-create-dialog .ch-dialog__keys-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.ch-create-dialog .ch-dialog__keys-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.ch-create-dialog .ch-dialog__keys-generated {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.ch-create-dialog .ch-dialog__key-field label {
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    display: block;
    margin-bottom: var(--space-1);
}

.ch-create-dialog .ch-dialog__key-input {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.ch-create-dialog .ch-dialog__key-input .v-text-field {
    flex: 1;
}

.ch-create-dialog .ch-dialog__copy-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all var(--transition-base);
    flex-shrink: 0;
}

.ch-create-dialog .ch-dialog__copy-btn:hover {
    color: var(--ch-blue);
    border-color: var(--ch-blue);
    background: rgba(74, 144, 194, 0.08);
}

.ch-create-dialog .ch-dialog__keys-notice {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3);
    background: rgba(74, 144, 194, 0.06);
    border: 1px solid rgba(74, 144, 194, 0.12);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: 1.5;
}

.ch-create-dialog .ch-dialog__keys-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: var(--space-5) 0;
    gap: var(--space-2);
}

.ch-create-dialog .ch-dialog__keys-empty p {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
    max-width: 280px;
    line-height: 1.5;
}

.ch-create-dialog .ch-dialog__keys-hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
    opacity: 0.6;
    margin-top: var(--space-1);
}

.ch-create-dialog .ch-dialog__required-note {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0;
}

.ch-create-dialog .ch-dialog__footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--border-subtle);
}

/* Override Vuetify field styles within the dialog */
.ch-create-dialog .v-field {
    background: var(--bg-base) !important;
}

.ch-create-dialog .v-field__outline {
    border-color: var(--border-default) !important;
}

.ch-create-dialog .v-field--focused .v-field__outline {
    border-color: var(--ch-blue) !important;
}
</style>
