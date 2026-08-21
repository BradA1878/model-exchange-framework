/**
 * Runtime request policies for task writes.
 *
 * TypeScript request types disappear at runtime. These parsers deliberately
 * construct fresh objects from an exact allowlist so HTTP/socket callers cannot
 * smuggle model-only fields (for example channelId, createdBy, result, or
 * blockedBy) through a typed object and into a Mongoose update.
 */

import {
    AssignmentStrategy,
    CreateTaskRequest,
    NonLifecycleTaskUpdateRequest,
    TaskPriority,
    TaskStatus,
    UpdateTaskRequest
} from '@mxf-dev/core/types/TaskTypes';

type InputRecord = Record<string, unknown>;

const TASK_PRIORITIES = new Set<TaskPriority>(['low', 'medium', 'high', 'urgent']);
const TASK_STATUSES = new Set<TaskStatus>([
    'pending',
    'assigned',
    'in_progress',
    'completed',
    'failed',
    'cancelled'
]);
const ASSIGNMENT_STRATEGIES = new Set<AssignmentStrategy>([
    'role_based',
    'workload_balanced',
    'expertise_driven',
    'manual',
    'intelligent',
    'none'
]);

const CREATE_FIELDS = new Set<keyof CreateTaskRequest>([
    'channelId',
    'title',
    'description',
    'priority',
    'requiredRoles',
    'requiredCapabilities',
    'assignmentStrategy',
    'assignedAgentId',
    'assignedAgentIds',
    'assignmentScope',
    'assignmentDistribution',
    'channelWideTask',
    'targetAgentRoles',
    'excludeAgentIds',
    'maxParticipants',
    'coordinationMode',
    'leadAgentId',
    'completionAgentId',
    'agentSelectionCriteria',
    'dueDate',
    'estimatedDuration',
    'metadata',
    'tags',
    'dependsOn'
]);

const UPDATE_FIELDS = new Set<keyof UpdateTaskRequest>([
    'status',
    'progress',
    'assignedAgentId',
    'priority',
    'dueDate',
    'metadata',
    'tags'
]);

const NON_LIFECYCLE_UPDATE_FIELDS = new Set<keyof NonLifecycleTaskUpdateRequest>([
    'progress',
    'priority',
    'dueDate',
    'metadata',
    'tags'
]);

const hasOwn = (record: InputRecord, field: string): boolean =>
    Object.prototype.hasOwnProperty.call(record, field) && record[field] !== undefined;

const readObject = (value: unknown, label: string): InputRecord => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as InputRecord;
};

const rejectUnknownFields = (
    record: InputRecord,
    allowedFields: ReadonlySet<string>,
    label: string
): void => {
    const unknownFields = Object.keys(record).filter(field => !allowedFields.has(field));
    if (unknownFields.length > 0) {
        throw new Error(`${label} contains unsupported field(s): ${unknownFields.sort().join(', ')}`);
    }
};

const readNonEmptyString = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${field} must be a non-empty string`);
    }
    return value;
};

const readFiniteNumber = (
    value: unknown,
    field: string,
    minimum?: number,
    maximum?: number
): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${field} must be a finite number`);
    }
    if (minimum !== undefined && value < minimum) {
        throw new Error(`${field} must be at least ${minimum}`);
    }
    if (maximum !== undefined && value > maximum) {
        throw new Error(`${field} must be at most ${maximum}`);
    }
    return value;
};

const readStringArray = (value: unknown, field: string): string[] => {
    if (!Array.isArray(value)) {
        throw new Error(`${field} must be an array of non-empty strings`);
    }

    return value.map((item, index) => readNonEmptyString(item, `${field}[${index}]`));
};

const readMetadata = (value: unknown): Record<string, unknown> => {
    const metadata = readObject(value, 'metadata');
    return { ...metadata };
};

const readEnum = <T extends string>(
    value: unknown,
    allowedValues: ReadonlySet<T>,
    field: string
): T => {
    if (typeof value !== 'string' || !allowedValues.has(value as T)) {
        throw new Error(`${field} must be one of: ${Array.from(allowedValues).join(', ')}`);
    }
    return value as T;
};

