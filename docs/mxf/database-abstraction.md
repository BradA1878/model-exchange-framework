# Database Abstraction Layer

## Overview

The Database Abstraction Layer provides a unified, type-safe interface for data persistence across multiple database backends. Using the Repository pattern with a Factory for instantiation, it enables seamless database switching while maintaining strong type safety and domain-driven design principles.

## Key Features

- **Database Agnostic**: Switch databases without changing application code
- **Type Safe**: Generic types ensure compile-time type checking
- **Repository Pattern**: Domain-focused interfaces matching business semantics
- **Factory Pattern**: Single point of configuration and instantiation
- **Rich Filtering**: Database-agnostic query DSL with comparison operators
- **Pagination Support**: Cursor and offset-based pagination with sorting
- **Multi-Scope Memory**: Three-tier memory model (agent, channel, relationship)
- **Future-Proof**: Designed for PostgreSQL, SQLite, MySQL expansion

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   APPLICATION LAYER                              │
│   Services, Controllers, Business Logic                         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   REPOSITORY INTERFACES                          │
│   IAgentRepository, IChannelRepository, ITaskRepository, etc.   │
│   • Domain-specific operations                                   │
│   • Type-safe contracts                                         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   DATABASE ADAPTER FACTORY                       │
│   • Singleton pattern                                           │
│   • Creates repository bundle                                   │
│   • Configuration management                                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ADAPTER IMPLEMENTATIONS                        │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│   │ MongoDB  │  │PostgreSQL│  │  SQLite  │  │  MySQL   │       │
│   │ (Active) │  │ (Planned)│  │ (Planned)│  │ (Planned)│       │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   DATABASE BACKENDS                              │
│   MongoDB, PostgreSQL, SQLite, MySQL                            │
└─────────────────────────────────────────────────────────────────┘
```

## Repository Interfaces

### Base Repository Interface

Foundation for all repositories providing generic CRUD operations:

```typescript
interface IBaseRepository<T, CreateDTO = Partial<T>, UpdateDTO = Partial<T>> {
  // Single entity queries
  findById(id: string): Promise<T | null>;
  findOne(filter: FilterOptions<T>): Promise<T | null>;

  // Multi-entity queries with pagination
  findMany(
    filter?: FilterOptions<T>,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<T>>;

  // Mutations
  create(data: CreateDTO): Promise<T>;
  update(id: string, data: UpdateDTO): Promise<T | null>;
  delete(id: string): Promise<boolean>;

  // Aggregates
  count(filter?: FilterOptions<T>): Promise<number>;
  exists(filter: FilterOptions<T>): Promise<boolean>;
}
```

**Key Features**:
- Generic type parameters for flexible entity types
- Separate CreateDTO and UpdateDTO for input validation
- Database-agnostic filter and pagination interfaces
- Promise-based async API

### Domain-Specific Repositories

#### IAgentRepository

```typescript
interface IAgentRepository extends IBaseRepository<IAgentEntity> {
  // Agent-specific queries
  findByAgentId(agentId: string): Promise<IAgentEntity | null>;
  findByKeyId(keyId: string): Promise<IAgentEntity | null>;
  findByServiceTypes(types: string[], matchAll?: boolean): Promise<IAgentEntity[]>;
  findByStatus(status: 'ACTIVE' | 'INACTIVE' | 'ERROR'): Promise<IAgentEntity[]>;
  findByCreator(createdBy: string): Promise<IAgentEntity[]>;

  // Status management
  updateStatus(agentId: string, status: AgentStatus): Promise<IAgentEntity | null>;
  updateLastActive(agentId: string, timestamp?: Date): Promise<void>;
  findStaleAgents(thresholdMs: number): Promise<IAgentEntity[]>;
  bulkUpdateStatus(agentIds: string[], status: AgentStatus): Promise<number>;

  // Capabilities management
  updateAllowedTools(agentId: string, allowedTools: string[]): Promise<IAgentEntity | null>;
  updateCapabilities(agentId: string, capabilities: string[]): Promise<IAgentEntity | null>;
}
```

#### IChannelRepository

```typescript
interface IChannelRepository extends IBaseRepository<IChannelEntity> {
  // Channel queries
  findByChannelId(channelId: string): Promise<IChannelEntity | null>;
  findByParticipant(agentId: string): Promise<IChannelEntity[]>;
  findByCreator(creatorId: string): Promise<IChannelEntity[]>;

