# Knowledge Graph Tools API Reference

This document provides detailed API reference for all Knowledge Graph MCP tools.

## Overview

The Knowledge Graph tools provide agents with the ability to manage entities and relationships, query the graph, and extract knowledge from text. All tools require the Knowledge Graph system to be enabled (`KNOWLEDGE_GRAPH_ENABLED=true`).

## Entity Query Tools

### kg_get_entity

Get a specific entity by its ID.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | **Yes** | Unique ID of the entity |

**Returns:**

```typescript
{
    success: boolean;
    entity: {
        id: string;
        channelId: string;
        name: string;
        type: EntityType;
        aliases: string[];
        description?: string;
        confidence: number;
        qValue: number;           // Utility score (0-1)
        accessCount: number;
        lastAccessed: Date;
        source: string;
        createdAt: Date;
        updatedAt: Date;
    } | null;
    message: string;
}
```

**Example:**

```typescript
const result = await agent.callTool('kg_get_entity', {
    entityId: 'ent_abc123'
});
// { success: true, entity: { name: 'John Smith', type: 'person', qValue: 0.75, ... } }
```

---

### kg_find_entity

Find entities by name or alias.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channelId` | string | No | context | Channel ID |
| `name` | string | **Yes** | - | Name or alias to search |
| `exact` | boolean | No | false | Require exact match |
| `limit` | number | No | 10 | Max results (1-50) |

**Returns:**

```typescript
{
    success: boolean;
    entities: Entity[];
    count: number;
    totalFound: number;        // Total matches before limit
    message: string;
}
```

**Example:**

```typescript
// Partial match search
const result = await agent.callTool('kg_find_entity', {
    name: 'John',
    limit: 5
});
// Returns entities with names containing "John"

// Exact match search
const exact = await agent.callTool('kg_find_entity', {
    name: 'John Smith',
    exact: true
});
```

---

### kg_get_neighbors

Get entities connected to a specific entity.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `entityId` | string | **Yes** | - | Entity ID to find neighbors for |
| `direction` | string | No | 'both' | 'incoming', 'outgoing', or 'both' |
| `relationshipType` | string | No | - | Filter by relationship type |
| `limit` | number | No | 20 | Max neighbors (1-100) |

**Returns:**

```typescript
{
    success: boolean;
    entities: Entity[];
    relationships: Relationship[];
    entityCount: number;
    relationshipCount: number;
    message: string;
}
```

**Example:**

```typescript
// Get all connections
const result = await agent.callTool('kg_get_neighbors', {
    entityId: 'person-123'
});

// Get only projects a person works on
const projects = await agent.callTool('kg_get_neighbors', {
    entityId: 'person-123',
    direction: 'outgoing',
    relationshipType: 'WORKS_ON'
});
```

---

### kg_find_path

Find the shortest path between two entities.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `fromEntityId` | string | **Yes** | - | Starting entity ID |
| `toEntityId` | string | **Yes** | - | Target entity ID |
| `maxHops` | number | No | 5 | Max relationship hops (1-10) |

**Returns:**

```typescript
{
    success: boolean;
    path: {
        entityIds: string[];
        relationshipIds: string[];
    } | null;
    found: boolean;
    hopCount: number;
    message: string;
}
```

**Example:**

```typescript
const result = await agent.callTool('kg_find_path', {
    fromEntityId: 'person-alice',
    toEntityId: 'project-xyz',
    maxHops: 3
});

if (result.found) {
    console.log('Connection path:', result.path.entityIds);
    // ['person-alice', 'org-acme', 'project-xyz']
}
```

---

### kg_get_high_utility_entities

Get entities with the highest Q-values (utility scores).

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channelId` | string | No | context | Channel ID |
| `limit` | number | No | 10 | Max entities (1-50) |

**Returns:**

```typescript
{
    success: boolean;
    entities: Entity[];        // Sorted by Q-value descending
    count: number;
    message: string;
}
```

**Example:**

```typescript
const result = await agent.callTool('kg_get_high_utility_entities', {
    limit: 5
});
// Returns top 5 entities by learned utility
```

## Context Tools

### kg_get_context

