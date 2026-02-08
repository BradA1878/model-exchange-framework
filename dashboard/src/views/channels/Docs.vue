<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useDocumentsStore } from '../../stores/documents';

// Props
interface Props {
    channel?: {
        id: string;
        name: string;
        participants: number;
        status: string;
    };
}

const props = withDefaults(defineProps<Props>(), {
    channel: () => ({ id: 'default', name: 'Default Channel', participants: 0, status: 'active' })
});

// Store
const documentsStore = useDocumentsStore();

// Snackbar notifications
const snackbar = ref(false);
const snackbarMessage = ref('');
const snackbarColor = ref('success');

const showSnackbar = (message: string, color: string = 'success'): void => {
    snackbarMessage.value = message;
    snackbarColor.value = color;
    snackbar.value = true;
};

// Computed properties from store
const documents = computed(() => documentsStore.filteredDocuments);
const stats = computed(() => documentsStore.stats);
const isLoading = computed(() => documentsStore.isLoading);
const errorMessage = computed(() => documentsStore.error);

// Filter options
const documentTypes = ref([
    { title: 'All Types', value: 'all' },
    { title: 'Guide', value: 'guide' },
    { title: 'Documentation', value: 'documentation' },
    { title: 'Template', value: 'template' },
    { title: 'Report', value: 'report' },
    { title: 'Other', value: 'other' }
]);

const documentFormats = ref([
    { title: 'All Formats', value: 'all' },
    { title: 'Markdown', value: 'markdown' },
    { title: 'PDF', value: 'pdf' },
    { title: 'Word', value: 'docx' },
    { title: 'Text', value: 'txt' },
    { title: 'HTML', value: 'html' }
]);

const documentStatuses = ref([
    { title: 'All Statuses', value: 'all' },
    { title: 'Published', value: 'published' },
    { title: 'Draft', value: 'draft' },
    { title: 'Archived', value: 'archived' }
]);

// Local filter refs (sync with store)
const searchQuery = ref('');
const selectedType = ref('all');
const selectedFormat = ref('all');
const selectedStatus = ref('all');
const sortBy = ref('updatedAt');
const sortDesc = ref(true);

// Upload dialog
const uploadDialog = ref(false);
const uploadFiles = ref<File[]>([]);
const uploadForm = ref({
    title: '',
    type: 'other' as const,
    tags: [] as string[],
    description: ''
});

// Methods
const loadDocuments = async (): Promise<void> => {
    try {
        // Set channel ID in store for filtering
        documentsStore.setChannelId(props.channel?.id || null);
        await documentsStore.fetchDocuments();
        await documentsStore.fetchDocumentStats(props.channel?.id);
    } catch (error) {
        console.error('Failed to load documents:', error);
        showSnackbar('An error occurred', 'error');
    }
};

const downloadDocument = async (doc: any): Promise<void> => {
    try {
        await documentsStore.downloadDocument(doc);
    } catch (error) {
        console.error('Failed to download document:', error);
        showSnackbar('An error occurred', 'error');
    }
};

const previewDocument = (doc: any): void => {
    // Set selected document for preview
    documentsStore.selectedDocument = doc;
    // Preview not yet implemented — show info snackbar
    showSnackbar(`Preview not yet available for "${doc.title}"`, 'info');
};

const deleteDocument = async (docId: string): Promise<void> => {
    try {
        await documentsStore.deleteDocument(docId);
    } catch (error) {
        console.error('Failed to delete document:', error);
        showSnackbar('An error occurred', 'error');
    }
};

const uploadDocument = async (): Promise<void> => {
    if (uploadFiles.value.length === 0) return;
    
    try {
        const formData = new FormData();
        uploadFiles.value.forEach(file => {
            formData.append('files', file);
        });
        formData.append('title', uploadForm.value.title || uploadFiles.value[0].name);
        formData.append('type', uploadForm.value.type);
        formData.append('description', uploadForm.value.description);
        formData.append('tags', uploadForm.value.tags.join(','));
        
        await documentsStore.uploadDocument(formData, props.channel?.id);
        
        // Reset upload form
        resetUploadForm();
        uploadDialog.value = false;
    } catch (error) {
        console.error('Failed to upload document:', error);
        showSnackbar('An error occurred', 'error');
    }
};

const resetUploadForm = (): void => {
    uploadFiles.value = [];
    uploadForm.value = {
        title: '',
        type: 'other',
        tags: [],
        description: ''
    };
};

