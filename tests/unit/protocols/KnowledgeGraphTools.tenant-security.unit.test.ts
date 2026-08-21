const mockGetEntity = jest.fn();
const mockFindEntityByName = jest.fn();
const mockGetNeighbors = jest.fn();
const mockFindPath = jest.fn();
const mockGetGraphContext = jest.fn();
const mockGetHighUtilityEntities = jest.fn();
const mockFindOrCreateEntity = jest.fn();
const mockCreateRelationship = jest.fn();
const mockFindSimilarEntities = jest.fn();
const mockMergeEntities = jest.fn();
const mockExtractFromText = jest.fn();
const mockProcessMemory = jest.fn();
const mockGetPhaseContext = jest.fn();

const mockKgService = {
    getEntity: mockGetEntity,
    findEntityByName: mockFindEntityByName,
    getNeighbors: mockGetNeighbors,
    findPath: mockFindPath,
    getGraphContext: mockGetGraphContext,
    getHighUtilityEntities: mockGetHighUtilityEntities,
    findOrCreateEntity: mockFindOrCreateEntity,
    createRelationship: mockCreateRelationship,
    findSimilarEntities: mockFindSimilarEntities,
    mergeEntities: mockMergeEntities
};

jest.mock('@mxf-dev/core/services/kg/KnowledgeGraphService', () => ({
    KnowledgeGraphService: { getInstance: jest.fn(() => mockKgService) }
}));

jest.mock('@mxf-dev/core/services/kg/EntityExtractionService', () => ({
    EntityExtractionService: {
        getInstance: jest.fn(() => ({
            extractFromText: mockExtractFromText,
            processMemory: mockProcessMemory
        }))
    }
}));

jest.mock('@mxf-dev/core/services/kg/OrparGraphIntegration', () => ({
    OrparGraphIntegration: {
        getInstance: jest.fn(() => ({ getPhaseContext: mockGetPhaseContext }))
    }
}));

