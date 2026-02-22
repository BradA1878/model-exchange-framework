# User Input Demo — Interactive Project Setup Wizard

Demonstrates the `user_input` MCP tool system end-to-end. An LLM agent guides the user through configuring a new software project, asking 7 questions that exercise all input types, modes, and edge cases.

## What This Demo Shows

- **Full end-to-end flow**: Agent LLM → Server → Socket.IO → SDK → Terminal Prompt → Response
- **All 4 input types**: `text`, `select`, `multi_select`, `confirm`
- **Blocking mode**: Agent pauses until user responds (Steps 1-4, 6-7)
- **Async mode**: Agent sends prompt, continues working, polls for response (Step 5)
- **Urgency levels**: `low`, `normal`, `high`, `critical`
- **Themes**: `default`, `info`, `success`, `warning`, `error`
- **Timeout behavior**: Step 7 has a 10-second timeout — wait it out to see timeout handling
- **Ctrl+C handling**: Clean exit with resource cleanup

## Prerequisites

1. MXF server running: `bun run start:dev`
2. MongoDB running (used by the server)
3. Environment variables configured (see below)

## Setup

```bash
cd examples/user-input-demo
cp .env.example .env
# Fill in MXF_DEMO_ACCESS_TOKEN, MXF_DOMAIN_KEY, OPENROUTER_API_KEY
```

Generate access token and domain key:
```bash
bun run server:cli -- demo:setup
```

## Running

```bash
bun run demo:user-input
```

## Expected Output

The demo walks through 7 interactive prompts:

| Step | Input Type     | Mode     | Theme   | Urgency  | Content                                   |
|------|---------------|----------|---------|----------|--------------------------------------------|
| 1    | `text`        | blocking | info    | normal   | Project name (min 2, max 50 chars)         |
| 2    | `select`      | blocking | default | high     | Framework (React/Vue/Angular/Svelte/Next)  |
| 3    | `multi_select`| blocking | success | normal   | Features (TypeScript, ESLint, etc.)        |
| 4    | `confirm`     | blocking | warning | critical | Enable auto-deploy?                        |
| 5    | `text`        | async    | info    | low      | Project description (multiline, polled)    |
| 6    | `select`      | blocking | default | low      | License choice (MIT/Apache/GPL/BSD)        |
| 7    | `text`        | blocking | error   | high     | Favorite color (10s timeout test)          |

After all steps, the agent calls `task_complete` with a summary of all choices.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│  LLM Agent  │────▶│  MXF Server  │────▶│  SDK Client  │────▶│  Terminal   │
│  (OpenRouter)│     │  (Socket.IO) │     │  (EventBus)  │     │  (prompts)  │
│             │     │              │     │              │     │             │
│  Calls      │     │  Forwards    │     │  Receives    │     │  Renders    │
│  user_input │     │  REQUEST     │     │  REQUEST     │     │  prompt     │
│  tool       │     │  event       │     │  event       │     │  to user    │
│             │◀────│              │◀────│              │◀────│             │
│  Gets       │     │  Routes      │     │  Emits       │     │  User       │
│  response   │     │  RESPONSE    │     │  RESPONSE    │     │  answers    │
└─────────────┘     └──────────────┘     └──────────────┘     └─────────────┘
```

## Handler Pattern

The key integration point is `agent.onUserInput()`. Here's the pattern for each input type:

```typescript
import { MxfSDK } from '../../src/sdk/index';
import type { UserInputRequestData, UserInputResponseValue } from '../../src/sdk/index';
import prompts from 'prompts';

// After creating the agent via sdk.createAgent()
agent.onUserInput(async (request: UserInputRequestData): Promise<UserInputResponseValue> => {
    switch (request.inputType) {
        case 'text': {
            const { value } = await prompts({ type: 'text', name: 'value', message: request.title });
            return value;
        }
        case 'select': {
            const config = request.inputConfig as { options: Array<{ value: string; label: string }> };
            const { value } = await prompts({
                type: 'select', name: 'value', message: request.title,
                choices: config.options.map(o => ({ title: o.label, value: o.value }))
            });
            return value;
        }
        case 'multi_select': {
            const config = request.inputConfig as { options: Array<{ value: string; label: string }> };
            const { value } = await prompts({
                type: 'multiselect', name: 'value', message: request.title,
                choices: config.options.map(o => ({ title: o.label, value: o.value }))
            });
            return value;
        }
        case 'confirm': {
            const { value } = await prompts({ type: 'confirm', name: 'value', message: request.title });
            return value;
        }
    }
});
```

## Troubleshooting

- **"MXF_DEMO_ACCESS_TOKEN is required"**: Run `bun run server:cli -- demo:setup` to generate credentials
- **Connection refused**: Make sure the MXF server is running (`bun run start:dev`)
- **Agent not responding**: Check that `OPENROUTER_API_KEY` is set and has credits
- **Timeout on Step 7**: This is expected behavior — the step has a 10s timeout to test the timeout feature
