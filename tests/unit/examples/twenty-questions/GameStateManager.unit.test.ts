/**
 * Unit tests for Twenty Questions GameStateManager
 *
 * Tests the Knowledge Graph, Risk Assessment, and MULS Reward features
 * added to the game state manager. These features track:
 * - Knowledge Graph: Guesser's evolving mental model of the possibility space
 * - Risk Assessment: ML-based scoring for "should I guess now or ask more?"
 * - MULS Rewards: Memory utility learning reward injections
 */

import { GameStateManager } from '../../../../examples/twenty-questions/server/engine/GameStateManager';
import {
    KnowledgeNode,
    KnowledgeEdge,
    RiskAssessment,
    MulsReward
} from '../../../../examples/twenty-questions/server/types/game';

describe('GameStateManager - Knowledge Graph, Risk Assessment, MULS', () => {
    let manager: GameStateManager;

    beforeEach(() => {
        manager = new GameStateManager();
    });

    describe('Initial State', () => {
        it('should initialize knowledgeGraph with empty nodes and edges arrays', () => {
            const state = manager.getState();
            expect(state.knowledgeGraph).toBeDefined();
            expect(state.knowledgeGraph.nodes).toEqual([]);
            expect(state.knowledgeGraph.edges).toEqual([]);
        });

        it('should initialize riskAssessments as an empty array', () => {
            const state = manager.getState();
            expect(state.riskAssessments).toBeDefined();
            expect(state.riskAssessments).toEqual([]);
        });

        it('should initialize mulsRewards as an empty array', () => {
            const state = manager.getState();
            expect(state.mulsRewards).toBeDefined();
            expect(state.mulsRewards).toEqual([]);
        });
    });

    describe('addKnowledgeNode', () => {
        it('should add a single knowledge node to the graph', () => {
            const node: KnowledgeNode = {
                entity: 'is_living',
                type: 'property',
                confidence: 0.9,
                questionNumber: 1
            };

            manager.addKnowledgeNode(node);

            const state = manager.getState();
            expect(state.knowledgeGraph.nodes).toHaveLength(1);
            expect(state.knowledgeGraph.nodes[0]).toEqual(node);
        });

        it('should accumulate multiple knowledge nodes', () => {
            const nodes: KnowledgeNode[] = [
                { entity: 'animal', type: 'category', confidence: 0.95, questionNumber: 1 },
                { entity: 'has_fur', type: 'property', confidence: 0.8, questionNumber: 2 },
                { entity: 'dog', type: 'candidate', confidence: 0.6, questionNumber: 3 },
                { entity: 'fish', type: 'eliminated', confidence: 0.0, questionNumber: 2 }
            ];

            for (const node of nodes) {
                manager.addKnowledgeNode(node);
            }

            const state = manager.getState();
            expect(state.knowledgeGraph.nodes).toHaveLength(4);
            expect(state.knowledgeGraph.nodes).toEqual(nodes);
        });

        it('should accept all valid node types: category, property, candidate, eliminated', () => {
            const types: KnowledgeNode['type'][] = ['category', 'property', 'candidate', 'eliminated'];

            for (const type of types) {
                manager.addKnowledgeNode({
                    entity: `test-${type}`,
                    type,
                    confidence: 0.5,
                    questionNumber: 1
                });
            }

            const state = manager.getState();
            expect(state.knowledgeGraph.nodes).toHaveLength(4);

            const storedTypes = state.knowledgeGraph.nodes.map(n => n.type);
            expect(storedTypes).toEqual(types);
        });

        it('should preserve node confidence values accurately', () => {
            const confidenceValues = [0.0, 0.1, 0.5, 0.99, 1.0];

            for (const confidence of confidenceValues) {
                manager.addKnowledgeNode({
                    entity: `entity-${confidence}`,
                    type: 'property',
                    confidence,
                    questionNumber: 1
                });
            }

            const state = manager.getState();
            const storedConfidences = state.knowledgeGraph.nodes.map(n => n.confidence);
            expect(storedConfidences).toEqual(confidenceValues);
        });

        it('should trigger state change callback when a node is added', () => {
            const callback = jest.fn();
            manager.onStateChangeCallback(callback);

            manager.addKnowledgeNode({
                entity: 'test',
                type: 'property',
                confidence: 0.5,
                questionNumber: 1
            });

            expect(callback).toHaveBeenCalledTimes(1);
            const callbackState = callback.mock.calls[0][0];
            expect(callbackState.knowledgeGraph.nodes).toHaveLength(1);
        });
    });

    describe('addKnowledgeEdge', () => {
        it('should add a single knowledge edge to the graph', () => {
            const edge: KnowledgeEdge = {
                from: 'animal',
                to: 'has_fur',
                relationship: 'has_property',
                questionNumber: 2
            };

            manager.addKnowledgeEdge(edge);

            const state = manager.getState();
            expect(state.knowledgeGraph.edges).toHaveLength(1);
            expect(state.knowledgeGraph.edges[0]).toEqual(edge);
        });

        it('should accumulate multiple knowledge edges', () => {
            const edges: KnowledgeEdge[] = [
                { from: 'animal', to: 'has_fur', relationship: 'has_property', questionNumber: 2 },
                { from: 'dog', to: 'animal', relationship: 'could_be', questionNumber: 3 },
                { from: 'fish', to: 'has_fur', relationship: 'is_not', questionNumber: 2 }
            ];

            for (const edge of edges) {
                manager.addKnowledgeEdge(edge);
            }

            const state = manager.getState();
            expect(state.knowledgeGraph.edges).toHaveLength(3);
            expect(state.knowledgeGraph.edges).toEqual(edges);
        });

        it('should trigger state change callback when an edge is added', () => {
            const callback = jest.fn();
            manager.onStateChangeCallback(callback);

            manager.addKnowledgeEdge({
                from: 'a',
                to: 'b',
                relationship: 'related_to',
                questionNumber: 1
            });

            expect(callback).toHaveBeenCalledTimes(1);
            const callbackState = callback.mock.calls[0][0];
            expect(callbackState.knowledgeGraph.edges).toHaveLength(1);
        });
    });

    describe('getKnowledgeGraph', () => {
        it('should return an empty graph when no nodes or edges are added', () => {
            const kg = manager.getKnowledgeGraph();
            expect(kg).toEqual({ nodes: [], edges: [] });
        });

        it('should return all added nodes and edges', () => {
            const node: KnowledgeNode = {
                entity: 'animal',
                type: 'category',
                confidence: 0.95,
                questionNumber: 1
            };
            const edge: KnowledgeEdge = {
                from: 'animal',
                to: 'has_fur',
                relationship: 'has_property',
                questionNumber: 2
            };

            manager.addKnowledgeNode(node);
            manager.addKnowledgeEdge(edge);

            const kg = manager.getKnowledgeGraph();
            expect(kg.nodes).toHaveLength(1);
            expect(kg.nodes[0]).toEqual(node);
            expect(kg.edges).toHaveLength(1);
            expect(kg.edges[0]).toEqual(edge);
        });

        it('should return a shallow copy (not the same reference as internal state)', () => {
            manager.addKnowledgeNode({
                entity: 'test',
                type: 'property',
                confidence: 0.5,
                questionNumber: 1
            });

            const kg1 = manager.getKnowledgeGraph();
            const kg2 = manager.getKnowledgeGraph();

            // The returned objects should not be the same reference
            expect(kg1).not.toBe(kg2);
            // But they should have equal content
            expect(kg1).toEqual(kg2);
        });
    });

    describe('addRiskAssessment', () => {
        it('should add a single risk assessment', () => {
            const assessment: RiskAssessment = {
                questionNumber: 5,
                riskScore: 0.7,
                confidence: 0.85,
                recommendation: 'ask_more',
                timestamp: Date.now()
            };

            manager.addRiskAssessment(assessment);

            const state = manager.getState();
            expect(state.riskAssessments).toHaveLength(1);
            expect(state.riskAssessments[0]).toEqual(assessment);
        });

        it('should accumulate multiple risk assessments in order', () => {
            const assessments: RiskAssessment[] = [
                { questionNumber: 3, riskScore: 0.8, confidence: 0.6, recommendation: 'ask_more', timestamp: 1000 },
                { questionNumber: 7, riskScore: 0.5, confidence: 0.7, recommendation: 'ask_more', timestamp: 2000 },
                { questionNumber: 12, riskScore: 0.2, confidence: 0.9, recommendation: 'guess_now', timestamp: 3000 }
            ];

            for (const assessment of assessments) {
                manager.addRiskAssessment(assessment);
            }

            const state = manager.getState();
            expect(state.riskAssessments).toHaveLength(3);
            expect(state.riskAssessments).toEqual(assessments);
        });

        it('should trigger state change callback when an assessment is added', () => {
            const callback = jest.fn();
            manager.onStateChangeCallback(callback);

            manager.addRiskAssessment({
                questionNumber: 1,
                riskScore: 0.5,
                confidence: 0.5,
                recommendation: 'ask_more',
                timestamp: Date.now()
            });

            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('getLatestRiskAssessment', () => {
        it('should return null when no assessments have been added', () => {
            const latest = manager.getLatestRiskAssessment();
            expect(latest).toBeNull();
        });

        it('should return the single assessment when one is added', () => {
            const assessment: RiskAssessment = {
                questionNumber: 5,
                riskScore: 0.7,
                confidence: 0.85,
                recommendation: 'ask_more',
                timestamp: Date.now()
            };

            manager.addRiskAssessment(assessment);
            const latest = manager.getLatestRiskAssessment();
            expect(latest).toEqual(assessment);
        });

        it('should return the last added assessment when multiple exist', () => {
            const assessments: RiskAssessment[] = [
                { questionNumber: 3, riskScore: 0.8, confidence: 0.6, recommendation: 'ask_more', timestamp: 1000 },
                { questionNumber: 7, riskScore: 0.5, confidence: 0.7, recommendation: 'ask_more', timestamp: 2000 },
                { questionNumber: 12, riskScore: 0.2, confidence: 0.9, recommendation: 'guess_now', timestamp: 3000 }
            ];

            for (const assessment of assessments) {
                manager.addRiskAssessment(assessment);
            }

            const latest = manager.getLatestRiskAssessment();
            expect(latest).toEqual(assessments[2]);
            expect(latest!.questionNumber).toBe(12);
            expect(latest!.recommendation).toBe('guess_now');
        });
    });

    describe('addMulsReward', () => {
        it('should add a single MULS reward', () => {
            const reward: MulsReward = {
                questionNumber: 4,
                reward: 0.8,
                reason: 'Effective narrowing question',
                timestamp: Date.now()
            };

            manager.addMulsReward(reward);

            const state = manager.getState();
            expect(state.mulsRewards).toHaveLength(1);
            expect(state.mulsRewards[0]).toEqual(reward);
        });

        it('should accumulate multiple MULS rewards in order', () => {
            const rewards: MulsReward[] = [
                { questionNumber: 1, reward: 0.3, reason: 'Broad question', timestamp: 1000 },
                { questionNumber: 2, reward: 0.7, reason: 'Good narrowing', timestamp: 2000 },
                { questionNumber: 3, reward: -0.2, reason: 'Redundant question', timestamp: 3000 }
            ];

            for (const reward of rewards) {
                manager.addMulsReward(reward);
            }

            const state = manager.getState();
            expect(state.mulsRewards).toHaveLength(3);
            expect(state.mulsRewards).toEqual(rewards);
        });

        it('should accept negative reward values', () => {
            const reward: MulsReward = {
                questionNumber: 5,
                reward: -0.5,
                reason: 'Wasted question',
                timestamp: Date.now()
            };

            manager.addMulsReward(reward);

            const state = manager.getState();
            expect(state.mulsRewards[0].reward).toBe(-0.5);
        });

        it('should accept zero reward values', () => {
            const reward: MulsReward = {
                questionNumber: 6,
                reward: 0,
                reason: 'Neutral outcome',
                timestamp: Date.now()
            };

            manager.addMulsReward(reward);

            const state = manager.getState();
            expect(state.mulsRewards[0].reward).toBe(0);
        });

        it('should trigger state change callback when a reward is added', () => {
            const callback = jest.fn();
            manager.onStateChangeCallback(callback);

            manager.addMulsReward({
                questionNumber: 1,
                reward: 0.5,
                reason: 'Test',
                timestamp: Date.now()
            });

            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    describe('reset', () => {
        it('should clear knowledgeGraph nodes and edges on reset', () => {
            // Add some knowledge graph data
            manager.addKnowledgeNode({
                entity: 'animal',
                type: 'category',
                confidence: 0.95,
                questionNumber: 1
            });
            manager.addKnowledgeNode({
                entity: 'has_fur',
                type: 'property',
                confidence: 0.8,
                questionNumber: 2
            });
            manager.addKnowledgeEdge({
                from: 'animal',
                to: 'has_fur',
                relationship: 'has_property',
                questionNumber: 2
            });

            // Verify data exists before reset
            const stateBefore = manager.getState();
            expect(stateBefore.knowledgeGraph.nodes).toHaveLength(2);
            expect(stateBefore.knowledgeGraph.edges).toHaveLength(1);

            // Reset
            manager.reset();

            // Verify data is cleared
            const stateAfter = manager.getState();
            expect(stateAfter.knowledgeGraph.nodes).toEqual([]);
            expect(stateAfter.knowledgeGraph.edges).toEqual([]);
        });

        it('should clear riskAssessments on reset', () => {
            manager.addRiskAssessment({
                questionNumber: 5,
                riskScore: 0.7,
                confidence: 0.85,
                recommendation: 'ask_more',
                timestamp: Date.now()
            });
            manager.addRiskAssessment({
                questionNumber: 10,
                riskScore: 0.3,
                confidence: 0.9,
                recommendation: 'guess_now',
                timestamp: Date.now()
            });

            const stateBefore = manager.getState();
            expect(stateBefore.riskAssessments).toHaveLength(2);

            manager.reset();

            const stateAfter = manager.getState();
            expect(stateAfter.riskAssessments).toEqual([]);
        });

        it('should clear mulsRewards on reset', () => {
            manager.addMulsReward({
                questionNumber: 3,
                reward: 0.8,
                reason: 'Good strategy',
                timestamp: Date.now()
            });

            const stateBefore = manager.getState();
            expect(stateBefore.mulsRewards).toHaveLength(1);

            manager.reset();

            const stateAfter = manager.getState();
            expect(stateAfter.mulsRewards).toEqual([]);
        });

        it('should return null from getLatestRiskAssessment after reset', () => {
            manager.addRiskAssessment({
                questionNumber: 5,
                riskScore: 0.5,
                confidence: 0.5,
                recommendation: 'ask_more',
                timestamp: Date.now()
            });

            expect(manager.getLatestRiskAssessment()).not.toBeNull();

            manager.reset();

            expect(manager.getLatestRiskAssessment()).toBeNull();
        });

        it('should return empty knowledge graph from getKnowledgeGraph after reset', () => {
            manager.addKnowledgeNode({
                entity: 'test',
                type: 'property',
                confidence: 0.5,
                questionNumber: 1
            });

            expect(manager.getKnowledgeGraph().nodes).toHaveLength(1);

            manager.reset();

            const kg = manager.getKnowledgeGraph();
            expect(kg.nodes).toEqual([]);
            expect(kg.edges).toEqual([]);
        });

        it('should preserve player info but clear orpar phases on reset', () => {
            manager.setPlayer('thinker', {
                agentId: 'thinker-agent',
                name: 'The Thinker',
                model: 'test-model',
                personality: 'clever'
            });
            manager.setPlayer('guesser', {
                agentId: 'guesser-agent',
                name: 'The Guesser',
                model: 'test-model',
                personality: 'curious'
            });

            manager.reset();

            const state = manager.getState();
            // Player info is preserved
            expect(state.players.thinker.agentId).toBe('thinker-agent');
            expect(state.players.thinker.name).toBe('The Thinker');
            expect(state.players.guesser.agentId).toBe('guesser-agent');
            expect(state.players.guesser.name).toBe('The Guesser');
            // But ORPAR phases are cleared
            expect(state.players.thinker.orparPhases).toEqual([]);
            expect(state.players.guesser.orparPhases).toEqual([]);
        });
    });

    describe('getStateSummary - Knowledge Graph section', () => {
        beforeEach(() => {
            // Set up a minimal valid game state so getStateSummary can produce meaningful output
            manager.setPlayer('thinker', { agentId: 'thinker-1', name: 'Thinker', model: 'test', personality: 'test' });
            manager.setPlayer('guesser', { agentId: 'guesser-1', name: 'Guesser', model: 'test', personality: 'test' });
        });

        it('should not include Knowledge Model section when graph is empty', () => {
            const summary = manager.getStateSummary('guesser');
            expect(summary).not.toContain('Knowledge Model');
        });

        it('should include Knowledge Model section when nodes exist', () => {
            manager.addKnowledgeNode({
                entity: 'is_alive',
                type: 'property',
                confidence: 0.9,
                questionNumber: 1
            });

            const summary = manager.getStateSummary('guesser');
            expect(summary).toContain('Knowledge Model');
            expect(summary).toContain('Entities: 1');
            expect(summary).toContain('Relationships: 0');
        });

        it('should display entity and relationship counts accurately', () => {
            manager.addKnowledgeNode({ entity: 'animal', type: 'category', confidence: 0.95, questionNumber: 1 });
            manager.addKnowledgeNode({ entity: 'has_fur', type: 'property', confidence: 0.8, questionNumber: 2 });
            manager.addKnowledgeNode({ entity: 'dog', type: 'candidate', confidence: 0.6, questionNumber: 3 });
            manager.addKnowledgeEdge({ from: 'animal', to: 'has_fur', relationship: 'has_property', questionNumber: 2 });
            manager.addKnowledgeEdge({ from: 'dog', to: 'animal', relationship: 'could_be', questionNumber: 3 });

            const summary = manager.getStateSummary('guesser');
            expect(summary).toContain('Entities: 3');
            expect(summary).toContain('Relationships: 2');
        });

        it('should list known properties', () => {
            manager.addKnowledgeNode({ entity: 'has_wings', type: 'property', confidence: 0.9, questionNumber: 1 });
            manager.addKnowledgeNode({ entity: 'can_fly', type: 'property', confidence: 0.85, questionNumber: 2 });

            const summary = manager.getStateSummary('guesser');
            expect(summary).toContain('Known properties: has_wings, can_fly');
        });

        it('should list candidates', () => {
            manager.addKnowledgeNode({ entity: 'eagle', type: 'candidate', confidence: 0.7, questionNumber: 5 });
            manager.addKnowledgeNode({ entity: 'hawk', type: 'candidate', confidence: 0.6, questionNumber: 5 });

            const summary = manager.getStateSummary('guesser');
            expect(summary).toContain('Candidates: eagle, hawk');
        });

        it('should list eliminated entities', () => {
            manager.addKnowledgeNode({ entity: 'fish', type: 'eliminated', confidence: 0.0, questionNumber: 2 });
            manager.addKnowledgeNode({ entity: 'reptile', type: 'eliminated', confidence: 0.0, questionNumber: 4 });

            const summary = manager.getStateSummary('guesser');
            expect(summary).toContain('Eliminated: fish, reptile');
        });

        it('should not include property/candidate/eliminated sections when none of that type exist', () => {
            // Add only a category node (no properties, candidates, or eliminated)
            manager.addKnowledgeNode({ entity: 'animal', type: 'category', confidence: 0.95, questionNumber: 1 });

            const summary = manager.getStateSummary('guesser');
            expect(summary).toContain('Knowledge Model');
            expect(summary).not.toContain('Known properties:');
            expect(summary).not.toContain('Candidates:');
            expect(summary).not.toContain('Eliminated:');
        });
    });

    describe('getStateSummary - Risk Assessment section', () => {
        beforeEach(() => {
            manager.setPlayer('thinker', { agentId: 'thinker-1', name: 'Thinker', model: 'test', personality: 'test' });
            manager.setPlayer('guesser', { agentId: 'guesser-1', name: 'Guesser', model: 'test', personality: 'test' });
        });

        it('should not include Risk Assessment section when no assessments exist', () => {
            const summary = manager.getStateSummary('guesser');
            expect(summary).not.toContain('Risk Assessment');
        });

        it('should include Risk Assessment section with the latest assessment', () => {
            manager.addRiskAssessment({
                questionNumber: 5,
                riskScore: 0.72,
                confidence: 0.85,
                recommendation: 'ask_more',
                timestamp: Date.now()
            });

            const summary = manager.getStateSummary('guesser');
            expect(summary).toContain('Risk Assessment');
            expect(summary).toContain('Risk Score: 72%');
            expect(summary).toContain('Confidence: 85%');
            expect(summary).toContain('Recommendation: ask_more');
        });

        it('should display only the latest risk assessment in the summary', () => {
            manager.addRiskAssessment({
                questionNumber: 3,
                riskScore: 0.8,
                confidence: 0.6,
                recommendation: 'ask_more',
                timestamp: 1000
            });
            manager.addRiskAssessment({
                questionNumber: 10,
                riskScore: 0.15,
                confidence: 0.92,
                recommendation: 'guess_now',
                timestamp: 2000
            });

            const summary = manager.getStateSummary('guesser');
            // Should show the latest (second) assessment
            expect(summary).toContain('Risk Score: 15%');
            expect(summary).toContain('Confidence: 92%');
            expect(summary).toContain('Recommendation: guess_now');
        });

        it('should format risk score as integer percentage', () => {
            manager.addRiskAssessment({
                questionNumber: 1,
                riskScore: 0.333,
                confidence: 0.667,
                recommendation: 'ask_more',
                timestamp: Date.now()
            });

            const summary = manager.getStateSummary('guesser');
            // 0.333 * 100 = 33.3, toFixed(0) = "33"
            expect(summary).toContain('Risk Score: 33%');
            // 0.667 * 100 = 66.7, toFixed(0) = "67"
            expect(summary).toContain('Confidence: 67%');
        });
    });

    describe('getStateSummary - Combined sections', () => {
        beforeEach(() => {
            manager.setPlayer('thinker', { agentId: 'thinker-1', name: 'Thinker', model: 'test', personality: 'test' });
            manager.setPlayer('guesser', { agentId: 'guesser-1', name: 'Guesser', model: 'test', personality: 'test' });
        });

        it('should include both Knowledge Model and Risk Assessment when both have data', () => {
            manager.addKnowledgeNode({ entity: 'animal', type: 'category', confidence: 0.95, questionNumber: 1 });
            manager.addKnowledgeNode({ entity: 'has_fur', type: 'property', confidence: 0.8, questionNumber: 2 });
            manager.addRiskAssessment({
                questionNumber: 5,
                riskScore: 0.4,
                confidence: 0.8,
                recommendation: 'ask_more',
                timestamp: Date.now()
            });

            const summary = manager.getStateSummary('guesser');
            expect(summary).toContain('Knowledge Model');
            expect(summary).toContain('Entities: 2');
            expect(summary).toContain('Risk Assessment');
            expect(summary).toContain('Risk Score: 40%');
        });

        it('should always include standard game info regardless of advanced features', () => {
            const summary = manager.getStateSummary('guesser');
            expect(summary).toContain('Twenty Questions Game State');
            expect(summary).toContain('Your Role: GUESSER');
            expect(summary).toContain('Phase: setup');
            expect(summary).toContain('Questions Asked: 0/20');
            expect(summary).toContain('Questions Remaining: 20');
        });

        it('should show thinker role correctly', () => {
            const summary = manager.getStateSummary('thinker');
            expect(summary).toContain('Your Role: THINKER');
        });
    });

    describe('State isolation', () => {
        it('should not share knowledgeGraph state between instances', () => {
            const manager1 = new GameStateManager();
            const manager2 = new GameStateManager();

            manager1.addKnowledgeNode({
                entity: 'test',
                type: 'property',
                confidence: 0.5,
                questionNumber: 1
            });

            expect(manager1.getState().knowledgeGraph.nodes).toHaveLength(1);
            expect(manager2.getState().knowledgeGraph.nodes).toHaveLength(0);
        });

        it('should not share riskAssessments between instances', () => {
            const manager1 = new GameStateManager();
            const manager2 = new GameStateManager();

            manager1.addRiskAssessment({
                questionNumber: 1,
                riskScore: 0.5,
                confidence: 0.5,
                recommendation: 'ask_more',
                timestamp: Date.now()
            });

            expect(manager1.getState().riskAssessments).toHaveLength(1);
            expect(manager2.getState().riskAssessments).toHaveLength(0);
        });

        it('should not share mulsRewards between instances', () => {
            const manager1 = new GameStateManager();
            const manager2 = new GameStateManager();

            manager1.addMulsReward({
                questionNumber: 1,
                reward: 0.5,
                reason: 'Test',
                timestamp: Date.now()
            });

            expect(manager1.getState().mulsRewards).toHaveLength(1);
            expect(manager2.getState().mulsRewards).toHaveLength(0);
        });

        it('should return a copy from getState, not a reference to internal state', () => {
            manager.addKnowledgeNode({
                entity: 'test',
                type: 'property',
                confidence: 0.5,
                questionNumber: 1
            });

            const state1 = manager.getState();
            const state2 = manager.getState();

            // Returned states should not be the same object reference
            expect(state1).not.toBe(state2);
            // But should have equal content
            expect(state1).toEqual(state2);
        });
    });
});
