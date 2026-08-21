const mockSearch = jest.fn();
const mockDeleteDocuments = jest.fn();
const mockDeleteMany = jest.fn();

const mockIndex = {
    updateFilterableAttributes: jest.fn().mockResolvedValue(undefined),
    updateSearchableAttributes: jest.fn().mockResolvedValue(undefined),
    search: mockSearch,
    deleteDocuments: mockDeleteDocuments
};

jest.mock('@mxf-dev/core/models/userMemory', () => ({
    UserMemory: {
        find: jest.fn(),
        deleteMany: mockDeleteMany
    },
    STALENESS_THRESHOLDS: {
        project: 30,
        reference: 60,
        feedback: 90,
        user: 180
    }
}));

jest.mock('@mxf-dev/core/services/MxfMeilisearchService', () => ({
    MxfMeilisearchService: {
        getInstance: jest.fn(() => ({
            isEnabled: (): boolean => true,
            getClient: (): {
                getIndexes: jest.Mock;
                index: jest.Mock;
            } => ({
                getIndexes: jest.fn().mockResolvedValue({
                    results: [{ uid: 'mxf-user-memories' }]
                }),
                index: jest.fn(() => mockIndex)
            })
        }))
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import { UserMemoryService } from '@mxf-dev/core/services/UserMemoryService';

interface ResettableUserMemoryService {
    instance?: UserMemoryService;
}

describe('UserMemoryService Meilisearch filter security', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (UserMemoryService as unknown as ResettableUserMemoryService).instance = undefined;
        mockSearch.mockResolvedValue({ hits: [] });
        mockDeleteDocuments.mockResolvedValue({ taskUid: 1 });
        mockDeleteMany.mockResolvedValue({ deletedCount: 0 });
    });

    it('escapes tenant identity before search filter interpolation', async () => {
        const maliciousScope = 'tenant\\" OR userId EXISTS';
        await UserMemoryService.getInstance().recall(maliciousScope, 'query');

        expect(mockSearch).toHaveBeenCalledWith('query', expect.objectContaining({
            filter: 'userId = "tenant\\\\\\" OR userId EXISTS"'
        }));
    });

    it('escapes tenant identity before bulk index deletion', async () => {
        const maliciousScope = 'tenant\\" OR userId EXISTS';
        await UserMemoryService.getInstance().purge(maliciousScope);

        expect(mockDeleteDocuments).toHaveBeenCalledWith({
            filter: 'userId = "tenant\\\\\\" OR userId EXISTS"'
        });
    });
});
