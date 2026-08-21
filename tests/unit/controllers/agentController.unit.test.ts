/**
 * Agent Controller Unit Tests
 *
 * Tests controller logic in isolation with mocked dependencies.
 * Covers all controller methods, validation, error handling, and response formats.
 */

import { Request, Response } from 'express';

interface AuthenticatedTestRequest extends Partial<Request> {
    user?: {
        id: string;
        role?: string;
    };
}

const mockDeactivateAgentKeys = jest.fn();
const mockClaimAgentIdentity = jest.fn();

jest.mock('../../../src/server/security/AgentIdentityOwnershipService', () => ({
    __esModule: true,
    default: { claimOrValidate: mockClaimAgentIdentity },
    AgentIdentityOwnershipError: class AgentIdentityOwnershipError extends Error {
        public readonly code: string;
        public readonly statusCode: number;

        constructor(code: string, message: string, statusCode: number = 409) {
            super(message);
            this.name = 'AgentIdentityOwnershipError';
            this.code = code;
            this.statusCode = statusCode;
        }
    }
}));

// Mock dependencies before importing controller
jest.mock('@mxf-dev/core/models/agent', () => ({
    Agent: {
        find: jest.fn(),
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
        findOneAndDelete: jest.fn(),
        create: jest.fn()
    }
}));

jest.mock('@mxf-dev/core/models/memory', () => ({
    AgentMemory: {
        deleteMany: jest.fn()
    }
}));

jest.mock('../../../src/server/socket/services/ChannelKeyService', () => ({
    __esModule: true,
    default: { deactivateAgentKeys: mockDeactivateAgentKeys }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('@mxf-dev/core/utils/validation', () => ({
    createStrictValidator: jest.fn().mockReturnValue({
        assertIsObject: jest.fn(),
        assertIsNonEmptyString: jest.fn(),
        assertIsString: jest.fn(),
        assertIsArray: jest.fn(),
        assertIsNumber: jest.fn(),
        assertIsBoolean: jest.fn()
    })
}));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            emit: jest.fn()
        }
    }
}));

import { Agent } from '@mxf-dev/core/models/agent';
import { AgentMemory } from '@mxf-dev/core/models/memory';
import { AgentIdentityOwnershipError } from '../../../src/server/security/AgentIdentityOwnershipService';
import {
    getAgents,
    getAgentById,
    createAgent,
    updateAgent,
    deleteAgent,
    getAgentsByService,
    getAgentContext,
    updateAgentContext
} from '../../../src/server/api/controllers/agentController';

