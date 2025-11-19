# Architecture Diagrams

This section provides comprehensive visual representations of the MXF architecture at different levels of abstraction.

## High-Level System Architecture

```mermaid
graph TB
    subgraph "User Interface Layer"
        DASH[Dashboard<br/>Vue 3 + Vuetify]
        CLI[CLI Tools]
        CUSTOM[Custom UIs]
    end
    
    subgraph "Client Layer"
        SDK[MXF SDK<br/>TypeScript]
        AGENT[MxfAgent<br/>LLM-Powered]
    end
    
    subgraph "API Gateway"
        REST[REST API<br/>Express.js]
        WS[WebSocket<br/>Socket.IO]
    end
    
    subgraph "Service Layer"
        AS[Agent Service]
        CS[Channel Service]
        TS[Task Service]
        MS[Memory Service]
        MCP[MCP Service]
        CLS[Control Loop Service]
    end
    
    subgraph "Core Infrastructure"
        EB[EventBus<br/>RxJS]
        AUTH[Auth Service<br/>JWT + Keys]
        CACHE[Cache Layer]
    end
    
    subgraph "Data Persistence"
        MONGO[(MongoDB)]
        REDIS[(Redis Cache)]
    end
    
    subgraph "External Integrations"
        LLM[LLM Providers<br/>OpenAI/Anthropic/etc]
        TOOLS[External Tools<br/>via MCP]
        WEBHOOKS[Webhooks]
    end
    
    DASH --> REST
    CLI --> SDK
    CUSTOM --> SDK
    SDK --> WS
    AGENT --> WS
    
    REST --> AUTH
    WS --> AUTH
    AUTH --> AS
    
    AS --> EB
    CS --> EB
    TS --> EB
    MS --> EB
    MCP --> EB
    CLS --> EB
    
    EB --> MONGO
    AS --> CACHE
    CACHE --> REDIS
    
    AS --> LLM
    MCP --> TOOLS
    CS --> WEBHOOKS
    
    style DASH fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    style SDK fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    style EB fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style MONGO fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
```

## Component Communication Flow

```mermaid
sequenceDiagram
    participant UI as Dashboard
    participant API as REST API
    participant WS as WebSocket
    participant EB as EventBus
    participant SVC as Services
    participant DB as MongoDB
    participant Agent as MxfAgent
    
    UI->>API: Login Request
    API->>DB: Validate User
    DB-->>API: User Data
    API-->>UI: JWT Token
    
    Agent->>WS: Connect with Keys
    WS->>EB: agent:register
    EB->>SVC: Process Registration
    SVC->>DB: Store Agent
    DB-->>SVC: Confirmation
    SVC->>EB: agent:registered
    EB->>WS: Forward Event
    WS-->>Agent: Connected
    
    Agent->>WS: message:send
    WS->>EB: Route Message
    EB->>SVC: Process Message
    SVC->>DB: Store Message
    EB->>WS: Broadcast
    WS-->>Agent: Delivered
```

## Data Flow Architecture

```mermaid
graph LR
    subgraph "Input Sources"
        A1[User Input]
        A2[Agent Messages]
        A3[API Calls]
        A4[Scheduled Tasks]
    end
    
    subgraph "Processing Pipeline"
        B1[Input Validation]
        B2[Authentication]
        B3[Authorization]
        B4[Business Logic]
        B5[Data Transform]
    end
    
    subgraph "Event Distribution"
        C1[EventBus]
        C2[Message Queue]
        C3[WebSocket Broadcast]
        C4[Webhook Dispatch]
    end
    
    subgraph "Storage"
        D1[(Primary DB)]
        D2[(Cache)]
        D3[(File Storage)]
        D4[(Logs)]
    end
    
    A1 --> B1
    A2 --> B1
    A3 --> B1
    A4 --> B4
    
    B1 --> B2
    B2 --> B3
    B3 --> B4
    B4 --> B5
    
    B5 --> C1
    C1 --> C2
    C1 --> C3
    C1 --> C4
    
    B5 --> D1
    B4 --> D2
    B5 --> D3
    C1 --> D4
    
    style B1 fill:#ffebee,stroke:#c62828
    style B4 fill:#e8f5e9,stroke:#2e7d32
    style C1 fill:#fff3e0,stroke:#ef6c00
    style D1 fill:#e3f2fd,stroke:#1565c0
```

## Service Layer Architecture

