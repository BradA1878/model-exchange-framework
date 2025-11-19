/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

import mongoose, { Document, Schema } from 'mongoose';

/**
 * Document Type Enumeration
 * Defines the types of documents that can be stored
 */
export enum DocumentType {
    GUIDE = 'guide',
    DOCUMENTATION = 'documentation', 
    TEMPLATE = 'template',
    REPORT = 'report',
    OTHER = 'other'
}

/**
 * Document Format Enumeration
 * Defines the file formats supported
 */
export enum DocumentFormat {
    MARKDOWN = 'markdown',
    PDF = 'pdf',
    DOCX = 'docx', 
    TXT = 'txt',
    HTML = 'html',
    JSON = 'json'
}

/**
 * Document Status Enumeration
 * Defines the lifecycle status of documents
 */
export enum DocumentStatus {
    DRAFT = 'draft',
    PUBLISHED = 'published',
    ARCHIVED = 'archived'
}

/**
 * Interface for Document entity
 * Defines the structure of document data
 */
export interface IDocument extends Document {
    title: string;
    type: DocumentType;
    format: DocumentFormat;
    status: DocumentStatus;
    content?: string;
    filePath?: string;
    fileSize: number;
    mimeType: string;
    tags: string[];
    author: string;
    authorId: string;
    channelId?: string;
    version: string;
    description?: string;
    views: number;
    downloads: number;
    metadata: {
        originalFileName: string;
        uploadedAt: Date;
        lastModified: Date;
        hash: string;
    };
    createdAt: Date;
    updatedAt: Date;
    active: boolean;
}

/**
 * Mongoose Schema for Document
 * Defines database structure and validation rules
 */
const DocumentSchema = new Schema<IDocument>({
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 255
    },
    type: {
        type: String,
        enum: Object.values(DocumentType),
        required: true,
        default: DocumentType.OTHER
    },
    format: {
        type: String,
        enum: Object.values(DocumentFormat),
        required: true
    },
    status: {
        type: String,
        enum: Object.values(DocumentStatus),
        required: true,
        default: DocumentStatus.DRAFT
    },
    content: {
        type: String,
        default: null
    },
    filePath: {
        type: String,
        default: null
    },
    fileSize: {
        type: Number,
        required: true,
        min: 0
    },
    mimeType: {
        type: String,
        required: true
    },
    tags: [{
        type: String,
        trim: true
    }],
    author: {
        type: String,
        required: true,
        trim: true
    },
    authorId: {
        type: String,
        required: true
    },
    channelId: {
        type: String,
        default: null,
        index: true
    },
    version: {
        type: String,
        required: true,
        default: '1.0.0'
    },
    description: {
        type: String,
        maxlength: 1000
    },
    views: {
        type: Number,
        default: 0,
        min: 0
    },
    downloads: {
        type: Number,
        default: 0,
        min: 0
    },
    metadata: {
        originalFileName: {
            type: String,
            required: true
        },
        uploadedAt: {
            type: Date,
            required: true,
            default: Date.now
        },
        lastModified: {
            type: Date,
            required: true,
            default: Date.now
        },
        hash: {
            type: String,
            required: true
        }
    },
    active: {
        type: Boolean,
        default: true,
        index: true
    }
}, {
    timestamps: true,
    collection: 'documents'
});

// Indexes for performance optimization
DocumentSchema.index({ channelId: 1, active: 1 });
DocumentSchema.index({ authorId: 1, active: 1 });
DocumentSchema.index({ type: 1, status: 1 });
DocumentSchema.index({ tags: 1 });
DocumentSchema.index({ 'metadata.uploadedAt': -1 });

// Pre-save middleware to update version and metadata
DocumentSchema.pre('save', function(this: IDocument, next) {
    if (!this.isNew && this.isModified()) {
        this.metadata.lastModified = new Date();
        // Auto-increment version for content changes
        if (this.isModified('content') || this.isModified('title')) {
            const versionParts = this.version.split('.').map(Number);
            versionParts[2] = (versionParts[2] || 0) + 1;
            this.version = versionParts.join('.');
        }
    }
    next();
});

/**
 * Document Model Export
 * Mongoose model for database operations
 */
export const DocumentModel = mongoose.models.Document || mongoose.model<IDocument>('Document', DocumentSchema);

/**
 * Document Statistics Interface
 * For aggregate statistics queries
 */
export interface DocumentStats {
    totalDocuments: number;
    publishedDocuments: number;
    draftDocuments: number;
    archivedDocuments: number;
    totalViews: number;
    totalDownloads: number;
    recentUploads: number;
    documentsByType: Record<DocumentType, number>;
    documentsByFormat: Record<DocumentFormat, number>;
}

/**
 * Document Query Filters Interface
 * For filtering and searching documents
 */
export interface DocumentQueryFilters {
    channelId?: string;
    authorId?: string;
    type?: DocumentType | 'all';
    status?: DocumentStatus | 'all';
    format?: DocumentFormat | 'all';
    tags?: string[];
    search?: string;
    dateFrom?: Date;
    dateTo?: Date;
    sortBy?: 'title' | 'createdAt' | 'updatedAt' | 'views' | 'downloads';
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
}
