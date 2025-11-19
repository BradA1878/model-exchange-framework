# Security

This section details the security model and best practices in MXF.

## Authentication

- **JWT (Dashboard Users):**
  - Issued via magic link or login endpoint.
  - Sent in `Authorization: Bearer <token>` header.
  - Middleware validates token and attaches user context.

- **Agent Keys (SDK):**
  - Generated and managed through the Dashboard key management APIs.
  - Use the `apiKey` header or `X-API-Key` for requests.
  - Rotate or revoke keys via `/api/agents/keys` endpoints.

## Authorization

- All protected endpoints enforce JWT or agent key checks.
- Dashboard-only actions require validated JWT with user scope.
- SDK actions use agent key permissions.

## Data Validation & Fail-Fast

- Shared validation utilities in `src/shared/utils/validation.ts` assert input integrity.
- Request schemas defined in `src/shared/schemas/MessageSchemas.ts`.
- Errors return standardized responses with HTTP status codes.

## Encryption & Storage

- Secrets (API keys, tokens) never stored in plain text in client.
- Keys stored securely in MongoDB with creation timestamps.
- Use HTTPS/TLS for all network communication.

## Best Practices

- Rotate agent keys periodically.
- Use environment variables for sensitive configs.
- Keep dependencies up to date and audit for vulnerabilities.
