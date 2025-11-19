# Pull Request

## Description
<!-- Provide a clear and concise description of what this PR does -->

## Related Issue
<!-- Link to the issue this PR addresses -->
Fixes #<!-- issue number -->
<!-- Or use: Closes #, Resolves #, Related to # -->

## Type of Change
<!-- Check all that apply -->
- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Performance improvement
- [ ] Code refactoring (no functional changes)
- [ ] Documentation update
- [ ] Configuration change
- [ ] Dependency update
- [ ] Other (please describe):

## Components Affected
<!-- Check all that apply -->
- [ ] Server Core (`src/server/`)
- [ ] SDK (`src/sdk/`)
- [ ] Shared utilities/types (`src/shared/`)
- [ ] Dashboard (`dashboard/`)
- [ ] REST API (`src/server/api/`)
- [ ] Socket.IO handlers (`src/server/socket/`)
- [ ] Tool system (Built-in tools)
- [ ] MCP integration
- [ ] Control Loop (ORPAR)
- [ ] Task Management
- [ ] Memory System
- [ ] Validation System
- [ ] Event system (`src/shared/events/`)
- [ ] Database models/schemas
- [ ] Docker configuration
- [ ] Documentation (`docs/`)
- [ ] Examples/demos (`examples/`)
- [ ] Build configuration
- [ ] Other:

## Changes Made
<!-- Provide a detailed list of changes -->

### Key Changes
- 
- 
- 

### Technical Details
<!-- Explain the technical approach and implementation details -->

## Code Quality Checklist
<!-- Verify your code follows MXF standards -->
- [ ] **Arrow functions**: Used arrow functions where appropriate (`prefer-arrow/prefer-arrow-functions`)
- [ ] **Explicit return types**: Added explicit return types to functions (`@typescript-eslint/explicit-function-return-type`)
- [ ] **Semicolons**: Added semicolons at end of statements (`@typescript-eslint/semi`)
- [ ] **Indentation**: Used 4-space indentation (`@typescript-eslint/indent`)
- [ ] **No unused variables**: Removed all unused variables (`@typescript-eslint/no-unused-vars`)
- [ ] **No unused imports**: Cleaned up unused imports (`import/no-unused-modules`)
- [ ] **Import order**: Organized imports properly (`import/order`)
- [ ] **Comments**: Added comments explaining complex logic
- [ ] **DRY principles**: Followed Don't Repeat Yourself principles
- [ ] **No unnecessary complexity**: Avoided over-engineering or unnecessary abstractions
- [ ] **No fallbacks/timeouts**: Did not add unnecessary fallbacks or simulation code
- [ ] **Event naming**: Used `EventNames.ts` for event constants (single source of truth)
- [ ] **Validation**: Used `src/shared/utils/validation.ts` for validation and assertions
- [ ] **Fail-fast**: Added proper validation for fail-fast behavior

## Testing
<!-- Describe the testing you've done -->

### Test Environment
- [ ] Local development (`npm run start:dev`)
- [ ] Docker deployment (`npm run docker:up`)
- [ ] Dashboard tested (`npm run dashboard:dev`)
- [ ] Examples/demos tested

### Testing Performed
- [ ] Manual testing completed
- [ ] Tested with multiple LLM providers (specify):
- [ ] Tested multi-agent scenarios
- [ ] Tested Socket.IO communication
- [ ] Tested REST API endpoints
- [ ] Tested tool execution
- [ ] Tested error handling
- [ ] Tested with different configurations
- [ ] Verified no breaking changes

### Test Scenarios
<!-- Describe specific test scenarios you ran -->
1. 
2. 
3. 

### Test Results
<!-- Paste relevant test output or results -->
```
Paste test results here
```

## Event/Tool Changes
<!-- If your PR adds or modifies events or tools -->

### New Events (if applicable)
<!-- List new events added to EventNames.ts -->
- 

### Modified Events (if applicable)
<!-- List events that were modified -->
- 

### New Tools (if applicable)
<!-- List new tools added -->
- 

### Modified Tools (if applicable)
<!-- List tools that were modified -->
- 

## Breaking Changes
<!-- If this PR introduces breaking changes, describe them here -->

### What breaks:
<!-- Describe what existing functionality will break -->

### Migration path:
<!-- Provide clear instructions for users to migrate -->

### Affected users:
- [ ] All MXF users
- [ ] SDK users only
- [ ] Server administrators only
- [ ] Dashboard users only
- [ ] Specific configurations (describe):

## Documentation
<!-- Check all that apply -->
- [ ] Updated relevant documentation in `docs/`
- [ ] Updated README.md (if needed)
- [ ] Updated SDK documentation (`src/sdk/README.md`)
- [ ] Updated API documentation
- [ ] Added JSDoc comments to new functions/classes
- [ ] Updated examples/demos
- [ ] Added inline code comments
- [ ] No documentation updates needed

### Documentation Changes
<!-- List documentation files changed -->
- 

## Configuration Changes
<!-- If this PR requires configuration changes -->

### Environment Variables
<!-- List new or modified environment variables -->
```env
# New variables (add to .env)

# Modified variables

# Deprecated variables
```

### Breaking Configuration Changes
<!-- Describe any configuration changes that will break existing setups -->

## Database/Schema Changes
<!-- If this PR modifies MongoDB schemas or Meilisearch indexes -->

### Database Changes
- [ ] MongoDB schema changes
- [ ] Meilisearch index changes
- [ ] Redis cache structure changes
- [ ] Migration script provided
- [ ] No database changes

### Migration Instructions
<!-- Provide migration instructions if needed -->

## Performance Impact
<!-- Describe any performance implications -->
- [ ] No significant performance impact
- [ ] Performance improvement (describe):
- [ ] Potential performance regression (explain and justify):
- [ ] Not applicable

## Security Considerations
<!-- Check all that apply -->
- [ ] No security implications
- [ ] Security enhancement (describe):
- [ ] Reviewed for injection vulnerabilities
- [ ] Reviewed for authentication/authorization issues
- [ ] Reviewed API key/token handling
- [ ] Reviewed data validation
- [ ] No new dependencies with known vulnerabilities

## Dependencies
<!-- List new dependencies or dependency updates -->

### New Dependencies
- 

### Updated Dependencies
- 

### Removed Dependencies
- 

## Screenshots/Videos
<!-- If applicable, add screenshots or videos demonstrating the changes -->

## Additional Notes
<!-- Any additional information reviewers should know -->

## Pre-Submission Checklist
<!-- Complete before submitting PR -->
- [ ] My code follows the project's coding standards
- [ ] I have performed a self-review of my code
- [ ] I have commented complex code sections
- [ ] I have updated relevant documentation
- [ ] My changes generate no new warnings or errors
- [ ] I have tested my changes thoroughly
- [ ] I have verified no breaking changes (or documented them)
- [ ] I have updated EventNames.ts if adding/modifying events
- [ ] I have used shared validation utilities
- [ ] I have followed fail-fast principles
- [ ] I have added myself to CONTRIBUTORS.md (if first contribution)
- [ ] I have read the [Contributing Guidelines](CONTRIBUTING.md)
- [ ] I have signed off my commits (DCO) if required

## Reviewer Notes
<!-- Optional: Specific areas you'd like reviewers to focus on -->

---

**By submitting this pull request, I confirm that my contribution is made under the terms of the Apache License 2.0.**
