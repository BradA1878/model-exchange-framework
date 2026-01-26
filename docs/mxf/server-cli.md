# MXF Server CLI

Command-line interface for MXF server operators. This tool provides essential server management functions including domain key generation, user management, and server configuration.

## Overview

The Server CLI is designed for **server operators only** and provides administrative functions that SDK users should not have access to. These commands manage the core security infrastructure and user accounts for the MXF server.

## Prerequisites

- MXF server installed and configured
- MongoDB running and accessible
- Administrative access to the server machine

## Installation

The CLI is included with the MXF server and available via npm scripts:

```bash
# Run Server CLI
bun run server:cli -- <command> [options]
```

## Commands

### domain-key:generate

Generate a new domain key for SDK authentication. This is the most critical security command.

**Usage:**
```bash
bun run server:cli -- domain-key:generate
```

**No options required** - the command will:
1. Generate a secure 64-character hex string using crypto.randomBytes(32)
2. Automatically save it to your `.env` file as `MXF_DOMAIN_KEY`
3. Display the key for sharing with SDK users

**Output:**
```
═══════════════════════════════════════════════════════════════════════════════
Generate SDK Domain Key
═══════════════════════════════════════════════════════════════════════════════

✓ Domain key generated and saved to .env file

Domain Key: 99cfb5f95a8e60ae80a99232e838219c4970438513beaa26cd16fb88f4a1eb9a

⚠️  IMPORTANT:
   1. Keep this key secure - it authenticates SDK connections
   2. Provide this key to SDK users via secure channel
   3. Restart the MXF server for changes to take effect

Security Recommendations:
   • Share via encrypted email or password manager
   • Rotate every 90 days minimum
   • Use different keys per environment (dev/staging/prod)
   • Never commit to version control
   • Monitor for unauthorized connection attempts
```

**Security Notes:**
- The domain key is required for all SDK connections
- Without this key, no SDK applications can connect to your server
- This is a mandatory security layer that cannot be disabled
- The key is automatically added to `.env` file
- **Server must be restarted** after generating a new key

### domain-key:show

Display the current domain key from the `.env` file.

**Usage:**
```bash
bun run server:cli -- domain-key:show
```

**Output:**
```
═══════════════════════════════════════════════════════════════════════════════
Current SDK Domain Key
═══════════════════════════════════════════════════════════════════════════════

Domain Key: 99cfb5f95a8e60ae80a99232e838219c4970438513beaa26cd16fb88f4a1eb9a

⚠️  Keep this key secure - it grants SDK access to your server
```

**Use Cases:**
- Retrieve the key to share with new SDK users
- Verify the current key is set correctly
- Check which key is active before rotation

### user:create

Create a new user account for SDK developers or administrators.

**Usage:**
```bash
bun run server:cli -- user:create \
  --email <email> \
  --password <password> \
  [--username <username>] \
  [--api-url <url>]
```

**Options:**
- `--email <email>` (required): User email address
- `--password <password>` (required): User password
- `--username <username>` (optional): Username (defaults to email prefix)
- `--api-url <url>` (optional): API URL (defaults to `http://localhost:3001/api`)

**Example:**
```bash
bun run server:cli -- user:create \
  --email developer@company.com \
  --password secure-password-123 \
  --username dev-user
```

**Output:**
```
✓ User created successfully
   Email: developer@company.com
   Username: dev-user
   User ID: 507f1f77bcf86cd799439011
```

**Notes:**
- Password is hashed using bcrypt before storage
- Email must be unique
- Username defaults to the part before @ in email
- Users can create channels and generate agent keys via SDK CLI

### user:list

List all user accounts in the system.

**Usage:**
```bash
bun run server:cli -- user:list [--api-url <url>]
```

**Options:**
- `--api-url <url>` (optional): API URL

**Output:**
```
═══════════════════════════════════════════════════════════════════════════════
User Accounts
═══════════════════════════════════════════════════════════════════════════════

Found 3 users:

 1. admin@company.com
    Username: admin
    User ID: 507f1f77bcf86cd799439011
    Created: 2025-01-15T10:30:00.000Z

 2. developer@company.com
    Username: dev-user
    User ID: 507f191e810c19729de860ea
    Created: 2025-01-20T14:22:00.000Z

 3. sdk-user@company.com
    Username: sdk-user
    User ID: 507f191e810c19729de860eb
    Created: 2025-01-22T09:15:00.000Z
```

## Common Workflows

### Initial Server Setup

Set up a new MXF server from scratch:

```bash
# 1. Ensure MongoDB is running
mongod --dbpath /path/to/data

# 2. Generate domain key
bun run server:cli -- domain-key:generate

# 3. Create admin user
bun run server:cli -- user:create \
  --email admin@company.com \
  --password admin-secure-password \
  --username admin

# 4. Start the MXF server
bun run start:dev

# 5. Share domain key with SDK users (via secure channel)
bun run server:cli -- domain-key:show
```

### Onboarding New SDK Developer

Steps to onboard a new developer:

```bash
# 1. Create user account for developer
bun run server:cli -- user:create \
  --email newdev@company.com \
  --password initial-password-123 \
  --username newdev

# 2. Provide domain key securely
bun run server:cli -- domain-key:show
# Send via encrypted email or password manager

# 3. Provide user credentials securely
# Email: newdev@company.com
# Password: initial-password-123
# (Advise user to change password immediately)
```

### Domain Key Rotation

Rotate domain keys for security:

```bash
# 1. Generate new domain key
bun run server:cli -- domain-key:generate

# 2. Notify all SDK users about the key change
# (They will need to update their .env files)

# 3. Schedule restart of MXF server
# (Plan for a maintenance window)

# 4. Restart server
npm restart

# 5. Verify SDK connections work with new key
# (Test with one SDK application first)
```

### User Audit

Review user accounts periodically:

```bash
# List all users
bun run server:cli -- user:list

# Review and remove inactive accounts
# (Use MongoDB directly or REST API for deletion)
```

## Security Best Practices

### Domain Key Management

1. **Generation**:
   - Use the CLI command (uses crypto.randomBytes)
   - Never manually create or modify domain keys
   - Generate new key for each environment

2. **Storage**:
   - Stored in `.env` file (must be in `.gitignore`)
   - Ensure file permissions are restrictive: `chmod 600 .env`
   - Back up `.env` file securely (encrypted)

3. **Sharing**:
   - Use encrypted channels (PGP, password managers)
   - Never share via Slack, email, or chat
   - Share only with authorized SDK developers
   - Log who received the key and when

4. **Rotation**:
   - Rotate every 90 days minimum
   - Rotate immediately if compromised
   - Coordinate with SDK users for planned rotation
   - Use different keys per environment

### User Account Management

1. **Password Policy**:
   - Minimum 16 characters
   - Require complexity (uppercase, lowercase, numbers, symbols)
   - Enforce regular password changes
   - Use bcrypt for hashing (automatic in MXF)

2. **Account Lifecycle**:
   - Create accounts only for authorized personnel
   - Review accounts monthly
   - Disable/delete inactive accounts promptly
   - Maintain audit log of account creation/deletion

3. **Access Control**:
   - Follow principle of least privilege
   - Separate admin and developer accounts
   - Monitor authentication failures
   - Set up alerts for suspicious activity

## Environment Files

### Server `.env` File

```bash
# MongoDB Connection
MONGODB_URI=mongodb://localhost:27017/mxf

# Authentication (REQUIRED)
JWT_SECRET=your-jwt-secret-min-32-chars
MXF_DOMAIN_KEY=generated-by-server-cli

# Server Configuration
PORT=3001
NODE_ENV=production

# Optional: LLM API Keys
OPENROUTER_API_KEY=your-openrouter-key

# Optional: MXP Encryption
MXP_ENCRYPTION_KEY=generated-with-mxp-cli
MXP_ENCRYPTION_ENABLED=true

# Optional: Logging
LOG_LEVEL=info
```

**Security:**
```bash
# Set restrictive permissions
chmod 600 .env

# Ensure .gitignore includes .env
echo ".env" >> .gitignore

# Back up securely
gpg --encrypt --recipient admin@company.com .env
```

## Troubleshooting

### "MXF_DOMAIN_KEY not found in .env"

**Cause**: Domain key was never generated

**Solution**:
```bash
bun run server:cli -- domain-key:generate
```

### "Cannot connect to MongoDB"

**Cause**: MongoDB is not running or connection string is incorrect

**Solution**:
```bash
# Check MongoDB is running
ps aux | grep mongod

# Start MongoDB
mongod --dbpath /path/to/data

# Verify connection string in .env
MONGODB_URI=mongodb://localhost:27017/mxf
```

### "User already exists"

**Cause**: Attempting to create user with existing email

**Solution**:
```bash
# List existing users
bun run server:cli -- user:list

# Use different email or delete existing user
```

### "Server authentication not configured"

**Cause**: Domain key is not set or `.env` is not loaded

**Solution**:
```bash
# Generate domain key
bun run server:cli -- domain-key:generate

# Verify .env file exists and contains MXF_DOMAIN_KEY
cat .env | grep MXF_DOMAIN_KEY

# Restart server
npm restart
```

## Production Deployment

### Initial Production Setup

```bash
# 1. Set up production environment file
cp .env.example .env.production
chmod 600 .env.production

# 2. Generate production domain key
NODE_ENV=production bun run server:cli -- domain-key:generate

# 3. Set strong JWT secret
openssl rand -base64 32

# 4. Configure production MongoDB
# Update MONGODB_URI in .env.production

# 5. Create admin account
NODE_ENV=production bun run server:cli -- user:create \
  --email admin@company.com \
  --password $(openssl rand -base64 32)

# 6. Start production server
NODE_ENV=production npm start
```

### Production Monitoring

```bash
# Monitor authentication events
tail -f logs/authentication.log

# Check server health
curl https://your-mxf-server.com/health

# Monitor MongoDB connections
mongo admin --eval "db.serverStatus().connections"
```

### Backup Strategy

```bash
# Backup .env file (encrypted)
gpg --encrypt --recipient admin@company.com .env > .env.gpg

# Backup MongoDB
mongodump --out /backup/mxf-$(date +%Y%m%d)

# Backup domain key separately
echo $MXF_DOMAIN_KEY | gpg --encrypt --recipient admin@company.com > domain-key.gpg
```

## Integration with SDK CLI

Server CLI and SDK CLI work together:

**Server Operator (Server CLI)**:
1. Generates domain key
2. Creates user accounts
3. Shares credentials securely

**SDK Developer (SDK CLI)**:
1. Receives domain key and user credentials
2. Creates channels and generates agent keys
3. Builds SDK applications

## See Also

- [Authentication Guide](../sdk/authentication.md) - Complete authentication documentation
- [Security](security.md) - MXF security architecture
- [Server Services](server-services.md) - Server architecture overview
- [SDK CLI](../sdk/cli.md) - SDK CLI for developers
