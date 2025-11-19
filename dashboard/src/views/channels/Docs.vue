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

// Error handling
const showErrorSnackbar = ref(false);

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
        showErrorSnackbar.value = true;
    }
};

const downloadDocument = async (doc: any): Promise<void> => {
    try {
        await documentsStore.downloadDocument(doc);
    } catch (error) {
        console.error('Failed to download document:', error);
        showErrorSnackbar.value = true;
    }
};

const previewDocument = (doc: any): void => {
    // Set selected document for preview
    documentsStore.selectedDocument = doc;
    // TODO: Open preview dialog or navigate to preview page
    console.log('Previewing document:', doc.title);
};

const deleteDocument = async (docId: string): Promise<void> => {
    try {
        await documentsStore.deleteDocument(docId);
    } catch (error) {
        console.error('Failed to delete document:', error);
        showErrorSnackbar.value = true;
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
        showErrorSnackbar.value = true;
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
    showErrorSnackbar.value = false;
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
        showErrorSnackbar.value = true;
    }
});

onMounted(async () => {
    await loadDocuments();
});
</script>

<template>
    <div class="docs-view">
        <!-- Header with statistics -->
        <v-row class="mb-4">
            <v-col cols="12">
                <v-card class="stats-card">
                    <v-card-text>
                        <v-row>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ stats.totalDocuments }}</div>
                                    <div class="stat-label">Total</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ stats.publishedDocuments }}</div>
                                    <div class="stat-label">Published</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ stats.draftDocuments }}</div>
                                    <div class="stat-label">Draft</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ stats.totalViews }}</div>
                                    <div class="stat-label">Views</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ stats.totalDownloads }}</div>
                                    <div class="stat-label">Downloads</div>
                                </div>
                            </v-col>
                        </v-row>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Controls and filters -->
        <v-row class="mb-4">
            <v-col cols="12">
                <v-card class="filters-card">
                    <v-card-text>
                        <!-- Action buttons -->
                        <div class="d-flex align-center mb-4">
                            <v-btn
                                color="primary"
                                prepend-icon="mdi-plus"
                                @click="uploadDialog = true"
                            >
                                Upload
                            </v-btn>
                            <v-spacer />
                            <v-btn
                                variant="outlined"
                                @click="loadDocuments"
                                :loading="isLoading"
                                prepend-icon="mdi-refresh"
                            >
                                Refresh
                            </v-btn>
                        </div>

                        <!-- Filters row -->
                        <v-row>
                            <v-col cols="12" md="3">
                                <v-text-field
                                    v-model="searchQuery"
                                    label="Search documents..."
                                    variant="outlined"
                                    density="compact"
                                    prepend-inner-icon="mdi-magnify"
                                    clearable
                                />
                            </v-col>
                            <v-col cols="4" md="2">
                                <v-select
                                    v-model="selectedType"
                                    :items="documentTypes"
                                    label="Type"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                            <v-col cols="4" md="2">
                                <v-select
                                    v-model="selectedFormat"
                                    :items="documentFormats"
                                    label="Format"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                            <v-col cols="4" md="2">
                                <v-select
                                    v-model="selectedStatus"
                                    :items="documentStatuses"
                                    label="Status"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                        </v-row>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Documents List -->
        <div class="documents-list">
            <div v-if="isLoading" class="text-center pa-8">
                <v-progress-circular indeterminate color="primary" size="64" />
                <p class="text-body-1 mt-4">Loading documents...</p>
            </div>
            
            <div v-else-if="documents.length === 0" class="text-center pa-8">
                <v-icon size="64" color="grey">mdi-file-document-multiple-outline</v-icon>
                <p class="text-h6 mt-4">No documents found</p>
                <p class="text-body-2 text-medium-emphasis">Try adjusting your filters or upload new documents</p>
            </div>
            
            <v-card
                v-for="doc in documents"
                :key="doc.id"
                elevation="0"
                class="document-card mb-4"
            >
                <v-card-text>
                    <div class="d-flex align-start justify-space-between">
                        <div class="document-header flex-grow-1">
                            <div class="d-flex align-center mb-2">
                                <v-icon :color="getTypeColor(doc.type)" class="mr-2">
                                    {{ getFormatIcon(doc.format) }}
                                </v-icon>
                                <v-chip
                                    :color="getTypeColor(doc.type)"
                                    size="small"
                                    variant="tonal"
                                    class="mr-2"
                                >
                                    {{ doc.type }}
                                </v-chip>
                                <v-chip
                                    :color="getStatusColor(doc.status)"
                                    size="small"
                                    variant="tonal"
                                    class="mr-2"
                                >
                                    {{ doc.status }}
                                </v-chip>
                                <span class="text-body-2 text-medium-emphasis">{{ doc.size }}</span>
                            </div>
                            
                            <h3 class="text-h6 mb-2">{{ doc.title }}</h3>
                            <p class="text-body-2 text-medium-emphasis mb-3">{{ doc.content }}</p>
                            
                            <div class="document-metadata mb-3">
                                <div class="d-flex align-center flex-wrap gap-2">
                                    <div class="d-flex align-center">
                                        <v-icon size="16" class="mr-1">mdi-account</v-icon>
                                        <span class="text-body-2">{{ doc.author }}</span>
                                    </div>
                                    <v-divider vertical />
                                    <div class="d-flex align-center">
                                        <v-icon size="16" class="mr-1">mdi-calendar</v-icon>
                                        <span class="text-body-2">{{ formatDate(doc.updatedAt) }}</span>
                                    </div>
                                    <v-divider vertical />
                                    <div class="d-flex align-center">
                                        <v-icon size="16" class="mr-1">mdi-eye</v-icon>
                                        <span class="text-body-2">{{ doc.views }} views</span>
                                    </div>
                                    <v-divider vertical />
                                    <div class="d-flex align-center">
                                        <v-icon size="16" class="mr-1">mdi-download</v-icon>
                                        <span class="text-body-2">{{ doc.downloads }} downloads</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="d-flex align-center flex-wrap gap-1">
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
                        
                        <div class="document-actions ml-4">
                            <div class="d-flex flex-column gap-2">
                                <v-btn
                                    size="small"
                                    variant="tonal"
                                    prepend-icon="mdi-eye"
                                    @click="previewDocument(doc)"
                                >
                                    Preview
                                </v-btn>
                                <v-btn
                                    size="small"
                                    variant="tonal"
                                    prepend-icon="mdi-download"
                                    @click="downloadDocument(doc)"
                                >
                                    Download
                                </v-btn>
                                <v-menu>
                                    <template #activator="{ props: menuProps }">
                                        <v-btn
                                            icon="mdi-dots-vertical"
                                            size="small"
                                            variant="text"
                                            v-bind="menuProps"
                                        />
                                    </template>
                                    <v-list>
                                        <v-list-item>
                                            <template #prepend>
                                                <v-icon>mdi-pencil</v-icon>
                                            </template>
                                            <v-list-item-title>Edit</v-list-item-title>
                                        </v-list-item>
                                        <v-list-item>
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
                </v-card-text>
            </v-card>
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
    </div>
</template>

<style scoped>
.docs-view {
    max-width: 1200px;
    margin: 0 auto;
}

.stats-card,
.filters-card,
.document-card {
    background: var(--v-theme-card-bg);
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.stat-item {
    text-align: center;
}

.stat-value {
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.2;
}

.stat-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.7;
    margin-top: 4px;
}

.document-header {
    min-width: 0; /* Allow text truncation */
}

.document-actions {
    min-width: 120px;
}

.document-metadata {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding: 0.75rem 0;
}

.gap-1 {
    gap: 0.25rem;
}

.gap-2 {
    gap: 0.5rem;
}

/* Responsive adjustments */
@media (max-width: 768px) {
    .document-header,
    .document-actions {
        margin-left: 0;
    }
    
    .document-actions {
        min-width: unset;
        margin-top: 1rem;
    }
    
    .stat-value {
        font-size: 1.25rem;
    }
}
</style>
