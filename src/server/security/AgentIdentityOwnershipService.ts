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

import { Agent } from '@mxf-dev/core/models/agent';
import AgentIdentityReservation, {
    IAgentIdentityReservation
} from '@mxf-dev/core/models/agentIdentityReservation';
import ChannelKey from '@mxf-dev/core/models/channelKey';
import { AgentMemory, RelationshipMemory } from '@mxf-dev/core/models/memory';
import {
    MemoryEntryModel,
    MemoryPatternModel,
    SurpriseHistoryModel
} from '@mxf-dev/core/models/memoryStrata';
import { MemoryUtility } from '@mxf-dev/core/models/memoryUtility';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { isReservedAgentId } from '@mxf-dev/core/constants/ReservedIdentities';

export type AgentIdentityOwnershipErrorCode =
    | 'INVALID_IDENTITY'
    | 'OWNERSHIP_CONFLICT'
    | 'LEGACY_OWNERSHIP_CONFLICT'
    | 'ORPHANED_AGENT_STATE'
    | 'RESERVATION_UNAVAILABLE';

/** A fail-closed ownership error safe for API callers to act on. */
export class AgentIdentityOwnershipError extends Error {
    public readonly statusCode: number;

    constructor(
        public readonly code: AgentIdentityOwnershipErrorCode,
        message: string,
        statusCode: number
    ) {
        super(message);
        this.name = 'AgentIdentityOwnershipError';
        this.statusCode = statusCode;
    }
}

interface LegacyOwnerEvidence {
    agentOwners: string[];
    channelKeyOwners: string[];
    malformedOwnerSources: string[];
    reservation: IAgentIdentityReservation | null;
}

const logger = new Logger('info', 'AgentIdentityOwnershipService', 'server');

const normalizeExactIdentifier = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new AgentIdentityOwnershipError(
            'INVALID_IDENTITY',
            `${label} must be a non-empty string`,
            400
        );
    }

    if (value !== value.trim()) {
        throw new AgentIdentityOwnershipError(
            'INVALID_IDENTITY',
            `${label} must not contain leading or trailing whitespace`,
            400
        );
    }

    return value;
};

interface PersistedOwnerRow {
    createdBy?: unknown;
}

interface ParsedOwnerRows {
    owners: string[];
    malformed: boolean;
}

const parsePersistedOwnerRows = (rows: PersistedOwnerRow[]): ParsedOwnerRows => {
    const owners = new Set<string>();
    let malformed = false;

    for (const row of rows) {
        const rawOwner = row.createdBy;
        if (rawOwner === null || rawOwner === undefined) {
            malformed = true;
            continue;
        }

        // ChannelKey.createdBy is an ObjectId while Agent.createdBy is a
        // string. Both have a stable exact string representation.
        const owner = String(rawOwner);
        if (owner.length === 0 || owner !== owner.trim()) {
            malformed = true;
            continue;
        }
        owners.add(owner);
    }

    return { owners: [...owners], malformed };
};

const isDuplicateKeyError = (error: unknown): boolean => (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
);

/**
 * Owns the permanent, global agentId -> tenant reservation invariant.
 *
 * The first legitimate claimant wins through an `_id`-indexed atomic upsert.
 * Before that upsert, legacy Agent and ChannelKey rows are consulted so an
 * upgrade cannot silently transfer an identity that already belonged to a
 * tenant. Every authentication re-runs the evidence check, making a manually
 * inserted conflicting key fail closed rather than bypassing the reservation.
 */
class AgentIdentityOwnershipService {
    private static instance: AgentIdentityOwnershipService;

    private constructor() {}

    public static getInstance(): AgentIdentityOwnershipService {
        if (!AgentIdentityOwnershipService.instance) {
            AgentIdentityOwnershipService.instance = new AgentIdentityOwnershipService();
        }
        return AgentIdentityOwnershipService.instance;
    }

