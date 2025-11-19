# Development Lifecycle

This section outlines the typical development workflow and code structure for MXF components.

## Repository Structure

```
model-exchange-framework/
├── src/server/         # Backend API server (TypeScript, Express)
├── dashboard/          # Vue 3 Dashboard application
├── sdk/                # MXF TypeScript SDK client
└── docs/               # Documentation (API, Dashboard, SDK, MXF)
```

## Backend

- **Install:** `pnpm install` in project root
- **Run:** `pnpm start` or `node dist/index.js` (default port 3001)
- **Build:** `pnpm build` compiles TypeScript to `dist/`
- **Lint:** `pnpm lint` ensures code style and TS rules
- **Validate:** Shared request/response schemas in `src/shared/schemas`

## Dashboard

- **Navigate:** `cd dashboard`
- **Install:** `pnpm install`
- **Dev Server:** `pnpm dev` (http://localhost:3002)
- **Build:** `pnpm build` outputs to `dashboard/dist/`

## SDK

- **Navigate:** `cd sdk`
- **Install:** `pnpm install`
- **Build:** `pnpm build` generates ESM/CJS in `dist/`
- **Test:** Manual smoke tests via example scripts (no unit tests)
- **Publish:** `npm publish` or `pnpm publish`

## Documentation

- **Location:** `docs/` folder contains all markdown files
- **Render:** Use any markdown viewer or publish to static site (e.g., Docusaurus)
- **Update:** After code changes, synchronize docs with API and config updates

---

By following this lifecycle, contributors can develop, validate, and publish MXF components efficiently.
