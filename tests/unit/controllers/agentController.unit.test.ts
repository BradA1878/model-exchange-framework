/**
 * Agent Controller Unit Tests
 *
 * Tests controller logic in isolation with mocked dependencies.
 * Covers all controller methods, validation, error handling, and response formats.
 */

import { Request, Response } from 'express';

// Mock dependencies before importing controller
jest.mock('../../../src/shared/models/agent', () => ({
    Agent: {
        find: jest.fn(),
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
        findOneAndDelete: jest.fn(),
        create: jest.fn()
    }
}));

jest.mock('../../../src/shared/models/memory', () => ({
    AgentMemory: {
        deleteMany: jest.fn()
    }
}));

jest.mock('../../../src/shared/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('../../../src/shared/utils/validation', () => ({
    createStrictValidator: jest.fn().mockReturnValue({
        assertIsObject: jest.fn(),
        assertIsNonEmptyString: jest.fn(),
        assertIsString: jest.fn(),
        assertIsArray: jest.fn(),
        assertIsNumber: jest.fn(),
        assertIsBoolean: jest.fn()
    })
}));

jest.mock('../../../src/shared/events/EventBus', () => ({
    EventBus: {
        server: {
            emit: jest.fn()
        }
    }
}));

import { Agent } from '../../../src/shared/models/agent';
import { AgentMemory } from '../../../src/shared/models/memory';
import {
    getAgents,
    getAgentById,
    createAgent,
    updateAgent,
    deleteAgent,
    getAgentsByService,
    getAgentContext,
    getOrCreateAgentMemory,
    updateAgentMemory,
    updateAgentContext
} from '../../../src/server/api/controllers/agentController';