/** Parse and copy the public REST task-creation contract. */
export const parseCreateTaskRequest = (value: unknown): CreateTaskRequest => {
    const input = readObject(value, 'Task creation request');
    rejectUnknownFields(input, CREATE_FIELDS, 'Task creation request');

    const request: CreateTaskRequest = {
        channelId: readNonEmptyString(input.channelId, 'channelId'),
        title: readNonEmptyString(input.title, 'title'),
        description: readNonEmptyString(input.description, 'description')
    };

    if (hasOwn(input, 'priority')) {
        request.priority = readEnum(input.priority, TASK_PRIORITIES, 'priority');
    }
    if (hasOwn(input, 'requiredRoles')) {
        request.requiredRoles = readStringArray(input.requiredRoles, 'requiredRoles');
    }
    if (hasOwn(input, 'requiredCapabilities')) {
        request.requiredCapabilities = readStringArray(input.requiredCapabilities, 'requiredCapabilities');
    }
    if (hasOwn(input, 'assignmentStrategy')) {
        request.assignmentStrategy = readEnum(
            input.assignmentStrategy,
            ASSIGNMENT_STRATEGIES,
            'assignmentStrategy'
        );
    }
    if (hasOwn(input, 'assignedAgentId')) {
        request.assignedAgentId = readNonEmptyString(input.assignedAgentId, 'assignedAgentId');
    }
    if (hasOwn(input, 'assignedAgentIds')) {
        request.assignedAgentIds = readStringArray(input.assignedAgentIds, 'assignedAgentIds');
    }
    if (hasOwn(input, 'assignmentScope')) {
        request.assignmentScope = readEnum(
            input.assignmentScope,
            new Set(['single', 'multiple', 'channel-wide'] as const),
            'assignmentScope'
        );
    }
    if (hasOwn(input, 'assignmentDistribution')) {
        request.assignmentDistribution = readEnum(
            input.assignmentDistribution,
            new Set(['parallel', 'sequential', 'collaborative'] as const),
            'assignmentDistribution'
        );
    }
    if (hasOwn(input, 'channelWideTask')) {
        if (typeof input.channelWideTask !== 'boolean') {
            throw new Error('channelWideTask must be a boolean');
        }
        request.channelWideTask = input.channelWideTask;
    }
    if (hasOwn(input, 'targetAgentRoles')) {
        request.targetAgentRoles = readStringArray(input.targetAgentRoles, 'targetAgentRoles');
    }
    if (hasOwn(input, 'excludeAgentIds')) {
        request.excludeAgentIds = readStringArray(input.excludeAgentIds, 'excludeAgentIds');
    }
    if (hasOwn(input, 'maxParticipants')) {
        const maxParticipants = readFiniteNumber(input.maxParticipants, 'maxParticipants', 1);
        if (!Number.isInteger(maxParticipants)) {
            throw new Error('maxParticipants must be an integer');
        }
        request.maxParticipants = maxParticipants;
    }
    if (hasOwn(input, 'coordinationMode')) {
        request.coordinationMode = readEnum(
            input.coordinationMode,
            new Set(['independent', 'collaborative', 'sequential', 'hierarchical'] as const),
            'coordinationMode'
        );
    }
    if (hasOwn(input, 'leadAgentId')) {
        request.leadAgentId = readNonEmptyString(input.leadAgentId, 'leadAgentId');
    }
    if (hasOwn(input, 'completionAgentId')) {
        request.completionAgentId = readNonEmptyString(
            input.completionAgentId,
            'completionAgentId'
        );
    }
    if (hasOwn(input, 'agentSelectionCriteria')) {
        const criteria = readObject(input.agentSelectionCriteria, 'agentSelectionCriteria');
        const criteriaFields = new Set([
            'minimumCapabilityMatch',
            'excludeBusyAgents',
            'preferIdleAgents',
            'requireAllCapabilities'
        ]);
        rejectUnknownFields(criteria, criteriaFields, 'agentSelectionCriteria');

        request.agentSelectionCriteria = {};
        if (hasOwn(criteria, 'minimumCapabilityMatch')) {
            request.agentSelectionCriteria.minimumCapabilityMatch = readFiniteNumber(
                criteria.minimumCapabilityMatch,
                'agentSelectionCriteria.minimumCapabilityMatch',
                0,
                1
            );
        }
        for (const field of ['excludeBusyAgents', 'preferIdleAgents', 'requireAllCapabilities'] as const) {
            if (hasOwn(criteria, field)) {
                if (typeof criteria[field] !== 'boolean') {
                    throw new Error(`agentSelectionCriteria.${field} must be a boolean`);
                }
                request.agentSelectionCriteria[field] = criteria[field];
            }
        }
    }
    if (hasOwn(input, 'dueDate')) {
        request.dueDate = readFiniteNumber(input.dueDate, 'dueDate', 0);
    }
    if (hasOwn(input, 'estimatedDuration')) {
        request.estimatedDuration = readFiniteNumber(input.estimatedDuration, 'estimatedDuration', 0);
    }
    if (hasOwn(input, 'metadata')) {
        request.metadata = readMetadata(input.metadata);
    }
    if (hasOwn(input, 'tags')) {
        request.tags = readStringArray(input.tags, 'tags');
    }
    if (hasOwn(input, 'dependsOn')) {
        request.dependsOn = readStringArray(input.dependsOn, 'dependsOn');
    }

    const normalizedAssignedAgentIds = new Set([
        ...(request.assignedAgentId ? [request.assignedAgentId] : []),
        ...(request.assignedAgentIds ?? [])
    ]);
    if (request.assignmentScope === 'multiple' && normalizedAssignedAgentIds.size < 2) {
        throw new Error(
            'Multiple assignment scope requires at least two distinct assigned agents'
        );
    }
    if (request.assignmentScope === 'channel-wide' &&
        request.channelWideTask !== true && request.maxParticipants === undefined) {
        throw new Error(
            'Channel-wide assignment requires channelWideTask=true or a maxParticipants limit'
        );
    }

    return request;
};

