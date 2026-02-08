# MXF SDK CLI

Command-line interface for managing channels and agent keys. This tool is designed for SDK developers to set up and manage their MXF workspace.

## Prerequisites

Before using the SDK CLI, you need:

1. **Domain Key**: Obtain from your MXF server operator (or generate via server CLI)
2. **Running MXF Server**: The server must be accessible at `http://localhost:3001`

## Installation

The CLI is included with the MXF SDK and available via npm scripts:

```bash
# Run SDK CLI
bun run sdk:cli -- <command> [options]
```

## Quick Start

The **recommended way** to set up a new project is using the interactive setup:

```bash
bun run sdk:cli -- setup:interactive
```

This will prompt you for:
- Email and password (creates user account)
- Project/channel name and description
- Agent names (comma-separated)

All credentials are automatically saved to `.env` file in the proper format.

## Commands

### user:create

Create a user account.

**Usage:**
```bash
bun run sdk:cli -- user:create \
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
bun run sdk:cli -- user:create \
  --email developer@company.com \
  --password secure-password-123 \
  --username dev-user
```

**Output:**
```
✓ User created successfully: developer@company.com
   Username: dev-user
   Email: developer@company.com
```

### channel:create

Create a new channel.

**Usage:**
```bash
bun run sdk:cli -- channel:create \
  --id <channel-id> \
  --name <channel-name> \
  --email <user-email> \
  --password <user-password> \
  [--description <description>] \
  [--private] \
  [--api-url <url>]
```

**Options:**
- `--id <channel-id>` (required): Unique channel identifier
- `--name <channel-name>` (required): Human-readable channel name
- `--email <user-email>` (required): Your user email for authentication
- `--password <user-password>` (required): Your user password
- `--description <description>` (optional): Channel description
- `--private` (optional): Make channel private (default: public)
- `--api-url <url>` (optional): API URL

**Example:**
```bash
bun run sdk:cli -- channel:create \
  --id dev-channel \
  --name "Development Channel" \
  --description "Channel for development testing" \
  --email developer@company.com \
  --password secure-password-123
```

**Output:**
```
✓ Authenticated as: developer@company.com
✓ Channel created successfully
   Channel ID: dev-channel
   Channel Name: Development Channel
```

### key:generate

Generate agent keys for a channel.

**Usage:**
```bash
bun run sdk:cli -- key:generate \
  --channel <channel-id> \
  --agents <agent-ids> \
  --email <user-email> \
  --password <user-password> \
  [--output <file>] \
  [--api-url <url>]
```

**Options:**
- `--channel <channel-id>` (required): Channel ID to generate keys for
- `--agents <agent-ids>` (required): Comma-separated list of agent IDs
- `--email <user-email>` (required): Your user email
- `--password <user-password>` (required): Your user password
- `--output <file>` (optional): Output file for credentials in `.env` format (default: `.env`)
- `--api-url <url>` (optional): API URL

**Example:**
```bash
bun run sdk:cli -- key:generate \
  --channel dev-channel \
  --agents agent1,agent2,agent3 \
  --email developer@company.com \
  --password secure-password-123 \
  --output .env
```

**Output:**
```
✓ Authenticated as: developer@company.com
✓ Generated key for agent: agent1
   Key ID: key-abc123
✓ Generated key for agent: agent2
   Key ID: key-def456
✓ Generated key for agent: agent3
   Key ID: key-ghi789
✓ Credentials saved to: .env

Environment Variables Added:
# Agent credentials for channel: dev-channel
# Generated: 2025-10-05T19:00:00.000Z
MXF_DEV_CHANNEL_AGENT1_KEY_ID="key-abc123"
MXF_DEV_CHANNEL_AGENT1_SECRET_KEY="secret-xyz789"
MXF_DEV_CHANNEL_AGENT2_KEY_ID="key-def456"
MXF_DEV_CHANNEL_AGENT2_SECRET_KEY="secret-uvw012"
MXF_DEV_CHANNEL_AGENT3_KEY_ID="key-ghi789"
MXF_DEV_CHANNEL_AGENT3_SECRET_KEY="secret-rst345"
```

**Credentials Format:**
Credentials are written to `.env` file in the format: `MXF_CHANNELID_AGENTID_KEY_ID` and `MXF_CHANNELID_AGENTID_SECRET_KEY`

### setup:interactive (Recommended)

Interactive setup that prompts for all configuration. This is the **easiest way** to set up a new project.

