# Authentication & Setup


## Installation

The MXF SDK is part of the monorepo and should be built from source:

```bash
# Clone the repository
git clone https://github.com/BradA1878/model-exchange-framework.git
cd model-exchange-framework

# Install dependencies
npm install

# Build the project
bun run build

# Start the server
bun run start

# For development with hot reload
bun run start:dev
```

## Authentication Architecture

MXF implements **mandatory two-layer authentication** for maximum security:

### Layer 1: Domain Key (REQUIRED)
- **Purpose**: Authenticates that the SDK is authorized to connect to this MXF server
- **Scope**: Server-wide authentication
- **Format**: 64-character hex string
- **Set by**: Server operator
- **Used by**: All SDK connections
- **Security**: Mandatory - no bypass option

### Layer 2: User/Agent Authentication (REQUIRED)
- **User Auth**: Authenticates specific user identity (JWT or username/password)
- **Agent Auth**: Authenticates specific agent identity (keyId + secretKey)
- **Scope**: Per-connection authentication
- **Management**: Via MXF dashboard or CLI tools
- **Security**: Stored encrypted in database

**Both layers must pass for any connection to succeed.**

## For Server Operators

Server operators manage the MXF server and provide domain keys and user accounts to SDK users.

### 1. Generate Domain Key

```bash
# Generate a secure 64-char domain key
bun run server:cli -- domain-key:generate

# Output:
# ✓ Domain key generated and saved to .env file
# Domain Key: 99cfb5f95a8e60ae80a99232e838219c4970438513beaa26cd16fb88f4a1eb9a
# 
# ⚠️  IMPORTANT:
#    1. Keep this key secure - it authenticates SDK connections
#    2. Provide this key to SDK users via secure channel
#    3. Restart the MXF server for changes to take effect
```

**The domain key is automatically saved to your `.env` file.**

### 2. View Current Domain Key

```bash
bun run server:cli -- domain-key:show
```

### 3. Create User Accounts

```bash
# Create a user account for SDK developers
bun run server:cli -- user:create \
  --email developer@company.com \
  --password secure-password-123 \
  --username dev-user

# Optional: role can be specified (default: consumer)
```

### 4. List Users

```bash
bun run server:cli -- user:list
```

### Security Best Practices for Server Operators

1. **Domain Key Security** (CRITICAL):
   - Generate with `openssl rand -hex 32` or the server CLI
   - **NEVER** commit to version control
   - Rotate every 90 days minimum
   - Share only via secure channels (encrypted email, password managers)
   - Monitor for unauthorized connections
   - Use different keys per environment (dev/staging/prod)

2. **User Account Management**:
   - Use strong password policies (minimum 16 characters)
   - Enable 2FA when available
   - Regular security audits
   - Monitor authentication failures

## For SDK Developers

SDK developers receive the domain key from the server operator and use it to connect their applications.

### 1. Receive Domain Key

Obtain the domain key from your MXF server operator via a secure channel:
- Encrypted email
- Password manager sharing
- Secure document vault
- In-person transfer for highly sensitive environments

**NEVER** receive domain keys via Slack, Teams, or unencrypted email.

### 2. Set Up Environment

Create a `.env` file in your project:

```env
# Domain key (from server operator)
MXF_DOMAIN_KEY=99cfb5f95a8e60ae80a99232e838219c4970438513beaa26cd16fb88f4a1eb9a

# User credentials (from server operator)
MXF_USERNAME=dev-user
MXF_PASSWORD=secure-password-123

# OR use JWT token
# MXF_USER_TOKEN=your-jwt-token

# LLM Provider
OPENROUTER_API_KEY=your-openrouter-api-key
```

### 3. Create Channel and Generate Agent Keys

Use the SDK CLI interactive setup (recommended):