Get relevant graph context for a task or query.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channelId` | string | No | Channel ID |
| `taskId` | string | No | Optional task ID for task-specific context |
| `keywords` | string[] | No | Keywords to find relevant entities |

**Returns:**

```typescript
{
    success: boolean;
    context: {
        entities: Entity[];
        relationships: Relationship[];
        highUtilityEntities: Entity[];
        stats: {
            entityCount: number;
            relationshipCount: number;
        };
    };
    stats: { entityCount: number; relationshipCount: number };
    message: string;
}
```

**Example:**

```typescript
const result = await agent.callTool('kg_get_context', {
    keywords: ['authentication', 'security', 'JWT']
});
```

---

### kg_get_phase_context

Get Knowledge Graph context optimized for a specific ORPAR phase.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channelId` | string | No | Channel ID |
| `phase` | string | **Yes** | 'observation', 'reasoning', 'planning', 'action', 'reflection' |
| `taskContent` | string | No | Task content (for observation phase) |
| `entityIds` | string[] | No | Entity IDs to focus on |

**Returns:**

```typescript
{
    success: boolean;
    phaseContext: {
        phase: string;
        entities: Entity[];
        relationships: Relationship[];
        summary: string;
        executionTimeMs: number;
    };
    entityCount: number;
    relationshipCount: number;
    summary: string;
    executionTimeMs: number;
    message: string;
}
```

**Phase-Specific Behavior:**

| Phase | Context Provided |
|-------|-----------------|
| `observation` | Entities matching task keywords, recently accessed entities |
| `reasoning` | Expanded subgraph with paths between related entities |
| `planning` | Dependencies, blockers, resources, high-utility entities |
| `action` | Relevant tools, patterns, and execution context |
| `reflection` | Updated entities, outcome analysis |

**Example:**

```typescript
// During observation phase
const obsContext = await agent.callTool('kg_get_phase_context', {
    phase: 'observation',
    taskContent: 'Implement user authentication with OAuth'
});

// During planning phase
const planContext = await agent.callTool('kg_get_phase_context', {
    phase: 'planning',
    entityIds: ['project-auth', 'tech-oauth']
});
```

## Entity Management Tools

### kg_create_entity

Create a new entity in the Knowledge Graph.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channelId` | string | No | context | Channel ID |
| `name` | string | **Yes** | - | Entity name |
| `type` | EntityType | **Yes** | - | Entity type (see below) |
| `aliases` | string[] | No | [] | Alternative names |
| `description` | string | No | - | Entity description |
| `confidence` | number | No | 0.8 | Confidence level (0-1) |

**Entity Types:** `person`, `organization`, `project`, `technology`, `concept`, `location`, `document`, `task`

**Returns:**

```typescript
{
    success: boolean;
    entity: Entity;
    message: string;
}
```

**Example:**

```typescript
const result = await agent.callTool('kg_create_entity', {
    name: 'React',
    type: 'technology',
    aliases: ['ReactJS', 'React.js'],
    description: 'JavaScript library for building user interfaces'
});
```

---

### kg_create_relationship

Create a relationship between two entities.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channelId` | string | No | context | Channel ID |
| `fromEntityId` | string | **Yes** | - | Source entity ID |
| `toEntityId` | string | **Yes** | - | Target entity ID |
| `type` | RelationshipType | **Yes** | - | Relationship type (see below) |
| `label` | string | No | - | Human-readable label |
| `confidence` | number | No | 0.8 | Confidence level (0-1) |

**Relationship Types:** `WORKS_ON`, `OWNS`, `DEPENDS_ON`, `RELATED_TO`, `MEMBER_OF`, `USES`, `CREATED`, `MODIFIED`, `REFERENCES`, `BLOCKS`, `CONTRADICTS`

**Returns:**

```typescript
{
    success: boolean;
    relationship: Relationship;
    message: string;
}
```

**Example:**

```typescript
const result = await agent.callTool('kg_create_relationship', {
    fromEntityId: 'person-john',
    toEntityId: 'project-xyz',
    type: 'WORKS_ON',
    label: 'Lead Developer'
});
```

## Extraction Tools

### kg_extract_from_text

Extract entities and relationships from arbitrary text.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channelId` | string | No | Channel ID |
| `text` | string | **Yes** | Text to extract entities from |
| `sourceId` | string | No | Source identifier (e.g., memory ID) |

**Returns:**

```typescript
{
    success: boolean;
    result: {
        entities: Entity[];
        relationships: Relationship[];
        entitiesExtracted: number;
        relationshipsExtracted: number;
        executionTimeMs: number;
    };
    entitiesExtracted: number;
    relationshipsExtracted: number;
    executionTimeMs: number;
    message: string;
}
```

**Example:**

```typescript
const result = await agent.callTool('kg_extract_from_text', {
    text: 'Sarah Chen from Google is leading the TensorFlow migration project. The team uses Python and Docker.'
});

