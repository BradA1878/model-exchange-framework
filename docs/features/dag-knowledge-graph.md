# Task DAG and Knowledge Graph

This document describes the Task DAG (Directed Acyclic Graph) and Knowledge Graph systems in MXF. Both are opt-in features that enhance task management and knowledge organization.

## Overview

### Task DAG

The Task DAG system provides dependency management for tasks within a channel. It enables:

- **Dependency Enforcement**: Prevent tasks from starting until their dependencies are complete
- **Cycle Detection**: Automatically detect and prevent circular dependencies
- **Execution Planning**: Calculate optimal execution order and parallel groups
- **Critical Path Analysis**: Identify the longest dependency chain

### Knowledge Graph

The Knowledge Graph system provides entity and relationship management across channels:

- **Entity Extraction**: Automatically extract entities (people, organizations, projects) from text
- **Q-Value Learning**: Learn which entities are most useful for task completion
- **ORPAR Integration**: Provide phase-specific context during the ORPAR control loop
- **Surprise Detection**: Detect unexpected patterns and relationships

## Feature Flags

Both systems are disabled by default and must be explicitly enabled:

```bash
# Enable Task DAG
TASK_DAG_ENABLED=true

# Enable Knowledge Graph
KNOWLEDGE_GRAPH_ENABLED=true
```

## Task DAG

### How It Works

1. **DAG Construction**: When enabled, the TaskService builds a DAG from task dependencies
2. **Dependency Validation**: Before adding a dependency, the system checks for cycles
3. **Status Enforcement**: Tasks cannot transition to `in_progress` if they have incomplete dependencies
4. **Completion Propagation**: When a task completes, dependent tasks are notified

### Architecture

```
┌─────────────────────┐
│    TaskService      │
│  (status changes)   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   TaskDagService    │
│  (in-memory cache)  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  MongoDagRepository │
│   (derives from     │
│   task.dependsOn)   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│    Task Model       │
│    (MongoDB)        │
└─────────────────────┘
```

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `TASK_DAG_ENABLED` | `false` | Enable the DAG system |
| `TASK_DAG_CACHE_TTL_MS` | `300000` (5min) | Cache TTL for DAG structures |
| `TASK_DAG_CYCLE_CHECK_TIMEOUT_MS` | `5000` | Timeout for cycle detection |
| `TASK_DAG_ENFORCE_ON_STATUS_CHANGE` | `true` | Block invalid status transitions |
| `TASK_DAG_MAX_IN_DEGREE_WARNING` | `10` | Warn if task has many dependencies |
| `TASK_DAG_MAX_OUT_DEGREE_WARNING` | `10` | Warn if task blocks many others |
| `TASK_DAG_MAX_CHAIN_LENGTH_WARNING` | `20` | Warn if dependency chain is long |
| `TASK_DAG_EMIT_EVENTS` | `true` | Emit DAG-related events |
| `TASK_DAG_DEBUG` | `false` | Enable debug logging |

### Events

| Event | Description |
|-------|-------------|
| `dag:task_dependencies_resolved` | All dependencies of a task are now complete |
| `dag:task_blocked` | Task cannot start due to incomplete dependencies |
| `dag:task_unblocked` | Task is now unblocked |
| `dag:cycle_detected` | Circular dependency detected |
| `dag:dag_updated` | DAG structure changed |
| `dag:dependency_added` | New dependency added |
| `dag:dependency_removed` | Dependency removed |

### Usage Example

```typescript
// Using the DAG MCP tools
const readyTasks = await agent.callTool('dag_get_ready_tasks', {
    channelId: 'my-channel'
});

// Validate before adding a dependency
const validation = await agent.callTool('dag_validate_dependency', {
    dependentTaskId: 'task-B',
    dependencyTaskId: 'task-A'
});

if (validation.isValid) {
    // Add the dependency via task update
    await agent.updateTask('task-B', { dependsOn: ['task-A'] });
}
```

## Knowledge Graph

### How It Works

1. **Entity Extraction**: When memory is updated, entities are extracted from the content
2. **Graph Construction**: Entities and relationships form a graph structure
3. **Q-Value Learning**: Task outcomes update entity utility scores (Q-values)
4. **Context Retrieval**: ORPAR phases retrieve relevant graph context

### Architecture

```
┌─────────────────────┐
│   MemoryService     │
│  (triggers extract) │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐      ┌─────────────────────┐
│EntityExtractionSvc  │──────│ KnowledgeGraphSvc   │
│ (rule-based NER)    │      │ (central service)   │
└─────────────────────┘      └──────────┬──────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           │                            │                            │
           ▼                            ▼                            ▼
┌─────────────────────┐      ┌─────────────────────┐      ┌─────────────────────┐
│ EntityQValueManager │      │GraphSurpriseCalc    │      │OrparGraphIntegration│
│ (utility learning)  │      │(pattern detection)  │      │(phase context)      │
└─────────────────────┘      └─────────────────────┘      └─────────────────────┘
                                        │
                                        ▼
                             ┌─────────────────────┐
                             │MongoKnowledgeGraph  │
                             │   Repository        │
                             └──────────┬──────────┘
                                        │
                                        ▼
                             ┌─────────────────────┐
                             │ Entity/Relationship │
                             │   Models (MongoDB)  │
                             └─────────────────────┘
```

### Entity Types

- `person` - People (developers, managers, stakeholders)
- `organization` - Companies, teams, departments
- `project` - Software projects, codebases
- `technology` - Languages, frameworks, tools
- `concept` - Abstract concepts, methodologies
- `location` - Physical or virtual locations
- `document` - Documents, specifications
- `task` - Task references

### Relationship Types

