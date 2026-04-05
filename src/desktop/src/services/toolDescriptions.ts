/**
 * MXF Desktop — Tool Call Description Service
 *
 * Maps MCP tool names to human-readable descriptions for the UI.
 * Each descriptor extracts key arguments into a concise string.
 * Unknown tools fall back to humanized tool names (snake_case → Title Case).
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

/** Extract the filename from a path string */
function basename(p: unknown): string {
    if (typeof p !== 'string') return 'file';
    return p.split('/').pop() || p;
}

/** Truncate a string to max chars, adding ellipsis */
function truncate(s: unknown, max: number): string {
    const str = String(s || '');
    return str.length > max ? str.substring(0, max) + '…' : str;
}

/** Convert snake_case tool name to Title Case for fallback display */
function humanizeToolName(name: string): string {
    return name
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

type DescribeFn = (args: Record<string, unknown>) => string;

/**
 * Tool name → description template mapping.
 * Each function receives the tool's args and returns a short human-readable string.
 */
const TOOL_DESCRIPTORS: Record<string, DescribeFn> = {
    // Filesystem
    read_file:          (a) => `Reading ${basename(a.path || a.file_path)}`,
    write_file:         (a) => `Writing ${basename(a.path || a.file_path)}`,
    edit_file:          (a) => `Editing ${basename(a.path || a.file_path)}`,
    create_file:        (a) => `Creating ${basename(a.path || a.file_path)}`,
    delete_file:        (a) => `Deleting ${basename(a.path || a.file_path)}`,
    move_file:          (a) => `Moving ${basename(a.source)} → ${basename(a.destination)}`,
    copy_file:          (a) => `Copying ${basename(a.source)}`,
    list_directory:     (a) => `Listing ${a.path || a.directory || '.'}`,
    create_directory:   (a) => `Creating dir ${a.path || ''}`,
    search_files:       (a) => `Finding: ${a.pattern || a.query || ''}`,
    get_file_info:      (a) => `Inspecting ${basename(a.path)}`,

    // Shell & code execution
    shell_execute:      (a) => `Running: ${truncate(a.command, 60)}`,
    code_execute:       (a) => `Executing ${a.language || 'code'}`,

    // Git
    git_status:         () => 'Checking git status',
    git_commit:         (a) => `Committing: ${truncate(a.message, 40)}`,
    git_log:            () => 'Viewing git history',
    git_diff:           () => 'Viewing changes',
    git_add:            (a) => `Staging ${a.files || 'changes'}`,
    git_branch:         (a) => a.name ? `Branch: ${a.name}` : 'Listing branches',
    git_push:           () => 'Pushing to remote',
    git_pull:           () => 'Pulling from remote',

    // Planning
    planning_create:        (a) => `Creating plan: ${truncate(a.title, 40)}`,
    planning_update_item:   () => 'Updating plan step',
    planning_view:          () => 'Viewing plan',
    planning_share:         () => 'Sharing plan',

    // Task management
    task_create_with_plan:  (a) => `Creating task: ${truncate(a.title, 40)}`,
    task_create:            (a) => `Creating task: ${truncate(a.title, 40)}`,
    task_delegate:          (a) => `Delegating: ${truncate(a.summary, 50)}`,
    task_update:            () => 'Updating task',
    task_monitoring_status: () => 'Checking task status',
    task_complete:          () => 'Completing task',

    // Memory
    memory_store:       (a) => `Storing: ${a.key || 'data'}`,
    memory_retrieve:    (a) => `Recalling: ${a.query || a.key || 'data'}`,

    // Communication
    messaging_send:     (a) => `Messaging ${a.targetAgentId || 'agent'}`,
    messaging_broadcast:() => 'Broadcasting message',
    messaging_discover: () => 'Discovering agents',

    // Web
    web_search:             (a) => `Searching: ${truncate(a.query, 40)}`,
    web_navigate:           (a) => `Opening: ${truncate(a.url, 50)}`,
    web_bulk_extract:       () => 'Extracting web content',
    web_screenshot:         () => 'Taking screenshot',
    api_fetch:              (a) => `Fetching: ${truncate(a.url, 50)}`,

    // User input
    user_input:             (a) => `Asking user: ${truncate(a.title, 40)}`,
    request_user_input:     (a) => `Asking user: ${truncate(a.title, 40)}`,

    // New tools
    project_context:    () => 'Scanning project',
    search_project:     (a) => `Searching: ${truncate(a.pattern, 40)}`,
    progress_update:    (a) => `${a.status || 'Working'}`,

    // Analytics
    analytics_agent_performance:    () => 'Analyzing agent performance',
    analytics_system_health:        () => 'Checking system health',
    analytics_generate_report:      () => 'Generating report',

    // Coordination
    coordination_request:   (a) => `Requesting help: ${truncate(a.description, 30)}`,
    coordination_complete:  () => 'Completing coordination',

    // Wolfram
    wolfram_compute:    (a) => `Computing: ${truncate(a.input || a.query, 40)}`,

    // ORPAR
    orpar_observe:  () => 'Observing',
    orpar_reason:   () => 'Reasoning',
    orpar_plan:     () => 'Planning',
    orpar_act:      () => 'Acting',
    orpar_reflect:  () => 'Reflecting',

    // User memory
    user_memory_save:   (a) => `Saving memory: ${truncate(String(a.title || ''), 40)}`,
    user_memory_recall: (a) => `Recalling: ${truncate(String(a.query || ''), 40)}`,
    user_memory_forget: (a) => a.searchTerm ? `Forgetting: ${truncate(String(a.searchTerm), 40)}` : 'Deleting memory',
    user_memory_shake:  () => 'Checking for stale memories',
};

/**
 * Get a human-readable description for a tool call.
 * Returns a concise string suitable for activity cards and status displays.
 */
export function describeToolCall(toolName: string, args: Record<string, unknown>): string {
    const descriptor = TOOL_DESCRIPTORS[toolName];
    if (descriptor) {
        try {
            return descriptor(args);
        } catch {
            // Fall through to humanize
        }
    }
    return humanizeToolName(toolName);
}