const applyFilters = (): void => {
    documentsStore.setFilters({
        search: searchQuery.value,
        type: selectedType.value,
        status: selectedStatus.value,
        sortBy: sortBy.value as any,
        sortOrder: sortDesc.value ? 'desc' : 'asc'
    });
    loadDocuments();
};

const clearError = (): void => {
    documentsStore.clearError();
    snackbar.value = false;
};

const formatFileSize = (sizeStr: string): string => {
    // If already formatted, return as-is
    if (sizeStr.includes('KB') || sizeStr.includes('MB') || sizeStr.includes('GB')) {
        return sizeStr;
    }
    // Otherwise try to parse and format
    const bytes = parseInt(sizeStr);
    if (isNaN(bytes)) return sizeStr;
    
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDate = (date: Date): string => {
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
};

const getStatusColor = (status: string): string => {
    switch (status) {
        case 'published': return 'success';
        case 'draft': return 'info';
        case 'archived': return 'warning';
        default: return 'default';
    }
};

const getTypeIcon = (type: string): string => {
    switch (type) {
        case 'guide': return 'mdi-book-open-variant';
        case 'documentation': return 'mdi-file-document';
        case 'template': return 'mdi-file-outline';
        case 'report': return 'mdi-chart-box';
        default: return 'mdi-file';
    }
};

const getTypeColor = (type: string): string => {
    switch (type) {
        case 'guide': return 'primary';
        case 'documentation': return 'info';
        case 'template': return 'success';
        case 'report': return 'warning';
        default: return 'default';
    }
};

const getFormatIcon = (format: string): string => {
    switch (format) {
        case 'pdf': return 'mdi-file-pdf-box';
        case 'docx': return 'mdi-file-word-box';
        case 'markdown': return 'mdi-language-markdown';
        case 'html': return 'mdi-language-html5';
        default: return 'mdi-file';
    }
};

// Watch for filter changes
watch([searchQuery, selectedType, selectedFormat, selectedStatus, sortBy, sortDesc], () => {
    applyFilters();
});

// Watch for error changes
watch(errorMessage, (newError) => {
    if (newError) {
        showSnackbar('An error occurred', 'error');
    }
});

onMounted(async () => {
    await loadDocuments();
});
</script>

<template>
    <div class="ch-docs">
        <!-- Header Strip -->
        <header class="ch-docs__header">
            <div class="ch-docs__header-left">
                <h1 class="ch-docs__header-title">Documents</h1>
                <span class="ch-docs__header-divider">/</span>
                <span class="ch-docs__header-sub">Manage channel documents, guides, and shared resources.</span>
            </div>
            <div class="ch-docs__header-actions">
                <button class="ch-docs__btn ch-docs__btn--primary" @click="uploadDialog = true">
                    <v-icon size="14">mdi-plus</v-icon>
                    <span>Upload</span>
                </button>
                <button class="ch-docs__btn ch-docs__btn--ghost" @click="loadDocuments">
                    <v-icon size="14">mdi-refresh</v-icon>
                    <span>Refresh</span>
                </button>
            </div>
        </header>

        <!-- Summary Metrics Strip -->
        <section class="ch-docs__metrics">
            <div class="ch-docs__metric" data-accent="blue">
                <div class="ch-docs__metric-head">
                    <span class="ch-docs__metric-label">Total</span>
                    <v-icon size="13" class="ch-docs__metric-ico">mdi-file-document-multiple</v-icon>
                </div>
                <div class="ch-docs__metric-number" v-if="!isLoading">{{ stats.totalDocuments }}</div>
                <v-skeleton-loader v-else type="text" width="40" />
            </div>
            <div class="ch-docs__metric" data-accent="green">
                <div class="ch-docs__metric-head">
                    <span class="ch-docs__metric-label">Published</span>
                    <v-icon size="13" class="ch-docs__metric-ico">mdi-check-circle-outline</v-icon>
                </div>
                <div class="ch-docs__metric-number" v-if="!isLoading">{{ stats.publishedDocuments }}</div>
                <v-skeleton-loader v-else type="text" width="40" />
            </div>
            <div class="ch-docs__metric" data-accent="cyan">
                <div class="ch-docs__metric-head">
                    <span class="ch-docs__metric-label">Draft</span>
                    <v-icon size="13" class="ch-docs__metric-ico">mdi-pencil-outline</v-icon>
                </div>
                <div class="ch-docs__metric-number" v-if="!isLoading">{{ stats.draftDocuments }}</div>
                <v-skeleton-loader v-else type="text" width="40" />
            </div>
            <div class="ch-docs__metric" data-accent="amber">
                <div class="ch-docs__metric-head">
                    <span class="ch-docs__metric-label">Views</span>
                    <v-icon size="13" class="ch-docs__metric-ico">mdi-eye-outline</v-icon>
                </div>
                <div class="ch-docs__metric-number" v-if="!isLoading">{{ stats.totalViews }}</div>
                <v-skeleton-loader v-else type="text" width="40" />
            </div>
            <div class="ch-docs__metric" data-accent="green">
                <div class="ch-docs__metric-head">
                    <span class="ch-docs__metric-label">Downloads</span>
                    <v-icon size="13" class="ch-docs__metric-ico">mdi-download</v-icon>
                </div>
                <div class="ch-docs__metric-number" v-if="!isLoading">{{ stats.totalDownloads }}</div>
                <v-skeleton-loader v-else type="text" width="40" />
            </div>
        </section>

        <!-- Filters -->
        <div class="ch-docs__filters">
            <div class="ch-docs__filters-head">
                <span class="ch-docs__filters-title">Filters</span>
            </div>
            <div class="ch-docs__filters-body">
                <v-text-field
                    v-model="searchQuery"
                    label="Search documents..."
                    variant="outlined"
                    density="compact"
                    prepend-inner-icon="mdi-magnify"
                    clearable
                    hide-details
                />
                <v-select
                    v-model="selectedType"
                    :items="documentTypes"
                    label="Type"
                    variant="outlined"
                    density="compact"
                    hide-details
                />
                <v-select
                    v-model="selectedFormat"
                    :items="documentFormats"
                    label="Format"
                    variant="outlined"
                    density="compact"
                    hide-details
                />
                <v-select
                    v-model="selectedStatus"
                    :items="documentStatuses"
                    label="Status"
                    variant="outlined"
                    density="compact"
                    hide-details
                />
            </div>
        </div>

        <!-- Documents List -->
        <div class="ch-docs__list">
            <!-- Loading state -->
            <div v-if="isLoading" class="ch-docs__empty">
                <v-progress-circular indeterminate color="primary" size="48" />
                <p class="ch-docs__empty-title">Loading documents...</p>
            </div>

            <!-- Empty state -->
            <div v-else-if="documents.length === 0" class="ch-docs__empty">
                <v-icon size="48" color="grey">mdi-file-document-multiple-outline</v-icon>
                <p class="ch-docs__empty-title">No documents found</p>
                <p class="ch-docs__empty-sub">Try adjusting your filters or upload new documents</p>
            </div>

            <!-- Document cards -->
            <div
                v-for="doc in documents"
                :key="doc.id"
                class="ch-docs__card"
                :data-accent="doc.status === 'published' ? 'green' : doc.status === 'draft' ? 'cyan' : 'amber'"
            >
                <div class="ch-docs__card-head">
                    <div class="ch-docs__card-chips">
                        <v-icon :color="getTypeColor(doc.type)" size="18">
                            {{ getFormatIcon(doc.format) }}
                        </v-icon>
                        <v-chip
                            :color="getTypeColor(doc.type)"
                            size="small"
                            variant="tonal"
                        >
                            {{ doc.type }}
                        </v-chip>
                        <v-chip
                            :color="getStatusColor(doc.status)"
                            size="small"
                            variant="tonal"
                        >
                            {{ doc.status }}
                        </v-chip>
                        <span class="ch-docs__card-size">{{ doc.size }}</span>
                    </div>

                    <h3 class="ch-docs__card-title">{{ doc.title }}</h3>
                    <p class="ch-docs__card-desc">{{ doc.content }}</p>

                    <div class="ch-docs__card-meta">
                        <div class="ch-docs__card-meta-item">
                            <v-icon size="14">mdi-account</v-icon>
                            <span>{{ doc.author }}</span>
                        </div>
                        <span class="ch-docs__card-meta-sep">|</span>
                        <div class="ch-docs__card-meta-item">
                            <v-icon size="14">mdi-calendar</v-icon>
                            <span>{{ formatDate(doc.updatedAt) }}</span>
                        </div>
                        <span class="ch-docs__card-meta-sep">|</span>
                        <div class="ch-docs__card-meta-item">
                            <v-icon size="14">mdi-eye</v-icon>
                            <span>{{ doc.views }} views</span>
                        </div>
                        <span class="ch-docs__card-meta-sep">|</span>
                        <div class="ch-docs__card-meta-item">
                            <v-icon size="14">mdi-download</v-icon>
                            <span>{{ doc.downloads }} downloads</span>
                        </div>
                    </div>

                    <div class="ch-docs__card-tags">
                        <v-chip
                            v-for="tag in doc.tags"
                            :key="tag"
                            size="x-small"
                            variant="outlined"
                        >
                            {{ tag }}
                        </v-chip>
                    </div>
                </div>

                <div class="ch-docs__card-actions">
                    <button class="ch-docs__btn ch-docs__btn--ghost" @click="previewDocument(doc)">
                        <v-icon size="14">mdi-eye</v-icon>
                        <span>Preview</span>
                    </button>
                    <button class="ch-docs__btn ch-docs__btn--ghost" @click="downloadDocument(doc)">
                        <v-icon size="14">mdi-download</v-icon>
                        <span>Download</span>
                    </button>
                    <v-menu>
                        <template #activator="{ props: menuProps }">
                            <button class="ch-docs__btn ch-docs__btn--ghost" v-bind="menuProps">
                                <v-icon size="14">mdi-dots-vertical</v-icon>
                            </button>
                        </template>
                        <v-list>
                            <v-list-item @click="showSnackbar('Edit not yet available', 'info')">
                                <template #prepend>
                                    <v-icon>mdi-pencil</v-icon>
                                </template>
                                <v-list-item-title>Edit</v-list-item-title>
                            </v-list-item>
                            <v-list-item @click="showSnackbar('Share not yet available', 'info')">
                                <template #prepend>
                                    <v-icon>mdi-share-variant</v-icon>
                                </template>
                                <v-list-item-title>Share</v-list-item-title>
                            </v-list-item>
                            <v-list-item
                                @click="deleteDocument(doc.id)"
                                :loading="isLoading"
                            >
                                <template #prepend>
                                    <v-icon color="error">mdi-delete</v-icon>
                                </template>
                                <v-list-item-title>Delete</v-list-item-title>
                            </v-list-item>
                        </v-list>
                    </v-menu>
                </div>
            </div>
        </div>

        <!-- Upload Dialog -->
        <v-dialog v-model="uploadDialog" max-width="600">
            <v-card>
                <v-card-title>
                    <span class="text-h5">Upload Documents</span>
                </v-card-title>
                <v-card-text>
                    <v-file-input
                        v-model="uploadFiles"
                        multiple
                        variant="outlined"
                        prepend-icon="mdi-paperclip"
                        label="Select files to upload"
                        accept=".pdf,.md,.json,.txt,.doc,.docx"
                        show-size
                    />
                    <v-alert
                        v-if="uploadFiles.length > 0"
                        type="info"
                        variant="tonal"
                        class="mt-4"
                    >
                        {{ uploadFiles.length }} file(s) selected for upload
                    </v-alert>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn @click="uploadDialog = false">Cancel</v-btn>
                    <v-btn
                        color="primary"
                        :loading="isLoading"
                        :disabled="uploadFiles.length === 0"
                        @click="uploadDocument"
                    >
                        Upload
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Snackbar notifications -->
        <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">
            {{ snackbarMessage }}
            <template #actions>
                <v-btn variant="text" @click="snackbar = false">Close</v-btn>
            </template>
        </v-snackbar>
    </div>
</template>

<style scoped>
/* ════════════════════════════════════════════
   MXF Channel Docs — Design System
   BEM prefix: ch-docs__
   ════════════════════════════════════════════ */

.ch-docs {
    --ch-blue: #4A90C2;
    --ch-green: #10B981;
    --ch-amber: #F59E0B;
    --ch-cyan: #22D3EE;
    --ch-red: #EF4444;
    position: relative;
}

/* ── Header Strip ─────────────────────── */
.ch-docs__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--space-4);
}

