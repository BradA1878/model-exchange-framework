# Users API

API endpoints for user management, authentication, and profile operations in the MXF framework.

## Overview

The Users API provides:
- User registration and authentication
- Profile management
- Role-based access control
- Password and security management
- Magic link authentication
- User preferences and settings

## Base URL

```
http://localhost:3001/api/users
```

## Authentication

Most endpoints require JWT authentication via `Authorization: Bearer <token>` header. 
Registration and login endpoints are public.

---

## Authentication Endpoints

### Register User

**POST** `/api/users/register`

Create a new user account.

**Request Body:**
```json
{
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "name": "John Doe",
    "organization": "Acme Corp",
    "acceptTerms": true
}
```

**Response (201):**
```json
{
    "success": true,
    "data": {
        "user": {
            "id": "user-123",
            "email": "user@example.com",
            "name": "John Doe",
            "role": "user",
            "createdAt": "2024-01-20T10:00:00Z"
        },
        "token": "eyJhbGciOiJIUzI1NiIs...",
        "expiresIn": 86400
    }
}
```

### Login

**POST** `/api/users/login`

Authenticate with email and password.

**Request Body:**
```json
{
    "email": "user@example.com",
    "password": "SecurePassword123!"
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "user": {
            "id": "user-123",
            "email": "user@example.com",
            "name": "John Doe",
            "role": "admin",
            "lastLogin": "2024-01-20T10:00:00Z"
        },
        "token": "eyJhbGciOiJIUzI1NiIs...",
        "expiresIn": 86400,
        "refreshToken": "refresh_token_here"
    }
}
```

### Request Magic Link

**POST** `/api/users/magic-link`

Request a passwordless login link.

**Request Body:**
```json
{
    "email": "user@example.com",
    "redirectUrl": "https://app.example.com/dashboard"
}
```

**Response:**
```json
{
    "success": true,
    "message": "Magic link sent to user@example.com",
    "data": {
        "expiresIn": 900 // 15 minutes
    }
}
```

### Verify Magic Link

**GET** `/api/users/verify-magic-link`

Exchange magic link token for JWT.

**Query Parameters:**
- `token` - Magic link token from email

**Response:**
```json
{
    "success": true,
    "data": {
        "user": {
            "id": "user-123",
            "email": "user@example.com",
            "name": "John Doe"
        },
        "token": "eyJhbGciOiJIUzI1NiIs...",
        "redirectUrl": "https://app.example.com/dashboard"
    }
}
```

### Refresh Token

**POST** `/api/users/refresh`

Refresh authentication token.

**Request Body:**
```json
{
    "refreshToken": "refresh_token_here"
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "token": "new_jwt_token",
        "expiresIn": 86400,
        "refreshToken": "new_refresh_token"
    }
}
```

### Logout

**POST** `/api/users/logout`