jest.mock('@mxf-dev/core/config/knowledge-graph.config', () => ({
    isKnowledgeGraphEnabled: jest.fn(() => true)
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import {
    kg_create_entity,
    kg_create_relationship,
    kg_extract_from_text,
    kg_find_entity,
    kg_find_path,
    kg_get_entity,
    kg_get_neighbors,
    kg_get_phase_context,
    kg_merge_entities
} from '@mxf-dev/core/protocols/mcp/tools/KnowledgeGraphTools';
import { McpToolHandlerContext } from '@mxf-dev/core/protocols/mcp/McpServerTypes';

const channelAContext: McpToolHandlerContext = {
    requestId: 'request-a',
    agentId: 'agent-a',
    channelId: 'channel-a'
};

const entity = (id: string): Record<string, unknown> => ({
    id,
    channelId: 'channel-a',
    name: id,
    type: 'concept'
});

describe('KnowledgeGraphTools tenant scoping', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetEntity.mockImplementation(async (id: string, channelId: string) => (
            channelId === 'channel-a' ? entity(id) : null
        ));
        mockFindEntityByName.mockResolvedValue([entity('entity-a')]);
        mockGetNeighbors.mockResolvedValue({ entities: [], relationships: [] });
        mockFindPath.mockResolvedValue({
            entityIds: ['entity-a', 'entity-b'],
            relationshipIds: ['relationship-a'],
            length: 1
        });
        mockFindOrCreateEntity.mockResolvedValue(entity('created-a'));
        mockCreateRelationship.mockResolvedValue({
            id: 'relationship-a',
            channelId: 'channel-a',
            type: 'related_to'
        });
        mockMergeEntities.mockResolvedValue({
            success: true,
            mergedEntity: entity('entity-target'),
            sourceEntityIds: ['entity-source']
        });
        mockExtractFromText.mockResolvedValue({
            entitiesExtracted: 1,
            relationshipsExtracted: 0,
            executionTimeMs: 1
        });
    });

    it('rejects caller-selected foreign channels before any graph service access or mutation', async () => {
        const read = await kg_find_entity.handler(
            { channelId: 'channel-b', name: 'secret' },
            channelAContext
        );
        const write = await kg_create_entity.handler(
            { channelId: 'channel-b', name: 'poison', type: 'concept' },
            channelAContext
        );
        const extract = await kg_extract_from_text.handler(
            { channelId: 'channel-b', text: 'foreign content' },
            channelAContext
        );

        expect(read).toEqual(expect.objectContaining({ success: false }));
        expect(write).toEqual(expect.objectContaining({ success: false }));
        expect(extract).toEqual(expect.objectContaining({ success: false }));
        expect(mockFindEntityByName).not.toHaveBeenCalled();
        expect(mockFindOrCreateEntity).not.toHaveBeenCalled();
        expect(mockExtractFromText).not.toHaveBeenCalled();
    });

    it('fails closed without both authenticated identity dimensions', async () => {
        const result = await kg_get_entity.handler(
            { entityId: 'entity-a' },
            { requestId: 'missing-channel', agentId: 'agent-a' }
        );

        expect(result).toEqual(expect.objectContaining({ success: false }));
        expect(mockGetEntity).not.toHaveBeenCalled();
    });

    it('reads entities only through the exact authenticated channel scope', async () => {
        const result = await kg_get_entity.handler(
            { entityId: 'entity-a' },
            channelAContext
        );

        expect(mockGetEntity).toHaveBeenCalledWith('entity-a', 'channel-a');
        expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it('denies foreign entity traversal before neighbor or path queries', async () => {
        mockGetEntity.mockResolvedValue(null);

        const neighbors = await kg_get_neighbors.handler(
            { entityId: 'foreign-entity' },
            channelAContext
        );
        const path = await kg_find_path.handler(
            { fromEntityId: 'foreign-a', toEntityId: 'foreign-b' },
            channelAContext
        );

        expect(neighbors).toEqual(expect.objectContaining({ success: false }));
        expect(path).toEqual(expect.objectContaining({ success: false }));
        expect(mockGetNeighbors).not.toHaveBeenCalled();
        expect(mockFindPath).not.toHaveBeenCalled();
    });

    it('rejects a path that traverses a legacy foreign-channel entity', async () => {
        mockFindPath.mockResolvedValue({
            entityIds: ['entity-a', 'foreign-hop', 'entity-b'],
            relationshipIds: ['relationship-a', 'relationship-b'],
            length: 2
        });
        mockGetEntity.mockImplementation(async (id: string, channelId: string) => (
            channelId === 'channel-a' && id !== 'foreign-hop' ? entity(id) : null
        ));

        const result = await kg_find_path.handler(
            { fromEntityId: 'entity-a', toEntityId: 'entity-b' },
            channelAContext
        );

        expect(mockFindPath).toHaveBeenCalledWith(
            'entity-a',
            'entity-b',
            5,
            'channel-a'
        );
        expect(result).toEqual(expect.objectContaining({
            success: false,
            found: false
        }));
    });

    it('allows same-channel entity creation and relationship mutation with trusted identity', async () => {
        const created = await kg_create_entity.handler(
            { name: 'Scoped entity', type: 'concept' },
            channelAContext
        );
        const related = await kg_create_relationship.handler(
            {
                fromEntityId: 'entity-a',
                toEntityId: 'entity-b',
                type: 'related_to'
            },
            channelAContext
        );

        expect(mockFindOrCreateEntity).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: 'channel-a' }),
            'agent-a'
        );
        expect(mockCreateRelationship).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: 'channel-a' }),
            'agent-a'
        );
        expect(created).toEqual(expect.objectContaining({ success: true }));
        expect(related).toEqual(expect.objectContaining({ success: true }));
    });

    it('preflights every merge entity and passes exact scope to the atomic merge', async () => {
        const result = await kg_merge_entities.handler(
            {
                targetEntityId: 'entity-target',
                sourceEntityIds: ['entity-source']
            },
            channelAContext
        );

        expect(mockGetEntity).toHaveBeenCalledWith('entity-target', 'channel-a');
        expect(mockGetEntity).toHaveBeenCalledWith('entity-source', 'channel-a');
        expect(mockMergeEntities).toHaveBeenCalledWith(
            'entity-target',
            ['entity-source'],
            'agent-a',
            'channel-a'
        );
        expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it('rejects foreign phase-context entities before ORPAR graph access', async () => {
        mockGetEntity.mockResolvedValue(null);

        const result = await kg_get_phase_context.handler(
            { phase: 'reasoning', entityIds: ['foreign-entity'] },
            channelAContext
        );

        expect(result).toEqual(expect.objectContaining({ success: false }));
        expect(mockGetPhaseContext).not.toHaveBeenCalled();
    });
});