.ch-docs__header-left {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.ch-docs__header-title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
    margin: 0;
}

.ch-docs__header-divider {
    color: var(--text-muted);
    opacity: 0.4;
    font-weight: 300;
}

.ch-docs__header-sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.ch-docs__header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

/* ── Buttons ──────────────────────────── */
.ch-docs__btn {
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

.ch-docs__btn--ghost {
    background: transparent;
    border-color: var(--border-default);
    color: var(--text-secondary);
}

.ch-docs__btn--ghost:hover {
    color: var(--text-primary);
    border-color: var(--ch-blue);
    background: rgba(74, 144, 194, 0.08);
}

.ch-docs__btn--primary {
    background: var(--ch-blue);
    border-color: var(--ch-blue);
    color: #fff;
}

.ch-docs__btn--primary:hover {
    background: #3d7fb3;
    border-color: #3d7fb3;
}

/* ── Metrics Grid ─────────────────────── */
.ch-docs__metrics {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-4);
}

.ch-docs__metric {
    position: relative;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    transition: all var(--transition-base);
    overflow: hidden;
}

.ch-docs__metric::before {
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

.ch-docs__metric[data-accent="blue"]::before  { background: var(--ch-blue); }
.ch-docs__metric[data-accent="green"]::before { background: var(--ch-green); }
.ch-docs__metric[data-accent="amber"]::before { background: var(--ch-amber); }
.ch-docs__metric[data-accent="cyan"]::before  { background: var(--ch-cyan); }

.ch-docs__metric:hover {
    border-color: var(--border-default);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.ch-docs__metric:hover::before {
    opacity: 1;
}

.ch-docs__metric-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-1);
}