describe('AgentController', () => {
    let mockReq: AuthenticatedTestRequest;
    let mockRes: Partial<Response>;
    let jsonMock: jest.Mock;
    let statusMock: jest.Mock;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Setup response mock
        jsonMock = jest.fn();
        statusMock = jest.fn().mockReturnValue({ json: jsonMock });

        mockReq = {
            params: {},
            body: {},
            query: {}
        } as AuthenticatedTestRequest;

        // Add user to the request (authentication middleware adds this)
        mockReq.user = { id: 'test-user-id' };

        mockDeactivateAgentKeys.mockResolvedValue(1);
        mockClaimAgentIdentity.mockResolvedValue(undefined);

        mockRes = {
            status: statusMock,
            json: jsonMock
        };
    });

    // =========================================================================
    // getAgents
    // =========================================================================

    describe('getAgents', () => {
        it('should return 200 with list of agents', async () => {
            const mockAgents = [
                { agentId: 'agent-1', name: 'Agent 1' },
                { agentId: 'agent-2', name: 'Agent 2' }
            ];

            (Agent.find as jest.Mock).mockReturnValue({
                sort: jest.fn().mockResolvedValue(mockAgents)
            });

            await getAgents(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({
                success: true,
                count: 2,
                data: mockAgents
            });
        });

        it('should filter by status when provided', async () => {
            mockReq.query = { status: 'ACTIVE' };

            (Agent.find as jest.Mock).mockReturnValue({
                sort: jest.fn().mockResolvedValue([])
            });

            await getAgents(mockReq as Request, mockRes as Response);

            expect(Agent.find).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'ACTIVE' })
            );
        });

        it('should filter by serviceType when provided', async () => {
            mockReq.query = { serviceType: 'testing' };

            (Agent.find as jest.Mock).mockReturnValue({
                sort: jest.fn().mockResolvedValue([])
            });

            await getAgents(mockReq as Request, mockRes as Response);

            expect(Agent.find).toHaveBeenCalledWith(
                expect.objectContaining({ serviceTypes: 'testing' })
            );
        });

        it('should return 500 on database error', async () => {
            (Agent.find as jest.Mock).mockReturnValue({
                sort: jest.fn().mockRejectedValue(new Error('Database error'))
            });

            await getAgents(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(500);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({ success: false })
            );
        });
    });

    // =========================================================================
    // getAgentById
    // =========================================================================

    describe('getAgentById', () => {
        it('should return 200 with agent when found', async () => {
            const mockAgent = { agentId: 'agent-1', name: 'Test Agent' };
            mockReq.params = { agentId: 'agent-1' };

            (Agent.findOne as jest.Mock).mockResolvedValue(mockAgent);

            await getAgentById(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({
                success: true,
                data: mockAgent
            });
        });

        it('should return 404 when agent not found', async () => {
            mockReq.params = { agentId: 'non-existent' };

            (Agent.findOne as jest.Mock).mockResolvedValue(null);

            await getAgentById(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(404);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    message: 'Agent not found'
                })
            );
        });

        it('should return 500 on database error', async () => {
            mockReq.params = { agentId: 'agent-1' };

            (Agent.findOne as jest.Mock).mockRejectedValue(new Error('Database error'));

            await getAgentById(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(500);
        });
    });

    // =========================================================================
    // createAgent
    // =========================================================================

    describe('createAgent', () => {
        const validAgentData = {
            agentId: 'new-agent',
            name: 'New Agent',
            description: 'Test agent',
            type: 'worker',
            serviceTypes: ['testing'],
            capabilities: ['testing']
        };

        it('should return 201 when agent created successfully', async () => {
            mockReq.body = validAgentData;

            (Agent.findOne as jest.Mock).mockResolvedValue(null);
            (Agent.create as jest.Mock).mockResolvedValue({
                ...validAgentData,
                status: 'INACTIVE'
            });

            await createAgent(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(201);
            expect(mockClaimAgentIdentity).toHaveBeenCalledWith('new-agent', 'test-user-id');
            expect(mockClaimAgentIdentity.mock.invocationCallOrder[0])
                .toBeLessThan((Agent.create as jest.Mock).mock.invocationCallOrder[0]);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({ success: true })
            );
        });

        it('should return 400 when agent already exists', async () => {
            mockReq.body = validAgentData;

            (Agent.findOne as jest.Mock).mockResolvedValue({ agentId: 'new-agent' });

            await createAgent(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(400);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    message: 'Agent with this ID already exists'
                })
            );
        });

        it('should return 500 on database error', async () => {
            mockReq.body = validAgentData;

            (Agent.findOne as jest.Mock).mockResolvedValue(null);
            (Agent.create as jest.Mock).mockRejectedValue(new Error('Database error'));

            await createAgent(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(500);
        });
    });

    // =========================================================================
    // updateAgent
    // =========================================================================

    describe('updateAgent', () => {
        it('should return 200 when agent updated', async () => {
            mockReq.params = { agentId: 'agent-1' };
            mockReq.body = { name: 'Updated Name' };

            const updatedAgent = { agentId: 'agent-1', name: 'Updated Name' };
            (Agent.findOneAndUpdate as jest.Mock).mockResolvedValue(updatedAgent);

            await updateAgent(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({
                success: true,
                data: updatedAgent
            });
        });

        it('should return 404 when agent not found', async () => {
            mockReq.params = { agentId: 'non-existent' };
            mockReq.body = { name: 'New Name' };

            (Agent.findOneAndUpdate as jest.Mock).mockResolvedValue(null);

            await updateAgent(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(404);
        });

        it('does not mutate credential-owned allowedTools through the agent profile', async () => {
            mockReq.params = { agentId: 'agent-1' };
            mockReq.body = { allowedTools: ['tool_help', 'messaging_send'] };

            await updateAgent(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(400);
            expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: expect.stringContaining('channel keys')
            }));
            expect(Agent.findOneAndUpdate).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // deleteAgent
    // =========================================================================

    describe('deleteAgent', () => {
        it('should return 200 when agent deleted', async () => {
            mockReq.params = { agentId: 'agent-1' };

            const persistedAgent = {
                _id: 'persisted-agent-id',
                agentId: 'agent-1',
                createdBy: 'test-user-id'
            };
            (Agent.findOne as jest.Mock).mockResolvedValue(persistedAgent);
            (Agent.findOneAndDelete as jest.Mock).mockResolvedValue(persistedAgent);
            (AgentMemory.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 1 });

            await deleteAgent(mockReq as Request, mockRes as Response);

            expect(mockClaimAgentIdentity).toHaveBeenCalledWith(
                'agent-1',
                'test-user-id'
            );
            expect(mockDeactivateAgentKeys).toHaveBeenCalledWith(
                'agent-1',
                'test-user-id'
            );
            expect(Agent.findOneAndDelete).toHaveBeenCalledWith({
                _id: 'persisted-agent-id',
                agentId: 'agent-1',
                createdBy: 'test-user-id'
            });
            expect(mockDeactivateAgentKeys.mock.invocationCallOrder[0])
                .toBeLessThan((Agent.findOneAndDelete as jest.Mock).mock.invocationCallOrder[0]);
            expect(mockClaimAgentIdentity.mock.invocationCallOrder[0])
                .toBeLessThan(mockDeactivateAgentKeys.mock.invocationCallOrder[0]);
            expect(mockDeactivateAgentKeys.mock.invocationCallOrder[0])
                .toBeLessThan((AgentMemory.deleteMany as jest.Mock).mock.invocationCallOrder[0]);
            expect((AgentMemory.deleteMany as jest.Mock).mock.invocationCallOrder[0])
                .toBeLessThan((Agent.findOneAndDelete as jest.Mock).mock.invocationCallOrder[0]);
            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: 'Agent deleted successfully'
                })
            );
        });

        it('should return 404 when agent not found', async () => {
            mockReq.params = { agentId: 'non-existent' };

            (Agent.findOne as jest.Mock).mockResolvedValue(null);

            await deleteAgent(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(404);
            expect(mockDeactivateAgentKeys).not.toHaveBeenCalled();
            expect(Agent.findOneAndDelete).not.toHaveBeenCalled();
        });

        it('should clean up agent memory on delete', async () => {
            mockReq.params = { agentId: 'agent-1' };

            const persistedAgent = {
                _id: 'persisted-agent-id',
                agentId: 'agent-1',
                createdBy: 'test-user-id'
            };
            (Agent.findOne as jest.Mock).mockResolvedValue(persistedAgent);
            (Agent.findOneAndDelete as jest.Mock).mockResolvedValue(persistedAgent);
            (AgentMemory.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 5 });

            await deleteAgent(mockReq as Request, mockRes as Response);

            expect(AgentMemory.deleteMany).toHaveBeenCalledWith({ agentId: 'agent-1' });
        });

        it('fails honestly and leaves the Agent retryable when memory cleanup fails', async () => {
            mockReq.params = { agentId: 'agent-1' };

            const persistedAgent = {
                _id: 'persisted-agent-id',
                agentId: 'agent-1',
                createdBy: 'test-user-id'
            };
            (Agent.findOne as jest.Mock).mockResolvedValue(persistedAgent);
            (Agent.findOneAndDelete as jest.Mock).mockResolvedValue(persistedAgent);
            (AgentMemory.deleteMany as jest.Mock).mockRejectedValue(new Error('Memory error'));

            await deleteAgent(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(500);
            expect(Agent.findOneAndDelete).not.toHaveBeenCalled();
        });

        it('fails closed before deletion when credential revocation fails', async () => {
            mockReq.params = { agentId: 'agent-1' };
            (Agent.findOne as jest.Mock).mockResolvedValue({
                _id: 'persisted-agent-id',
                agentId: 'agent-1',
                createdBy: 'test-user-id'
            });
            mockDeactivateAgentKeys.mockRejectedValue(new Error('key database unavailable'));

            await deleteAgent(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(500);
            expect(Agent.findOneAndDelete).not.toHaveBeenCalled();
            expect(AgentMemory.deleteMany).not.toHaveBeenCalled();
        });

        it('returns the actionable ownership status and performs no deletion on reservation conflict', async () => {
            mockReq.params = { agentId: 'agent-1' };
            (Agent.findOne as jest.Mock).mockResolvedValue({
                _id: 'persisted-agent-id',
                agentId: 'agent-1',
                createdBy: 'test-user-id'
            });
            mockClaimAgentIdentity.mockRejectedValue(
                new AgentIdentityOwnershipError(
                    'LEGACY_OWNERSHIP_CONFLICT',
                    'legacy ownership conflict',
                    409
                )
            );

            await deleteAgent(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(409);
            expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: 'legacy ownership conflict'
            }));
            expect(mockDeactivateAgentKeys).not.toHaveBeenCalled();
            expect(AgentMemory.deleteMany).not.toHaveBeenCalled();
            expect(Agent.findOneAndDelete).not.toHaveBeenCalled();
        });

        it('uses the persisted owner when an administrator deletes another owner\'s agent', async () => {
            mockReq.user = { id: 'admin-id', role: 'admin' };
            mockReq.params = { agentId: 'agent-1' };
            const persistedAgent = {
                _id: 'persisted-agent-id',
                agentId: 'agent-1',
                createdBy: 'owner-id'
            };
            (Agent.findOne as jest.Mock).mockResolvedValue(persistedAgent);
            (Agent.findOneAndDelete as jest.Mock).mockResolvedValue(persistedAgent);
            (AgentMemory.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 0 });

            await deleteAgent(mockReq as Request, mockRes as Response);

            expect(Agent.findOne).toHaveBeenCalledWith({ agentId: 'agent-1' });
            expect(mockDeactivateAgentKeys).toHaveBeenCalledWith('agent-1', 'owner-id');
            expect(statusMock).toHaveBeenCalledWith(200);
        });
    });

    // =========================================================================
    // getAgentsByService
    // =========================================================================

    describe('getAgentsByService', () => {
        it('should return agents filtered by service type', async () => {
            mockReq.params = { serviceType: 'testing' };

            const mockAgents = [{ agentId: 'agent-1', serviceTypes: ['testing'] }];
            const sort = jest.fn().mockResolvedValue(mockAgents);
            (Agent.find as jest.Mock).mockReturnValue({
                select: jest.fn().mockReturnValue({ sort })
            });

            await getAgentsByService(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(Agent.find).toHaveBeenCalledWith({
                serviceTypes: 'testing',
                status: 'ACTIVE',
                createdBy: 'test-user-id'
            });
        });

        it('allows an administrator to query active agents across owners', async () => {
            mockReq.user = { id: 'admin-user-id', role: 'admin' };
            mockReq.params = { serviceType: 'testing' };
            const sort = jest.fn().mockResolvedValue([]);
            (Agent.find as jest.Mock).mockReturnValue({
                select: jest.fn().mockReturnValue({ sort })
            });

            await getAgentsByService(mockReq as Request, mockRes as Response);

            expect(Agent.find).toHaveBeenCalledWith({
                serviceTypes: 'testing',
                status: 'ACTIVE'
            });
        });

        it('should return empty array for unknown service type', async () => {
            mockReq.params = { serviceType: 'unknown' };

            const sort = jest.fn().mockResolvedValue([]);
            (Agent.find as jest.Mock).mockReturnValue({
                select: jest.fn().mockReturnValue({ sort })
            });

            await getAgentsByService(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({
                success: true,
                count: 0,
                data: []
            });
        });
    });

    // =========================================================================
    // getAgentContext
    // =========================================================================

    describe('getAgentContext', () => {
        it('should return agent context when found', async () => {
            mockReq.params = { keyId: 'key-123' };

            const mockAgent = {
                keyId: 'key-123',
                context: {
                    identity: 'Test identity',
                    instructions: 'Test instructions'
                },
                role: 'worker',
                specialization: 'testing'
            };
            (Agent.findOne as jest.Mock).mockResolvedValue(mockAgent);

            await getAgentContext(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: expect.objectContaining({
                        keyId: 'key-123',
                        identity: 'Test identity'
                    })
                })
            );
        });

        it('should return 404 for non-existent keyId', async () => {
            mockReq.params = { keyId: 'non-existent' };

            (Agent.findOne as jest.Mock).mockResolvedValue(null);

            await getAgentContext(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(404);
        });
    });

    // =========================================================================
    // updateAgentContext
    // =========================================================================

    describe('updateAgentContext', () => {
        it('should update agent context fields', async () => {
            mockReq.params = { keyId: 'key-123' };
            mockReq.body = {
                identity: 'New identity',
                role: 'coordinator'
            };

            const mockAgent = {
                keyId: 'key-123',
                context: {} as { identity?: string },
                role: 'worker',
                save: jest.fn().mockResolvedValue(true)
            };
            (Agent.findOne as jest.Mock).mockResolvedValue(mockAgent);

            await updateAgentContext(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(mockAgent.context.identity).toBe('New identity');
            expect(mockAgent.role).toBe('coordinator');
        });

        it('should update constraints and examples', async () => {
            mockReq.params = { keyId: 'key-123' };
            mockReq.body = {
                constraints: ['No external calls'],
                examples: ['Example 1']
            };

            const mockAgent = {
                keyId: 'key-123',
                context: {} as { constraints?: string[]; examples?: string[] },
                save: jest.fn().mockResolvedValue(true)
            };
            (Agent.findOne as jest.Mock).mockResolvedValue(mockAgent);

            await updateAgentContext(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(mockAgent.context.constraints).toEqual(['No external calls']);
            expect(mockAgent.context.examples).toEqual(['Example 1']);
        });

        it('should return 404 for non-existent keyId', async () => {
            mockReq.params = { keyId: 'non-existent' };
            mockReq.body = { identity: 'test' };

            (Agent.findOne as jest.Mock).mockResolvedValue(null);

            await updateAgentContext(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(404);
        });
    });

    // =========================================================================
    // Response Format Consistency
    // =========================================================================

    describe('Response Format Consistency', () => {
        it('all success responses should have success: true', async () => {
            const mockAgents = [{ agentId: 'agent-1' }];
            (Agent.find as jest.Mock).mockReturnValue({
                sort: jest.fn().mockResolvedValue(mockAgents)
            });

            await getAgents(mockReq as Request, mockRes as Response);

            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({ success: true })
            );
        });

        it('all error responses should have success: false', async () => {
            mockReq.params = { agentId: 'non-existent' };
            (Agent.findOne as jest.Mock).mockResolvedValue(null);

            await getAgentById(mockReq as Request, mockRes as Response);

            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({ success: false })
            );
        });
    });
});