```mermaid
graph TB
    subgraph "API Layer"
        REST[REST Endpoints]
        WS[WebSocket Handlers]
    end
    
    subgraph "Service Layer"
        subgraph "Core Services"
            AS[AgentService<br/>- Registration<br/>- Lifecycle<br/>- Status]
            CS[ChannelService<br/>- CRUD<br/>- Participants<br/>- Access Control]
            TS[TaskService<br/>- Assignment<br/>- Tracking<br/>- Completion]
        end
        
        subgraph "Support Services"
            MS[MemoryService<br/>- Persistence<br/>- Scoping<br/>- Versioning]
            MCP[McpService<br/>- Tool Registry<br/>- Execution<br/>- Sandboxing]
            CLS[ControlLoopService<br/>- ORPAR Cycle<br/>- Pattern Learning<br/>- Coordination]
        end
        
        subgraph "Infrastructure Services"
            AUTH[AuthService<br/>- JWT<br/>- API Keys<br/>- Permissions]
            LOG[LogService<br/>- Custom Logger<br/>- Structured Logs<br/>- Aggregation]
            METRIC[MetricService<br/>- Performance<br/>- Business KPIs<br/>- Alerts]
        end
    end
    
    subgraph "Data Access Layer"
        REPO[Repositories<br/>- Mongoose Models<br/>- Query Builders<br/>- Transactions]
        CACHE[Cache Manager<br/>- Redis<br/>- In-Memory<br/>- TTL Management]
    end
    
    REST --> AS
    REST --> CS
    REST --> TS
    WS --> AS
    WS --> MS
    WS --> MCP
    
    AS --> REPO
    CS --> REPO
    TS --> REPO
    MS --> CACHE
    MCP --> CACHE
    
    AS --> AUTH
    CS --> AUTH
    TS --> LOG
    MS --> METRIC
```

## Memory System Architecture

```mermaid
graph TB
    subgraph "Memory Scopes"
        AM[Agent Memory<br/>Private Context]
        CM[Channel Memory<br/>Shared Context]
        RM[Relationship Memory<br/>Inter-Agent Context]
    end
    
    subgraph "Memory Operations"
        CREATE[Create Entry]
        READ[Read Entry]
        UPDATE[Update Entry]
        DELETE[Delete Entry]
        SEARCH[Search Entries]
    end
    
    subgraph "Memory Features"
        VERSION[Versioning<br/>- History Tracking<br/>- Rollback]
        META[Metadata<br/>- Tags<br/>- TTL<br/>- Importance]
        SYNC[Synchronization<br/>- Real-time Updates<br/>- Conflict Resolution]
    end
    
    subgraph "Storage Backend"
        DB[(MongoDB<br/>Collections)]
        IDX[Indexes<br/>- scope<br/>- targetId<br/>- key]
        TTL[TTL Management<br/>- Expiration<br/>- Cleanup]
    end
    
    AM --> CREATE
    CM --> CREATE
    RM --> CREATE
    
    CREATE --> VERSION
    UPDATE --> VERSION
    READ --> META
    
    VERSION --> DB
    META --> DB
    SYNC --> DB
    
    DB --> IDX
    DB --> TTL
    
    style AM fill:#e8eaf6,stroke:#283593
    style CM fill:#e0f2f1,stroke:#00695c
    style RM fill:#fce4ec,stroke:#880e4f
```

## MCP Tool Integration Architecture

```mermaid
graph LR
    subgraph "Tool Providers"
        P1[Anthropic MCP]
        P2[OpenAI Functions]
        P3[XAI Tools]
        P4[Custom Tools]
    end
    
    subgraph "MCP Service"
        REG[Tool Registry]
        VAL[Validator]
        EXEC[Executor]
        SAND[Sandbox]
    end
    
    subgraph "Tool Lifecycle"
        DISC[Discovery]
        LOAD[Loading]
        CACHE[Caching]
        MON[Monitoring]
    end
    
    subgraph "Security"
        PERM[Permissions]
        LIMIT[Rate Limiting]
        LOG[Audit Log]
    end
    
    P1 --> REG
    P2 --> REG
    P3 --> REG
    P4 --> REG
    
    REG --> VAL
    VAL --> EXEC
    EXEC --> SAND
    
    EXEC --> CACHE
    SAND --> MON
    
    SAND --> PERM
    EXEC --> LIMIT
    SAND --> LOG
    
    style REG fill:#f3e5f5,stroke:#4a148c
    style SAND fill:#ffebee,stroke:#b71c1c
    style PERM fill:#e8f5e9,stroke:#1b5e20
```

## Control Loop (ORPAR) Architecture

```mermaid
stateDiagram-v2
    [*] --> Initialize
    Initialize --> Observe
    
    Observe --> Reason
    Reason --> Plan
    Plan --> Action
    Action --> Reflect
    Reflect --> Observe
    
    state Observe {
        [*] --> CollectData
        CollectData --> ProcessInputs
        ProcessInputs --> EnrichMetadata
    }
    
    state Reason {
        [*] --> AnalyzeContext
        AnalyzeContext --> IdentifyPatterns
        IdentifyPatterns --> GenerateInsights
    }
    
    state Plan {
        [*] --> CreatePlan
        CreatePlan --> PrioritizeActions
        PrioritizeActions --> DefineDependencies
    }
    
    state Action {
        [*] --> ExecutePlan
        ExecutePlan --> MonitorProgress
        MonitorProgress --> HandleErrors
    }
    
    state Reflect {
        [*] --> EvaluateOutcomes
        EvaluateOutcomes --> ExtractLearnings
        ExtractLearnings --> UpdatePatterns
    }
    
    Reflect --> [*]: Complete
```

## Deployment Architecture

