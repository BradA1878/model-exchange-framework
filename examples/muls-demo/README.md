# Memory Utility Learning System (MULS) Demo

This demo is **fully agentic** - an autonomous agent demonstrates MULS by making real tool calls to store memories, inject rewards, and view analytics.

## What the Agent Does

The agent executes these steps autonomously:

1. **Check Configuration** - Calls `memory_utility_config` to verify MULS is enabled
2. **Store Test Memories** - Creates 5 pattern memories using `agent_memory_write`
3. **View Initial Q-Values** - Calls `memory_qvalue_analytics` (all start at 0.5)
4. **Inject Rewards** - Simulates task outcomes via `memory_inject_reward`:
   - Positive rewards for successful patterns (+0.8, +0.9)
   - Negative reward for failed pattern (-0.6)
   - Partial reward for partially effective pattern (+0.3)
5. **View Updated Q-Values** - Shows how Q-values changed after rewards
6. **Explain Benefits** - Describes how this affects future retrieval
7. **Complete** - Summarizes the demonstration

## Key MULS Concepts

### Q-Value Update Formula (EMA)

```
Q_new = Q_old + alpha * (reward - Q_old)
```

Where `alpha` (learning rate) = 0.1

### Composite Scoring Formula

```
score = (1 - lambda) * similarity + lambda * Q_normalized
```

- `lambda = 0`: Pure semantic similarity
- `lambda = 1`: Pure utility (Q-value)
- `lambda = 0.5`: Balanced

### ORPAR Phase-Specific Lambda Values

| Phase | Lambda | Rationale |
|-------|--------|-----------|
| OBSERVATION | 0.2 | Prioritize semantic accuracy |
| REASONING | 0.5 | Balance exploration/exploitation |
| PLANNING | 0.7 | Exploit proven patterns |
| ACTION | 0.3 | Stay grounded |
| REFLECTION | 0.6 | Favor good assessments |

## Running the Demo

### Prerequisites

- MXF server running with MULS enabled
- `OPENROUTER_API_KEY` set for LLM operations

### Start Server with MULS Enabled

```bash
MEMORY_UTILITY_LEARNING_ENABLED=true bun run dev
```

### Run the Demo

```bash
bun run demo:muls
```

## Expected Output

You'll see tool calls like:

```
==================================================
[MULS Tool Call] memory_utility_config
==================================================
  Action: get

==================================================
[MULS Tool Call] agent_memory_write
==================================================
  Key: muls_pattern_auth
  Value: {"type":"pattern","content":"JWT authentication...

==================================================
[MULS Tool Call] memory_inject_reward
==================================================
  Memory ID: muls_pattern_auth
  Reward: +0.8
  Reason: Successfully implemented secure authentication

[Reward Injection Result]
  Success: Memory muls_pattern_auth
  New Q-Value: 0.5300
```

## MULS Tools Used

| Tool | Purpose |
|------|---------|
| `memory_utility_config` | Get/set MULS configuration |
| `memory_qvalue_analytics` | View Q-value distribution and top performers |
| `memory_inject_reward` | Manually inject reward signals |
| `agent_memory_write` | Store memories in agent memory |

## Environment Variables

```bash
# Enable MULS (required for full demo)
MEMORY_UTILITY_LEARNING_ENABLED=true

# Q-value configuration
QVALUE_DEFAULT=0.5
QVALUE_LEARNING_RATE=0.1

# Lambda values
RETRIEVAL_LAMBDA_DEFAULT=0.5
RETRIEVAL_LAMBDA_OBSERVATION=0.2
RETRIEVAL_LAMBDA_REASONING=0.5
RETRIEVAL_LAMBDA_PLANNING=0.7
RETRIEVAL_LAMBDA_ACTION=0.3
RETRIEVAL_LAMBDA_REFLECTION=0.6
```

## Troubleshooting

### "MULS is disabled"

Start the server with the environment variable:
```bash
MEMORY_UTILITY_LEARNING_ENABLED=true bun run dev
```

### "Tools NOT FOUND in registry"

Restart the server - the tool registration order was fixed to ensure MULS tools are registered before McpService initializes.

### Connection errors

Ensure the MXF server is running on port 3001:
```bash
bun run dev
```
