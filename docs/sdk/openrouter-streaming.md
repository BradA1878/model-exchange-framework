# OpenRouter streaming request bounds

MXF distinguishes a silent connection from a provider that sends keepalives but
never produces model output. Both failures abort the HTTP request and surface
an error to the agent.

| Setting | Library default | Applies to |
| --- | --- | --- |
| `OPENROUTER_REQUEST_TIMEOUT_MS` | 300000 ms | Entire non-streaming completion |
| `OPENROUTER_STREAM_IDLE_TIMEOUT_MS` | 120000 ms | Silence between streaming transport reads |
| `OPENROUTER_FIRST_TOKEN_TIMEOUT_MS` | 180000 ms | Each streaming attempt before actual model output |
| `OPENROUTER_SLOW_REQUEST_WARN_MS` | 60000 ms | Warning while a request remains in flight |

Keepalive comments reset the idle bound. They do not reset or clear the
first-data bound. Nonempty content, reasoning, encrypted reasoning data, or
native tool name/argument fragments clear the first-data bound. Role-only,
usage-only, and empty delta frames do not. Once model data arrives, the stream
has no total duration cap; transport idle expiry still applies.

A first-data expiry logs the model, agent, elapsed time, configured bound, and
request size at ERROR. It permits **one retry**, with a new request ID, while
preserving the activation ID. `OPENROUTER_MAX_RETRIES=1` disables that retry.
Other streaming errors, including failures after partial output, are not retried.
`[DONE]` ends a stream even when the provider leaves its HTTP body open.

Budget for both attempts and configured retry backoff. With the default
first-data bound, two stalled attempts take about six minutes plus backoff.
A consumer with a six-minute total task budget must choose a smaller bound or
one attempt, leaving room for its other model and tool calls. Increasing the
consumer budget alone does not repair a stalled provider.

The new first-data setting accepts a positive integer in milliseconds within
the runtime's timer range. Invalid values fail provider initialization. Request
capture records each attempted HTTP body; usage is emitted only when the
provider reports it, so a stalled attempt does not acquire fabricated usage.