.ch-docs__metric-label {
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.ch-docs__metric-ico {
    color: var(--text-muted);
    opacity: 0.5;
}

.ch-docs__metric-number {
    font-family: var(--font-mono);
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
    letter-spacing: -0.02em;
}

/* ── Filters ──────────────────────────── */
.ch-docs__filters {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    margin-bottom: var(--space-4);
    overflow: hidden;
}

.ch-docs__filters-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
}

.ch-docs__filters-title {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.ch-docs__filters-body {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: var(--space-3);
    padding: var(--space-4);
}

/* ── Document Cards ───────────────────── */
.ch-docs__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.ch-docs__card {
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    transition: all var(--transition-base);
    overflow: hidden;
}

.ch-docs__card::before {
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

.ch-docs__card[data-accent="green"]::before { background: var(--ch-green); }
.ch-docs__card[data-accent="cyan"]::before  { background: var(--ch-cyan); }
.ch-docs__card[data-accent="amber"]::before { background: var(--ch-amber); }
.ch-docs__card[data-accent="blue"]::before  { background: var(--ch-blue); }

.ch-docs__card:hover {
    border-color: var(--border-default);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.ch-docs__card:hover::before {
    opacity: 1;
}

.ch-docs__card-head {
    flex: 1;
    min-width: 0;
}

.ch-docs__card-chips {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
}

.ch-docs__card-size {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.ch-docs__card-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 var(--space-1);
}

.ch-docs__card-desc {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0 0 var(--space-3);
}

.ch-docs__card-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--border-subtle);
    margin-bottom: var(--space-3);
}

.ch-docs__card-meta-item {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--text-secondary);
}

