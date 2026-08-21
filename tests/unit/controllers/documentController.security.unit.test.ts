/**
 * Document REST authorization regression tests.
 *
 * These tests keep tenant predicates at the persistence boundary and prove
 * denied requests cannot reach counters, mutations, or upload storage.
 */

import { Request, Response } from 'express';

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('fs/promises', () => ({
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    copyFile: jest.fn(),
    unlink: jest.fn()
}));

jest.mock('@mxf-dev/core/models/document', () => {
    const actual = jest.requireActual('@mxf-dev/core/models/document');
    const model = jest.fn();

    Object.assign(model, {
        find: jest.fn(),
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
        updateOne: jest.fn(),
        countDocuments: jest.fn(),
        aggregate: jest.fn()
    });

    return { ...actual, DocumentModel: model };
});

import * as fs from 'fs/promises';
import {
    DocumentFormat,
    DocumentModel,
    DocumentStatus,
    DocumentType
} from '@mxf-dev/core/models/document';
import { authorizationService } from '../../../src/server/api/services/AuthorizationService';
import {
    createDocument,
    deleteDocument,
    downloadDocument,
    getDocumentById,
    getDocuments,
    getDocumentStats,
    updateDocument
} from '../../../src/server/api/controllers/documentController';

interface TestRequest extends Partial<Request> {
    authType?: string;
    user?: {
        id: string;
        username?: string;
        email?: string;
        role?: string;
    };
    agent?: {
        agentId: string;
        channelId: string;
        keyId: string;
    };
    files?: Array<{
        buffer: Buffer;
        size: number;
        mimetype: string;
        originalname: string;
    }>;
}

interface MockDocumentModel extends jest.Mock {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
    countDocuments: jest.Mock;
    aggregate: jest.Mock;
}

const model = DocumentModel as unknown as MockDocumentModel;

const AGENT_DOCUMENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const USER_DOCUMENT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const createResponse = (): {
    response: Response;
    status: jest.Mock;
    json: jest.Mock;
    send: jest.Mock;
    setHeader: jest.Mock;
} => {
    const json = jest.fn();
    const send = jest.fn();
    const setHeader = jest.fn();
    const response = {
        status: jest.fn(),
        json,
        send,
        setHeader
    } as unknown as Response;
    const status = response.status as jest.Mock;
    status.mockReturnValue(response);

    return { response, status, json, send, setHeader };
};

const agentRequest = (overrides: Partial<TestRequest> = {}): TestRequest => ({
    authType: 'key',
    agent: {
        agentId: 'agent-a',
        channelId: 'channel-a',
        keyId: 'key-a'
    },
    params: {},
    query: {},
    body: {},
    ...overrides
});

const userRequest = (overrides: Partial<TestRequest> = {}): TestRequest => ({
    authType: 'jwt',
    user: {
        id: 'user-owner',
        username: 'Owner',
        role: 'user'
    },
    params: {},
    query: {},
    body: {},
    ...overrides
});

const allowAgentChannel = (): void => {
    jest.spyOn(authorizationService, 'resolveChannelScope').mockResolvedValue({
        allowed: true,
        scope: { unrestricted: false, channelIds: ['channel-a'] }
    });
};

const allowOwnedUserChannel = (): void => {
    jest.spyOn(authorizationService, 'resolveChannelScope').mockResolvedValue({
        allowed: true,
        scope: { unrestricted: false, channelIds: ['channel-owned'] }
    });
};

const mockCollectionResult = (documents: unknown[] = []): void => {
    const query = {
        sort: jest.fn(),
        skip: jest.fn(),
        limit: jest.fn(),
        lean: jest.fn().mockResolvedValue(documents)
    };
    query.sort.mockReturnValue(query);
    query.skip.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    model.find.mockReturnValue(query);
    model.countDocuments.mockResolvedValue(documents.length);
};

const mockItemLookup = (document: unknown): void => {
    model.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(document)
    });
};

