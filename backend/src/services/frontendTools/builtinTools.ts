/**
 * Built-in Frontend Tool Definitions
 *
 * These tools are always available and don't require frontend registration.
 * AskUserQuestion is the first (and currently only) built-in frontend tool.
 */

import type { FrontendToolDefinition } from './types.js';

export const ASK_USER_QUESTION_TOOL: FrontendToolDefinition = {
  name: 'ask_user_question',
  mcpServerName: 'ask-user-question',
  description: `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- By default, a free-text input box is shown so users can type a custom answer. Set customInput to false to disable it and only allow selecting from the provided options.
- Use multiSelect: true to allow multiple answers to be selected for a question
- The tool will pause execution until the user provides their answers
- This tool supports multiple notification channels (Web, Slack, WeChat, etc.)

IMPORTANT: This tool will block until the user responds. Do not call it in situations where immediate response is needed.`,
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'Questions to ask the user (1-4 questions)',
        items: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'The complete question to ask the user.',
            },
            header: {
              type: 'string',
              description: 'Very short label displayed as a chip/tag (max 12 chars).',
            },
            options: {
              type: 'array',
              description: 'The available choices (2-4 options).',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
            multiSelect: {
              type: 'boolean',
              description: 'Set to true to allow multiple options to be selected.',
            },
            customInput: {
              description:
                'Controls the free-text input. true/undefined = show (default), false = hide, object = full control.',
            },
          },
          required: ['question', 'header', 'options', 'multiSelect'],
        },
      },
    },
    required: ['questions'],
  },
  resultFormat: 'json',
};

/**
 * All built-in frontend tools.
 */
export const BUILTIN_FRONTEND_TOOLS: FrontendToolDefinition[] = [
  ASK_USER_QUESTION_TOOL,
];
