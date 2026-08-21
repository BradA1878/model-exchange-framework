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
 * @documentation https://mxf-dev.github.io/mxf/
 */

import { Request, Response } from 'express';
import { FilterQuery } from 'mongoose';
import {
    DocumentFormat,
    DocumentModel,
    DocumentStats,
    DocumentStatus,
    DocumentType,
    IDocument
} from '@mxf-dev/core/models/document';
import { Logger } from '@mxf-dev/core/utils/Logger';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
    AuthorizationPrincipal,
    authorizationService
} from '../services/AuthorizationService';

const logger = new Logger('info', 'DocumentController', 'server');

const MAX_QUERY_TEXT_LENGTH = 255;
const MAX_SEARCH_LENGTH = 200;
const MAX_PAGE = 10_000;
const MAX_PAGE_SIZE = 100;

type DocumentSortField = 'title' | 'createdAt' | 'updatedAt' | 'views' | 'downloads';

const DOCUMENT_SORT_FIELDS = new Set<DocumentSortField>([
    'title',
    'createdAt',
    'updatedAt',
    'views',
    'downloads'
]);

interface UploadedDocumentFile {
    size?: number;
    mimetype?: string;
    originalname?: string;
    buffer?: Buffer;
    path?: string;
}

interface AuthenticatedRequest extends Request {
    authType?: string;
    user?: {
        id?: unknown;
        username?: unknown;
        email?: unknown;
        role?: string;
    };
    agent?: {
        agentId?: unknown;
        channelId?: unknown;
        keyId?: unknown;
    };
    files?: UploadedDocumentFile[];
}

type AuthenticatedDocumentPrincipal = Extract<
    AuthorizationPrincipal,
    { kind: 'user' | 'agent' }
>;

interface DocumentAccess {
    principal: AuthenticatedDocumentPrincipal;
    visibilityQuery: FilterQuery<IDocument>;
    unrestricted: boolean;
    channelIds: string[];
}

class DocumentRequestError extends Error {
    public constructor(
        public readonly status: 400 | 401 | 403 | 404,
        message: string
    ) {
        super(message);
        this.name = 'DocumentRequestError';
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const normalizeIdentifier = (value: unknown, field: string): string | undefined => {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw new DocumentRequestError(400, `${field} must be a string`);
    }

    const normalized = value.trim();
    if (normalized.length === 0) {
        throw new DocumentRequestError(400, `${field} must not be empty`);
    }

    if (normalized.length > MAX_QUERY_TEXT_LENGTH) {
        throw new DocumentRequestError(400, `${field} is too long`);
    }

    return normalized;
};

const requireDocumentId = (value: unknown): string => {
    const documentId = normalizeIdentifier(value, 'documentId');
    if (!documentId || !/^[a-f\d]{24}$/i.test(documentId)) {
        throw new DocumentRequestError(400, 'documentId must be a valid ObjectId');
    }

    return documentId;
};

const requireBodyString = (
    value: unknown,
    field: string,
    options: { allowEmpty?: boolean; maxLength?: number } = {}
): string => {
    if (typeof value !== 'string') {
        throw new DocumentRequestError(400, `${field} must be a string`);
    }

    const normalized = value.trim();
    if (!options.allowEmpty && normalized.length === 0) {
        throw new DocumentRequestError(400, `${field} is required`);
    }

    if (options.maxLength !== undefined && normalized.length > options.maxLength) {
        throw new DocumentRequestError(400, `${field} is too long`);
    }

    return normalized;
};

const parseEnumValue = <T extends string>(
    value: unknown,
    field: string,
    values: readonly T[],
    allowAll = false
): T | undefined => {
    if (value === undefined || value === null || (allowAll && value === 'all')) {
        return undefined;
    }

    const normalized = normalizeIdentifier(value, field);
    if (!normalized || !values.includes(normalized as T)) {
        throw new DocumentRequestError(400, `${field} is invalid`);
    }

    return normalized as T;
};

const parseBoundedInteger = (
    value: unknown,
    field: string,
    defaultValue: number,
    maximum: number
): number => {
    if (value === undefined || value === null) {
        return defaultValue;
    }

    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw new DocumentRequestError(400, `${field} must be a positive integer`);
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
        throw new DocumentRequestError(400, `${field} must be between 1 and ${maximum}`);
    }

    return parsed;
};

const parseOptionalDate = (value: unknown, field: string): Date | undefined => {
    const normalized = normalizeIdentifier(value, field);
    if (!normalized) {
        return undefined;
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
        throw new DocumentRequestError(400, `${field} must be a valid date`);
    }

    return parsed;
};

