---
description: Run full test suite with auto-start (CI mode)
---

Run the complete test suite with automatic infrastructure and server startup:

```bash
npm run test:ci
```

**What happens:**
1. Starts infrastructure (MongoDB, Meilisearch, Redis) via Docker
2. Starts the MXF server automatically
3. Runs all integration tests
4. Stops the server on completion
5. Infrastructure left running for faster subsequent runs

**Use when:**
- Running in CI/CD pipeline
- Need completely fresh test environment
- Don't want to manage server manually

**Note:** This takes longer than manual mode due to server startup time.
For faster iteration, use `npm run dev` first, then `/test`.
