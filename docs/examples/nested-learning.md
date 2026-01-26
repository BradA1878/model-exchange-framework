# Nested Learning Demo

Demonstrates the **Self-Evolving Reasoning Cycle (SERC)** integrating concepts from Titans, MIRAS, and Agent0-VL into MXF's ORPAR control loop.

## Overview

Nested Learning enables agents to learn continuously with multi-timescale memory, verify their own reasoning through tool-grounded analysis, and self-correct when verification identifies issues.

## Key MXF Features Demonstrated

### Memory Strata (MIRAS Framework)

Four temporal layers with different update frequencies:

| Stratum | Update Frequency | Persistence | Architecture | Bias |
|---------|------------------|-------------|--------------|------|
| Immediate | Every cycle | Ephemeral | Vector | MSE |
| Tactical | 3-5 cycles | Session | Matrix | YAAD |
| Operational | 10-20 cycles | Extended | Matrix | YAAD |
| Strategic | 50+ cycles | Persistent | Deep MLP | MEMORA |

### Surprise Calculation with Momentum

Titans-inspired surprise with contextual momentum:

```
momentarySurprise = |predicted - actual|
accumulated = accumulated * decay + momentary * (1 - decay)
effectiveSurprise = momentary + accumulated * 0.5
```

Momentum ensures contextually related information following a surprising event is also captured.

### Tool-Grounded Verification (Verifier Mode)

During Reflection, the Verifier produces:

```typescript
interface VerificationTuple {
  score: number;      // -1 to 1, factual correctness
  confidence: number; // 0 to 1, epistemic certainty
  critique: string;   // Natural language feedback
}
```

### Self-Repair Protocol (PATCH Instructions)

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

## Running the Demo

### Start Server

```bash
bun run dev
```

### Set Up Environment

```bash
cd examples/nested-learning-demo
cp .env.example .env
```

### Run the Demo

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

## SERC Architecture

### Inner Loop (per-cycle)

1. **Observation** → Compute surprise signal
2. **Reasoning** → Modulated by surprise level
3. **Planning** → Generate predictions
4. **Action** → Execute and record outcomes
5. **Reflection** → Verifier mode with tool-grounded verification

### Outer Loop (cross-cycle)

- Memory consolidation to slower strata
- SystemLLM pattern recognition
- Strategic updates
- MIRAS configuration adjustment

### Solver/Verifier Mode Switching

```
Success → Solver Mode (continue exploration)
Failure → Verifier Mode (check reasoning)
Repeated Failure → Self-Repair Protocol
Recovery → Solver Mode (resume)
```

## Promotion Score

Combined scoring formula:

```
score = α_s * surprise
      + α_c * confidence
      + α_t * toolVerificationScore
      - β * repairCost
```

## Learning Points

- **Continual Learning**: Multi-timescale memory prevents catastrophic forgetting
- **Self-Correction**: Tool-grounded verification enables genuine self-repair
- **Adaptive Depth**: Surprise modulates reasoning depth
- **Cross-Agent Learning**: SystemLLM as outer optimizer

## References

- **Titans**: Learning to Memorize at Test Time (2025)
- **MIRAS**: Unified Framework for Sequence Modeling (2025)
- **Agent0-VL**: Self-Evolving Agent for Tool-Integrated Reasoning (2025)
- **Nested Learning**: Multi-Timescale Memory Paradigm (NeurIPS 2025)

## Source Code

See the full implementation in `examples/nested-learning-demo/`

## Related Documentation

- [Nested Learning](../mxf/nested-learning.md)
- [ORPAR Control Loop](../mxf/orpar.md)
- [ORPAR-Memory Integration](../mxf/orpar-memory-integration.md)
