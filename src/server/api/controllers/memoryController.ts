/**
 * Canonical REST boundary for MXF memory.
 *
 * Socket/EventBus operations and these HTTP handlers deliberately share the
 * same MemoryService instance. That keeps its cache coherent and guarantees
 * that every surface persists through the injected MemoryPersistenceService
 * instead of the legacy Agent.memory and Channel.sharedMemory subdocuments.
 */

import { Request, Response } from 'express';
import { firstValueFrom } from 'rxjs';
import { Agent } from '@mxf-dev/core/models/agent';
import { MemoryService } from '@mxf-dev/core/services/MemoryService';
import {
    IAgentMemory,
    IChannelMemory,
    IRelationshipMemory
} from '@mxf-dev/core/types/MemoryTypes';
import { Logger } from '@mxf-dev/core/utils/Logger';

const logger = new Logger('info', 'MemoryController', 'server');

type WritableAgentMemory = Pick<IAgentMemory, 'notes' | 'conversationHistory' | 'customData'>;
type WritableChannelMemory = Pick<
    IChannelMemory,
    'notes' | 'sharedState' | 'customData'
>;
type WritableRelationshipMemory = Pick<
    IRelationshipMemory,
    'notes' | 'interactionHistory' | 'customData'
>;

class MemoryRequestError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOwnField = (value: Record<string, unknown>, field: string): boolean =>
    Object.prototype.hasOwnProperty.call(value, field);

const requireIdentifier = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new MemoryRequestError(`${field} must be a non-empty string`);
    }
    return value.trim();
};

const requireUpdateBody = (
    value: unknown,
    allowedFields: readonly string[]
): Record<string, unknown> => {
    if (!isRecord(value)) {
        throw new MemoryRequestError('Memory update body must be an object');
    }

    const fields = Object.keys(value);
    if (fields.length === 0) {
        throw new MemoryRequestError('Memory update body must contain at least one field');
    }

    const unsupportedField = fields.find(field => !allowedFields.includes(field));
    if (unsupportedField) {
        throw new MemoryRequestError(`Unsupported memory update field: ${unsupportedField}`);
    }

    return value;
};

const requireOptionalRecord = (
    update: Record<string, unknown>,
    field: string
): Record<string, unknown> | undefined => {
    const value = update[field];
    if (value === undefined) {
        return undefined;
    }
    if (!isRecord(value)) {
        throw new MemoryRequestError(`${field} must be an object`);
    }
    return value;
};

const requireOptionalArray = (update: Record<string, unknown>, field: string): unknown[] | undefined => {
    const value = update[field];
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        throw new MemoryRequestError(`${field} must be an array`);
    }
    return value;
};

const readAgentUpdate = (body: unknown): Partial<WritableAgentMemory> => {
    const update = requireUpdateBody(body, ['notes', 'conversationHistory', 'customData']);
    const result: Partial<WritableAgentMemory> = {};
    const notes = requireOptionalRecord(update, 'notes');
    const conversationHistory = requireOptionalArray(update, 'conversationHistory');
    const customData = requireOptionalRecord(update, 'customData');
    if (notes !== undefined) result.notes = notes;
    if (conversationHistory !== undefined) result.conversationHistory = conversationHistory;
    if (customData !== undefined) result.customData = customData;
    return result;
};

const readChannelUpdate = (body: unknown): Partial<WritableChannelMemory> => {
    const update = requireUpdateBody(
        body,
        ['notes', 'sharedState', 'customData']
    );
    const result: Partial<WritableChannelMemory> = {};
    const notes = requireOptionalRecord(update, 'notes');
    const sharedState = requireOptionalRecord(update, 'sharedState');
    const customData = requireOptionalRecord(update, 'customData');
    if (sharedState !== undefined && hasOwnField(sharedState, 'context')) {
        throw new MemoryRequestError(
            'sharedState.context is reserved for atomic channel context operations'
        );
    }
    if (customData !== undefined && hasOwnField(customData, 'contextHistory')) {
        throw new MemoryRequestError(
            'customData.contextHistory is reserved for atomic channel context operations'
        );
    }
    if (notes !== undefined) result.notes = notes;
    if (sharedState !== undefined) result.sharedState = sharedState;
    if (customData !== undefined) result.customData = customData;
    return result;
};