```bash
# Run interactive setup
bun run sdk:cli -- setup:interactive

# Follow the prompts:
# ✔ User email: dev-user@company.com
# ✔ User password: ********
# ✔ Username: dev-user
# ✔ Project/Channel ID: my-channel
# ✔ Project/Channel name: My Channel
# ✔ Description (optional): 
# ✔ Agent names (comma-separated): agent1, agent2, agent3
#
# All credentials are saved to .env automatically
```

Or use manual commands:

```bash
# Create a channel
bun run sdk:cli -- channel:create \
  --id my-channel \
  --name "My Channel" \
  --email dev-user@company.com \
  --password secure-password-123

# Generate agent keys (saved to .env)
bun run sdk:cli -- key:generate \
  --channel my-channel \
  --agents agent1,agent2,agent3 \
  --email dev-user@company.com \
  --password secure-password-123 \
  --output .env
```

This appends credentials to your `.env` file:

```env
# User credentials for MXF authentication
MXF_USERNAME="dev-user@company.com"
MXF_PASSWORD="secure-password-123"

# Agent credentials for channel: my-channel
MXF_MY_CHANNEL_AGENT1_KEY_ID="key-abc123"
MXF_MY_CHANNEL_AGENT1_SECRET_KEY="secret-xyz789"
MXF_MY_CHANNEL_AGENT2_KEY_ID="key-def456"
MXF_MY_CHANNEL_AGENT2_SECRET_KEY="secret-uvw012"
MXF_MY_CHANNEL_AGENT3_KEY_ID="key-ghi789"
MXF_MY_CHANNEL_AGENT3_SECRET_KEY="secret-rst345"
```

### 4. Initialize SDK and Create Agent

```typescript
import { MxfSDK, Events } from '@mxf/sdk';
import type { MxfAgent } from '@mxf/sdk';
import dotenv from 'dotenv';

// Load credentials from .env file
dotenv.config();

// Initialize SDK with domain key and user authentication
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,  // REQUIRED
    // Socket-based authentication (no REST API required)
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
    // OR use JWT token:
    // userId: 'dev-user',
    // userToken: process.env.MXF_USER_TOKEN
});

// Connect the SDK
await sdk.connect();

// Create agent using credentials from environment variables
const agent = await sdk.createAgent({
    agentId: 'agent1',
    name: 'My First Agent',
    channelId: 'my-channel',
    keyId: process.env.MXF_MY_CHANNEL_AGENT1_KEY_ID!,
    secretKey: process.env.MXF_MY_CHANNEL_AGENT1_SECRET_KEY!,
    llmProvider: 'anthropic',
    defaultModel: 'claude-3-5-sonnet-20241022',
    apiKey: process.env.ANTHROPIC_API_KEY
});

// Connect the agent
await agent.connect();

// The agent is now authenticated and connected
console.log('Agent connected successfully');
```

**Environment Variable Format:**
- Agent keys follow the pattern: `MXF_<CHANNEL_ID>_<AGENT_ID>_KEY_ID` and `MXF_<CHANNEL_ID>_<AGENT_ID>_SECRET_KEY`
- Channel and agent IDs are uppercased with hyphens converted to underscores
- Example: channel `my-channel` + agent `agent1` = `MXF_MY_CHANNEL_AGENT1_KEY_ID`

### Security Best Practices for SDK Developers

1. **Domain Key Security** (CRITICAL):
   - Store in environment variables, **NEVER** hardcode
   - Keep `.env` out of version control (add to `.gitignore`)
   - Use different domain keys per environment
   - Do not log or expose in error messages

2. **Agent Keys Management**:
   - All credentials are in `.env` file (automatically gitignored)
   - Use environment variables or secure vaults in production
   - Rotate agent keys every 60 days
   - Revoke unused keys immediately
   - Never commit `.env` files to version control

3. **Secure Storage for Production**:
   - AWS Secrets Manager
   - Azure Key Vault  
   - HashiCorp Vault
   - Kubernetes Secrets
   - Never store credentials in code or config files

4. **Load Credentials Securely**:

```typescript
import dotenv from 'dotenv';

// Load credentials from .env file
dotenv.config();

const sdk = new MxfSDK({
    serverUrl: process.env.MXF_SERVER_URL!,
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

// Use environment variables for agent keys
const agent = await sdk.createAgent({
    agentId: 'secure-agent',
    channelId: 'my-channel',
    keyId: process.env.MXF_MY_CHANNEL_SECURE_AGENT_KEY_ID!,
    secretKey: process.env.MXF_MY_CHANNEL_SECURE_AGENT_SECRET_KEY!,
    llmProvider: 'anthropic',
    defaultModel: 'claude-3-5-sonnet-20241022',
    apiKey: process.env.ANTHROPIC_API_KEY
});
```

## CLI Setup (Automated)

For automated setup or CI/CD, you can use a configuration file:

### Setup Config File

Create `setup-config.json`:

```json
{
  "user": {
    "email": "developer@company.com",
    "password": "${MXF_USER_PASSWORD}",
    "username": "dev-user"
  },
  "channel": {
    "id": "my-channel",
    "name": "My Channel",
    "description": "Development channel",
    "isPrivate": false
  },
  "agents": [
    "agent1",
    "agent2",
    "agent3"
  ]
}
```

### Run Automated Setup

```bash
# Create user, channel, and generate all keys in one command
# Credentials are written to .env file
bun run sdk:cli -- setup \
  --config setup-config.json \
  --output .env

# The CLI supports environment variable substitution
# ${MXF_USER_PASSWORD} will be replaced with the actual env var value
```

**Note:** The interactive setup (`bun run sdk:cli -- setup:interactive`) is recommended for most use cases. Use config files for automation only.

## Authentication Errors

Common authentication errors and troubleshooting:

### "Domain key required for SDK connection"

**Cause**: `MXF_DOMAIN_KEY` not set in environment

**Solution**:
```bash
# Get domain key from server operator
# Add to .env file:
MXF_DOMAIN_KEY=your-64-char-domain-key
```

### "Invalid domain key"

**Cause**: Domain key doesn't match server's key

**Solution**:
- Verify you have the correct domain key from server operator
- Check for typos in `.env` file
- Ensure you're using the key for the correct environment (dev/staging/prod)
- Contact server operator for the correct key

### "Server authentication not configured"

**Cause**: MXF server doesn't have `MXF_DOMAIN_KEY` set

**Solution**:
- **For server operators**: Run `bun run server:cli -- domain-key:generate`
- Server cannot accept SDK connections without a domain key
- This is a server-side issue, contact your server operator

### "Authentication required"

**Cause**: Missing user credentials in SDK config

**Solution**:
```typescript
// Must provide EITHER (userId + userToken) OR (username + password)
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    // Option 1: JWT token
    userId: 'your-user-id',
    userToken: process.env.MXF_USER_TOKEN
    // Option 2: Username/password
    // username: 'dev-user',
    // password: process.env.MXF_USER_PASSWORD
});
```

### "Authentication failed"

**Cause**: Invalid username/password or expired JWT token

**Solution**:
- Verify username and password are correct
- For JWT tokens, they may have expired - request a new one
- Contact server operator if account is disabled or deleted
- Check that user account exists via `bun run server:cli -- user:list`

### "Invalid agent key"

**Cause**: Invalid `keyId` or `secretKey` when creating agent

**Solution**:
```bash
# Regenerate agent keys via CLI
bun run sdk:cli -- key:generate \
  --channel your-channel \
  --agents your-agent-id \
  --email your@email.com \
  --password your-password \
  --output credentials.json

# Use the newly generated keys
```

### Connection Errors

```typescript
import { Events } from '@mxf/sdk';

// Handle connection errors
agent.on(Events.Agent.ERROR, (payload) => {
    console.error('Agent error:', payload.data.error);
    
    if (payload.data.type === 'authentication') {
        console.error('Authentication failed - check your credentials');
    } else if (payload.data.type === 'connection') {
        console.error('Connection failed - check server URL and network');
        // Attempt reconnection
        setTimeout(async () => {
            await agent.connect();
        }, 5000);
    }
});

agent.on(Events.Agent.DISCONNECTED, (payload) => {
    console.warn('Agent disconnected');
    // Implement reconnection logic
});
```

