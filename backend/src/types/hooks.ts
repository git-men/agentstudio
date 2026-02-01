/**
 * Hooks types for Claude Code
 * 
 * Hooks are custom shell commands that execute automatically when targeted events occur.
 * Location: ~/.claude/settings.json or .claude/settings.local.json
 */

export type HookEventType = 
  | 'PreToolUse'       // Before a tool is executed
  | 'PostToolUse'      // After a tool completes successfully
  | 'PostToolUseFailure' // After a tool fails
  | 'PermissionRequest' // When permission is requested
  | 'SessionStart'      // When a session starts
  | 'UserPromptSubmit'  // When user submits a prompt
  | 'Notification';     // When a notification is shown

export interface HookMatcher {
  // Tool name or pattern to match
  tool_name?: string;
  // Tool names to match (array)
  tool_names?: string[];
  // Glob pattern for file paths
  path_pattern?: string;
}

export interface Hook {
  // Event type that triggers this hook
  event: HookEventType;
  // Optional matcher to filter when hook runs
  matcher?: HookMatcher;
  // Shell command to execute
  command: string;
  // Whether hook is enabled
  enabled?: boolean;
  // Optional timeout in milliseconds
  timeout?: number;
}

export interface HooksConfig {
  hooks?: Hook[];
}

export interface HookListItem {
  id: string;  // Generated ID (index-based)
  event: HookEventType;
  command: string;
  matcher?: HookMatcher;
  enabled: boolean;
  timeout?: number;
}

export interface HookCreate {
  event: HookEventType;
  command: string;
  matcher?: HookMatcher;
  enabled?: boolean;
  timeout?: number;
}

export interface HookUpdate {
  event?: HookEventType;
  command?: string;
  matcher?: HookMatcher;
  enabled?: boolean;
  timeout?: number;
}