  // Participant management
  addParticipant(channelId: string, participantId: string): Promise<IChannelEntity | null>;
  removeParticipant(channelId: string, participantId: string): Promise<IChannelEntity | null>;
  getParticipants(channelId: string): Promise<string[]>;
  isParticipant(channelId: string, agentId: string): Promise<boolean>;

  // Channel operations
  updateLastActive(channelId: string, timestamp?: Date): Promise<void>;
  searchByName(query: string): Promise<IChannelEntity[]>;
  getStatistics(channelId: string): Promise<ChannelStatistics>;
  findActive(): Promise<IChannelEntity[]>;
}
```

#### ITaskRepository

```typescript
interface ITaskRepository extends IBaseRepository<ITaskEntity> {
  // Task queries
  findByChannel(channelId: string, filters?: TaskFilters): Promise<ITaskEntity[]>;
  findByAssignee(agentId: string, filters?: TaskFilters): Promise<ITaskEntity[]>;
  findByCreator(agentId: string, filters?: TaskFilters): Promise<ITaskEntity[]>;
  findByStatus(status: TaskStatus | TaskStatus[]): Promise<ITaskEntity[]>;
  findByPriority(priority: TaskPriority): Promise<ITaskEntity[]>;

  // Time-based queries
  findOverdue(): Promise<ITaskEntity[]>;
  findByDeadlineRange(range: DateRange): Promise<ITaskEntity[]>;

  // Task mutations
  updateStatus(taskId: string, status: TaskStatus, metadata?: Record<string, any>): Promise<ITaskEntity | null>;
  assignTo(taskId: string, agentId: string): Promise<ITaskEntity | null>;
  unassign(taskId: string): Promise<ITaskEntity | null>;
  updateProgress(taskId: string, progress: number): Promise<ITaskEntity | null>;

  // Analytics
  getChannelStatistics(channelId: string): Promise<TaskStatistics>;
  getAgentStatistics(agentId: string): Promise<TaskStatistics>;
  search(query: string, filters?: TaskFilters): Promise<ITaskEntity[]>;
}
```

#### IMemoryRepository

Memory repository has unique scoped patterns and does NOT extend IBaseRepository:

```typescript
interface IMemoryRepository {
  // Agent memory
  getAgentMemory(agentId: string): Promise<IAgentMemory | null>;
  saveAgentMemory(memory: Partial<IAgentMemory> & { agentId: string }): Promise<IAgentMemory>;
  updateAgentMemory(agentId: string, updates: Partial<IAgentMemory>): Promise<IAgentMemory | null>;
  deleteAgentMemory(agentId: string): Promise<boolean>;

  // Channel memory
  getChannelMemory(channelId: string): Promise<IChannelMemory | null>;
  saveChannelMemory(memory: Partial<IChannelMemory> & { channelId: string }): Promise<IChannelMemory>;
  updateChannelMemory(channelId: string, updates: Partial<IChannelMemory>): Promise<IChannelMemory | null>;
  deleteChannelMemory(channelId: string): Promise<boolean>;

  // Relationship memory
  getRelationshipMemory(agentId1: string, agentId2: string): Promise<IRelationshipMemory | null>;
  saveRelationshipMemory(memory: Partial<IRelationshipMemory> & { agentId1: string; agentId2: string }): Promise<IRelationshipMemory>;
  getAgentRelationships(agentId: string): Promise<IRelationshipMemory[]>;
  deleteRelationshipMemory(agentId1: string, agentId2: string): Promise<boolean>;

  // Bulk operations
  deleteByScope(scope: MemoryScope, id: string): Promise<boolean>;
  getStatistics(): Promise<MemoryStatistics>;
}
```

## Database Adapter Factory

### Initialization and Usage

```typescript
import { DatabaseAdapterFactory } from '@/shared/database';

// Initialize factory with environment configuration
DatabaseAdapterFactory.initialize({
  type: process.env.DB_TYPE || 'mongodb',
  connectionString: process.env.MONGODB_URI || 'mongodb://localhost:27017/mxf',
  options: {
    poolSize: parseInt(process.env.DB_POOL_SIZE || '10'),
    useNewUrlParser: true,
    maxRetries: 3
  }
});

// Get repository bundle (singleton pattern)
const repositories = DatabaseAdapterFactory.create();

// Use repositories in services
const agent = await repositories.agents.findByAgentId('agent-123');
const channels = await repositories.channels.findByParticipant('agent-123');
const tasks = await repositories.tasks.findByChannel('channel-456');
const memory = await repositories.memory.getAgentMemory('agent-123');
```

### Factory Pattern

```typescript
type DatabaseType = 'mongodb' | 'postgresql' | 'sqlite' | 'mysql';

interface DatabaseConfig {
  type: DatabaseType;
  connectionString: string;
  options?: Record<string, any>;
}

interface RepositoryBundle {
  agents: IAgentRepository;
  channels: IChannelRepository;
  tasks: ITaskRepository;
  memory: IMemoryRepository;
}

class DatabaseAdapterFactory {
  private static instance: RepositoryBundle | null = null;
  private static config: DatabaseConfig | null = null;