- `WORKS_ON` - Person works on project/task
- `OWNS` - Ownership relationship
- `DEPENDS_ON` - Dependency relationship
- `RELATED_TO` - General relation
- `MEMBER_OF` - Membership relationship
- `USES` - Technology usage
- `CREATED` - Creation relationship
- `MODIFIED` - Modification relationship
- `REFERENCES` - Reference relationship
- `BLOCKS` - Blocking relationship
- `CONTRADICTS` - Contradicting information

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `KNOWLEDGE_GRAPH_ENABLED` | `false` | Enable the KG system |
| `KNOWLEDGE_GRAPH_EXTRACTION_ENABLED` | `true` | Enable entity extraction |
| `KNOWLEDGE_GRAPH_EXTRACTION_MODEL` | `rule-based` | Extraction method |
| `KNOWLEDGE_GRAPH_MIN_CONFIDENCE` | `0.6` | Minimum confidence for entities |
| `KNOWLEDGE_GRAPH_AUTO_MERGE_THRESHOLD` | `0.9` | Auto-merge similar entities |
| `KNOWLEDGE_GRAPH_QVALUE_ENABLED` | `true` | Enable Q-value learning |
| `KNOWLEDGE_GRAPH_QVALUE_LEARNING_RATE` | `0.1` | EMA learning rate |
| `KNOWLEDGE_GRAPH_SURPRISE_ENABLED` | `true` | Enable surprise detection |
| `KNOWLEDGE_GRAPH_SURPRISE_THRESHOLD` | `0.7` | High surprise threshold |
| `KNOWLEDGE_GRAPH_MAX_CONTEXT_ENTITIES` | `50` | Max entities in context |
| `KNOWLEDGE_GRAPH_MAX_CONTEXT_RELATIONSHIPS` | `100` | Max relationships in context |
| `KNOWLEDGE_GRAPH_ORPAR_INTEGRATION_ENABLED` | `true` | Enable ORPAR integration |
| `KNOWLEDGE_GRAPH_DEBUG` | `false` | Enable debug logging |

### Q-Value Learning

The Knowledge Graph uses Q-values to track entity utility:

```
Q(entity) = (1 - α) × Q(entity) + α × reward
```

Where:
- `α` is the learning rate (default: 0.1)
- `reward` is derived from task outcomes (0.0 to 1.0)

Entities involved in successful tasks have their Q-values increased, making them more likely to be retrieved in future contexts.

### ORPAR Integration

Each ORPAR phase retrieves different graph context:

| Phase | Context Provided |
|-------|-----------------|
| **Observation** | Entities matching task keywords |
| **Reasoning** | Expanded subgraph with relationships |
| **Planning** | Dependencies, blockers, resources |
| **Action** | Relevant tools and patterns |
| **Reflection** | Graph updates from task outcome |

### Surprise Detection

The system detects surprising relationships:

- **Conflicting Relationships**: Existing relationship contradicts new observation
- **Pattern Surprise**: Unexpected relationship type between entity types
- **Novel Patterns**: Previously unseen entity combinations

High surprise events are forwarded to the SurpriseOrparAdapter, potentially triggering additional observation cycles.

### Events

| Event | Description |
|-------|-------------|
| `kg:entity_created` | New entity added |
| `kg:entity_updated` | Entity modified |
| `kg:entity_deleted` | Entity removed |
| `kg:relationship_created` | New relationship added |
| `kg:relationship_updated` | Relationship modified |
| `kg:relationship_deleted` | Relationship removed |
| `kg:high_surprise_relationship` | Surprising pattern detected |
| `kg:graph_updated` | Graph structure changed |

### Usage Example

```typescript
// Extract entities from text
const extraction = await agent.callTool('kg_extract_from_text', {
    text: 'John Smith from Acme Corp is leading the React migration project.'
});
// Result: Entities for "John Smith" (person), "Acme Corp" (organization),
//         "React migration" (project), "React" (technology)

// Find related entities
const neighbors = await agent.callTool('kg_get_neighbors', {
    entityId: 'john-smith-id',
    direction: 'both'
});

// Get ORPAR phase context
const context = await agent.callTool('kg_get_phase_context', {
    phase: 'planning',
    entityIds: ['project-123']
});
```

## Integration with ORPAR-Memory

When both Knowledge Graph and ORPAR-Memory integration are enabled, the systems work together:

1. **Memory Promotion**: When memories are promoted, entities are extracted
2. **Q-Value Attribution**: Phase-weighted rewards update entity Q-values
3. **Surprise Routing**: Graph surprise events trigger ORPAR decisions
4. **Context Enrichment**: Graph context enriches memory retrieval

Enable both integrations:

```bash
KNOWLEDGE_GRAPH_ENABLED=true
ORPAR_MEMORY_INTEGRATION_ENABLED=true
KNOWLEDGE_GRAPH_ORPAR_INTEGRATION_ENABLED=true
```

## Best Practices

### Task DAG

1. **Keep dependencies minimal**: Only add truly necessary dependencies
2. **Avoid deep chains**: Long dependency chains delay execution
3. **Use parallel groups**: Structure tasks to enable parallel execution
4. **Monitor for cycles**: Use `dag_validate_dependency` before adding dependencies

### Knowledge Graph

1. **Review extracted entities**: Periodically check for duplicates
2. **Merge similar entities**: Use `kg_merge_entities` for deduplication
3. **Trust Q-values**: High-utility entities are genuinely useful
4. **Monitor surprise**: High surprise may indicate data quality issues

## MCP Tools Reference

See the API documentation:
- [DAG Tools](../api/dag-tools.md) - 7 tools for DAG operations
- [Knowledge Graph Tools](../api/knowledge-graph-tools.md) - 13 tools for KG operations
