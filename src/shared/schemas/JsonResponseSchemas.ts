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
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * JsonResponseSchemas.ts
 * 
 * JSON Schema definitions for structured LLM responses used throughout the Model Exchange Framework.
 * These schemas ensure consistent formatting and validation of LLM outputs.
 */

// JSON Schema for topic extraction responses
export const TOPIC_EXTRACTION_SCHEMA = {
    type: "object",
    properties: {
        topics: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    topic: { type: "string" },
                    keywords: {
                        type: "array",
                        items: { type: "string" }
                    },
                    relevanceScore: { 
                        type: "number",
                        minimum: 0,
                        maximum: 1
                    },
                    messageCount: { type: "number" },
                    firstMention: { type: "string" },
                    lastMention: { type: "string" }
                },
                required: ["id", "topic", "keywords", "relevanceScore"]
            }
        },
        summary: { type: "string" },
        participantCount: { type: "number" },
        messageAnalyzed: { type: "number" },
        extractionTimestamp: { type: "string" }
    },
    required: ["topics", "summary", "participantCount", "messageAnalyzed", "extractionTimestamp"]
};

// JSON Schema for conversation summary responses
export const CONVERSATION_SUMMARY_SCHEMA = {
    type: "object", 
    properties: {
        summary: { type: "string" },
        keyPoints: {
            type: "array",
            items: { type: "string" }
        },
        participants: {
            type: "array",
            items: { type: "string" }
        },
        timespan: {
            type: "object",
            properties: {
                start: { type: "string" },
                end: { type: "string" },
                duration: { type: "string" }
            },
            required: ["start", "end"]
        },
        topics: {
            type: "array",
            items: { type: "string" }
        },
        sentiment: {
            type: "string",
            enum: ["positive", "negative", "neutral", "mixed"]
        },
        messageCount: { type: "number" }
    },
    required: ["summary", "keyPoints", "participants", "timespan", "messageCount"]
};

// JSON Schema for reasoning analysis responses  
export const REASONING_ANALYSIS_SCHEMA = {
    type: "object",
    properties: {
        reasoning: {
            type: "object",
            properties: {
                analysis: { type: "string" },
                keyInsights: {
                    type: "array",
                    items: { type: "string" }
                },
                contextFactors: {
                    type: "array", 
                    items: { type: "string" }
                },
                recommendations: {
                    type: "array",
                    items: { type: "string" }
                },
                confidence: {
                    type: "number",
                    minimum: 0,
                    maximum: 1
                }
            },
            required: ["analysis", "keyInsights", "contextFactors"]
        },
        metadata: {
            type: "object",
            properties: {
                processingTimestamp: { type: "string" },
                inputMessageCount: { type: "number" },
                llmModel: { type: "string" },
                processingDuration: { type: "number" }
            }
        }
    },
    required: ["reasoning"]
};

// JSON Schema for plan creation responses
export const PLAN_CREATION_SCHEMA = {
    type: "object",
    properties: {
        plan: {
            type: "object",
            properties: {
                id: { type: "string" },
                description: { type: "string" },
                goal: { type: "string" },
                actions: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            description: { type: "string" },
                            action: { type: "string" },
                            parameters: { type: "object" },
                            priority: { type: "number" },
                            status: { 
                                type: "string",
                                enum: ["pending", "in_progress", "completed", "failed", "skipped"]
                            }
                        },
                        required: ["id", "description", "action", "parameters", "priority", "status"]
                    }
                },
                priority: { type: "string" },
                estimatedDuration: { type: "string" },
                resources: {
                    type: "array",
                    items: { type: "string" }
                },
                successMetrics: {
                    type: "array", 
                    items: { type: "string" }
                },
                risks: {
                    type: "array",
                    items: { type: "string" }
                }
            },
            required: ["id", "description", "goal", "actions"]
        }
    },
    required: ["plan"]
};

// JSON Schema for reflection responses
export const REFLECTION_SCHEMA = {
    type: "object",
    properties: {
        reflection: {
            type: "object",
            properties: {
                id: { type: "string" },
                planId: { type: "string" },
                success: { type: "boolean" },
                insights: {
                    type: "array",
                    items: { type: "string" }
                },
                improvements: {
                    type: "array",
                    items: { type: "string" }
                },
                learnings: {
                    type: "array",
                    items: { type: "string" }
                },
                successFactors: {
                    type: "array",
                    items: { type: "string" }
                },
                challenges: {
                    type: "array",
                    items: { type: "string" }
                },
                recommendations: {
                    type: "array",
                    items: { type: "string" }
                },
                confidence: {
                    type: "number",
                    minimum: 0,
                    maximum: 1
                }
            },
            required: ["id", "planId", "success", "insights"]
        }
    },
    required: ["reflection"]
};

// JSON Schema for tool recommendation responses
export const TOOL_RECOMMENDATION_SCHEMA = {
    type: "object",
    properties: {
        recommendations: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    toolName: { type: "string" },
                    relevanceScore: { 
                        type: "number", 
                        minimum: 0, 
                        maximum: 1 
                    },
                    reasoning: { type: "string" },
                    usageHint: { type: "string" }
                },
                required: ["toolName", "relevanceScore", "reasoning", "usageHint"]
            }
        },
        confidence: { 
            type: "number", 
            minimum: 0, 
            maximum: 1 
        }
    },
    required: ["recommendations", "confidence"]
};
