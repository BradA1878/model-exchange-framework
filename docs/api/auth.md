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