const escapeRegularExpression = (value: string): string => (
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
);

const combineQueries = (...queries: FilterQuery<IDocument>[]): FilterQuery<IDocument> => {
    const activeQueries = queries.filter(query => Object.keys(query).length > 0);

    if (activeQueries.length === 0) {
        return {};
    }

    if (activeQueries.length === 1) {
        return activeQueries[0];
    }

    return { $and: activeQueries };
};

const resolveDocumentAccess = async (
    req: AuthenticatedRequest,
    requestedChannelId?: string
): Promise<DocumentAccess> => {
    const principal = authorizationService.readPrincipal(req);
    const decision = await authorizationService.resolveChannelScope(principal);

    if (!decision.allowed) {
        throw new DocumentRequestError(decision.status, decision.reason);
    }

    if (principal.kind !== 'user' && principal.kind !== 'agent') {
        throw new DocumentRequestError(403, 'Unsupported authentication principal');
    }

    if (
        requestedChannelId
        && !decision.scope.unrestricted
        && !decision.scope.channelIds.includes(requestedChannelId)
    ) {
        throw new DocumentRequestError(403, 'You do not have permission to access this channel');
    }

    if (decision.scope.unrestricted) {
        return {
            principal,
            visibilityQuery: {},
            unrestricted: true,
            channelIds: []
        };
    }

    if (principal.kind === 'agent') {
        return {
            principal,
            visibilityQuery: { channelId: principal.channelId },
            unrestricted: false,
            channelIds: decision.scope.channelIds
        };
    }

    return {
        principal,
        visibilityQuery: {
            $or: [
                { channelId: { $in: decision.scope.channelIds } },
                { channelId: null, authorId: principal.userId }
            ]
        },
        unrestricted: false,
        channelIds: decision.scope.channelIds
    };
};

const getAuthor = (
    req: AuthenticatedRequest,
    principal: AuthenticatedDocumentPrincipal
): { authorId: string; author: string } => {
    if (principal.kind === 'agent') {
        return { authorId: principal.agentId, author: principal.agentId };
    }

    const username = typeof req.user?.username === 'string' ? req.user.username.trim() : '';
    const email = typeof req.user?.email === 'string' ? req.user.email.trim() : '';

    return {
        authorId: principal.userId,
        author: username || email || principal.userId
    };
};

const sendError = (
    res: Response,
    error: unknown,
    operation: string,
    publicMessage: string
): void => {
    if (error instanceof DocumentRequestError) {
        res.status(error.status).json({ success: false, message: error.message });
        return;
    }

    logger.error(`${operation}:`, error);
    res.status(500).json({ success: false, message: publicMessage });
};

const buildItemQuery = (
    documentId: string,
    access: DocumentAccess
): FilterQuery<IDocument> => combineQueries(
    { _id: documentId, active: true },
    access.visibilityQuery
);