  static initialize(config: DatabaseConfig): void {
    this.config = config;
    this.instance = null; // Reset on re-initialization
  }

  static create(): RepositoryBundle {
    if (!this.config) {
      throw new Error('DatabaseAdapterFactory not initialized. Call initialize() first.');
    }
    if (this.instance) {
      return this.instance; // Singleton pattern
    }

    switch (this.config.type) {
      case 'mongodb':
        this.instance = this.createMongoRepositories();
        break;
      case 'postgresql':
        throw new Error('PostgreSQL adapter not yet implemented');
      case 'sqlite':
        throw new Error('SQLite adapter not yet implemented');
      case 'mysql':
        throw new Error('MySQL adapter not yet implemented');
    }
    return this.instance;
  }

  static reset(): void {
    this.instance = null;
    this.config = null;
  }
}
```

**Design Patterns**:
- **Singleton**: Same repository instance returned on multiple calls
- **Factory**: Encapsulates repository creation logic
- **Strategy**: Different adapters for different databases
- **Lazy Initialization**: Repositories created on-demand

## Filter System

Database-agnostic filtering with rich operators:

```typescript
interface FilterOptions<T> {
  where?: Partial<Record<keyof T, any>>;           // Equality filters
  comparisons?: ComparisonFilter<T>[];             // Operators
  arrayContains?: ArrayContainsFilter<T>[];        // Array operations
  textSearch?: string;                              // Full-text search
  or?: FilterOptions<T>[];                          // Logical OR
  and?: FilterOptions<T>[];                         // Logical AND
}

type ComparisonOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'like' | 'regex';

interface ComparisonFilter<T> {
  field: keyof T;
  operator: ComparisonOperator;
  value: any;
}

interface ArrayContainsFilter<T> {
  field: keyof T;
  value: any;
  mode: 'any' | 'all';  // Contains any value OR all values
}
```

### Filter Examples

```typescript
// Simple equality
const filter1 = {
  where: { status: 'ACTIVE' }
};

// Comparison operators
const filter2 = {
  comparisons: [
    { field: 'priority' as keyof ITaskEntity, operator: 'eq', value: 'high' },
    { field: 'createdAt' as keyof ITaskEntity, operator: 'gte', value: yesterday }
  ]
};

// Array contains
const filter3 = {
  arrayContains: [
    { field: 'capabilities' as keyof IAgentEntity, value: 'code_review', mode: 'any' }
  ]
};

// Complex logical operations
const filter4 = {
  or: [
    { where: { status: 'ACTIVE' } },
    { where: { status: 'BUSY' } }
  ],
  and: [
    { comparisons: [{ field: 'createdAt', operator: 'gte', value: lastWeek }] }
  ]
};
```

## Pagination System

```typescript
interface PaginationOptions {
  limit?: number;           // Default: 20
  offset?: number;          // Default: 0
  sortBy?: string;          // Field to sort by
  sortOrder?: 'asc' | 'desc'; // Default: 'desc'
  cursor?: string;          // For cursor-based pagination
}

interface PaginatedResult<T> {
  items: T[];              // Page items
  total: number;           // Total count
  hasMore: boolean;        // More items available
  nextCursor?: string;     // For cursor pagination
  pagination: {
    limit: number;
    offset: number;
    page: number;
    totalPages: number;
  };
}
```

### Pagination Examples

```typescript
// Offset-based pagination (page 2, 20 items per page)
const result1 = await repositories.agents.findMany(
  { where: { status: 'ACTIVE' } },
  {
    limit: 20,
    offset: 20,  // (page - 1) * limit
    sortBy: 'createdAt',
    sortOrder: 'desc'
  }
);

console.log(`Page ${result1.pagination.page} of ${result1.pagination.totalPages}`);
console.log(`Showing ${result1.items.length} of ${result1.total} total`);
console.log(`Has more: ${result1.hasMore}`);
```

## Usage Examples

### Example 1: Service Using Repositories

```typescript
import { DatabaseAdapterFactory } from '@/shared/database';

class AgentService {
  private agentRepository = DatabaseAdapterFactory.create().agents;