const readRelationshipUpdate = (body: unknown): Partial<WritableRelationshipMemory> => {
    const update = requireUpdateBody(body, ['notes', 'interactionHistory', 'customData']);
    const result: Partial<WritableRelationshipMemory> = {};
    const notes = requireOptionalRecord(update, 'notes');
    const interactionHistory = requireOptionalArray(update, 'interactionHistory');
    const customData = requireOptionalRecord(update, 'customData');
    if (notes !== undefined) result.notes = notes;
    if (interactionHistory !== undefined) result.interactionHistory = interactionHistory;
    if (customData !== undefined) result.customData = customData;
    return result;
};

const findAgentIdByKey = async (keyId: string): Promise<string | null> => {
    const agent = await Agent.findOne({ keyId }).select('agentId');
    return agent ? agent.agentId : null;
};

const handleError = (res: Response, operation: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof MemoryRequestError) {
        res.status(400).json({ success: false, message });
        return;
    }

    logger.error(`${operation} failed: ${message}`);
    res.status(500).json({ success: false, message: `${operation} failed` });
};

export const getAgentMemory = async (req: Request, res: Response): Promise<void> => {
    try {
        const keyId = requireIdentifier(req.params.keyId, 'keyId');
        const agentId = await findAgentIdByKey(keyId);
        if (!agentId) {
            res.status(404).json({ success: false, message: 'Agent not found' });
            return;
        }

        const memory = await firstValueFrom(MemoryService.getInstance().getAgentMemory(agentId));
        res.status(200).json({ success: true, data: memory });
    } catch (error) {
        handleError(res, 'Get agent memory', error);
    }
};

export const updateAgentMemory = async (req: Request, res: Response): Promise<void> => {
    try {
        const keyId = requireIdentifier(req.params.keyId, 'keyId');
        const updates = readAgentUpdate(req.body);
        const agentId = await findAgentIdByKey(keyId);
        if (!agentId) {
            res.status(404).json({ success: false, message: 'Agent not found' });
            return;
        }

        const memory = await firstValueFrom(
            MemoryService.getInstance().updateAgentMemory(agentId, updates)
        );
        res.status(200).json({ success: true, data: memory });
    } catch (error) {
        handleError(res, 'Update agent memory', error);
    }
};

export const getChannelMemory = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelId = requireIdentifier(req.params.channelId, 'channelId');
        const memory = await firstValueFrom(MemoryService.getInstance().getChannelMemory(channelId));
        res.status(200).json({ success: true, data: memory });
    } catch (error) {
        handleError(res, 'Get channel memory', error);
    }
};

export const updateChannelMemory = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelId = requireIdentifier(req.params.channelId, 'channelId');
        const updates = readChannelUpdate(req.body);
        const memory = await firstValueFrom(
            MemoryService.getInstance().updateChannelMemory(channelId, updates)
        );
        res.status(200).json({ success: true, data: memory });
    } catch (error) {
        handleError(res, 'Update channel memory', error);
    }
};

export const getRelationshipMemory = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelId = requireIdentifier(req.params.channelId, 'channelId');
        const agentId1 = requireIdentifier(req.params.agentId1, 'agentId1');
        const agentId2 = requireIdentifier(req.params.agentId2, 'agentId2');
        const memory = await firstValueFrom(
            MemoryService.getInstance().getRelationshipMemory(agentId1, agentId2, channelId)
        );
        res.status(200).json({ success: true, data: memory });
    } catch (error) {
        handleError(res, 'Get relationship memory', error);
    }
};

export const updateRelationshipMemory = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelId = requireIdentifier(req.params.channelId, 'channelId');
        const agentId1 = requireIdentifier(req.params.agentId1, 'agentId1');
        const agentId2 = requireIdentifier(req.params.agentId2, 'agentId2');
        const updates = readRelationshipUpdate(req.body);
        const memory = await firstValueFrom(
            MemoryService.getInstance().updateRelationshipMemory(
                agentId1,
                agentId2,
                channelId,
                updates
            )
        );
        res.status(200).json({ success: true, data: memory });
    } catch (error) {
        handleError(res, 'Update relationship memory', error);
    }
};