    /**
     * Atomically reserve an agentId for an owner, or verify the existing owner.
     * The reservation is permanent and is never released by this service.
     */
    public async claimOrValidate(agentId: string, ownerId: string): Promise<void> {
        const exactAgentId = normalizeExactIdentifier(agentId, 'agentId');
        const exactOwnerId = normalizeExactIdentifier(ownerId, 'ownerId');

        if (isReservedAgentId(exactAgentId)) {
            throw new AgentIdentityOwnershipError(
                'INVALID_IDENTITY',
                `Agent identity "${exactAgentId}" is reserved for internal MXF routing; choose a different agentId.`,
                400
            );
        }

        try {
            const evidence = await this.readLegacyOwnerEvidence(exactAgentId);
            await this.assertEvidenceAllowsOwner(exactAgentId, exactOwnerId, evidence);
        } catch (error) {
            if (error instanceof AgentIdentityOwnershipError) {
                throw error;
            }
            logger.error(
                `Agent identity ownership evidence lookup failed: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            throw new AgentIdentityOwnershipError(
                'RESERVATION_UNAVAILABLE',
                'Agent identity ownership evidence is unavailable; credential issuance and authentication are denied.',
                503
            );
        }

        const reservation = await this.atomicClaim(exactAgentId, exactOwnerId);
        const reservationId = String(reservation._id ?? '').trim();
        const reservedAgentId = String(reservation.agentId ?? '').trim();
        const reservationOwner = String(reservation.ownerId ?? '').trim();

        if (reservationId !== exactAgentId || reservedAgentId !== exactAgentId) {
            throw new AgentIdentityOwnershipError(
                'RESERVATION_UNAVAILABLE',
                `Agent identity reservation "${exactAgentId}" is malformed. Reconcile the reservation ` +
                    'record before issuing or authenticating credentials.',
                503
            );
        }

        if (reservationOwner !== exactOwnerId) {
            throw new AgentIdentityOwnershipError(
                'OWNERSHIP_CONFLICT',
                `Agent identity "${exactAgentId}" is permanently reserved by another owner; ` +
                    'choose a different agentId or use credentials issued by the existing owner.',
                409
            );
        }
    }

    private async readLegacyOwnerEvidence(agentId: string): Promise<LegacyOwnerEvidence> {
        const [agentRows, channelKeyRows, reservation] = await Promise.all([
            Agent.find({ agentId }).select('createdBy').lean(),
            // Inactive and expired keys still prove historical ownership. A
            // deleted credential must never release a globally keyed identity.
            ChannelKey.find({ agentId }).select('createdBy').lean(),
            AgentIdentityReservation.findOne({ _id: agentId })
        ]);

        const parsedAgentRows = parsePersistedOwnerRows(agentRows);
        const parsedChannelKeyRows = parsePersistedOwnerRows(channelKeyRows);

        return {
            agentOwners: parsedAgentRows.owners,
            channelKeyOwners: parsedChannelKeyRows.owners,
            malformedOwnerSources: [
                ...(parsedAgentRows.malformed ? ['Agent'] : []),
                ...(parsedChannelKeyRows.malformed ? ['ChannelKey'] : [])
            ],
            reservation
        };
    }

    private async assertEvidenceAllowsOwner(
        agentId: string,
        ownerId: string,
        evidence: LegacyOwnerEvidence
    ): Promise<void> {
        const legacyOwners = [...new Set([
            ...evidence.agentOwners,
            ...evidence.channelKeyOwners
        ])];

        if (evidence.malformedOwnerSources.length > 0) {
            throw new AgentIdentityOwnershipError(
                'LEGACY_OWNERSHIP_CONFLICT',
                `Agent identity "${agentId}" has missing or malformed owners in legacy ${
                    evidence.malformedOwnerSources.join('/')
                } records. Reconcile those persisted records before this identity can be claimed or authenticated.`,
                409
            );
        }

        if (legacyOwners.length > 1) {
            throw new AgentIdentityOwnershipError(
                'LEGACY_OWNERSHIP_CONFLICT',
                `Agent identity "${agentId}" has conflicting legacy Agent/ChannelKey owners. ` +
                    'Reconcile those persisted records before this identity can issue or authenticate keys.',
                409
            );
        }

        if (evidence.reservation) {
            const reservationId = String(evidence.reservation._id ?? '').trim();
            const reservedAgentId = String(evidence.reservation.agentId ?? '').trim();
            const reservationOwner = String(evidence.reservation.ownerId ?? '').trim();

            if (reservationId !== agentId || reservedAgentId !== agentId || reservationOwner.length === 0) {
                throw new AgentIdentityOwnershipError(
                    'RESERVATION_UNAVAILABLE',
                    `Agent identity reservation "${agentId}" is malformed. Reconcile the reservation ` +
                        'record before issuing or authenticating credentials.',
                    503
                );
            }

            if (reservationOwner !== ownerId) {
                throw new AgentIdentityOwnershipError(
                    'OWNERSHIP_CONFLICT',
                    `Agent identity "${agentId}" is permanently reserved by another owner; ` +
                        'choose a different agentId or use credentials issued by the existing owner.',
                    409
                );
            }
        }

        if (legacyOwners.length === 1 && legacyOwners[0] !== ownerId) {
            throw new AgentIdentityOwnershipError(
                'OWNERSHIP_CONFLICT',
                `Agent identity "${agentId}" already belongs to another owner according to persisted ` +
                    'Agent/ChannelKey records; choose a different agentId or use the original owner.',
                409
            );
        }

        // A reservation or owner-bearing legacy row identifies who may reclaim
        // the identity. Ownerless durable memory does not. If it exists before
        // the first reservation, assigning it to the first caller would expose
        // an unknown previous agent's state, so require explicit remediation.
        if (!evidence.reservation && legacyOwners.length === 0) {
            const orphanedStateSources = await this.findOrphanedStateSources(agentId);
            if (orphanedStateSources.length > 0) {
                throw new AgentIdentityOwnershipError(
                    'ORPHANED_AGENT_STATE',
                    `Agent identity "${agentId}" has ownerless durable state in ${
                        orphanedStateSources.join(', ')
                    }. An administrator must migrate, assign, or remove that state before this agentId can be claimed.`,
                    409
                );
            }
        }
    }

    private async findOrphanedStateSources(agentId: string): Promise<string[]> {
        const evidence = await Promise.all([
            AgentMemory.exists({ agentId }),
            RelationshipMemory.exists({
                $or: [{ agentId1: agentId }, { agentId2: agentId }]
            }),
            MemoryEntryModel.exists({
                $or: [
                    { agentId },
                    { 'context.agentId': agentId },
                    { 'source.agentId': agentId }
                ]
            }),
            SurpriseHistoryModel.exists({ agentId }),
            MemoryPatternModel.exists({ agentId }),
            MemoryUtility.exists({ agentId })
        ]);

        const sourceNames = [
            'agent memory',
            'relationship memory',
            'memory strata',
            'surprise history',
            'memory patterns',
            'memory utility'
        ];

        return sourceNames.filter((_source, index) => Boolean(evidence[index]));
    }

    private async atomicClaim(
        agentId: string,
        ownerId: string
    ): Promise<IAgentIdentityReservation> {
        try {
            const reservation = await AgentIdentityReservation.findOneAndUpdate(
                { _id: agentId },
                {
                    $setOnInsert: {
                        _id: agentId,
                        agentId,
                        ownerId,
                        claimedAt: new Date()
                    }
                },
                {
                    upsert: true,
                    new: true,
                    runValidators: true,
                    setDefaultsOnInsert: true
                }
            );

            if (!reservation) {
                throw new AgentIdentityOwnershipError(
                    'RESERVATION_UNAVAILABLE',
                    'Agent identity reservation returned no record; credential issuance is denied.',
                    503
                );
            }

            return reservation;
        } catch (error) {
            if (!isDuplicateKeyError(error)) {
                logger.error(
                    `Agent identity reservation claim failed: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
                throw new AgentIdentityOwnershipError(
                    'RESERVATION_UNAVAILABLE',
                    'Agent identity ownership storage is unavailable; credential issuance and authentication are denied.',
                    503
                );
            }

            // Two unowned identities can reach an upsert together. The unique
            // index elects one winner; re-read that durable winner so the same
            // owner succeeds and a different owner receives a stable conflict.
            let winner: IAgentIdentityReservation | null;
            try {
                winner = await AgentIdentityReservation.findOne({ _id: agentId });
            } catch (readError) {
                logger.error(
                    `Agent identity reservation race winner lookup failed: ${
                        readError instanceof Error ? readError.message : String(readError)
                    }`
                );
                throw new AgentIdentityOwnershipError(
                    'RESERVATION_UNAVAILABLE',
                    'The agent identity claim raced, but its durable winner could not be verified.',
                    503
                );
            }
            if (!winner) {
                throw new AgentIdentityOwnershipError(
                    'RESERVATION_UNAVAILABLE',
                    'The agent identity claim raced, but no durable reservation winner was found.',
                    503
                );
            }
            return winner;
        }
    }
}

const agentIdentityOwnershipService = AgentIdentityOwnershipService.getInstance();
export default agentIdentityOwnershipService;