**Usage:**
```bash
bun run sdk:cli -- setup:interactive [--output <file>] [--api-url <url>]
```

**Alias:**
```bash
bun run sdk:cli -- init
```

**Options:**
- `--output <file>` (optional): Output file for credentials (default: `.env`)
- `--api-url <url>` (optional): API URL

**Interactive Prompts:**
```bash
$ bun run sdk:cli -- setup:interactive

🚀 MXF Interactive Setup
This will create a user account, channel, and agent keys.

✔ User email: developer@company.com
✔ User password: ********
✔ Username: developer
✔ Project/Channel ID (lowercase, hyphens): my-project
✔ Project/Channel name: My Project
✔ Description (optional): Development project
✔ Agent names (comma-separated): coordinator, worker, monitor

ℹ Starting MXF setup...

✓ User created successfully: developer@company.com
✓ Channel created successfully: my-project
✓ Generated key for agent: coordinator
✓ Generated key for agent: worker
✓ Generated key for agent: monitor
✓ Credentials saved to: .env
✓ User credentials added to .env file

✨ Setup completed successfully!

ℹ Channel ID: my-project
ℹ Agents: coordinator, worker, monitor
ℹ Credentials saved to: .env
```

**What Gets Created:**
- User account with provided email/password
- Channel with specified ID and name
- Agent keys for all specified agents
- All credentials written to `.env` file

### setup

Complete automated setup from a configuration file (for scripting/automation).

**Usage:**
```bash
bun run sdk:cli -- setup \
  --config <config-file> \
  [--output <output-file>] \
  [--api-url <url>]
```

**Options:**
- `--config <config-file>` (required): Path to JSON configuration file
- `--output <output-file>` (optional): Output credentials file (default: `.env`)
- `--api-url <url>` (optional): API URL

**Configuration File Format:**

Create `setup-config.json`:

```json
{
  "user": {
    "email": "developer@company.com",
    "password": "your-password",
    "username": "dev-user"
  },
  "channel": {
    "id": "my-channel",
    "name": "My Channel",
    "description": "Development channel for testing",
    "isPrivate": false
  },
  "agents": [
    "agent1",
    "agent2",
    "agent3"
  ]
}
```

**Example:**
```bash
bun run sdk:cli -- setup \
  --config setup-config.json \
  --output .env
```

**Output:**
```
✓ User created successfully: developer@company.com
✓ Channel created successfully: my-channel
✓ Generated key for agent: agent1
✓ Generated key for agent: agent2
✓ Generated key for agent: agent3
✓ Credentials saved to: .env
✓ User credentials added to .env file

✨ Setup completed successfully!
```

**Note:** Configuration files support environment variable substitution using `${VAR_NAME}` syntax

## Usage Workflows

### Initial Setup Workflow (Recommended)

Quick setup using interactive mode:

```bash
# Run interactive setup
bun run sdk:cli -- setup:interactive

# Answer the prompts
# All credentials are automatically saved to .env file
# Ready to start building!
```

### Initial Setup Workflow (Config File)

For automation or CI/CD:

```bash
# 1. Create setup configuration
cat > setup-config.json << EOF
{
  "user": {
    "email": "developer@company.com",
    "password": "your-secure-password",
    "username": "dev-user"
  },
  "channel": {
    "id": "project-alpha",
    "name": "Project Alpha",
    "description": "Main channel for Project Alpha"
  },
  "agents": ["coordinator", "analyst", "executor"]
}
EOF

# 2. Run automated setup
bun run sdk:cli -- setup \
  --config setup-config.json \
  --output .env

# 3. Credentials are now in .env file
```

### Adding Agents to Existing Channel

Generate keys for new agents in an existing channel:

```bash
# Generate keys for new agents
bun run sdk:cli -- key:generate \
  --channel project-alpha \
  --agents new-agent1,new-agent2 \
  --email developer@company.com \
  --password your-secure-password \
  --output additional-keys.json
```

### Multiple Environments

Set up separate channels for different environments:

```bash
# Development environment
bun run sdk:cli -- channel:create \
  --id dev-channel \
  --name "Development" \
  --email dev@company.com \
  --password dev-password

# Staging environment
bun run sdk:cli -- channel:create \
  --id staging-channel \
  --name "Staging" \
  --email dev@company.com \
  --password dev-password

# Production environment
bun run sdk:cli -- channel:create \
  --id prod-channel \
  --name "Production" \
  --email ops@company.com \
  --password prod-password
```

