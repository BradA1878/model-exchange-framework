# Bare prompts and message activation

Agents can opt into an operator-only system prompt and turns triggered by
incoming messages. Defaults remain `promptMode: 'framework'`, `activation: 'task'`,
`circuitBreakerEnabled: true`, and `captureLlmRequests: false`.

Deploy the matching [server controls and history migration](../server-agent-controls.md)
for owner-published messages, private DM reads, and per-agent filesystem roots.
SDK prompt mode alone does not change server permissions or persistence.

Pass these options to `sdk.createAgent()` alongside the normal identity,
credentials, channel, provider, and model configuration:

```typescript
{
    agentConfigPrompt: operatorPrompt,
    promptMode: 'bare',
    activation: 'message',
    disableTaskHandling: true,
    circuitBreakerEnabled: false,
    captureLlmRequests: true,
    mxpEnabled: false,
    maxIterations: 20,
    allowedTools: toolNames,
    providerOptions: {
        provider: { order: ['anthropic'], allow_fallbacks: false }
    }
}
```

Bare mode requires a nonblank prompt and preserves its bytes, including template
syntax. It rejects `mxpEnabled: true` and `useMessageAggregate: true`. Message
activation also rejects aggregation and requires a positive integer iteration
limit when supplied. Invalid settings fail before connection.

The request contains the operator prompt, recorded dialogue and tool results,
and allowlisted registry tools with their full schemas and descriptions. Received
dialogue gets only `[sender]: ` attribution. Framework identity, task and action
sections, SystemLLM messages, tool-intent rewriting, and deferred instructional
feedback are omitted. Server tool errors stay in tool results; empty file content
stays empty. Malformed native tool arguments fail before dispatch. A missing
result recovered on reconnect is recorded as an explicit missing-result error
to preserve native tool pairing; it does not claim that external side effects
failed. History limits still apply and emit `HISTORY_TRIMMED`.

A channel message from another sender or a DM addressed to the agent starts one
turn after persistence. No task is required. Incoming messages during a turn are
stored and coalesce into one follow-up turn. Canonical message IDs deduplicate
the latest 100 received messages. Self messages do not start a turn. Disconnect
invalidates pending work; reconnect waits for an earlier provider call to drain
before starting a new one.

Native tool calls continue the turn. A response without tools is recorded as an
assistant message and ends it; it is not broadcast. Hitting `maxIterations` emits
`ITERATION_LIMIT`, with no task failure or extra history entry. Assigned tasks do
not start message turns; `disableTaskHandling: true` also disables the base
client's automatic task handling. Disabling the circuit breaker disables both
tracking and intervention; the iteration limit still bounds the turn.

Request capture observes the actual serialized HTTP JSON, including provider
routing options. OpenRouter, OpenAI, Azure OpenAI, Anthropic, xAI, and Ollama
support it. The installed Gemini SDK has no per-instance final-body observation
hook, so requesting capture fails before sending; ordinary bare Gemini requests
remain supported, without transport request metadata. Custom adapters must
implement transport observation themselves. Provider-native schemas may be
rejected by a provider; MXF does not remove constraints to make them pass.

OpenRouter requests include usage reporting. Cost, route, finish reason and token
counts reflect provider evidence; absent usage is not replaced with zeros. See
[events](events.md) for request/activation correlation and late-response usage.
See [OpenRouter streaming bounds](openrouter-streaming.md) for each attempt's
first-data and idle limits; keepalives do not count as model output.

On the server, `AUTO_CORRECTION_ENABLED=false` disables correction and pattern
learning; deterministic schema coercion remains enabled. The setting cannot be
re-enabled through a tool at runtime. Authorization and schema rejection create
no execution record. Accepted tool calls await their audit start and terminal
writes before returning. Cancelling a call settles its audit outcome but cannot
undo side effects in a handler that does not support cancellation.
