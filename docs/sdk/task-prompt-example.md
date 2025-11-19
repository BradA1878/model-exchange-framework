# Task Prompt Examples

Task prompts define how agents should handle specific tasks within the MXF framework. These prompts are typically used when assigning tasks to agents or when agents need to understand task execution patterns.

## Overview

Task prompts serve to:
- **Task Specification**: Define what needs to be accomplished
- **Execution Guidelines**: Specify how the task should be performed
- **Success Criteria**: Define what constitutes task completion
- **Coordination Patterns**: Explain multi-agent collaboration requirements

## Example: Research Task Assignment

```typescript
// Example of assigning a research task to an agent
const researchTask = {
    taskId: 'research-001',
    title: 'Competitive Analysis Research',
    description: `
            # Task Prompt

            ## Current Task
            You have been assigned a task: # TEAM MEETING COORDINATION

            ## MISSION
            alice and bob need to coordinate a team meeting for next week.

            ## PARTICIPANTS
            - alice (project coordinator): Take the lead 
            - bob (technical specialist): Provide input

            ## REQUIREMENTS
            - Find mutually agreeable time
            - Decide on agenda topic
            - Confirm duration and format

            ## COMPLETION
            Only complete when both agents confirm all details.

            alice: You are the coordinator. Initiate contact with bob to plan this meeting.

            You are responsible for completing this entire task. Call task_complete when finished.

            ## COMPLETION GUIDANCE:
            - You ARE the completion agent for this task
            - Monitor the overall progress of all contributors
            - Only call task_complete when the ENTIRE task is finished
            - Coordinate with other agents as needed
            - Take responsibility for final task completion

            Please begin work on this task.
    `,
    assignedAgentIds: ['research-assistant-001'],
    assignmentStrategy: 'expertise_driven',
    priority: 'high'
};
```

## Example: Multi-Agent Coordination Task

```typescript
// Example of a task requiring coordination between multiple agents
const coordinationTask = {
    taskId: 'project-planning-001',
    title: 'Software Development Planning',
    description: `
            # Multi-Agent Coordination Task

            ## Current Task
            You have been assigned a collaborative task: # SOFTWARE ARCHITECTURE REVIEW

            ## MISSION
            Multiple agents need to coordinate to review and approve the new microservices architecture.

            ## PARTICIPANTS
            - architect-agent (lead): Design review and technical oversight
            - security-agent: Security assessment and compliance
            - performance-agent: Performance analysis and optimization
            - qa-agent: Testing strategy and quality assurance

            ## COORDINATION REQUIREMENTS
            - Each agent must complete their specialized review
            - Use messaging_coordinate for cross-functional discussions
            - Lead agent (architect-agent) consolidates all feedback
            - Consensus required before final approval

            ## DELIVERABLES
            - Individual assessment reports from each agent
            - Consolidated recommendation from lead agent
            - Go/no-go decision with rationale

            ## COMPLETION CRITERIA
            Task complete only when:
            1. All agents have submitted their assessments
            2. Lead agent has consolidated feedback
            3. Final decision has been communicated to all participants

            Lead agent: You are responsible for orchestrating this review process.
            Other agents: Provide your specialized expertise and collaborate as needed.
    `,
    assignmentScope: 'multiple',
    coordinationMode: 'collaborative',
    assignedAgentIds: ['architect-001', 'pm-001', 'analyst-001'],
    leadAgentId: 'pm-001'
};
```

## Task Execution Patterns

### 1. **Single Agent Tasks**
- Independent execution
- Direct result reporting
- Minimal coordination overhead

### 2. **Multi-Agent Collaborative Tasks**
- Shared responsibility
- Real-time coordination
- Consensus-based completion

### 3. **Sequential Agent Tasks**
- Workflow-based execution
- Output passing between agents
- Dependency management

### 4. **Hierarchical Agent Tasks**
- Lead agent coordination
- Delegated sub-tasks
- Structured reporting

## Best Practices

### 1. **Clear Task Definition**
- Specific, measurable objectives
- Well-defined scope and boundaries
- Success criteria and deliverables

### 2. **Resource Specification**
- Required tools and capabilities
- Access permissions and constraints
- Time and priority requirements

### 3. **Coordination Guidelines**
- Communication protocols
- Progress reporting requirements
- Error handling procedures

### 4. **Quality Assurance**
- Validation criteria
- Review processes
- Completion verification

## Related Documentation

- **[System Prompt Examples](./system-prompt-example.md)** - Framework-level system prompts
- **[Agent Config Prompt Examples](./agent-config-prompt-example.md)** - Agent configuration patterns
- **[Conversation Prompt Examples](./conversation-prompt-example.md)** - Multi-agent conversation patterns
- **[Task System Documentation](../mxf/task-system.md)** - Complete task system architecture
