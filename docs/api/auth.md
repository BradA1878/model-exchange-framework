# Authentication API

Detailed reference for all `/users` authentication and user management endpoints.

---

## Register User
**POST** `/users/register`
- **Auth:** None
- **Description:** Create a new user account.

**Body:**
```json
{
  "username": "string",       // required
  "email": "string",          // required
  "password": "string",       // required
  "firstName": "string",      // optional
  "lastName": "string",       // optional
  "company": "string",        // optional
  "role": "string"            // optional, default: CONSUMER
}
```

**Response:**
```json
{
  "success": true,
  "message": "User registered successfully",
  "user": {
    "id": "string",
    "username": "string",
    "email": "string",
    "firstName": "string",
    "lastName": "string",
    "company": "string",
    "role": "string"
  },
  "token": "jwt-token"
}
```

---

## User Login
**POST** `/users/login`
- **Auth:** None
- **Description:** Authenticate with username/email and password.

**Body:**
```json
{
  "username": "string",  // username or email
  "password": "string"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "user": { /* same user object as register */ },
  "token": "jwt-token"
}
```

---

## Request Magic Link
**POST** `/users/magic-link`
- **Auth:** None
- **Description:** Generate a magic link token and send or return it for login.

**Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Magic link generated successfully",
  "magicLink": "token-string",   // for dev
  "expiresIn": "15 minutes"
}
```

---

## Verify Magic Link
**POST** `/users/magic-link/verify`
- **Auth:** None
- **Description:** Verify a magic link token and authenticate the user.

**Body:**
```json
{
  "token": "string"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Authentication successful",
  "user": { /* user profile */ },
  "token": "jwt-token"
}
```

---

## Get User Profile
**GET** `/users/profile`
- **Auth:** JWT
- **Description:** Retrieve the authenticated user's profile.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "string",
    "username": "string",
    "email": "string",
    "firstName": "string",
    "lastName": "string",
    "company": "string",
    "role": "string",
    "avatar": "string"
  }
}
```

---

## Update User Profile
**PATCH** `/users/profile`
- **Auth:** JWT
- **Description:** Update authenticated user's profile fields.

**Body:** (any of the following)
```json
{
  "firstName": "string",
  "lastName": "string",
  "company": "string",
  "avatar": "string"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": { /* updated profile object */ }
}
```

---

## List All Users
**GET** `/users`
- **Auth:** JWT (admin)
- **Description:** Retrieve all user accounts (admin only).

**Response:**
```json
{
  "success": true,
  "data": [
    { /* user object */ }
  ]
}
```

---

## Update User Role
**PATCH** `/users/role`
- **Auth:** JWT (admin)
- **Description:** Update another user's role.

**Body:**
```json
{
  "userId": "string",   // required
  "role": "string"      // required, e.g., ADMIN, CONSUMER
}
```

**Response:**
```json
{
  "success": true,
  "message": "User role updated successfully"
}
```

---

# Personal Access Tokens (PAT) API

Personal Access Tokens are the **recommended** authentication method for SDK usage, especially for users who signed up via magic link and don't know their auto-generated password.

## Create Token
**POST** `/tokens`
- **Auth:** JWT
- **Description:** Create a new personal access token.

**Body:**
```json
{
  "name": "string",                // required - friendly name for the token
  "description": "string",         // optional - what this token is used for
  "expiresAt": "ISO-8601 date",    // optional - when the token expires
  "maxRequestsPerDay": 1000,       // optional - daily rate limit
  "maxRequestsPerMonth": 30000     // optional - monthly rate limit
}
```

**Response:**
```json
{
  "success": true,
  "message": "Token created successfully",
  "token": {
    "tokenId": "pat_abc123",
    "secret": "xyz789...",         // ⚠️ Shown ONCE - save immediately!
    "name": "My SDK Token",
    "expiresAt": null,
    "createdAt": "2025-01-01T00:00:00Z"
  }
}
```

**Note:** The `secret` is only returned once at creation time. Store it securely.

---

## List Tokens
**GET** `/tokens`
- **Auth:** JWT
- **Description:** List all your personal access tokens with usage stats.

**Response:**
```json
{
  "success": true,
  "tokens": [
    {
      "tokenId": "pat_abc123",
      "name": "My SDK Token",
      "description": "For local development",
      "createdAt": "2025-01-01T00:00:00Z",
      "expiresAt": null,
      "lastUsed": "2025-01-15T12:00:00Z",
      "usageCount": 150,
      "isActive": true
    }
  ]
}
```

---

## Get Token Details
**GET** `/tokens/:tokenId`
- **Auth:** JWT
- **Description:** Get detailed information about a specific token.

**Response:**
```json
{
  "success": true,
  "token": {
    "tokenId": "pat_abc123",
    "name": "My SDK Token",
    "description": "For local development",
    "createdAt": "2025-01-01T00:00:00Z",
    "expiresAt": null,
    "lastUsed": "2025-01-15T12:00:00Z",
    "usageCount": 150,
    "dailyUsageCount": 25,
    "monthlyUsageCount": 500,
    "maxRequestsPerDay": 1000,
    "maxRequestsPerMonth": 30000,
    "isActive": true
  }
}
```

---

## Revoke Token
**DELETE** `/tokens/:tokenId`
- **Auth:** JWT
- **Description:** Permanently revoke a personal access token.

**Query Parameters:**
- `reason` (optional): Reason for revocation

**Response:**
```json
{
  "success": true,
  "message": "Token revoked successfully"
}
```

---

## Using PAT with SDK

Once you have a PAT, use it with the SDK:

```typescript
import { MxfSDK } from '@mxf/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    accessToken: 'pat_abc123:xyz789...'  // tokenId:secret format
});

await sdk.connect();
```

---

## PAT vs Other Auth Methods

| Method | Use Case | Pros | Cons |
|--------|----------|------|------|
| **PAT** | SDK usage (RECOMMENDED) | Works for magic link users, revocable, rate limits | Must store securely |
| JWT | Pre-authenticated sessions | Short-lived, secure | Requires login first |
| Username/Password | Dashboard login only (DEPRECATED for SDK) | Simple | Doesn't work for magic link users, deprecated for programmatic access |

> **Note:** Username/password authentication is deprecated for SDK usage. Use Personal Access Tokens (PAT) for all programmatic SDK access. Username/password is only supported for dashboard login.

