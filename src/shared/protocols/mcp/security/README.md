# MCP Security Framework

A comprehensive security framework for Model Context Protocol (MCP) tools that provides OS-specific guardrails, command validation, path restrictions, and destructive operation protection.

## Overview

The MCP Security Framework consists of three main components:

1. **McpSecurityGuard** - Validates commands and file paths based on OS-specific rules
2. **McpConfirmationManager** - Manages confirmation requests for high-risk operations
3. **McpSecurityConfig** - Configuration system for customizing security policies

## Features

### OS-Specific Command Protection

- **macOS**: Blocks diskutil, system configuration tools, security bypasses
- **Windows**: Blocks format, registry editors, system tools
- **Linux**: Blocks disk formatting, system services, package managers

### Path Restrictions

- Prevents path traversal attacks
- Blocks access to system directories
- Restricts write operations outside project directory
- Configurable allowed paths

### Risk-Based Confirmation

- Automatic risk assessment (low/medium/high/critical)
- Configurable confirmation strategies
- Audit logging of all security decisions

## Quick Start

### Basic Usage

```typescript
import { getSecurityGuard, getConfirmationManager } from './security';

// Initialize security guard
const securityGuard = getSecurityGuard('/path/to/project');

// Validate a command
const validation = securityGuard.validateCommand('rm -rf /tmp/test', {
    agentId: 'agent-123',
    channelId: 'channel-456',
    requestId: 'req-789'
});

if (!validation.allowed) {
    throw new Error(validation.reason);
}

// Check if confirmation needed
if (validation.requiresConfirmation) {
    const confirmationManager = getConfirmationManager();
    const confirmed = await confirmationManager.requestConfirmation(
        'command',
        'Execute shell command',
        {
            command: 'rm -rf /tmp/test',
            riskLevel: validation.riskLevel,
            reason: validation.reason
        },
        context
    );
    
    if (!confirmed) {
        throw new Error('Operation cancelled by user');
    }
}
```

### Configuration

Create a `mcp-security.json` file in your project:

```json
{
    "enabled": true,
    "mode": "moderate",
    "commands": {
        "additionalBlocked": ["custom-dangerous-cmd"],
        "additionalAllowed": ["my-safe-tool"],
        "defaultTimeout": 60000
    },
    "filesystem": {
        "additionalAllowedPaths": ["/tmp/my-app"],
        "allowOutsideProject": false,
        "autoBackup": true
    },
    "confirmation": {
        "strategy": "interactive",
        "requireConfirmationFor": ["medium", "high", "critical"],
        "autoApproveInDev": true
    },
    "logging": {
        "enabled": true,
        "logPath": "./logs/mcp-security.log"
    }
}
```

### Environment Variables

- `MCP_SECURITY_ENABLED` - Enable/disable security (true/false)
- `MCP_SECURITY_MODE` - Security mode (strict/moderate/permissive)
- `MCP_SECURITY_CONFIRMATION` - Confirmation strategy (interactive/policy/logging/none)
- `MCP_SECURITY_AUTO_APPROVE_DEV` - Auto-approve in development (true/false)
- `MCP_SECURITY_LOG_PATH` - Path for security logs

## Security Modes

### Strict Mode
- Blocks all potentially dangerous commands
- Requires confirmation for all medium+ risk operations
- No operations outside project directory
- Comprehensive logging

### Moderate Mode (Default)
- Blocks known dangerous commands
- Requires confirmation for high/critical operations
- Allows read operations outside project
- Standard logging

### Permissive Mode
- Minimal blocking (only critical commands)
- Confirmation only for critical operations
- More flexible path access
- Optional logging

## Confirmation Strategies

### Interactive Strategy
- Prompts user for confirmation
- Timeout support
- Best for CLI/desktop applications

### Policy Strategy
- Rule-based automatic decisions
- Configurable policies
- Best for automation

### Logging Strategy
- Logs all requests
- Auto-approve or deny based on configuration
- Best for debugging/testing

## Command Risk Levels

- **Low**: Safe, read-only operations (ls, pwd, echo)
- **Medium**: Potentially impactful (npm install, git operations)
- **High**: System modifications (service restart, config changes)
- **Critical**: Destructive operations (rm -rf, format, system shutdown)

## Best Practices

1. **Start with Moderate Mode** - Balance between security and usability
2. **Customize for Your Environment** - Add project-specific rules
3. **Use Confirmation Wisely** - Don't overwhelm users with prompts
4. **Enable Logging** - Maintain audit trail of security decisions
5. **Regular Reviews** - Update rules based on security logs

## Example Integration

```typescript
// In your MCP tool implementation
export const shellExecTool = {
    name: 'shell_execute',
    async handler(input: any, context: any) {
        // Security validation
        const securityContext = {
            agentId: context.agentId,
            channelId: context.channelId,
            requestId: context.requestId
        };
        
        const validation = securityGuard.validateCommand(
            input.command,
            securityContext
        );
        
        if (!validation.allowed) {
            throw new Error(validation.reason);
        }
        
        if (validation.requiresConfirmation) {
            const confirmed = await confirmationManager.requestConfirmation(
                'command',
                'Execute shell command',
                {
                    command: input.command,
                    riskLevel: validation.riskLevel,
                    reason: validation.reason
                },
                securityContext
            );
            
            if (!confirmed) {
                throw new Error('Command execution cancelled');
            }
        }
        
        // Execute command...
    }
};
```

## Extending the Framework

### Adding Custom Command Rules

```typescript
// Add to blocked list
securityGuard.addBlockedCommand('my-dangerous-cmd');

// Add to safe list
securityGuard.addSafeCommand('my-safe-tool');
```

### Custom Confirmation Policies

```typescript
const policyStrategy = new PolicyConfirmationStrategy();

// Add custom policy
policyStrategy.addPolicy('command', (request) => {
    // Auto-approve test commands
    if (request.details.command?.includes('test')) {
        return true;
    }
    return false;
});

confirmationManager.setStrategy(policyStrategy);
```

### Platform-Specific Configuration

```json
{
    "platformOverrides": {
        "darwin": {
            "commands": {
                "additionalBlocked": ["osascript"]
            }
        },
        "win32": {
            "filesystem": {
                "additionalBlockedPaths": ["C:\\Windows"]
            }
        }
    }
}
```

## Security Considerations

1. This framework provides defense-in-depth but is not foolproof
2. Always validate inputs at multiple levels
3. Run MCP tools with minimum required privileges
4. Monitor security logs for suspicious patterns
5. Keep the blocked command list updated

## Contributing

When adding new security rules:

1. Consider cross-platform implications
2. Document the security rationale
3. Add tests for new rules
4. Update risk assessments appropriately
5. Consider backward compatibility