/** GET /api/documents */
export const getDocuments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const channelId = normalizeIdentifier(req.query.channelId, 'channelId');
        const authorId = normalizeIdentifier(req.query.authorId, 'authorId');
        const type = parseEnumValue(req.query.type, 'type', Object.values(DocumentType), true);
        const status = parseEnumValue(req.query.status, 'status', Object.values(DocumentStatus), true);
        const format = parseEnumValue(req.query.format, 'format', Object.values(DocumentFormat), true);
        const search = normalizeIdentifier(req.query.search, 'search');
        const dateFrom = parseOptionalDate(req.query.dateFrom, 'dateFrom');
        const dateTo = parseOptionalDate(req.query.dateTo, 'dateTo');
        const page = parseBoundedInteger(req.query.page, 'page', 1, MAX_PAGE);
        const limit = parseBoundedInteger(req.query.limit, 'limit', 10, MAX_PAGE_SIZE);

        if (search && search.length > MAX_SEARCH_LENGTH) {
            throw new DocumentRequestError(400, `search must be at most ${MAX_SEARCH_LENGTH} characters`);
        }

        if (dateFrom && dateTo && dateFrom > dateTo) {
            throw new DocumentRequestError(400, 'dateFrom must not be later than dateTo');
        }

        const rawSortBy = normalizeIdentifier(req.query.sortBy, 'sortBy') || 'updatedAt';
        if (!DOCUMENT_SORT_FIELDS.has(rawSortBy as DocumentSortField)) {
            throw new DocumentRequestError(400, 'sortBy is invalid');
        }
        const sortBy = rawSortBy as DocumentSortField;

        const rawSortOrder = normalizeIdentifier(req.query.sortOrder, 'sortOrder') || 'desc';
        if (rawSortOrder !== 'asc' && rawSortOrder !== 'desc') {
            throw new DocumentRequestError(400, 'sortOrder is invalid');
        }

        const access = await resolveDocumentAccess(req, channelId);
        const queryParts: FilterQuery<IDocument>[] = [
            { active: true },
            access.visibilityQuery
        ];

        if (channelId) {
            queryParts.push({ channelId });
        }
        if (authorId) {
            queryParts.push({ authorId });
        }
        if (type) {
            queryParts.push({ type });
        }
        if (status) {
            queryParts.push({ status });
        }
        if (format) {
            queryParts.push({ format });
        }
        if (search) {
            const safeSearch = new RegExp(escapeRegularExpression(search), 'i');
            queryParts.push({
                $or: [
                    { title: safeSearch },
                    { description: safeSearch },
                    { tags: { $in: [safeSearch] } }
                ]
            });
        }
        if (dateFrom || dateTo) {
            const createdAt: { $gte?: Date; $lte?: Date } = {};
            if (dateFrom) {
                createdAt.$gte = dateFrom;
            }
            if (dateTo) {
                createdAt.$lte = dateTo;
            }
            queryParts.push({ createdAt });
        }

        const mongoQuery = combineQueries(...queryParts);
        const skip = (page - 1) * limit;
        const documentsQuery = DocumentModel.find(mongoQuery)
            .sort({ [sortBy]: rawSortOrder === 'asc' ? 1 : -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const [documents, totalCount] = await Promise.all([
            documentsQuery,
            DocumentModel.countDocuments(mongoQuery)
        ]);

        res.json({
            success: true,
            data: documents,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalCount / limit),
                totalItems: totalCount,
                itemsPerPage: limit
            }
        });
    } catch (error) {
        sendError(res, error, 'Failed to get documents', 'Failed to retrieve documents');
    }
};

/** GET /api/channels/:channelId/documents */
export const getDocumentsByChannel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const channelId = normalizeIdentifier(req.params.channelId, 'channelId');
        if (!channelId) {
            throw new DocumentRequestError(400, 'channelId is required');
        }

        req.query.channelId = channelId;
        await getDocuments(req, res);
    } catch (error) {
        sendError(res, error, 'Failed to get channel documents', 'Failed to retrieve channel documents');
    }
};

/** GET /api/documents/:documentId */
export const getDocumentById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const documentId = requireDocumentId(req.params.documentId);
        const access = await resolveDocumentAccess(req);
        const itemQuery = buildItemQuery(documentId, access);
        const document = await DocumentModel.findOne(itemQuery).lean() as IDocument | null;

        if (!document) {
            throw new DocumentRequestError(404, 'Document not found');
        }

        await DocumentModel.updateOne(itemQuery, { $inc: { views: 1 } });

        res.json({ success: true, data: document });
    } catch (error) {
        sendError(res, error, 'Failed to get document', 'Failed to retrieve document');
    }
};