  async getAgentById(agentId: string) {
    return await this.agentRepository.findByAgentId(agentId);
  }

  async getAgentsByStatus(status: 'ACTIVE' | 'INACTIVE' | 'ERROR') {
    return await this.agentRepository.findByStatus(status);
  }

  async updateAgentStatus(agentId: string, status: 'ACTIVE' | 'INACTIVE' | 'ERROR') {
    return await this.agentRepository.updateStatus(agentId, status);
  }

  async findAgentsWithCapability(capability: string) {
    return await this.agentRepository.findMany({
      arrayContains: [{
        field: 'capabilities' as keyof IAgentEntity,
        value: capability,
        mode: 'any'
      }]
    });
  }

  async findStaleAgents(hoursSinceActive: number) {
    const threshold = hoursSinceActive * 60 * 60 * 1000;
    return await this.agentRepository.findStaleAgents(threshold);
  }

  async countActiveAgents() {
    return await this.agentRepository.count({
      where: { status: 'ACTIVE' }
    });
  }
}
```

### Example 2: Complex Filtering

```typescript
class TaskService {
  async findAgentTasks(agentId: string, filters?: {
    status?: string;
    priority?: string;
    overdue?: boolean;
  }) {
    const repos = DatabaseAdapterFactory.create();

    if (filters?.overdue) {
      return await repos.tasks.findOverdue();
    }

    const filterOptions: FilterOptions<ITaskEntity> = {
      where: { assignedAgentId: agentId }
    };

    if (filters?.priority) {
      filterOptions.comparisons = [{
        field: 'priority' as keyof ITaskEntity,
        operator: 'eq',
        value: filters.priority
      }];
    }

    if (filters?.status) {
      filterOptions.where!['status'] = filters.status;
    }

    return await repos.tasks.findMany(filterOptions, {
      limit: 50,
      offset: 0,
      sortBy: 'createdAt',
      sortOrder: 'desc'
    });
  }

  async searchTasksByMultipleCriteria(
    channelId: string,
    options: {
      status?: string[];
      priority?: string;
      assigneeId?: string;
    }
  ) {
    const repos = DatabaseAdapterFactory.create();

    const filterOptions: FilterOptions<ITaskEntity> = {
      where: { channelId },
      comparisons: []
    };

    if (options.priority) {
      filterOptions.comparisons!.push({
        field: 'priority' as keyof ITaskEntity,
        operator: 'eq',
        value: options.priority
      });
    }

    if (options.assigneeId) {
      filterOptions.where!['assignedAgentId'] = options.assigneeId;
    }

    if (options.status && options.status.length > 0) {
      filterOptions.comparisons!.push({
        field: 'status' as keyof ITaskEntity,
        operator: 'in',
        value: options.status
      });
    }

    return await repos.tasks.findMany(filterOptions, {
      limit: 100,
      offset: 0,
      sortBy: 'priority',
      sortOrder: 'desc'
    });
  }
}
```

### Example 3: Memory Operations

```typescript
class MemoryService {
  async saveAgentMemory(agentId: string, notes: Record<string, any>) {
    const repos = DatabaseAdapterFactory.create();

    return await repos.memory.saveAgentMemory({
      agentId,
      notes,
      persistenceLevel: MemoryPersistenceLevel.PERSISTENT
    });
  }

  async updateAgentLearnings(agentId: string, learnings: string[]) {
    const repos = DatabaseAdapterFactory.create();
    const existing = await repos.memory.getAgentMemory(agentId);

    const updated = {
      ...existing,
      customData: {
        ...(existing?.customData || {}),
        learnings
      }
    };

    return await repos.memory.updateAgentMemory(agentId, updated);
  }

  async getChannelContext(channelId: string) {
    const repos = DatabaseAdapterFactory.create();
    return await repos.memory.getChannelMemory(channelId);
  }

  async createRelationshipMemory(
    agentId1: string,
    agentId2: string,
    notes: Record<string, any>
  ) {
    const repos = DatabaseAdapterFactory.create();

    return await repos.memory.saveRelationshipMemory({
      agentId1,
      agentId2,
      notes,
      persistenceLevel: MemoryPersistenceLevel.PERSISTENT
    });
  }
}
```

### Example 4: Channel Participant Management

```typescript
class ChannelService {
  async addAgentToChannel(channelId: string, agentId: string) {
    const repos = DatabaseAdapterFactory.create();

    // Check if already a participant
    const isParticipant = await repos.channels.isParticipant(channelId, agentId);
    if (isParticipant) {
      return await repos.channels.findByChannelId(channelId);
    }

    // Add participant
    return await repos.channels.addParticipant(channelId, agentId);
  }

