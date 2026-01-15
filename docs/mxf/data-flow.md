# Data Flow

The following sequence illustrates request and response flow in MXF:

<div class="mermaid-fallback">

```mermaid
sequenceDiagram
    participant User
    participant Dashboard
    participant SDK
    participant API
    participant DB

    User->>Dashboard: Trigger action (create channel/task)
    Dashboard->>API: HTTP POST/GET/PUT
    SDK->>API: HTTP POST/GET/PUT (programmatic)
    API->>DB: Read/Write data
    API-->>Dashboard: Response JSON
    API-->>SDK: Response JSON
    Dashboard-->>User: UI update
```

</div>

<iframe src="../diagram/data-flow-architecture.html" width="100%" height="520" style="border: none; border-radius: 10px; background: var(--bg-secondary);"></iframe>

Key points:
- Both Dashboard and SDK use the same API endpoints.
- Real-time updates via WebSocket (Socket.IO) for task and memory changes.
- Persistent storage in MongoDB ensures data consistency.