Invalidate current session.

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
    "success": true,
    "message": "Logged out successfully"
}
```

---

## User Profile Management

### Get Current User

**GET** `/api/users/me`

Get authenticated user's profile.

**Response:**
```json
{
    "success": true,
    "data": {
        "id": "user-123",
        "email": "user@example.com",
        "name": "John Doe",
        "role": "admin",
        "organization": "Acme Corp",
        "avatar": "https://example.com/avatar.jpg",
        "preferences": {
            "theme": "dark",
            "language": "en",
            "timezone": "America/New_York"
        },
        "stats": {
            "agentsCreated": 25,
            "channelsOwned": 12,
            "lastActive": "2024-01-20T10:30:00Z"
        },
        "createdAt": "2024-01-01T00:00:00Z",
        "updatedAt": "2024-01-20T10:00:00Z"
    }
}
```

### Update Profile

**PUT** `/api/users/me`

Update current user's profile.

**Request Body:**
```json
{
    "name": "Jane Doe",
    "organization": "New Corp",
    "avatar": "https://example.com/new-avatar.jpg",
    "preferences": {
        "theme": "light",
        "language": "es"
    }
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        /* Updated user object */
    }
}
```

### Change Password

**POST** `/api/users/change-password`

Change user password.

**Request Body:**
```json
{
    "currentPassword": "OldPassword123!",
    "newPassword": "NewSecurePassword456!",
    "confirmPassword": "NewSecurePassword456!"
}
```

**Response:**
```json
{
    "success": true,
    "message": "Password changed successfully"
}
```

### Delete Account

**DELETE** `/api/users/me`

Delete user account and all associated data.

**Request Body:**
```json
{
    "password": "CurrentPassword123!",
    "confirmation": "DELETE MY ACCOUNT",
    "reason": "No longer needed"
}
```

**Response:**
```json
{
    "success": true,
    "message": "Account deleted successfully"
}
```

---

## User Management (Admin)

### List Users

**GET** `/api/users`

List all users (admin only).

**Query Parameters:**
- `role` - Filter by role: `user`, `admin`, `provider`
- `status` - Filter by status: `active`, `inactive`, `suspended`
- `search` - Search in name and email
- `sort` - Sort by: `name`, `email`, `created`, `lastLogin`
- `limit` - Results per page
- `offset` - Pagination offset

**Response:**
```json
{
    "success": true,
    "data": {
        "users": [
            {
                "id": "user-456",
                "email": "admin@example.com",
                "name": "Admin User",
                "role": "admin",
                "status": "active",
                "organization": "MXF Corp",
                "lastLogin": "2024-01-20T09:00:00Z",
                "createdAt": "2023-12-01T00:00:00Z"
            }
        ],
        "pagination": {
            "total": 150,
            "limit": 20,
            "offset": 0
        }
    }
}
```

### Get User by ID

**GET** `/api/users/:userId`

Get specific user details (admin only).

**Response:**
```json
{
    "success": true,
    "data": {
        /* Full user object with additional admin fields */
        "permissions": ["create_agents", "manage_channels"],
        "quotas": {
            "maxAgents": 100,
            "maxChannels": 50,
            "storageGB": 10
        },
        "usage": {
            "agents": 25,
            "channels": 12,
            "storageGB": 2.5
        }
    }
}
```

### Create User

**POST** `/api/users`

Create a new user (admin only).

**Request Body:**
```json
{
    "email": "newuser@example.com",
    "name": "New User",
    "role": "user",
    "password": "TempPassword123!",
    "sendWelcomeEmail": true,
    "quotas": {
        "maxAgents": 50,
        "maxChannels": 20
    }
}
```

### Update User

**PUT** `/api/users/:userId`

Update user details (admin only).

**Request Body:**
```json
{
    "role": "admin",
    "status": "active",
    "quotas": {
        "maxAgents": 200
    }
}
```

### Suspend User

**POST** `/api/users/:userId/suspend`

Suspend user account (admin only).

**Request Body:**
```json
{
    "reason": "Terms violation",
    "duration": 7, // days
    "notifyUser": true
}
```

### Activate User

**POST** `/api/users/:userId/activate`

Activate suspended user (admin only).

---

## Password Recovery

### Request Password Reset

**POST** `/api/users/forgot-password`

Request password reset email.

**Request Body:**
```json
{
    "email": "user@example.com"
}
```

**Response:**
```json
{
    "success": true,
    "message": "Password reset instructions sent to user@example.com"
}
```

### Reset Password

**POST** `/api/users/reset-password`

Reset password with token.

**Request Body:**
```json
{
    "token": "reset_token_from_email",
    "newPassword": "NewSecurePassword789!",
    "confirmPassword": "NewSecurePassword789!"
}
```

**Response:**
```json
{
    "success": true,
    "message": "Password reset successfully"
}
```

---

## Two-Factor Authentication

### Enable 2FA

**POST** `/api/users/2fa/enable`

Enable two-factor authentication.

**Response:**
```json
{
    "success": true,
    "data": {
        "secret": "JBSWY3DPEHPK3PXP",
        "qrCode": "data:image/png;base64,...",
        "backupCodes": [
            "12345678",
            "87654321",
            "11223344"
        ]
    }
}
```

### Verify 2FA Setup

**POST** `/api/users/2fa/verify`

Verify 2FA setup with code.

**Request Body:**
```json
{
    "code": "123456"
}
```

**Response:**
```json
{
    "success": true,
    "message": "2FA enabled successfully"
}
```

### Disable 2FA

**POST** `/api/users/2fa/disable`

Disable two-factor authentication.

**Request Body:**
```json
{
    "password": "CurrentPassword123!",
    "code": "123456"
}
```

---

## API Keys

### List API Keys

**GET** `/api/users/api-keys`

List user's API keys.

**Response:**
```json
{
    "success": true,
    "data": {
        "apiKeys": [
            {
                "id": "key-123",
                "name": "Production API Key",
                "prefix": "mxf_live_",
                "lastUsed": "2024-01-20T09:00:00Z",
                "createdAt": "2024-01-01T00:00:00Z",
                "expiresAt": null,
                "permissions": ["read", "write"]
            }
        ]
    }
}
```

### Create API Key

**POST** `/api/users/api-keys`

Create a new API key.

**Request Body:**
```json
{
    "name": "Development Key",
    "permissions": ["read"],
    "expiresIn": 2592000 // 30 days
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "id": "key-456",
        "name": "Development Key",
        "key": "mxf_test_abc123xyz789", // Only shown once!
        "prefix": "mxf_test_",
        "permissions": ["read"],
        "expiresAt": "2024-02-19T10:00:00Z"
    }
}
```

### Revoke API Key

**DELETE** `/api/users/api-keys/:keyId`

Revoke an API key.

---

## User Preferences

### Get Preferences

**GET** `/api/users/preferences`

Get user preferences.

**Response:**
```json
{
    "success": true,
    "data": {
        "ui": {
            "theme": "dark",
            "language": "en",
            "timezone": "America/New_York",
            "dateFormat": "MM/DD/YYYY"
        },
        "notifications": {
            "email": {
                "enabled": true,
                "frequency": "daily",
                "types": ["alerts", "reports"]
            },
            "push": {
                "enabled": false
            }
        },
        "privacy": {
            "showEmail": false,
            "showProfile": true
        }
    }
}
```

### Update Preferences

**PUT** `/api/users/preferences`

Update user preferences.

**Request Body:**
```json
{
    "ui": {
        "theme": "light"
    },
    "notifications": {
        "email": {
            "frequency": "weekly"
        }
    }
}
```

---

## User Activity

### Get Activity Log

**GET** `/api/users/activity`

Get user's activity log.

**Query Parameters:**
- `from` - Start date
- `to` - End date
- `type` - Activity type filter
- `limit` - Number of entries

**Response:**
```json
{
    "success": true,
    "data": {
        "activities": [
            {
                "id": "act-123",
                "type": "agent_created",
                "timestamp": "2024-01-20T10:00:00Z",
                "details": {
                    "agentId": "agent-789",
                    "agentName": "New Bot"
                },
                "ip": "192.168.1.1",
                "userAgent": "Mozilla/5.0..."
            }
        ]
    }
}
```

### Get Login History

**GET** `/api/users/login-history`

Get user's login history.

**Response:**
```json
{
    "success": true,
    "data": {
        "logins": [
            {
                "timestamp": "2024-01-20T09:00:00Z",
                "ip": "192.168.1.1",
                "location": "New York, US",
                "device": "Chrome on Windows",
                "success": true
            }
        ]
    }
}
```

---

## Error Responses

### 400 Bad Request
```json
{
    "success": false,
    "error": "Validation error",
    "details": {
        "email": "Invalid email format",
        "password": "Password must be at least 8 characters"
    }
}
```

### 401 Unauthorized
```json
{
    "success": false,
    "error": "Invalid credentials"
}
```

### 403 Forbidden
```json
{
    "success": false,
    "error": "Insufficient permissions"
}
```

### 409 Conflict
```json
{
    "success": false,
    "error": "Email already registered"
}
```

## Rate Limiting

- **Registration**: 5 per hour per IP
- **Login**: 10 per 15 minutes per IP
- **Password Reset**: 3 per hour per email
- **Profile Updates**: 20 per hour

## Security Best Practices

1. **Password Requirements**: Minimum 8 characters, mixed case, numbers, symbols
2. **Session Management**: Tokens expire after 24 hours
3. **2FA**: Strongly recommended for admin accounts
4. **API Keys**: Use least privilege principle
5. **Activity Monitoring**: Review login history regularly

## Next Steps

- See [Authentication](auth.md) for detailed auth flows
- Review [Dashboard API](dashboard.md) for user dashboard
- Check [Agents API](agents.md) for user's agents
- Explore [Channels API](channels.md) for user's channels