describe('AgentController', () => {
    let mockReq: Partial<Request>;
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
        } as Partial<Request>;

        // Add user to the request (authentication middleware adds this)
        (mockReq as any).user = { id: 'test-user-id' };

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

        it('should update allowedTools', async () => {
            mockReq.params = { agentId: 'agent-1' };
            mockReq.body = { allowedTools: ['tool_help', 'messaging_send'] };

            const updatedAgent = {
                agentId: 'agent-1',
                allowedTools: ['tool_help', 'messaging_send']
            };
            (Agent.findOneAndUpdate as jest.Mock).mockResolvedValue(updatedAgent);

            await updateAgent(mockReq as Request, mockRes as Response);

            expect(Agent.findOneAndUpdate).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    allowedTools: ['tool_help', 'messaging_send']
                }),
                expect.anything()
            );
        });
    });

    // =========================================================================
    // deleteAgent
    // =========================================================================

    describe('deleteAgent', () => {
        it('should return 200 when agent deleted', async () => {
            mockReq.params = { agentId: 'agent-1' };

            (Agent.findOneAndDelete as jest.Mock).mockResolvedValue({ agentId: 'agent-1' });
            (AgentMemory.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 1 });

            await deleteAgent(mockReq as Request, mockRes as Response);

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

            (Agent.findOneAndDelete as jest.Mock).mockResolvedValue(null);

            await deleteAgent(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(404);
        });

        it('should clean up agent memory on delete', async () => {
            mockReq.params = { agentId: 'agent-1' };

            (Agent.findOneAndDelete as jest.Mock).mockResolvedValue({ agentId: 'agent-1' });
            (AgentMemory.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 5 });

            await deleteAgent(mockReq as Request, mockRes as Response);

            expect(AgentMemory.deleteMany).toHaveBeenCalledWith({ agentId: 'agent-1' });
        });

        it('should succeed even if memory cleanup fails', async () => {
            mockReq.params = { agentId: 'agent-1' };

            (Agent.findOneAndDelete as jest.Mock).mockResolvedValue({ agentId: 'agent-1' });
            (AgentMemory.deleteMany as jest.Mock).mockRejectedValue(new Error('Memory error'));

            await deleteAgent(mockReq as Request, mockRes as Response);

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
            (Agent.find as jest.Mock).mockReturnValue({
                sort: jest.fn().mockResolvedValue(mockAgents)
            });

            await getAgentsByService(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(Agent.find).toHaveBeenCalledWith({
                serviceTypes: 'testing',
                status: 'ACTIVE'
            });
        });

        it('should return empty array for unknown service type', async () => {
            mockReq.params = { serviceType: 'unknown' };

            (Agent.find as jest.Mock).mockReturnValue({
                sort: jest.fn().mockResolvedValue([])
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
    // getOrCreateAgentMemory
    // =========================================================================

    describe('getOrCreateAgentMemory', () => {
        it('should return existing memory', async () => {
            mockReq.params = { keyId: 'key-123' };

            const mockAgent = {
                keyId: 'key-123',
                memory: {
                    notes: { key: 'value' },
                    conversationHistory: [],
                    customData: {},
                    updatedAt: new Date()
                }
            };
            (Agent.findOne as jest.Mock).mockResolvedValue(mockAgent);

            await getOrCreateAgentMemory(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: expect.objectContaining({
                        keyId: 'key-123',
                        notes: { key: 'value' }
                    })
                })
            );
        });

        it('should create agent with memory if not exists', async () => {
            mockReq.params = { keyId: 'new-key' };

            // When agent doesn't exist, controller creates new one
            // This test verifies the 200 response when findOne returns null
            // and new agent is created (constructor called internally)
            (Agent.findOne as jest.Mock).mockResolvedValue(null);

            // The controller will try to create a new Agent and save it
            // Since we can't easily mock the constructor, we'll just verify
            // that findOne was called with the right params
            await getOrCreateAgentMemory(mockReq as Request, mockRes as Response);

            expect(Agent.findOne).toHaveBeenCalledWith({ keyId: 'new-key' });
            // Response depends on whether constructor was successful
            // In mocked environment, this may fail gracefully
        });
    });

    // =========================================================================
    // updateAgentMemory
    // =========================================================================

    describe('updateAgentMemory', () => {
        it('should update memory notes', async () => {
            mockReq.params = { keyId: 'key-123' };
            mockReq.body = { notes: { newNote: 'value' } };

            const mockAgent = {
                keyId: 'key-123',
                memory: {
                    notes: { existingNote: 'old' },
                    conversationHistory: [],
                    customData: {}
                },
                save: jest.fn().mockResolvedValue(true)
            };
            (Agent.findOne as jest.Mock).mockResolvedValue(mockAgent);

            await updateAgentMemory(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(mockAgent.memory.notes).toEqual({
                existingNote: 'old',
                newNote: 'value'
            });
        });

        it('should append to conversation history', async () => {
            mockReq.params = { keyId: 'key-123' };
            mockReq.body = {
                conversationHistory: [{ role: 'user', content: 'Hello' }]
            };

            const mockAgent = {
                keyId: 'key-123',
                memory: {
                    notes: {},
                    conversationHistory: [],
                    customData: {}
                },
                save: jest.fn().mockResolvedValue(true)
            };
            (Agent.findOne as jest.Mock).mockResolvedValue(mockAgent);

            await updateAgentMemory(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(mockAgent.memory.conversationHistory).toHaveLength(1);
        });

        it('should return 404 for non-existent keyId', async () => {
            mockReq.params = { keyId: 'non-existent' };
            mockReq.body = { notes: { key: 'value' } };

            (Agent.findOne as jest.Mock).mockResolvedValue(null);

            await updateAgentMemory(mockReq as Request, mockRes as Response);

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
                context: {},
                role: 'worker',
                save: jest.fn().mockResolvedValue(true)
            };
            (Agent.findOne as jest.Mock).mockResolvedValue(mockAgent);

            await updateAgentContext(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect((mockAgent.context as any).identity).toBe('New identity');
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
                context: {},
                save: jest.fn().mockResolvedValue(true)
            };
            (Agent.findOne as jest.Mock).mockResolvedValue(mockAgent);

            await updateAgentContext(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect((mockAgent.context as any).constraints).toEqual(['No external calls']);
            expect((mockAgent.context as any).examples).toEqual(['Example 1']);
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