// Extracted entities:
// - Sarah Chen (person)
// - Google (organization)
// - TensorFlow migration (project)
// - TensorFlow (technology)
// - Python (technology)
// - Docker (technology)
//
// Extracted relationships:
// - Sarah Chen MEMBER_OF Google
// - Sarah Chen WORKS_ON TensorFlow migration
// - TensorFlow migration USES Python
// - TensorFlow migration USES Docker
```

---

### kg_extract_from_memory

Extract entities and relationships from a stored memory.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channelId` | string | No | Channel ID |
| `memoryId` | string | **Yes** | Memory ID to extract from |
| `memoryContent` | string | **Yes** | Memory content |

**Returns:**

```typescript
{
    success: boolean;
    result: {
        entities: Entity[];
        relationships: Relationship[];
        entitiesExtracted: number;
        relationshipsExtracted: number;
        executionTimeMs: number;
        linkedToMemory: boolean;
    };
    entitiesExtracted: number;
    relationshipsExtracted: number;
    executionTimeMs: number;
    message: string;
}
```

**Example:**

```typescript
const result = await agent.callTool('kg_extract_from_memory', {
    memoryId: 'mem_123',
    memoryContent: 'Discussed API design with Bob. He suggested using GraphQL.'
});
```

## Maintenance Tools

### kg_find_duplicates

Find entities that may be duplicates based on name similarity.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channelId` | string | No | context | Channel ID |
| `threshold` | number | No | 0.8 | Similarity threshold (0-1) |

**Returns:**

```typescript
{
    success: boolean;
    duplicates: Array<{
        entity1: Entity;
        entity2: Entity;
        similarity: number;
    }>;
    count: number;
    message: string;
}
```

**Example:**

```typescript
const result = await agent.callTool('kg_find_duplicates', {
    threshold: 0.85
});

for (const dup of result.duplicates) {
    console.log(`Potential duplicate: "${dup.entity1.name}" and "${dup.entity2.name}" (${dup.similarity * 100}% similar)`);
}
```

---

### kg_merge_entities

Merge multiple entities into a single target entity.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `targetEntityId` | string | **Yes** | Entity to merge into (preserved) |
| `sourceEntityIds` | string[] | **Yes** | Entities to merge (deleted after) |

**Returns:**

```typescript
{
    success: boolean;
    result: {
        success: boolean;
        mergedEntity: Entity;
        relationshipsTransferred: number;
        aliasesMerged: string[];
        error?: string;
    };
    message: string;
}
```

**Example:**

```typescript
// Merge "ReactJS" and "React.js" into "React"
const result = await agent.callTool('kg_merge_entities', {
    targetEntityId: 'ent_react',
    sourceEntityIds: ['ent_reactjs', 'ent_react_js']
});

// Result: "React" entity now has aliases ["ReactJS", "React.js"]
//         Relationships from merged entities are transferred
```

## Error Handling

All tools return a consistent error structure:

```typescript
{
    success: false;
    [entity|entities|...]: null | [];
    message: string;
    error?: string;
}
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Knowledge Graph is disabled" | `KNOWLEDGE_GRAPH_ENABLED` not set | Enable with `KNOWLEDGE_GRAPH_ENABLED=true` |
| "channelId is required" | No channel context | Provide `channelId` parameter |
| "Entity not found" | Invalid entity ID | Verify entity ID exists |
| "Merge failed" | Invalid entity IDs or relationships | Check entity IDs are valid |

## Best Practices

1. **Use extraction for bulk entity creation**
   ```typescript
   // Instead of creating entities one by one
   const result = await agent.callTool('kg_extract_from_text', {
       text: documentContent
   });
   ```

2. **Leverage Q-values for context prioritization**
   ```typescript
   const highValue = await agent.callTool('kg_get_high_utility_entities', {});
   // Focus on entities that have been most useful
   ```

3. **Use phase context for ORPAR alignment**
   ```typescript
   const context = await agent.callTool('kg_get_phase_context', {
       phase: currentPhase
   });
   // Context is optimized for the current ORPAR phase
   ```

4. **Regularly check for and merge duplicates**
   ```typescript
   const dups = await agent.callTool('kg_find_duplicates', {});
   for (const dup of dups.duplicates) {
       await agent.callTool('kg_merge_entities', {
           targetEntityId: dup.entity1.id,
           sourceEntityIds: [dup.entity2.id]
       });
   }
   ```

5. **Use path finding for relationship discovery**
   ```typescript
   const path = await agent.callTool('kg_find_path', {
       fromEntityId: 'entity-a',
       toEntityId: 'entity-b'
   });
   // Discover indirect connections between entities
   ```
