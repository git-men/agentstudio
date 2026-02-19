/**
 * useFrontendTool
 *
 * Register a custom frontend tool that can be called by the AI agent.
 * The tool schema is sent to the backend before each chat session so the
 * agent can use it as an MCP tool. When the agent calls the tool, the
 * `render` function is used to display custom UI in the chat.
 *
 * Usage:
 * ```tsx
 * useFrontendTool({
 *   name: 'select_game_character',
 *   description: 'Let the user choose a game character',
 *   parameters: {
 *     type: 'object',
 *     properties: {
 *       characters: { type: 'array', description: 'Available characters' },
 *     },
 *     required: ['characters'],
 *   },
 *   render: ({ args, onSubmit }) => (
 *     <CharacterPicker characters={args.characters as string[]} onSelect={onSubmit} />
 *   ),
 * });
 * ```
 */

import { useEffect } from 'react';
import {
  registerTool,
  unregisterTool,
  type FrontendToolSchema,
  type FrontendToolRenderFn,
} from '../services/frontendToolRegistry.js';

export interface UseFrontendToolOptions extends FrontendToolSchema {
  render: FrontendToolRenderFn;
}

/**
 * Register a custom frontend tool for the current component's lifetime.
 * The tool is unregistered when the component unmounts.
 */
export function useFrontendTool(options: UseFrontendToolOptions): void {
  const { render, ...schema } = options;

  // Use a stable string key derived from name to avoid stale closure issues.
  // If the description/parameters change the component should remount anyway.
  const toolName = schema.name;

  useEffect(() => {
    registerTool({ schema, render });

    return () => {
      unregisterTool(toolName);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolName]);
}