/** POST /api/documents */
export const createDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    let storedFilePath: string | undefined;

    try {
        if (!isRecord(req.body)) {
            throw new DocumentRequestError(400, 'Request body must be an object');
        }

        const title = requireBodyString(req.body.title, 'title', { maxLength: 255 });
        const type = parseEnumValue(req.body.type, 'type', Object.values(DocumentType));
        const format = parseEnumValue(req.body.format, 'format', Object.values(DocumentFormat));
        const status = parseEnumValue(req.body.status, 'status', Object.values(DocumentStatus))
            || DocumentStatus.DRAFT;
        const channelId = normalizeIdentifier(req.body.channelId, 'channelId');

        if (!type || !format) {
            throw new DocumentRequestError(400, 'type and format are required');
        }

        const access = await resolveDocumentAccess(req, channelId);
        if (access.principal.kind === 'agent' && !channelId) {
            throw new DocumentRequestError(403, 'Agent-created documents must use the key-bound channel');
        }

        const content = req.body.content === undefined
            ? undefined
            : requireBodyString(req.body.content, 'content', { allowEmpty: true });
        const description = req.body.description === undefined || req.body.description === null
            ? undefined
            : requireBodyString(req.body.description, 'description', { allowEmpty: true, maxLength: 1000 });
        const tags = req.body.tags === undefined
            ? []
            : (Array.isArray(req.body.tags) ? req.body.tags : [req.body.tags]).map((tag, index) => (
                requireBodyString(tag, `tags[${index}]`, { maxLength: 100 })
            ));

        if (tags.length > 50) {
            throw new DocumentRequestError(400, 'A document may have at most 50 tags');
        }

        const { author, authorId } = getAuthor(req, access.principal);
        let fileSize = content === undefined ? 0 : Buffer.byteLength(content, 'utf8');
        let mimeType = 'text/plain';
        let originalFileName = title;
        const file = Array.isArray(req.files) && req.files.length > 0 ? req.files[0] : undefined;

        if (file) {
            const hasBuffer = Buffer.isBuffer(file.buffer);
            const hasSourcePath = typeof file.path === 'string' && file.path.length > 0;
            if (!hasBuffer && !hasSourcePath) {
                throw new DocumentRequestError(400, 'Uploaded file has no readable content');
            }

            originalFileName = typeof file.originalname === 'string' && file.originalname.length > 0
                ? path.basename(file.originalname)
                : title;
            mimeType = typeof file.mimetype === 'string' && file.mimetype.length > 0
                ? file.mimetype
                : 'application/octet-stream';
            fileSize = typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0
                ? file.size
                : (file.buffer?.length || 0);

            const uploadDir = path.join(process.cwd(), 'uploads', 'documents');
            await fs.mkdir(uploadDir, { recursive: true });

            const extension = path.extname(originalFileName).slice(0, 20);
            storedFilePath = path.join(uploadDir, `${crypto.randomUUID()}${extension}`);
            if (hasBuffer) {
                await fs.writeFile(storedFilePath, file.buffer as Buffer);
            } else {
                await fs.copyFile(file.path as string, storedFilePath);
            }
        }

        const contentHash = crypto
            .createHash('sha256')
            .update(content || file?.buffer || '')
            .digest('hex');

        const document = new DocumentModel({
            title,
            type,
            format,
            status,
            content,
            filePath: storedFilePath,
            fileSize,
            mimeType,
            tags,
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
        });

        await document.save();

        res.status(201).json({
            success: true,
            message: 'Document created successfully',
            data: document
        });
    } catch (error) {
        if (storedFilePath) {
            try {
                await fs.unlink(storedFilePath);
            } catch (cleanupError) {
                logger.error(`Failed to clean up document upload ${storedFilePath}:`, cleanupError);
            }
        }

        sendError(res, error, 'Failed to create document', 'Failed to create document');
    }
};

/** PUT /api/documents/:documentId */
export const updateDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const documentId = requireDocumentId(req.params.documentId);
        if (!isRecord(req.body)) {
            throw new DocumentRequestError(400, 'Request body must be an object');
        }

        const access = await resolveDocumentAccess(req);
        const itemQuery = buildItemQuery(documentId, access);
        const existingDocument = await DocumentModel.findOne(itemQuery).lean();

        if (!existingDocument) {
            throw new DocumentRequestError(404, 'Document not found');
        }

        const updateData: Record<string, unknown> = {};
        if (req.body.title !== undefined) {
            updateData.title = requireBodyString(req.body.title, 'title', { maxLength: 255 });
        }
        if (req.body.type !== undefined) {
            updateData.type = parseEnumValue(req.body.type, 'type', Object.values(DocumentType));
        }
        if (req.body.status !== undefined) {
            updateData.status = parseEnumValue(req.body.status, 'status', Object.values(DocumentStatus));
        }
        if (req.body.content !== undefined) {
            const content = requireBodyString(req.body.content, 'content', { allowEmpty: true });
            updateData.content = content;
            updateData['metadata.hash'] = crypto.createHash('sha256').update(content).digest('hex');
            updateData.fileSize = Buffer.byteLength(content, 'utf8');
        }
        if (req.body.tags !== undefined) {
            const rawTags = Array.isArray(req.body.tags) ? req.body.tags : [req.body.tags];
            if (rawTags.length > 50) {
                throw new DocumentRequestError(400, 'A document may have at most 50 tags');
            }
            updateData.tags = rawTags.map((tag, index) => (
                requireBodyString(tag, `tags[${index}]`, { maxLength: 100 })
            ));
        }
        if (req.body.description !== undefined) {
            updateData.description = req.body.description === null
                ? null
                : requireBodyString(req.body.description, 'description', { allowEmpty: true, maxLength: 1000 });
        }

        if (Object.keys(updateData).length === 0) {
            throw new DocumentRequestError(400, 'No supported document updates were provided');
        }

        updateData['metadata.lastModified'] = new Date();
        const updatedDocument = await DocumentModel.findOneAndUpdate(
            itemQuery,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedDocument) {
            throw new DocumentRequestError(404, 'Document not found');
        }

        res.json({
            success: true,
            message: 'Document updated successfully',
            data: updatedDocument
        });
    } catch (error) {
        sendError(res, error, 'Failed to update document', 'Failed to update document');
    }
};