  async getChannelMembers(channelId: string) {
    const repos = DatabaseAdapterFactory.create();
    return await repos.channels.getParticipants(channelId);
  }

  async getAgentChannels(agentId: string) {
    const repos = DatabaseAdapterFactory.create();
    return await repos.channels.findByParticipant(agentId);
  }

  async getChannelStats(channelId: string) {
    const repos = DatabaseAdapterFactory.create();
    return await repos.channels.getStatistics(channelId);
  }
}
```

### Example 5: Paginated Listing

```typescript
class ListService {
  async getPaginatedAgents(page: number = 1, pageSize: number = 20, status?: string) {
    const repos = DatabaseAdapterFactory.create();

    const filter = status ? { where: { status } } : undefined;

    return await repos.agents.findMany(filter, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sortBy: 'createdAt',
      sortOrder: 'desc'
    });
  }
}
```

## Adding New Database Adapters

### Step 1: Create Base Repository

```typescript
// src/shared/database/adapters/postgresql/PostgreBaseRepository.ts
import { Model } from 'sequelize';
import { IBaseRepository } from '../../../repositories/interfaces/IBaseRepository';
import { FilterOptions, PaginationOptions, PaginatedResult } from '../../../repositories/types';

export abstract class PostgreBaseRepository<T, CreateDTO = Partial<T>, UpdateDTO = Partial<T>>
  implements IBaseRepository<T, CreateDTO, UpdateDTO> {

  constructor(protected readonly model: Model) {}

  async findById(id: string): Promise<T | null> {
    const record = await this.model.findByPk(id);
    return record ? this.toEntity(record.toJSON()) : null;
  }

  async findOne(filter: FilterOptions<T>): Promise<T | null> {
    const sqlFilter = this.buildSqlFilter(filter);
    const record = await this.model.findOne({ where: sqlFilter });
    return record ? this.toEntity(record.toJSON()) : null;
  }

  async findMany(
    filter?: FilterOptions<T>,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<T>> {
    const { limit = 20, offset = 0, sortBy, sortOrder = 'desc' } = pagination || {};
    const sqlFilter = filter ? this.buildSqlFilter(filter) : {};

    const { count, rows } = await this.model.findAndCountAll({
      where: sqlFilter,
      limit,
      offset,
      order: sortBy ? [[sortBy, sortOrder.toUpperCase()]] : [['createdAt', 'DESC']]
    });

    return {
      items: rows.map(row => this.toEntity(row.toJSON())),
      total: count,
      hasMore: offset + rows.length < count,
      pagination: {
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(count / limit)
      }
    };
  }

  async create(data: CreateDTO): Promise<T> {
    const record = await this.model.create(data);
    return this.toEntity(record.toJSON());
  }

  async update(id: string, data: UpdateDTO): Promise<T | null> {
    const record = await this.model.findByPk(id);
    if (!record) return null;
    await record.update(data);
    return this.toEntity(record.toJSON());
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.model.destroy({ where: { id } });
    return deleted > 0;
  }

  async count(filter?: FilterOptions<T>): Promise<number> {
    const sqlFilter = filter ? this.buildSqlFilter(filter) : {};
    return this.model.count({ where: sqlFilter });
  }

  async exists(filter: FilterOptions<T>): Promise<boolean> {
    const sqlFilter = this.buildSqlFilter(filter);
    const record = await this.model.findOne({ where: sqlFilter });
    return record !== null;
  }

  protected abstract toEntity(data: any): T;
  protected abstract buildSqlFilter(filter: FilterOptions<T>): Record<string, any>;
}
```

### Step 2: Implement Domain Repositories

```typescript
// src/shared/database/adapters/postgresql/PostgreAgentRepository.ts
import { Agent } from '../../../models/agent';
import { IAgentEntity, IAgentRepository } from '../../../repositories/interfaces/IAgentRepository';
import { PostgreBaseRepository } from './PostgreBaseRepository';

export class PostgreAgentRepository
  extends PostgreBaseRepository<IAgentEntity>
  implements IAgentRepository {

  constructor() {
    super(Agent);
  }

  protected toEntity(data: any): IAgentEntity {
    return {
      agentId: data.agentId,
      name: data.name,
      description: data.description,
      // ... map all fields
    };
  }

  async findByAgentId(agentId: string): Promise<IAgentEntity | null> {
    const record = await this.model.findOne({ where: { agentId } });
    return record ? this.toEntity(record.toJSON()) : null;
  }

  async findByKeyId(keyId: string): Promise<IAgentEntity | null> {
    const record = await this.model.findOne({ where: { keyId } });
    return record ? this.toEntity(record.toJSON()) : null;
  }

  // ... implement other IAgentRepository methods
}
```

### Step 3: Update Factory

```typescript
// In DatabaseAdapterFactory.ts
case 'postgresql':
  this.instance = this.createPostgresRepositories();
  break;

// Add method:
private static createPostgresRepositories(): RepositoryBundle {
  return {
    agents: new PostgreAgentRepository(),
    channels: new PostgreChannelRepository(),
    tasks: new PostgreTaskRepository(),
    memory: new PostgreMemoryRepository()
  };
}
```

## Configuration

### Environment Variables

```bash
# Database Type
DB_TYPE=mongodb                                    # 'mongodb' | 'postgresql' | 'sqlite' | 'mysql'

# Connection
MONGODB_URI=mongodb://localhost:27017/mxf        # MongoDB connection string
# POSTGRES_URI=postgresql://user:pass@localhost/mxf  # PostgreSQL (planned)

# Connection Pool
DB_POOL_SIZE=10                                  # Connection pool size
DB_POOL_IDLE_TIMEOUT=30000                       # Idle timeout in ms
DB_POOL_MAX_LIFETIME=3600000                     # Max connection lifetime
```

## Available Adapters

### MongoDB (Current)

**Status**: Fully Implemented

**Features**:
- Mongoose-based implementation
- Full CRUD operations
- Complex filtering and aggregation
- Three-scope memory model
- Efficient indexing

**Files**:
- `src/shared/database/adapters/mongodb/MongoBaseRepository.ts`
- `src/shared/database/adapters/mongodb/MongoAgentRepository.ts`
- `src/shared/database/adapters/mongodb/MongoChannelRepository.ts`
- `src/shared/database/adapters/mongodb/MongoTaskRepository.ts`
- `src/shared/database/adapters/mongodb/MongoMemoryRepository.ts`

### PostgreSQL (Planned)

**Status**: Stub (throws "not yet implemented" error)

**Planned Features**:
- Sequelize-based implementation
- Full SQL query support
- Transactional operations
- Advanced indexing

### SQLite (Planned)

**Status**: Stub (throws "not yet implemented" error)

**Planned Features**:
- Embedded database support
- File-based persistence
- Development/testing environments

### MySQL (Planned)

**Status**: Stub (throws "not yet implemented" error)

**Planned Features**:
- Full SQL compatibility
- Enterprise scalability

## Best Practices

1. **Use the Factory**: Always instantiate repositories through `DatabaseAdapterFactory.create()`
2. **Filter Wisely**: Use database-agnostic filters for portability
3. **Paginate Large Results**: Always use pagination for potentially large result sets
4. **Type Safety**: Leverage TypeScript generics for compile-time safety
5. **Domain Focus**: Use domain-specific methods (e.g., `findByAgentId`) over generic `findOne`
6. **Memory Scopes**: Use appropriate memory scope (agent, channel, relationship)
7. **Error Handling**: Catch and handle repository errors in service layer
8. **Connection Pooling**: Configure appropriate pool sizes for load

## Troubleshooting

### Connection Errors

**Check**:
- Database server is running
- Connection string is correct
- Network connectivity
- Authentication credentials
- Firewall rules

### Performance Issues

**Actions**:
- Add appropriate indexes
- Use pagination for large datasets
- Optimize filter queries
- Increase connection pool size
- Monitor slow queries

### Type Errors

**Check**:
- Entity interfaces match database schema
- CreateDTO and UpdateDTO are correctly defined
- Generic type parameters are specified

## Related Documentation

- [System Overview](system-overview.md)
- [Server Services](server-services.md)
- [API Reference](../api/index.md)

## Implementation Files

**Factory**: `src/shared/database/DatabaseAdapterFactory.ts`
**Interfaces**: `src/shared/repositories/interfaces/`
**MongoDB Adapter**: `src/shared/database/adapters/mongodb/`
**Type Definitions**: `src/shared/repositories/types/`
**Tests**: `tests/unit/database/` and `tests/integration/repositories/`