.ch-docs__card-meta-sep {
    color: var(--text-muted);
    opacity: 0.3;
    font-size: var(--text-xs);
}

.ch-docs__card-tags {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1);
}

.ch-docs__card-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-left: var(--space-4);
    flex-shrink: 0;
}

/* ── Empty State ──────────────────────── */
.ch-docs__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-8) var(--space-4);
    text-align: center;
}

.ch-docs__empty-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    margin: var(--space-4) 0 var(--space-1);
}

.ch-docs__empty-sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
}

/* ── Responsive ───────────────────────── */
@media (max-width: 768px) {
    .ch-docs__header {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-2);
    }

    .ch-docs__header-actions {
        align-self: flex-end;
    }

    .ch-docs__metrics {
        grid-template-columns: repeat(2, 1fr);
    }

    .ch-docs__filters-body {
        grid-template-columns: 1fr 1fr;
    }

    .ch-docs__card {
        flex-direction: column;
    }

    .ch-docs__card-actions {
        flex-direction: row;
        margin-left: 0;
        margin-top: var(--space-3);
    }
}

@media (max-width: 480px) {
    .ch-docs__metrics {
        grid-template-columns: 1fr;
    }

    .ch-docs__filters-body {
        grid-template-columns: 1fr;
    }

    .ch-docs__card-meta {
        flex-direction: column;
        align-items: flex-start;
    }

    .ch-docs__card-meta-sep {
        display: none;
    }

    .ch-docs__card-actions {
        flex-direction: column;
    }
}
</style>
