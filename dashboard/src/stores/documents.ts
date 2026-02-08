import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from '../plugins/axios';

// Types
interface Document {
    id: string;
    title: string;
    type: 'guide' | 'documentation' | 'template' | 'report' | 'other';
    size: string;
    format: 'markdown' | 'pdf' | 'docx' | 'txt' | 'html';
    content: string;
    tags: string[];
    author: string;
    createdAt: Date;
    updatedAt: Date;
    version: string;
    status: 'draft' | 'published' | 'archived';
    views: number;
    downloads: number;
    channelId?: string;
}

interface DocumentFilters {
    search: string;
    type: string;
    status: string;
    author: string;
    format: string;
    tags: string[];
    sortBy: 'title' | 'createdAt' | 'updatedAt' | 'views' | 'downloads';
    sortOrder: 'asc' | 'desc';
    page: number;
    itemsPerPage: number;
}

interface DocumentStats {
    totalDocuments: number;
    publishedDocuments: number;
    draftDocuments: number;
    totalViews: number;
    totalDownloads: number;
    recentUploads: number;
}

export const useDocumentsStore = defineStore('documents', () => {
    // State
    const documents = ref<Document[]>([]);
    const selectedDocument = ref<Document | null>(null);
    const stats = ref<DocumentStats>({
        totalDocuments: 0,
        publishedDocuments: 0,
        draftDocuments: 0,
        totalViews: 0,
        totalDownloads: 0,
        recentUploads: 0
    });

    // Filters and pagination
    const filters = ref<DocumentFilters>({
        search: '',
        type: 'all',
        status: 'all',
        author: 'all',
        format: 'all',
        tags: [],
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        page: 1,
        itemsPerPage: 10
    });
    
    const currentPage = ref(1);
    const itemsPerPage = ref(10);
    const totalDocuments = ref(0);
    const totalPages = ref(0);
    const channelId = ref<string | null>(null);

    // Loading states
    const loadingDocuments = ref(false);
    const loadingStats = ref(false);
    const loadingDocument = ref(false);
    const uploadingDocument = ref(false);
    
    // Error state
    const error = ref<string | null>(null);

    // Computed
    const isLoading = computed(() => 
        loadingDocuments.value || loadingStats.value || loadingDocument.value
    );

    const filteredDocuments = computed(() => {
        let filtered = [...documents.value];

        // Apply search filter
        if (filters.value.search) {
            const searchTerm = filters.value.search.toLowerCase();
            filtered = filtered.filter(doc => 
                doc.title.toLowerCase().includes(searchTerm) ||
                doc.content.toLowerCase().includes(searchTerm) ||
                doc.tags.some(tag => tag.toLowerCase().includes(searchTerm))
            );
        }

        // Apply type filter
        if (filters.value.type !== 'all') {
            filtered = filtered.filter(doc => doc.type === filters.value.type);
        }

        // Apply status filter
        if (filters.value.status !== 'all') {
            filtered = filtered.filter(doc => doc.status === filters.value.status);
        }

        // Apply author filter
        if (filters.value.author !== 'all') {
            filtered = filtered.filter(doc => doc.author === filters.value.author);
        }

        // Apply tags filter
        if (filters.value.tags.length > 0) {
            filtered = filtered.filter(doc => 
                filters.value.tags.some(tag => doc.tags.includes(tag))
            );
        }

        // Apply sorting
        filtered.sort((a, b) => {
            const aValue = a[filters.value.sortBy];
            const bValue = b[filters.value.sortBy];
            
            if (filters.value.sortOrder === 'asc') {
                return aValue > bValue ? 1 : -1;
            } else {
                return aValue < bValue ? 1 : -1;
            }
        });

        return filtered;
    });

    const hasDocuments = computed(() => documents.value.length > 0);

    // Get all documents with filtering
    const fetchDocuments = async (): Promise<void> => {
        if (loadingDocuments.value) return;
        
        loadingDocuments.value = true;
        error.value = null;
        
        try {
            const params = new URLSearchParams();
            
            // Apply channel filter if set
            if (channelId.value) {
                params.append('channelId', channelId.value);
            }
            
            // Apply other filters
            if (filters.value.type && filters.value.type !== 'all') {
                params.append('type', filters.value.type);
            }
            
            if (filters.value.status && filters.value.status !== 'all') {
                params.append('status', filters.value.status);
            }
            
            if (filters.value.format && filters.value.format !== 'all') {
                params.append('format', filters.value.format);
            }
            
            if (filters.value.search) {
                params.append('search', filters.value.search);
            }
            
            // Apply sorting and pagination
            params.append('sortBy', filters.value.sortBy);
            params.append('sortOrder', filters.value.sortOrder);
            params.append('page', filters.value.page.toString());
            params.append('limit', filters.value.itemsPerPage.toString());
            
            const response = await axios.get(`/api/documents?${params.toString()}`);
            
            if (response.data.success) {
                documents.value = response.data.data || [];
                
                // Update pagination from response
                if (response.data.pagination) {
                    const pagination = response.data.pagination;
                    totalDocuments.value = pagination.totalItems;
                    totalPages.value = pagination.totalPages;
                }
            } else {
                throw new Error(response.data.message || 'Failed to fetch documents');
            }
            
        } catch (err: any) {
            console.error('Failed to fetch documents:', err);
            error.value = err.response?.data?.message || err.message || 'Failed to fetch documents';
            documents.value = [];
        } finally {
            loadingDocuments.value = false;
        }
    };

    const fetchDocumentStats = async (channelId?: string): Promise<void> => {
        loadingStats.value = true;
        try {
            const params = channelId ? `?channelId=${channelId}` : '';
            const response = await axios.get(`/api/documents/stats${params}`);
            
            if (response.data.success) {
                stats.value = response.data.data;
            } else {
                throw new Error(response.data.message || 'Failed to fetch document stats');
            }
        } catch (err: any) {
            console.error('Failed to fetch document stats:', err);
            error.value = err.response?.data?.message || 'Failed to load document statistics';
        } finally {
            loadingStats.value = false;
        }
    };

    const fetchDocumentById = async (documentId: string): Promise<void> => {
        loadingDocument.value = true;
        try {
            const response = await axios.get(`/api/documents/${documentId}`);
            
            if (response.data.success) {
                selectedDocument.value = {
                    ...response.data.data,
                    createdAt: new Date(response.data.data.createdAt),
                    updatedAt: new Date(response.data.data.updatedAt)
                };
            } else {
                throw new Error(response.data.message || 'Failed to fetch document');
            }
        } catch (err: any) {
            console.error('Failed to fetch document:', err);
            error.value = err.response?.data?.message || 'Failed to load document';
        } finally {
            loadingDocument.value = false;
        }
    };

    const uploadDocument = async (formData: FormData, channelId?: string): Promise<Document> => {
        uploadingDocument.value = true;
        try {
            // Add channelId to formData if provided
            if (channelId) {
                formData.append('channelId', channelId);
            }
            
            const response = await axios.post('/api/documents', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            
            if (response.data.success) {
                const newDocument = {
                    ...response.data.data,
                    createdAt: new Date(response.data.data.createdAt),
                    updatedAt: new Date(response.data.data.updatedAt)
                };
                
                // Add to documents list
                documents.value.unshift(newDocument);
                
                return newDocument;
            } else {
                throw new Error(response.data.message || 'Failed to upload document');
            }
        } catch (err: any) {
            console.error('Failed to upload document:', err);
            error.value = err.response?.data?.message || 'Failed to upload document';
            throw err;
        } finally {
            uploadingDocument.value = false;
        }
    };

    const updateDocument = async (documentId: string, updates: Partial<Document>): Promise<void> => {
        try {
            const response = await axios.put(`/api/documents/${documentId}`, updates);
            
            if (response.data.success) {
                const updatedDocument = {
                    ...response.data.data,
                    createdAt: new Date(response.data.data.createdAt),
                    updatedAt: new Date(response.data.data.updatedAt)
                };
                
                // Update in documents list
                const index = documents.value.findIndex(doc => doc.id === documentId);
                if (index !== -1) {
                    documents.value[index] = updatedDocument;
                }
                
                // Update selected document if it's the same
                if (selectedDocument.value?.id === documentId) {
                    selectedDocument.value = updatedDocument;
                }
            } else {
                throw new Error(response.data.message || 'Failed to update document');
            }
        } catch (err: any) {
            console.error('Failed to update document:', err);
            error.value = err.response?.data?.message || 'Failed to update document';
        }
    };

    const deleteDocument = async (documentId: string): Promise<void> => {
        try {
            const response = await axios.delete(`/api/documents/${documentId}`);
            
            if (response.data.success) {
                // Remove from documents list
                documents.value = documents.value.filter(doc => doc.id !== documentId);
                
                // Clear selected document if it's the same
                if (selectedDocument.value?.id === documentId) {
                    selectedDocument.value = null;
                }
            } else {
                throw new Error(response.data.message || 'Failed to delete document');
            }
        } catch (err: any) {
            console.error('Failed to delete document:', err);
            error.value = err.response?.data?.message || 'Failed to delete document';
        }
    };

    const downloadDocument = async (document: Document): Promise<void> => {
        try {
            const response = await axios.get(`/api/documents/${document.id}/download`, {
                responseType: 'blob'
            });
            
            // Create download link
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = window.document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${document.title}.${document.format}`);
            window.document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            
            // Update download count
            const docIndex = documents.value.findIndex(d => d.id === document.id);
            if (docIndex !== -1) {
                documents.value[docIndex].downloads++;
            }
        } catch (err: any) {
            console.error('Failed to download document:', err);
            error.value = err.response?.data?.message || 'Failed to download document';
        }
    };

    const setFilters = (newFilters: Partial<DocumentFilters>): void => {
        Object.assign(filters.value, newFilters);
        currentPage.value = 1; // Reset to first page when filters change
    };

    const setPage = (page: number): void => {
        currentPage.value = page;
    };

    const clearError = (): void => {
        error.value = null;
    };

    const clearDocuments = (): void => {
        documents.value = [];
        selectedDocument.value = null;
        totalDocuments.value = 0;
    };

    // CSV Export function
    const exportDocuments = (): void => {
        try {
            const csvContent = [
                // CSV Headers
                ['Title', 'Type', 'Format', 'Status', 'Author', 'Tags', 'Views', 'Downloads', 'Version', 'Size', 'Created', 'Updated'].join(','),
                // CSV Data
                ...documents.value.map(doc => [
                    `"${doc.title}"`,
                    doc.type,
                    doc.format,
                    doc.status,
                    `"${doc.author}"`,
                    `"${doc.tags.join('; ')}"`,
                    doc.views,
                    doc.downloads,
                    doc.version,
                    doc.size,
                    doc.createdAt.toISOString().split('T')[0],
                    doc.updatedAt.toISOString().split('T')[0]
                ].join(','))
            ].join('\n');

            // Create and download file
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const link = window.document.createElement('a');
            link.href = url;
            link.setAttribute('download', `documents-export-${new Date().toISOString().split('T')[0]}.csv`);
            window.document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
            console.error('Failed to export documents:', err);
            error.value = 'Failed to export documents';
        }
    };

    // Set channel ID for filtering
    const setChannelId = (id: string | null): void => {
        channelId.value = id;
    };

    return {
        // State
        documents,
        selectedDocument,
        stats,
        filters,
        currentPage,
        itemsPerPage,
        totalDocuments,
        totalPages,
        channelId,
        
        // Loading states
        loadingDocuments,
        loadingStats,
        loadingDocument, 
        uploadingDocument,
        isLoading,
        
        // Error state
        error,
        
        // Computed
        filteredDocuments,
        hasDocuments,
        
        // Actions
        fetchDocuments,
        fetchDocumentStats,
        fetchDocumentById,
        uploadDocument,
        updateDocument,
        deleteDocument,
        downloadDocument,
        exportDocuments,
        setFilters,
        setPage,
        setChannelId,
        clearError,
        clearDocuments
    };
});
