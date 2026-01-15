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

import { Request, Response } from 'express';
import { DocumentModel, IDocument, DocumentStats, DocumentQueryFilters, DocumentType, DocumentStatus, DocumentFormat } from '../../../shared/models/document';
import { Logger } from '../../../shared/utils/Logger';
import { createStrictValidator } from '../../../shared/utils/validation';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';

// Initialize logger and validator
const logger = new Logger('info', 'DocumentController', 'server');
const validator = createStrictValidator('DocumentController');

/**
 * Extended Request interface for authenticated requests
 */
interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        username: string;
        email: string;
    };
    files?: any[]; // For file uploads
}

/**
 * Get all documents with optional filtering
 * GET /api/documents
 */
export const getDocuments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const filters: DocumentQueryFilters = {
            channelId: req.query.channelId as string,
            authorId: req.query.authorId as string,
            type: req.query.type as DocumentType,
            status: req.query.status as DocumentStatus,
            format: req.query.format as DocumentFormat,
            search: req.query.search as string,
            sortBy: (req.query.sortBy as any) || 'updatedAt',
            sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'desc',
            page: parseInt(req.query.page as string) || 1,
            limit: parseInt(req.query.limit as string) || 10
        };

        // Build MongoDB query
        const mongoQuery: any = { active: true };

        // Apply filters
        if (filters.channelId) {
            mongoQuery.channelId = filters.channelId;
        }

        if (filters.authorId) {
            mongoQuery.authorId = filters.authorId;
        }

        if (filters.type && filters.type !== 'all') {
            mongoQuery.type = filters.type;
        }

        if (filters.status && filters.status !== 'all') {
            mongoQuery.status = filters.status;
        }

        if (filters.format && filters.format !== 'all') {
            mongoQuery.format = filters.format;
        }

        if (filters.search) {
            mongoQuery.$or = [
                { title: { $regex: filters.search, $options: 'i' } },
                { description: { $regex: filters.search, $options: 'i' } },
                { tags: { $in: [new RegExp(filters.search, 'i')] } }
            ];
        }

        // Apply date range filter
        if (filters.dateFrom || filters.dateTo) {
            mongoQuery.createdAt = {};
            if (filters.dateFrom) {
                mongoQuery.createdAt.$gte = new Date(filters.dateFrom);
            }
            if (filters.dateTo) {
                mongoQuery.createdAt.$lte = new Date(filters.dateTo);
            }
        }

        // Build sort object
        const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;
        const sort: any = {};
        sort[filters.sortBy!] = sortOrder;

        // Execute query with pagination
        const skip = (filters.page! - 1) * filters.limit!;
        const documentsQuery = DocumentModel.find(mongoQuery)
            .sort(sort)
            .skip(skip)
            .limit(filters.limit!)
            .lean();
        
        const [documents, totalCount] = await Promise.all([
            documentsQuery,
            DocumentModel.countDocuments(mongoQuery)
        ]);

        res.json({
            success: true,
            data: documents,
            pagination: {
                currentPage: filters.page,
                totalPages: Math.ceil(totalCount / filters.limit!),
                totalItems: totalCount,
                itemsPerPage: filters.limit
            }
        });


    } catch (error) {
        logger.error('Failed to get documents:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve documents',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Get documents by channel ID
 * GET /api/channels/:channelId/documents
 */
export const getDocumentsByChannel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { channelId } = req.params;
        validator.assertIsNonEmptyString(channelId, 'channelId is required');

        // Reuse getDocuments logic with channelId filter
        req.query.channelId = channelId;
        await getDocuments(req, res);

    } catch (error) {
        logger.error(`Failed to get documents for channel ${req.params.channelId}:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve channel documents',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Get specific document by ID
 * GET /api/documents/:documentId
 */
export const getDocumentById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { documentId } = req.params;
        validator.assertIsNonEmptyString(documentId, 'documentId is required');

        const document = await DocumentModel.findOne({ 
            _id: documentId, 
            active: true 
        }).lean() as IDocument | null;

        if (!document) {
            res.status(404).json({
                success: false,
                message: 'Document not found'
            });
            return;
        }

        // Increment view count
        await DocumentModel.updateOne(
            { _id: documentId },
            { $inc: { views: 1 } }
        );

        res.json({
            success: true,
            data: document
        });


    } catch (error) {
        logger.error(`Failed to get document ${req.params.documentId}:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve document',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Create/Upload new document
 * POST /api/documents
 */
export const createDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const {
            title,
            type,
            format,
            status,
            content,
            tags,
            channelId,
            description
        } = req.body;

        // Validate required fields
        validator.assertIsNonEmptyString(title, 'title is required');
        validator.assertIsNonEmptyString(type, 'type is required');
        validator.assertIsNonEmptyString(format, 'format is required');

        // Get user info from authenticated request
        const authorId = req.user?.id || 'unknown';
        const author = req.user?.username || req.user?.email || 'Unknown';

        // Handle file upload if present
        let fileSize = 0;
        let filePath: string | undefined;
        let mimeType = 'text/plain';
        let originalFileName = title;

        if (req.files && Array.isArray(req.files) && req.files.length > 0) {
            const file = req.files[0] as any;
            fileSize = file.size;
            mimeType = file.mimetype;
            originalFileName = file.originalname;

            // Store file to local filesystem
            const uploadDir = path.join(process.cwd(), 'uploads', 'documents');
            try {
                await fs.mkdir(uploadDir, { recursive: true });
                const fileExtension = path.extname(originalFileName) || '';
                const uniqueFileName = `${crypto.randomUUID()}${fileExtension}`;
                filePath = path.join(uploadDir, uniqueFileName);

                // If file has buffer (memory storage), write it; otherwise use the path
                if (file.buffer) {
                    await fs.writeFile(filePath, file.buffer);
                } else if (file.path) {
                    // File already saved by multer disk storage, just copy to our location
                    await fs.copyFile(file.path, filePath);
                }
                logger.info(`File stored at: ${filePath}`);
            } catch (storageError) {
                logger.error(`Failed to store file: ${storageError}`);
                // Continue without file storage - content will be stored inline if provided
                filePath = undefined;
            }
        } else if (content) {
            fileSize = Buffer.byteLength(content, 'utf8');
        }

        // Generate content hash for integrity
        const contentHash = crypto
            .createHash('sha256')
            .update(content || '')
            .digest('hex');

        // Create document record
        const documentData: Partial<IDocument> = {
            title: title.trim(),
            type: type as DocumentType,
            format: format as DocumentFormat,
            status: status as DocumentStatus || DocumentStatus.DRAFT,
            content,
            filePath,
            fileSize,
            mimeType,
            tags: Array.isArray(tags) ? tags : (tags ? [tags] : []),
            author,
            authorId,
            channelId: channelId || null,
            description: description || null,
            views: 0,
            downloads: 0,
            metadata: {
                originalFileName,
                uploadedAt: new Date(),
                lastModified: new Date(),
                hash: contentHash
            },
            active: true
        };

        const document = new DocumentModel(documentData);
        await document.save();

        res.status(201).json({
            success: true,
            message: 'Document created successfully',
            data: document
        });



    } catch (error) {
        logger.error('Failed to create document:', error);
        res.status(400).json({
            success: false,
            message: 'Failed to create document',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Update existing document
 * PUT /api/documents/:documentId
 */
export const updateDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { documentId } = req.params;
        validator.assertIsNonEmptyString(documentId, 'documentId is required');

        const updates = req.body;
        
        // Find existing document
        const existingDocument = await DocumentModel.findOne({
            _id: documentId,
            active: true
        });

        if (!existingDocument) {
            res.status(404).json({
                success: false,
                message: 'Document not found'
            });
            return;
        }

        // Update allowed fields
        const allowedUpdates = ['title', 'type', 'status', 'content', 'tags', 'description'];
        const updateData: any = {};

        allowedUpdates.forEach(field => {
            if (updates[field] !== undefined) {
                updateData[field] = updates[field];
            }
        });

        // Update content hash if content changed
        if (updates.content) {
            updateData['metadata.hash'] = crypto
                .createHash('sha256')
                .update(updates.content)
                .digest('hex');
            updateData.fileSize = Buffer.byteLength(updates.content, 'utf8');
        }

        const updatedDocument = await DocumentModel.findByIdAndUpdate(
            documentId,
            updateData,
            { new: true, runValidators: true }
        );

        res.json({
            success: true,
            message: 'Document updated successfully',
            data: updatedDocument
        });


    } catch (error) {
        logger.error(`Failed to update document ${req.params.documentId}:`, error);
        res.status(400).json({
            success: false,
            message: 'Failed to update document',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Delete document (soft delete)
 * DELETE /api/documents/:documentId
 */
export const deleteDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { documentId } = req.params;
        validator.assertIsNonEmptyString(documentId, 'documentId is required');

        const document = await DocumentModel.findOneAndUpdate(
            { _id: documentId, active: true },
            { active: false, status: DocumentStatus.ARCHIVED },
            { new: true }
        );

        if (!document) {
            res.status(404).json({
                success: false,
                message: 'Document not found'
            });
            return;
        }

        res.json({
            success: true,
            message: 'Document deleted successfully'
        });


    } catch (error) {
        logger.error(`Failed to delete document ${req.params.documentId}:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete document',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Download document
 * GET /api/documents/:documentId/download
 */
export const downloadDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { documentId } = req.params;
        validator.assertIsNonEmptyString(documentId, 'documentId is required');

        const document = await DocumentModel.findOne({
            _id: documentId,
            active: true
        });

        if (!document) {
            res.status(404).json({
                success: false,
                message: 'Document not found'
            });
            return;
        }

        // Increment download count
        await DocumentModel.updateOne(
            { _id: documentId },
            { $inc: { downloads: 1 } }
        );

        // Set response headers for file download
        const fileName = `${document.title}.${document.format}`;
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', document.mimeType);

        // For now, return content directly (in production, stream from file storage)
        if (document.content) {
            res.send(document.content);
        } else {
            res.status(404).json({
                success: false,
                message: 'Document content not available'
            });
        }


    } catch (error) {
        logger.error(`Failed to download document ${req.params.documentId}:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to download document',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Get document statistics
 * GET /api/documents/stats
 */
export const getDocumentStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { channelId } = req.query;
        
        // Base query for active documents
        const baseQuery = { active: true };
        if (channelId) {
            (baseQuery as any).channelId = channelId;
        }

        // Aggregate statistics
        const [
            totalDocuments,
            publishedDocuments,
            draftDocuments,
            archivedDocuments,
            viewsResult,
            downloadsResult,
            recentUploads,
            typeStats,
            formatStats
        ] = await Promise.all([
            DocumentModel.countDocuments(baseQuery),
            DocumentModel.countDocuments({ ...baseQuery, status: DocumentStatus.PUBLISHED }),
            DocumentModel.countDocuments({ ...baseQuery, status: DocumentStatus.DRAFT }),
            DocumentModel.countDocuments({ ...baseQuery, status: DocumentStatus.ARCHIVED }),
            DocumentModel.aggregate([
                { $match: baseQuery },
                { $group: { _id: null, totalViews: { $sum: '$views' } } }
            ]),
            DocumentModel.aggregate([
                { $match: baseQuery },
                { $group: { _id: null, totalDownloads: { $sum: '$downloads' } } }
            ]),
            DocumentModel.countDocuments({
                ...baseQuery,
                createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
            }),
            DocumentModel.aggregate([
                { $match: baseQuery },
                { $group: { _id: '$type', count: { $sum: 1 } } }
            ]),
            DocumentModel.aggregate([
                { $match: baseQuery },
                { $group: { _id: '$format', count: { $sum: 1 } } }
            ])
        ]);

        // Process aggregation results
        const totalViews = viewsResult.length > 0 ? viewsResult[0].totalViews : 0;
        const totalDownloads = downloadsResult.length > 0 ? downloadsResult[0].totalDownloads : 0;

        // Process type and format statistics
        const documentsByType: Record<DocumentType, number> = {} as any;
        const documentsByFormat: Record<DocumentFormat, number> = {} as any;

        Object.values(DocumentType).forEach(type => {
            documentsByType[type] = 0;
        });

        Object.values(DocumentFormat).forEach(format => {
            documentsByFormat[format] = 0;
        });

        typeStats.forEach((stat: any) => {
            documentsByType[stat._id as DocumentType] = stat.count;
        });

        formatStats.forEach((stat: any) => {
            documentsByFormat[stat._id as DocumentFormat] = stat.count;
        });

        const stats: DocumentStats = {
            totalDocuments,
            publishedDocuments,
            draftDocuments,
            archivedDocuments,
            totalViews,
            totalDownloads,
            recentUploads,
            documentsByType,
            documentsByFormat
        };

        res.json({
            success: true,
            data: stats
        });


    } catch (error) {
        logger.error('Failed to get document statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve document statistics',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};
