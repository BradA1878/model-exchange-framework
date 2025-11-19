# Task Prompt Best Practices for LLM Agents

## Overview

Clear, structured task prompts significantly improve LLM agent compliance and task completion rates. This guide provides best practices for writing effective task descriptions in the MXF system.

## Key Principles

### 1. Use Numbered Steps
✅ **Good:**
```
1. Use agent_discover to find agents with 'analysis' capability
2. Use messaging_send to agent 'analyzer' with message "Please analyze Q3 data"
3. Use task_complete when you receive the response
```

❌ **Bad:**
```
Discover agents that can do analysis and ask them to analyze Q3 data. Complete the task when done.
```

### 2. Specify Exact Tool Names
✅ **Good:**
```
Use messaging_broadcast to share your findings
```

❌ **Bad:**
```
Share your findings with everyone
```

### 3. Provide Concrete Values
✅ **Good:**
```
Set priority to "high" and status to "in-progress"
```

❌ **Bad:**
```
Set appropriate priority and status
```

### 4. One Action Per Step
✅ **Good:**
```
1. Calculate the sum of 15 + 27
2. Use messaging_send to Bob with the result
3. Use task_complete
```

❌ **Bad:**
```
Calculate 15 + 27 and send the result to Bob, then complete the task
```

### 5. Clear Completion Criteria
✅ **Good:**
```
Use task_complete after receiving Bob's confirmation message
```

❌ **Bad:**
```
Complete when appropriate
```

## Task Description Templates

### Simple Single-Agent Task
```
Complete these steps:
1. [Action with specific tool]
2. [Action with specific values]
3. Use task_complete with summary: "[Expected outcome]"
```

### Collaboration Task
```
[Agent1 Name]:
1. [First action]
2. Wait for [specific event/message]
3. Use task_complete when [specific condition]

[Agent2 Name]:
1. Wait for [specific trigger]
2. [Response action]
3. [Follow-up action]
```

### Planning-Based Task
```
1. Use planning_create with items: ["Step 1", "Step 2", "Step 3"]
2. For each step:
   - [Specific action]
   - Use planning_update_item to mark as 'completed'
3. Use task_complete when all steps show status 'completed'
```

## Common Pitfalls to Avoid

### 1. Ambiguous Instructions
❌ **Avoid:**
- "When you're ready..."
- "Use your judgment..."
- "Do what seems appropriate..."
- "Let me know when..."

✅ **Instead:**
- "After completing step 2..."
- "Use [specific tool]..."
- "Set value to [specific value]..."
- "Use task_complete when..."

### 2. Multiple Concepts per Instruction
❌ **Avoid:**
```
Analyze the data and share insights while coordinating with other agents to ensure comprehensive coverage.
```

✅ **Instead:**
```
1. Analyze the data for trends
2. Use messaging_broadcast: "Found 3 key trends: [list them]"
3. Use agent_discover to find agents with 'review' capability
4. Use coordination_request to agent 'reviewer' for validation
```

### 3. Implicit Tool Usage
❌ **Avoid:**
```
Tell Bob about the results
```

✅ **Instead:**
```
Use messaging_send to agent 'bob' with message: "Results: [your findings]"
```

### 4. Vague Completion Conditions
❌ **Avoid:**
```
Complete the task when everything is done
```

✅ **Instead:**
```
Use task_complete after you receive 3 responses from team members
```

## Examples by Task Type

### Data Analysis Task
```yaml
title: "Analyze Sales Data"
description: |
  1. Use data_query with filter: {"month": "October", "region": "North"}
  2. Calculate the total sales amount
  3. Use messaging_broadcast: "October North sales: $[amount]"
  4. Use task_complete with summary: "Shared October North sales analysis"
```

### Team Coordination Task
```yaml
title: "Schedule Team Meeting"
description: |
  Coordinator:
  1. Use agent_discover to find agents with 'calendar' capability
  2. Use coordination_request to all found agents: "Available times for meeting?"
  3. Wait for all responses
  4. Use messaging_broadcast: "Meeting scheduled for [agreed time]"
  5. Use task_complete with summary: "Meeting scheduled"
  
  Team Members:
  1. Wait for coordination request about meeting times
  2. Use coordination_accept with your available times
```

### Sequential Processing Task
```yaml
title: "Process Customer Feedback"
description: |
  1. Use data_fetch to get feedback from endpoint: "/api/feedback/latest"
  2. Count positive vs negative feedback
  3. Use messaging_send to 'manager': "Feedback summary: [X] positive, [Y] negative"
  4. Use memory_store with key: "feedback_summary" and the counts
  5. Use task_complete with summary: "Processed latest feedback"
```

## Testing Your Prompts

Before deploying, test your prompts:

1. **Clarity Test**: Can you follow the steps without interpretation?
2. **Tool Test**: Are all tool names valid and specific?
3. **Value Test**: Are all required values provided?
4. **Completion Test**: Is it clear when the task is done?

## Migration Guide

If you have existing complex prompts, migrate them:

### Before:
```
Please help coordinate with the team to analyze our customer data and provide insights that will help improve our service. Make sure everyone is involved and share the results when ready.
```

### After:
```
1. Use agent_discover to find agents with 'analysis' capability
2. Use task_create for each agent: "Analyze customer segment: [assign different segments]"
3. Wait for all agents to complete their tasks
4. Use data_aggregate to combine all results
5. Use messaging_broadcast with the combined insights
6. Use task_complete with summary: "Customer analysis shared with team"
```

## Conclusion

Clear, structured prompts lead to:
- Higher task completion rates
- Fewer agent errors
- More predictable behavior
- Easier debugging
- Better collaboration

Remember: If a human can follow your instructions step-by-step without thinking, an LLM agent can too!