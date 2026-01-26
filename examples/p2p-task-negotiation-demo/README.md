# P2P Task Negotiation Demo

Demonstrates **decentralized task assignment** via auction mechanism. Multiple agents bid on announced tasks based on their capabilities, and selection is made using configurable strategies.

## Overview

P2P Task Negotiation allows tasks to be distributed across a network of agents through an auction-based marketplace. Agents bid on tasks they're capable of handling, and a selection strategy determines the winner.

### Key Concepts

**Task Announcement**: Tasks are broadcast with requirements, complexity, and reward.

**Agent Bidding**: Agents submit bids including confidence, estimated duration, and proposed cost.

**Selection Strategies**: Different strategies for choosing the winning bid.

## What This Demo Shows

1. **Agent Marketplace**: Registered agents and their capabilities
2. **Task Announcement**: Broadcasting tasks to the marketplace
3. **Bid Collection**: Gathering bids from eligible agents
4. **Selection Strategies**: Comparing different selection approaches
5. **Complex Tasks**: Tasks requiring multiple capabilities
6. **MXF Integration**: Agent-based marketplace coordination

## Running the Demo

1. Ensure MXF server is running:
   ```bash
   bun run dev
   ```

2. Set up environment:
   ```bash
   cd examples/p2p-task-negotiation-demo
   cp .env.example .env
   ```

3. Run the demo:
   ```bash
   bun run p2p-task-negotiation-demo.ts
   ```

## Expected Output

```
======================================================================
  P2P Task Negotiation Demo
======================================================================

[Step 1] The Agent Marketplace
  Alpha Agent (agent_alpha)
    Capabilities: data_analysis, code_review, testing
    Reputation: 95%
    Base cost: $10

[Step 2] Task Announcement
  Title: Data Analysis Project
  Required: data_analysis
  Complexity: moderate
  Reward: $25

[Step 3] Bid Collection
  Alpha Agent submitted bid:
    Confidence: 95%, Duration: 3m, Cost: $15.00
  Beta Agent submitted bid:
    Confidence: 82%, Duration: 4m, Cost: $10.50

Total bids received: 2

[Step 4] Selection Strategies
  lowest_price        → Beta Agent
  highest_reputation  → Alpha Agent
  fastest             → Alpha Agent
  best_value          → Alpha Agent
```

## Selection Strategies

| Strategy | Description | Use When |
|----------|-------------|----------|
| `lowest_price` | Minimize cost | Budget constrained |
| `highest_reputation` | Prioritize trust | Quality critical |
| `fastest` | Minimize duration | Time sensitive |
| `best_value` | Balanced scoring | General use |

### Best Value Scoring

```
score = (reputation * confidence) / (cost * duration)
```

## Agent Profile

```typescript
interface AgentProfile {
  id: string;
  name: string;
  capabilities: string[];  // What the agent can do
  reputation: number;      // 0-1, based on past performance
  baseCost: number;        // Base cost per task
  speedMultiplier: number; // Affects estimated duration
}
```

## Task Announcement

```typescript
interface TaskAnnouncement {
  id: string;
  title: string;
  description: string;
  requiredCapabilities: string[];  // Must have ALL
  complexity: 'simple' | 'moderate' | 'complex';
  deadline: Date;
  reward: number;
  bidWindow: number;  // ms to collect bids
}
```

## Agent Bid

```typescript
interface TaskBid {
  announcementId: string;
  agentId: string;
  confidence: number;       // 0-1
  estimatedDuration: number; // ms
  proposedCost: number;
  capabilities: string[];
  reputation: number;
}
```

## Configuration

```typescript
const config = {
  enabled: true,
  defaultBidWindowMs: 30000,
  minBidsRequired: 1,
  maxBidsAccepted: 10,
  defaultSelectionStrategy: 'best_value'
};
```

## Key Benefits

- **Decentralized**: No central task assignment
- **Market-Based**: Supply and demand economics
- **Capability Matching**: Only qualified agents bid
- **Reputation System**: Track agent performance
- **Flexible Strategies**: Choose what matters most