/** DELETE /api/documents/:documentId */
export const deleteDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const documentId = requireDocumentId(req.params.documentId);
        const access = await resolveDocumentAccess(req);
        const itemQuery = buildItemQuery(documentId, access);
        const existingDocument = await DocumentModel.findOne(itemQuery).lean();

        if (!existingDocument) {
            throw new DocumentRequestError(404, 'Document not found');
        }

        const document = await DocumentModel.findOneAndUpdate(
            itemQuery,
            { $set: { active: false, status: DocumentStatus.ARCHIVED } },
            { new: true }
        );

        if (!document) {
            throw new DocumentRequestError(404, 'Document not found');
        }

        res.json({ success: true, message: 'Document deleted successfully' });
    } catch (error) {
        sendError(res, error, 'Failed to delete document', 'Failed to delete document');
    }
};

/** GET /api/documents/:documentId/download */
export const downloadDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const documentId = requireDocumentId(req.params.documentId);
        const access = await resolveDocumentAccess(req);
        const itemQuery = buildItemQuery(documentId, access);
        const document = await DocumentModel.findOne(itemQuery).lean() as IDocument | null;

        if (!document) {
            throw new DocumentRequestError(404, 'Document not found');
        }

        if (typeof document.content !== 'string') {
            throw new DocumentRequestError(404, 'Document content not available');
        }

        await DocumentModel.updateOne(itemQuery, { $inc: { downloads: 1 } });

        const safeTitle = document.title.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 200) || 'document';
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.${document.format}"`);
        res.setHeader('Content-Type', document.mimeType);
        res.send(document.content);
    } catch (error) {
        sendError(res, error, 'Failed to download document', 'Failed to download document');
    }
};

/** GET /api/documents/stats */
export const getDocumentStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const channelId = normalizeIdentifier(req.query.channelId, 'channelId');
        const access = await resolveDocumentAccess(req, channelId);
        const baseQuery = combineQueries(
            { active: true },
            access.visibilityQuery,
            channelId ? { channelId } : {}
        );

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
            DocumentModel.countDocuments(combineQueries(baseQuery, { status: DocumentStatus.PUBLISHED })),
            DocumentModel.countDocuments(combineQueries(baseQuery, { status: DocumentStatus.DRAFT })),
            DocumentModel.countDocuments(combineQueries(baseQuery, { status: DocumentStatus.ARCHIVED })),
            DocumentModel.aggregate([
                { $match: baseQuery },
                { $group: { _id: null, totalViews: { $sum: '$views' } } }
            ]),
            DocumentModel.aggregate([
                { $match: baseQuery },
                { $group: { _id: null, totalDownloads: { $sum: '$downloads' } } }
            ]),
            DocumentModel.countDocuments(combineQueries(baseQuery, {
                createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
            })),
            DocumentModel.aggregate([
                { $match: baseQuery },
                { $group: { _id: '$type', count: { $sum: 1 } } }
            ]),
            DocumentModel.aggregate([
                { $match: baseQuery },
                { $group: { _id: '$format', count: { $sum: 1 } } }
            ])
        ]);

        const documentsByType = Object.values(DocumentType).reduce<Record<DocumentType, number>>(
            (counts, type) => ({ ...counts, [type]: 0 }),
            {} as Record<DocumentType, number>
        );
        const documentsByFormat = Object.values(DocumentFormat).reduce<Record<DocumentFormat, number>>(
            (counts, format) => ({ ...counts, [format]: 0 }),
            {} as Record<DocumentFormat, number>
        );

        typeStats.forEach((stat: { _id: DocumentType; count: number }) => {
            if (Object.values(DocumentType).includes(stat._id)) {
                documentsByType[stat._id] = stat.count;
            }
        });
        formatStats.forEach((stat: { _id: DocumentFormat; count: number }) => {
            if (Object.values(DocumentFormat).includes(stat._id)) {
                documentsByFormat[stat._id] = stat.count;
            }
        });

        const stats: DocumentStats = {
            totalDocuments,
            publishedDocuments,
            draftDocuments,
            archivedDocuments,
            totalViews: viewsResult[0]?.totalViews || 0,
            totalDownloads: downloadsResult[0]?.totalDownloads || 0,
            recentUploads,
            documentsByType,
            documentsByFormat
        };

        res.json({ success: true, data: stats });
    } catch (error) {
        sendError(res, error, 'Failed to get document statistics', 'Failed to retrieve document statistics');
    }
};