```mermaid
graph TB
    subgraph "Load Balancer"
        LB[Nginx/HAProxy]
    end
    
    subgraph "Application Tier"
        API1[API Server 1]
        API2[API Server 2]
        WS1[WebSocket Server 1]
        WS2[WebSocket Server 2]
    end
    
    subgraph "Service Tier"
        SVC1[Service Instance 1]
        SVC2[Service Instance 2]
        WORKER1[Task Worker 1]
        WORKER2[Task Worker 2]
    end
    
    subgraph "Data Tier"
        MONGO1[(MongoDB Primary)]
        MONGO2[(MongoDB Secondary)]
        REDIS1[(Redis Master)]
        REDIS2[(Redis Slave)]
    end
    
    subgraph "Monitoring"
        PROM[Prometheus]
        GRAF[Grafana]
        LOG[ELK Stack]
    end
    
    LB --> API1
    LB --> API2
    LB --> WS1
    LB --> WS2
    
    API1 --> SVC1
    API2 --> SVC2
    WS1 --> SVC1
    WS2 --> SVC2
    
    SVC1 --> WORKER1
    SVC2 --> WORKER2
    
    SVC1 --> MONGO1
    SVC2 --> MONGO1
    MONGO1 --> MONGO2
    
    SVC1 --> REDIS1
    SVC2 --> REDIS1
    REDIS1 --> REDIS2
    
    API1 --> PROM
    SVC1 --> LOG
    PROM --> GRAF
    
    style LB fill:#ffcdd2,stroke:#d32f2f
    style MONGO1 fill:#c8e6c9,stroke:#388e3c
    style PROM fill:#fff9c4,stroke:#f57f17
```

## Security Architecture

```mermaid
graph TB
    subgraph "External Access"
        CLIENT[Client Applications]
        AGENT[Agent SDKs]
    end
    
    subgraph "Security Layers"
        TLS[TLS/SSL<br/>Encryption]
        WAF[Web Application<br/>Firewall]
        RATE[Rate Limiting]
    end
    
    subgraph "Authentication"
        JWT[JWT Auth<br/>- Users<br/>- Dashboard]
        KEY[API Key Auth<br/>- Agents<br/>- Channels]
        MFA[Multi-Factor<br/>Authentication]
    end
    
    subgraph "Authorization"
        RBAC[Role-Based<br/>Access Control]
        PERM[Permission<br/>Matrix]
        SCOPE[Resource<br/>Scoping]
    end
    
    subgraph "Data Protection"
        ENC[Encryption<br/>at Rest]
        HASH[Password<br/>Hashing]
        AUDIT[Audit<br/>Logging]
    end
    
    CLIENT --> TLS
    AGENT --> TLS
    TLS --> WAF
    WAF --> RATE
    
    RATE --> JWT
    RATE --> KEY
    JWT --> MFA
    
    JWT --> RBAC
    KEY --> RBAC
    RBAC --> PERM
    PERM --> SCOPE
    
    SCOPE --> ENC
    SCOPE --> HASH
    SCOPE --> AUDIT
    
    style TLS fill:#e8f5e9,stroke:#2e7d32
    style JWT fill:#e3f2fd,stroke:#1565c0
    style RBAC fill:#fff3e0,stroke:#ef6c00
    style ENC fill:#ffebee,stroke:#c62828
```

## Performance Optimization Architecture

```mermaid
graph LR
    subgraph "Frontend Optimizations"
        CDN[CDN<br/>Static Assets]
        LAZY[Lazy Loading<br/>Components]
        CACHE_FE[Browser<br/>Caching]
    end
    
    subgraph "API Optimizations"
        POOL[Connection<br/>Pooling]
        BATCH[Request<br/>Batching]
        COMPRESS[Response<br/>Compression]
    end
    
    subgraph "Database Optimizations"
        INDEX[Query<br/>Indexing]
        SHARD[Data<br/>Sharding]
        REPLICA[Read<br/>Replicas]
    end
    
    subgraph "Caching Strategy"
        MEM[In-Memory<br/>Cache]
        REDIS_C[Redis<br/>Cache]
        QUERY[Query Result<br/>Cache]
    end
    
    CDN --> LAZY
    LAZY --> CACHE_FE
    
    CACHE_FE --> POOL
    POOL --> BATCH
    BATCH --> COMPRESS
    
    COMPRESS --> MEM
    MEM --> REDIS_C
    REDIS_C --> QUERY
    
    QUERY --> INDEX
    INDEX --> SHARD
    SHARD --> REPLICA
    
    style CDN fill:#e1f5fe,stroke:#01579b
    style MEM fill:#fff3e0,stroke:#e65100
    style INDEX fill:#e8f5e9,stroke:#1b5e20
```

---

## Next Steps

1. Understand [Key Concepts](key-concepts.md) that drive the architecture
2. Learn about [Data Flow](data-flow.md) patterns in detail
3. Explore [System Overview](system-overview.md) for component details
4. Review [Security](security.md) architecture implementation
5. Check [Development Lifecycle](development-lifecycle.md) for best practices