## Security Best Practices

### 1. Environment Variables

Always use environment variables for sensitive data:

```bash
# .env file (add to .gitignore)
MXF_USER_EMAIL=developer@company.com
MXF_USER_PASSWORD=your-secure-password

# Use in commands
bun run sdk:cli -- channel:create \
  --id my-channel \
  --name "My Channel" \
  --email $MXF_USER_EMAIL \
  --password $MXF_USER_PASSWORD
```

### 2. .env File Security

```bash
# The .env file is already gitignored by default
# But verify it's not tracked:
git check-ignore .env

# Set restrictive permissions
chmod 600 .env

# Never commit setup config files with credentials
echo "setup-config.json" >> .gitignore
```

### 3. Separate Credentials per Environment

```
project/
├── secrets/
│   ├── dev-credentials.json          # Development keys
│   ├── staging-credentials.json      # Staging keys
│   └── prod-credentials.json         # Production keys (most restricted)
├── .gitignore                        # Ignore secrets/ directory
└── .env                              # Environment variables
```

### 4. Key Rotation

Regularly rotate agent keys:

```bash
# Generate new keys for agents
bun run sdk:cli -- key:generate \
  --channel my-channel \
  --agents agent1,agent2 \
  --email developer@company.com \
  --password $MXF_USER_PASSWORD \
  --output new-credentials.json

# Update your application to use new credentials
# Old keys remain valid during transition
```

## Troubleshooting

### "Authentication failed"

**Cause**: Invalid email or password

**Solution**:
- Verify your credentials are correct
- Check that the user account exists
- Contact server operator if needed

### "Channel already exists"

**Cause**: Attempting to create a channel with an ID that already exists

**Solution**:
- Use a different channel ID
- Or use the existing channel and generate new keys for it

### "Agent key generation failed"

**Cause**: Channel doesn't exist or insufficient permissions

**Solution**:
- Verify the channel ID is correct
- Ensure you have permission to manage the channel
- Check that the channel was created successfully first

### "Cannot connect to server"

**Cause**: Server is not running or incorrect URL

**Solution**:
```bash
# Check server is running
curl http://localhost:3001/health

# Specify correct API URL
bun run sdk:cli -- channel:create \
  --id my-channel \
  --name "My Channel" \
  --email your@email.com \
  --password your-password \
  --api-url https://your-mxf-server.com/api
```

### "Environment variable not set"

**Cause**: Config file references undefined environment variable

**Solution**:
```bash
# Check which variables are needed
grep -o '\${[A-Z_]*}' setup-config.json

# Set all required variables
export MXF_USER_PASSWORD="your-password"
export MXF_USER_EMAIL="your@email.com"
```

## Integration with SDK

After running setup, credentials are available from environment variables:

```typescript
import { MxfSDK } from '@mxf/sdk';
import dotenv from 'dotenv';

// Load credentials from .env file
dotenv.config();

// Initialize SDK with access token (recommended)
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    accessToken: process.env.MXF_ACCESS_TOKEN!
});

await sdk.connect();

// Create agents using environment variables for keys
// Format: MXF_CHANNELID_AGENTID_KEY_ID and MXF_CHANNELID_AGENTID_SECRET_KEY
const agent = await sdk.createAgent({
    agentId: 'agent1',
    name: 'My Agent',
    channelId: 'my-project',
    keyId: process.env.MXF_MY_PROJECT_AGENT1_KEY_ID!,
    secretKey: process.env.MXF_MY_PROJECT_AGENT1_SECRET_KEY!,
    llmProvider: 'anthropic',
    defaultModel: 'claude-3-5-sonnet-20241022',
    apiKey: process.env.ANTHROPIC_API_KEY
});

await agent.connect();
```

**Environment Variable Format:**
- Access token: `MXF_ACCESS_TOKEN` (recommended for SDK usage)
- Agent keys: `MXF_<CHANNEL_ID>_<AGENT_ID>_KEY_ID`, `MXF_<CHANNEL_ID>_<AGENT_ID>_SECRET_KEY`
- Channel and agent IDs are uppercased with hyphens converted to underscores

## See Also

- [Authentication Guide](authentication.md) - Complete authentication documentation
- [SDK Overview](index.md) - MxfSDK usage patterns
- [Getting Started](../getting-started.md) - Initial setup guide
- [Examples](examples.md) - Practical code examples
