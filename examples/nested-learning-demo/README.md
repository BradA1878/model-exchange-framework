# Nested Learning Demo

Demonstrates the **Self-Evolving Reasoning Cycle (SERC)** integrating concepts from Titans, MIRAS, and Agent0-VL into MXF's ORPAR control loop.

## Overview

Nested Learning enables agents to learn continuously with multi-timescale memory, verify their own reasoning through tool-grounded analysis, and self-correct when verification identifies issues.

### Key Concepts

**Memory Strata**: Four temporal layers (Immediate, Tactical, Operational, Strategic) with different update frequencies.

**Surprise Signal**: Gradient-based prediction error with momentum tracking for contextual continuity.

**Tool-Grounded Verification**: Reflection uses external tools to cross-check reasoning, not just text-based review.

**Self-Repair Protocol**: PATCH instructions generated when confidence falls below threshold.

## What This Demo Shows

1. **Memory Strata Configuration**: MIRAS framework design choices
2. **Surprise Calculation**: Momentum tracking for contextual surprise
3. **Verifier Mode**: Tool invocation during Reflection
4. **Self-Repair**: PATCH generation and re-execution flow
5. **SERC Orchestration**: Inner/outer loop architecture
6. **Promotion Scoring**: Combined reward from Titans + MIRAS + Agent0-VL

## Running the Demo

1. Ensure MXF server is running:
   ```bash
   bun run dev
   ```

2. Set up environment:
   ```bash
   cd examples/nested-learning-demo
   cp .env.example .env
   ```

3. Run the demo:
   ```bash
   bun run nested-learning-demo.ts
   ```

## Expected Output

```
======================================================================
  Nested Learning Demo
  Self-Evolving Reasoning Cycle (SERC)
======================================================================

[Step 1] Memory Strata (MIRAS Framework)

Four memory strata with different temporal frequencies:

  Immediate Stratum
    Update: Every cycle
    Persistence: Ephemeral
    Decay rate: 0.8/cycle
    Architecture: vector
    Bias: MSE

  Tactical Stratum
    Update: Every 3-5 cycles
    ...

[Step 2] Surprise Calculation with Momentum

  Cycle 3: Unexpected error!
    Momentary surprise: 0.450
    Accumulated (momentum): 0.315
    Effective surprise: 0.608
    Should promote: YES

[Step 3] Tool-Grounded Verification (Verifier Mode)

  Scenario: Fact-checking claim
  Reasoning: "The capital of Australia is Sydney"
  Verification Tuple:
    Score: -1.00 (incorrect)
    Confidence: 94%
    Critique: Tool verification failed.

[Step 4] Self-Repair Protocol (PATCH Instructions)

  Low confidence - trigger repair:
    Confidence: 55%
    Action: PATCH (step 3)
    Type: parameter
    → Re-execute Planning phase with correction
```

## Memory Strata

| Stratum | Update Frequency | Persistence | Architecture | Bias |
|---------|------------------|-------------|--------------|------|
| Immediate | Every cycle | Ephemeral | Vector | MSE |
| Tactical | 3-5 cycles | Session | Matrix | YAAD |
| Operational | 10-20 cycles | Extended | Matrix | YAAD |
| Strategic | 50+ cycles | Persistent | Deep MLP | MEMORA |

## Surprise Calculation

Titans-inspired surprise with momentum:

```
momentarySurprise = |predicted - actual|
accumulated = accumulated * decay + momentary * (1 - decay)
effectiveSurprise = momentary + accumulated * 0.5
```

Momentum ensures contextually related information following a surprising event is also captured.

## Verification Tuple

During Reflection, the Verifier produces:

```typescript
interface VerificationTuple {
  score: number;      // -1 to 1, factual correctness
  confidence: number; // 0 to 1, epistemic certainty
  critique: string;   // Natural language feedback
}
```

## Self-Repair Protocol

When confidence falls below threshold (default 70%):

```typescript
interface PatchInstruction {
  action: 'PATCH' | 'NO_CHANGE';
  targetStep: number;
  patchType?: 'reasoning' | 'tool_call' | 'parameter';
  newContent?: string;
  justification: string;
}
```

## SERC Architecture

**Inner Loop** (per-cycle):
1. Observation → Compute surprise signal
2. Reasoning → Modulated by surprise level
3. Planning → Generate predictions
4. Action → Execute and record outcomes
5. Reflection → Verifier mode with tool-grounded verification

**Outer Loop** (cross-cycle):
- Memory consolidation to slower strata
- SystemLLM pattern recognition
- Strategic updates
- MIRAS configuration adjustment

## Promotion Score

Combined scoring formula:

```
score = α_s * surprise
      + α_c * confidence
      + α_t * toolVerificationScore
      - β * repairCost
```

## Key Benefits

- **Continual Learning**: Multi-timescale memory prevents catastrophic forgetting
- **Self-Correction**: Tool-grounded verification enables genuine self-repair
- **Adaptive Depth**: Surprise modulates reasoning depth
- **Cross-Agent Learning**: SystemLLM as outer optimizer

## References

- **Titans**: Learning to Memorize at Test Time (2025)
- **MIRAS**: Unified Framework for Sequence Modeling (2025)
- **Agent0-VL**: Self-Evolving Agent for Tool-Integrated Reasoning (2025)
- **Nested Learning**: Multi-Timescale Memory Paradigm (NeurIPS 2025)
