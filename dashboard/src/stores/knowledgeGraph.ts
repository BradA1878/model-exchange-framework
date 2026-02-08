/**
 * Knowledge Graph Pinia Store
 *
 * State management for Knowledge Graph data in the dashboard.
 * Provides access to entities, relationships, graph visualization, and Q-value data.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from '../plugins/axios';

// Types
export interface EntityUtility {
    qValue: number;
    retrievalCount: number;
    successCount: number;
    failureCount: number;
    lastAccessedAt: number;
    lastQValueUpdateAt: number;
    qValueConfidence: number;
}

export interface Entity {
    id: string;
    channelId: string;
    type: string;
    name: string;
    aliases: string[];
    description?: string;
    properties: Record<string, any>;
    utility: EntityUtility;
    confidence: number;
    source: string;
    sourceMemoryIds: string[];
    createdAt: number;
    updatedAt: number;
    merged: boolean;
    mergedInto?: string;
    customType?: string;
}

export interface Relationship {
    id: string;
    channelId: string;
    fromEntityId: string;
    toEntityId: string;
    type: string;
    label?: string;
    properties: Record<string, any>;
    confidence: number;
    surpriseScore: number;
    source: string;
    sourceMemoryIds: string[];
    createdAt: number;
    updatedAt: number;
    weight: number;
    customType?: string;
}

export interface GraphNode {
    id: string;
    label: string;
    type: string;
    qValue: number;
    confidence: number;
    properties: Record<string, any>;
}

export interface GraphEdge {
    id: string;
    source: string;
    target: string;
    type: string;
    label: string;
    weight: number;
    confidence: number;
}

export interface KGStats {
    entityCount: number;
    relationshipCount: number;
    entityTypes: Array<{ _id: string; count: number }>;
    relationshipTypes: Array<{ _id: string; count: number }>;
    qValueStats: {
        avgQValue: number;
        maxQValue: number;
        minQValue: number;
        avgConfidence: number;
    };
    recentEntities: Array<{
        id: string;
        name: string;
        type: string;
        createdAt: number;
    }>;
}

export const useKnowledgeGraphStore = defineStore('knowledgeGraph', () => {
    // State
    const entities = ref<Entity[]>([]);
    const relationships = ref<Relationship[]>([]);
    const selectedEntity = ref<Entity | null>(null);
    const selectedEntityRelationships = ref<Relationship[]>([]);
    const selectedEntityRelated = ref<Entity[]>([]);
    const graphNodes = ref<GraphNode[]>([]);
    const graphEdges = ref<GraphEdge[]>([]);
    const highUtilityEntities = ref<Entity[]>([]);
    const stats = ref<KGStats | null>(null);
    const entityTypes = ref<string[]>([]);
    const relationshipTypes = ref<string[]>([]);

    const loading = ref(false);
    const error = ref<string | null>(null);

    const totalEntities = ref(0);
    const currentOffset = ref(0);
    const currentLimit = ref(100);

    // Computed
    const hasMoreEntities = computed(() => currentOffset.value + entities.value.length < totalEntities.value);

    // Actions
    const fetchEntities = async (params: {
        channelId?: string;
        type?: string;
        search?: string;
        minQValue?: number;
        limit?: number;
        offset?: number;
    } = {}) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/kg/entities', { params });
            entities.value = response.data.entities;
            totalEntities.value = response.data.total;
            currentOffset.value = params.offset || 0;
            currentLimit.value = params.limit || 100;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch entities';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchEntityById = async (entityId: string) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get(`/api/kg/entities/${entityId}`);
            selectedEntity.value = response.data.entity;
            selectedEntityRelationships.value = response.data.relationships;
            selectedEntityRelated.value = response.data.relatedEntities;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch entity';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchRelationships = async (params: {
        channelId?: string;
        type?: string;
        entityId?: string;
        minConfidence?: number;
        limit?: number;
    } = {}) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/kg/relationships', { params });
            relationships.value = response.data.relationships;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch relationships';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchGraph = async (params: {
        channelId: string;
        entityIds?: string;
        depth?: number;
        limit?: number;
    }) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/kg/graph', { params });
            graphNodes.value = response.data.nodes;
            graphEdges.value = response.data.edges;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch graph';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchHighUtility = async (params: {
        channelId?: string;
        limit?: number;
    } = {}) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/kg/high-utility', { params });
            highUtilityEntities.value = response.data.entities;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch high-utility entities';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchStats = async (channelId?: string) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/kg/stats', { params: { channelId } });
            stats.value = response.data.stats;
            return response.data.stats;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch KG stats';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchTypes = async () => {
        try {
            const response = await axios.get('/api/kg/types');
            entityTypes.value = response.data.entityTypes;
            relationshipTypes.value = response.data.relationshipTypes;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch types';
            throw err;
        }
    };

    const clearSelection = () => {
        selectedEntity.value = null;
        selectedEntityRelationships.value = [];
        selectedEntityRelated.value = [];
    };

    const reset = () => {
        entities.value = [];
        relationships.value = [];
        selectedEntity.value = null;
        selectedEntityRelationships.value = [];
        selectedEntityRelated.value = [];
        graphNodes.value = [];
        graphEdges.value = [];
        highUtilityEntities.value = [];
        stats.value = null;
        loading.value = false;
        error.value = null;
        totalEntities.value = 0;
        currentOffset.value = 0;
    };

    return {
        // State
        entities,
        relationships,
        selectedEntity,
        selectedEntityRelationships,
        selectedEntityRelated,
        graphNodes,
        graphEdges,
        highUtilityEntities,
        stats,
        entityTypes,
        relationshipTypes,
        loading,
        error,
        totalEntities,
        currentOffset,
        currentLimit,

        // Computed
        hasMoreEntities,

        // Actions
        fetchEntities,
        fetchEntityById,
        fetchRelationships,
        fetchGraph,
        fetchHighUtility,
        fetchStats,
        fetchTypes,
        clearSelection,
        reset
    };
});
