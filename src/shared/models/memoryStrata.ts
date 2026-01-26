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
 * MongoDB Models for Memory Strata System
 *
 * Persistent storage for multi-timescale memory following Nested Learning paradigm.
 * Feature flag: MEMORY_STRATA_ENABLED
 */

import mongoose, { Document, Schema } from 'mongoose';
import {
  MemoryStratum,
  MemoryImportance,
  MemoryEntry as IMemoryEntry,
  SurpriseDetection,
  MemoryPattern
} from '../types/MemoryStrataTypes';

/**
 * Memory Entry Document
 */
export interface IMemoryEntryDocument extends Document {
  memoryId: string;
  agentId: string;
  channelId?: string;
  stratum: MemoryStratum;
  content: string;
  contentType: 'text' | 'structured' | 'embedding';
  structuredData?: Record<string, unknown>;
  embedding?: number[];
  importance: MemoryImportance;
  tags: string[];
  source: {
    type: string;
    agentId?: string;
    channelId?: string;
    eventId?: string;
    data?: Record<string, unknown>;
  };
  context: {
    agentId: string;
    channelId?: string;
    taskId?: string;
    orparPhase?: string;
    timestamp: Date;
    data?: Record<string, unknown>;
  };
  accessCount: number;
  lastAccessed: Date;
  createdAt: Date;
  expiresAt?: Date;
  relatedMemories: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Surprise History Document
 */
export interface ISurpriseHistoryDocument extends Document {
  agentId: string;
  timestamp: Date;
  momentarySurprise: number;
  pastSurprise: number;
  effectiveSurprise: number;
  detection: SurpriseDetection;
  context?: Record<string, unknown>;
}

/**
 * Memory Pattern Document
 */
export interface IMemoryPatternDocument extends Document {
  patternId: string;
  agentId?: string;
  channelId?: string;
  name: string;
  description?: string;
  type: 'sequential' | 'causal' | 'correlational' | 'structural';
  elements: Array<{
    position: number;
    description: string;
    constraints?: Record<string, unknown>;
    temporalRelation?: string;
  }>;
  confidence: number;
  evidence: string[];
  observationCount: number;
  lastObserved: Date;
  createdAt: Date;
}

/**
 * Memory Entry Schema
 */
const MemoryEntrySchema: Schema = new Schema(
  {
    memoryId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    agentId: {
      type: String,
      required: true,
      index: true
    },
    channelId: {
      type: String,
      index: true
    },
    stratum: {
      type: String,
      enum: Object.values(MemoryStratum),
      required: true,
      index: true
    },
    content: {
      type: String,
      required: true
    },
    contentType: {
      type: String,
      enum: ['text', 'structured', 'embedding'],
      default: 'text'
    },
    structuredData: {
      type: Schema.Types.Mixed
    },
    embedding: {
      type: [Number]
    },
    importance: {
      type: Number,
      enum: Object.values(MemoryImportance),
      required: true,
      index: true
    },
    tags: {
      type: [String],
      default: [],
      index: true
    },
    source: {
      type: {
        type: String,
        required: true
      },
      agentId: String,
      channelId: String,
      eventId: String,
      data: Schema.Types.Mixed
    },
    context: {
      agentId: {
        type: String,
        required: true
      },
      channelId: String,
      taskId: String,
      orparPhase: {
        type: String,
        enum: ['observe', 'reason', 'plan', 'act', 'reflect']
      },
      timestamp: {
        type: Date,
        required: true
      },
      data: Schema.Types.Mixed
    },
    accessCount: {
      type: Number,
      default: 0
    },
    lastAccessed: {
      type: Date,
      default: Date.now
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    expiresAt: {
      type: Date,
      index: true
    },
    relatedMemories: {
      type: [String],
      default: []
    },
    metadata: {
      type: Schema.Types.Mixed
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for efficient queries
MemoryEntrySchema.index({ agentId: 1, stratum: 1, createdAt: -1 });
MemoryEntrySchema.index({ channelId: 1, stratum: 1, createdAt: -1 });
MemoryEntrySchema.index({ agentId: 1, importance: 1 });
MemoryEntrySchema.index({ tags: 1, stratum: 1 });

// TTL index for expiration
MemoryEntrySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Surprise History Schema
 */
const SurpriseHistorySchema: Schema = new Schema(
  {
    agentId: {
      type: String,
      required: true,
      index: true
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    },
    momentarySurprise: {
      type: Number,
      required: true
    },
    pastSurprise: {
      type: Number,
      required: true
    },
    effectiveSurprise: {
      type: Number,
      required: true
    },
    detection: {
      isSurprising: Boolean,
      surpriseScore: Number,
      type: String,
      explanation: String,
      expectation: {
        expected: Schema.Types.Mixed,
        confidence: Number,
        source: String,
        basedOn: [String]
      },
      observation: String,
      suggestedActions: [String]
    },
    context: {
      type: Schema.Types.Mixed
    }
  },
  {
    timestamps: true
  }
);

// Compound index for time-series queries
SurpriseHistorySchema.index({ agentId: 1, timestamp: -1 });

// TTL index to keep only recent history (90 days)
SurpriseHistorySchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 });

/**
 * Memory Pattern Schema
 */
const MemoryPatternSchema: Schema = new Schema(
  {
    patternId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    agentId: {
      type: String,
      index: true
    },
    channelId: {
      type: String,
      index: true
    },
    name: {
      type: String,
      required: true
    },
    description: String,
    type: {
      type: String,
      enum: ['sequential', 'causal', 'correlational', 'structural'],
      required: true
    },
    elements: [
      {
        position: Number,
        description: String,
        constraints: Schema.Types.Mixed,
        temporalRelation: {
          type: String,
          enum: ['before', 'after', 'during', 'concurrent']
        }
      }
    ],
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1
    },
    evidence: {
      type: [String],
      default: []
    },
    observationCount: {
      type: Number,
      default: 1
    },
    lastObserved: {
      type: Date,
      default: Date.now
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes
MemoryPatternSchema.index({ agentId: 1, confidence: -1 });
MemoryPatternSchema.index({ channelId: 1, type: 1 });

/**
 * Memory Entry Model
 */
export const MemoryEntryModel = mongoose.model<IMemoryEntryDocument>(
  'MemoryEntry',
  MemoryEntrySchema
);

/**
 * Surprise History Model
 */
export const SurpriseHistoryModel = mongoose.model<ISurpriseHistoryDocument>(
  'SurpriseHistory',
  SurpriseHistorySchema
);

/**
 * Memory Pattern Model
 */
export const MemoryPatternModel = mongoose.model<IMemoryPatternDocument>(
  'MemoryPattern',
  MemoryPatternSchema
);

/**
 * Helper function to convert MemoryEntry to MongoDB document
 */
export function memoryEntryToDocument(
  entry: IMemoryEntry,
  agentId: string,
  channelId?: string
): Partial<IMemoryEntryDocument> {
  return {
    memoryId: entry.id,
    agentId,
    channelId,
    stratum: entry.stratum,
    content: entry.content,
    contentType: entry.contentType,
    structuredData: entry.structuredData,
    embedding: entry.embedding,
    importance: entry.importance,
    tags: entry.tags,
    source: entry.source,
    context: entry.context as any,
    accessCount: entry.accessCount,
    lastAccessed: entry.lastAccessed,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    relatedMemories: entry.relatedMemories,
    metadata: entry.metadata
  };
}

/**
 * Helper function to convert MongoDB document to MemoryEntry
 */
export function documentToMemoryEntry(doc: IMemoryEntryDocument): IMemoryEntry {
  return {
    id: doc.memoryId,
    stratum: doc.stratum,
    content: doc.content,
    contentType: doc.contentType,
    structuredData: doc.structuredData,
    embedding: doc.embedding,
    importance: doc.importance,
    tags: doc.tags,
    source: doc.source as any,
    context: doc.context as any,
    accessCount: doc.accessCount,
    lastAccessed: doc.lastAccessed,
    createdAt: doc.createdAt,
    expiresAt: doc.expiresAt,
    relatedMemories: doc.relatedMemories,
    metadata: doc.metadata
  };
}