describe('DocumentController tenant authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
        model.mockImplementation((data: Record<string, unknown>) => ({
            ...data,
            save: jest.fn().mockResolvedValue(undefined)
        }));
        model.updateOne.mockResolvedValue({ modifiedCount: 1 });
        model.findOneAndUpdate.mockResolvedValue({});
        model.aggregate.mockResolvedValue([]);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('scopes an agent collection query to the immutable key-bound channel', async () => {
        allowAgentChannel();
        mockCollectionResult();
        const req = agentRequest({
            query: { authorId: 'some-other-agent' }
        });
        const { response, json } = createResponse();

        await getDocuments(req as Request, response);

        expect(model.find).toHaveBeenCalledWith({
            $and: [
                { active: true },
                { channelId: 'channel-a' },
                { authorId: 'some-other-agent' }
            ]
        });
        expect(model.countDocuments).toHaveBeenCalledWith(model.find.mock.calls[0][0]);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('scopes a normal user collection query to owned channels and their own unscoped documents', async () => {
        allowOwnedUserChannel();
        mockCollectionResult();
        const req = userRequest();
        const { response } = createResponse();

        await getDocuments(req as Request, response);

        expect(model.find).toHaveBeenCalledWith({
            $and: [
                { active: true },
                {
                    $or: [
                        { channelId: { $in: ['channel-owned'] } },
                        { channelId: null, authorId: 'user-owner' }
                    ]
                }
            ]
        });
    });

    it('rejects an explicit foreign-channel collection query before touching documents', async () => {
        allowAgentChannel();
        const req = agentRequest({ query: { channelId: 'channel-b' } });
        const { response, status } = createResponse();

        await getDocuments(req as Request, response);

        expect(status).toHaveBeenCalledWith(403);
        expect(model.find).not.toHaveBeenCalled();
        expect(model.countDocuments).not.toHaveBeenCalled();
    });

    it('rejects foreign-channel stats before issuing count or aggregation queries', async () => {
        allowOwnedUserChannel();
        const req = userRequest({ query: { channelId: 'channel-foreign' } });
        const { response, status } = createResponse();

        await getDocumentStats(req as Request, response);

        expect(status).toHaveBeenCalledWith(403);
        expect(model.countDocuments).not.toHaveBeenCalled();
        expect(model.aggregate).not.toHaveBeenCalled();
    });

    it('includes the normal-user tenant predicate in every stats query', async () => {
        allowOwnedUserChannel();
        model.countDocuments.mockResolvedValue(0);
        model.aggregate.mockResolvedValue([]);
        const req = userRequest();
        const { response } = createResponse();

        await getDocumentStats(req as Request, response);

        expect(model.countDocuments).toHaveBeenCalledTimes(5);
        expect(model.aggregate).toHaveBeenCalledTimes(4);
        for (const [query] of model.countDocuments.mock.calls) {
            expect(JSON.stringify(query)).toContain('channel-owned');
            expect(JSON.stringify(query)).toContain('user-owner');
        }
        for (const [pipeline] of model.aggregate.mock.calls) {
            expect(JSON.stringify(pipeline[0].$match)).toContain('channel-owned');
            expect(JSON.stringify(pipeline[0].$match)).toContain('user-owner');
        }
    });

    it('rejects a foreign-channel upload before model construction or file-system writes', async () => {
        allowOwnedUserChannel();
        const req = userRequest({
            body: {
                title: 'Foreign document',
                type: DocumentType.GUIDE,
                format: DocumentFormat.MARKDOWN,
                channelId: 'channel-foreign',
                authorId: 'victim'
            },
            files: [{
                buffer: Buffer.from('secret'),
                size: 6,
                mimetype: 'text/plain',
                originalname: 'secret.txt'
            }]
        });
        const { response, status } = createResponse();

        await createDocument(req as Request, response);

        expect(status).toHaveBeenCalledWith(403);
        expect(model).not.toHaveBeenCalled();
        expect(fs.mkdir).not.toHaveBeenCalled();
        expect(fs.writeFile).not.toHaveBeenCalled();
        expect(fs.copyFile).not.toHaveBeenCalled();
    });

    it('derives an agent document author from authenticated middleware identity', async () => {
        allowAgentChannel();
        const req = agentRequest({
            body: {
                title: 'Bound document',
                type: DocumentType.GUIDE,
                format: DocumentFormat.MARKDOWN,
                status: DocumentStatus.PUBLISHED,
                channelId: 'channel-a',
                authorId: 'forged-author',
                author: 'Forged Author',
                content: 'safe'
            }
        });
        const { response, status } = createResponse();

        await createDocument(req as Request, response);

        expect(status).toHaveBeenCalledWith(201);
        expect(model).toHaveBeenCalledWith(expect.objectContaining({
            authorId: 'agent-a',
            author: 'agent-a',
            channelId: 'channel-a'
        }));
    });

    it('derives a user document author from authenticated middleware identity', async () => {
        allowOwnedUserChannel();
        const req = userRequest({
            body: {
                title: 'Personal document',
                type: DocumentType.GUIDE,
                format: DocumentFormat.MARKDOWN,
                authorId: 'forged-author',
                author: 'Forged Author',
                content: 'personal'
            }
        });
        const { response, status } = createResponse();

        await createDocument(req as Request, response);

        expect(status).toHaveBeenCalledWith(201);
        expect(model).toHaveBeenCalledWith(expect.objectContaining({
            authorId: 'user-owner',
            author: 'Owner',
            channelId: null
        }));
    });

    it('does not allow an agent to create an unscoped document', async () => {
        allowAgentChannel();
        const req = agentRequest({
            body: {
                title: 'Unscoped document',
                type: DocumentType.GUIDE,
                format: DocumentFormat.MARKDOWN
            }
        });
        const { response, status } = createResponse();

        await createDocument(req as Request, response);

        expect(status).toHaveBeenCalledWith(403);
        expect(model).not.toHaveBeenCalled();
    });

    it.each([
        ['read', getDocumentById],
        ['update', updateDocument],
        ['delete', deleteDocument],
        ['download', downloadDocument]
    ])('hides a foreign item on %s before any mutation or counter update', async (_name, handler) => {
        allowAgentChannel();
        mockItemLookup(null);
        const req = agentRequest({
            params: { documentId: AGENT_DOCUMENT_ID },
            body: { title: 'Attempted overwrite' }
        });
        const { response, status } = createResponse();

        await handler(req as Request, response);

        expect(status).toHaveBeenCalledWith(404);
        expect(model.findOne).toHaveBeenCalledWith({
            $and: [
                { _id: AGENT_DOCUMENT_ID, active: true },
                { channelId: 'channel-a' }
            ]
        });
        expect(model.findOneAndUpdate).not.toHaveBeenCalled();
        expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('allows a user to read their own unscoped item and scopes the view counter update', async () => {
        allowOwnedUserChannel();
        const document = {
            _id: USER_DOCUMENT_ID,
            title: 'Personal note',
            authorId: 'user-owner',
            channelId: null
        };
        mockItemLookup(document);
        const req = userRequest({ params: { documentId: USER_DOCUMENT_ID } });
        const { response, json } = createResponse();

        await getDocumentById(req as Request, response);

        const expectedQuery = {
            $and: [
                { _id: USER_DOCUMENT_ID, active: true },
                {
                    $or: [
                        { channelId: { $in: ['channel-owned'] } },
                        { channelId: null, authorId: 'user-owner' }
                    ]
                }
            ]
        };
        expect(model.findOne).toHaveBeenCalledWith(expectedQuery);
        expect(model.updateOne).toHaveBeenCalledWith(expectedQuery, { $inc: { views: 1 } });
        expect(json).toHaveBeenCalledWith({ success: true, data: document });
    });

    it('escapes literal search text and rejects unbounded pagination and sort fields', async () => {
        allowAgentChannel();
        mockCollectionResult();
        const safeReq = agentRequest({ query: { search: 'a+b.*(c)' } });
        const safeResponse = createResponse();

        await getDocuments(safeReq as Request, safeResponse.response);

        const query = model.find.mock.calls[0][0];
        const searchClause = query.$and[2].$or[0].title as RegExp;
        expect(searchClause).toBeInstanceOf(RegExp);
        expect(searchClause.source).toBe('a\\+b\\.\\*\\(c\\)');

        jest.clearAllMocks();
        const unsafeReq = agentRequest({ query: { limit: '1000000', sortBy: '$where' } });
        const unsafeResponse = createResponse();
        await getDocuments(unsafeReq as Request, unsafeResponse.response);

        expect(unsafeResponse.status).toHaveBeenCalledWith(400);
        expect(model.find).not.toHaveBeenCalled();
        expect(model.countDocuments).not.toHaveBeenCalled();
    });

    it('keeps administrator statistics unrestricted', async () => {
        jest.spyOn(authorizationService, 'resolveChannelScope').mockResolvedValue({
            allowed: true,
            scope: { unrestricted: true }
        });
        model.countDocuments.mockResolvedValue(0);
        model.aggregate.mockResolvedValue([]);
        const req = userRequest({
            user: { id: 'admin-user', username: 'Admin', role: 'admin' }
        });
        const { response } = createResponse();

        await getDocumentStats(req as Request, response);

        expect(model.countDocuments.mock.calls[0][0]).toEqual({ active: true });
        expect(model.aggregate.mock.calls[0][0][0]).toEqual({ $match: { active: true } });
    });
});