## Production Deployment

### Environment Variables

**Server `.env` (Server Operator):**
```bash
# Required
MONGODB_URI=mongodb://localhost:27017/mxf
JWT_SECRET=your-jwt-secret
MXF_DOMAIN_KEY=your-generated-64-char-domain-key

# Optional
OPENROUTER_API_KEY=your-openrouter-key
MXP_ENCRYPTION_KEY=your-mxp-encryption-key
PORT=3001
NODE_ENV=production
```

**SDK Application `.env` (SDK Developer):**
```bash
# Required
MXF_DOMAIN_KEY=domain-key-from-server-operator
MXF_USERNAME=your-username
MXF_PASSWORD=your-password

# Optional
OPENROUTER_API_KEY=your-openrouter-key
MXF_SERVER_URL=https://mxf.yourcompany.com
```

### Security Considerations

1. **HTTPS in Production** - Always use TLS encryption for production deployments
2. **Domain Key Rotation** - Rotate domain keys every 90 days
3. **Agent Key Rotation** - Rotate agent keys every 60 days
4. **Secure Credential Storage** - Use cloud secret managers (AWS, Azure, GCP)
5. **Network Security** - Restrict server access via firewall rules
6. **Audit Logging** - Monitor authentication events and failures
7. **Rate Limiting** - Prevent brute force attacks on authentication endpoints

### Testing Authentication

```typescript
import { MxfSDK, Events } from '@mxf/sdk';

// Test SDK connection and agent creation
async function testAuthentication(): Promise<void> {
    try {
        // Test SDK connection
        const sdk = new MxfSDK({
            serverUrl: process.env.MXF_SERVER_URL!,
            domainKey: process.env.MXF_DOMAIN_KEY!,
            username: process.env.MXF_USERNAME!,
            password: process.env.MXF_PASSWORD!
        });
        
        await sdk.connect();
        console.log('✓ SDK authentication successful');
        
        // Test agent creation
        const agent = await sdk.createAgent({
            agentId: 'test-agent',
            name: 'Test Agent',
            channelId: process.env.TEST_CHANNEL_ID!,
            keyId: process.env.TEST_KEY_ID!,
            secretKey: process.env.TEST_SECRET_KEY!,
            llmProvider: 'openrouter',
            defaultModel: 'anthropic/claude-3.5-sonnet'
        });
        
        await agent.connect();
        console.log('✓ Agent authentication successful');
        
        // Test basic operation
        await agent.channelService.sendMessage('Test message');
        console.log('✓ Agent operations working');
        
        // Cleanup
        await agent.disconnect();
        console.log('✓ All authentication tests passed');
        
    } catch (error) {
        console.error('✗ Authentication test failed:', error);
        throw error;
    }
}

// Run test
testAuthentication().catch(console.error);
```

## CLI Reference

### Server CLI Commands

```bash
# Domain key management
bun run server:cli -- domain-key:generate
bun run server:cli -- domain-key:show

# User management
bun run server:cli -- user:create --email <email> --password <password> [--username <username>]
bun run server:cli -- user:list
```

### SDK CLI Commands

```bash
# Channel management
bun run sdk:cli -- channel:create --id <id> --name <name> --email <email> --password <password>

# Key generation
bun run sdk:cli -- key:generate --channel <id> --agents <agent1,agent2> --email <email> --password <password> [--output <file>]

# Automated setup
bun run sdk:cli -- setup --config <file> [--output <file>]
```

## Next Steps

- Review [Core Interfaces](interfaces.md) for type definitions
- See [Code Examples](examples.md) for practical authentication patterns
- Learn about [Event System](events.md) for authentication events
- Explore [CLI Tools](cli.md) for command-line utilities
- Review [SDK Overview](index.md) for complete SDK documentation