/** Parse and copy the only fields callers may mutate on an existing task. */
export const parseUpdateTaskRequest = (value: unknown): UpdateTaskRequest => {
    const input = readObject(value, 'Task update request');
    rejectUnknownFields(input, UPDATE_FIELDS, 'Task update request');

    const update: UpdateTaskRequest = {};
    if (hasOwn(input, 'status')) {
        update.status = readEnum(input.status, TASK_STATUSES, 'status');
    }
    if (hasOwn(input, 'progress')) {
        update.progress = readFiniteNumber(input.progress, 'progress', 0, 100);
    }
    if (hasOwn(input, 'assignedAgentId')) {
        update.assignedAgentId = readNonEmptyString(input.assignedAgentId, 'assignedAgentId');
    }
    if (hasOwn(input, 'priority')) {
        update.priority = readEnum(input.priority, TASK_PRIORITIES, 'priority');
    }
    if (hasOwn(input, 'dueDate')) {
        update.dueDate = readFiniteNumber(input.dueDate, 'dueDate', 0);
    }
    if (hasOwn(input, 'metadata')) {
        update.metadata = readMetadata(input.metadata);
    }
    if (hasOwn(input, 'tags')) {
        update.tags = readStringArray(input.tags, 'tags');
    }

    if (Object.keys(update).length === 0) {
        throw new Error('Task update request must contain at least one supported field');
    }

    return update;
};

/**
 * Parse a generic task patch. Lifecycle state is deliberately absent from this
 * surface: an authenticated caller must use the dedicated assignment or
 * lifecycle operation whose database compare-and-set authorizes the actor and
 * constrains the source state.
 */
export const parseNonLifecycleTaskUpdateRequest = (
    value: unknown
): NonLifecycleTaskUpdateRequest => {
    const input = readObject(value, 'Task update request');
    if (hasOwn(input, 'status')) {
        throw new Error('Task status transitions require a dedicated lifecycle operation');
    }
    if (hasOwn(input, 'assignedAgentId')) {
        throw new Error('Task assignment requires a dedicated assignment operation');
    }
    rejectUnknownFields(input, NON_LIFECYCLE_UPDATE_FIELDS, 'Task update request');

    return parseUpdateTaskRequest(input);
};
