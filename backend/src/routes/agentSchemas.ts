import { z } from 'zod';

// 定义 SystemPrompt schema，支持字符串或预设对象格式
export const PresetSystemPromptSchema = z.object({
  type: z.literal('preset'),
  preset: z.literal('claude_code'),
  append: z.string().optional()
});

export const SystemPromptSchema = z.union([
  z.string().min(1),
  PresetSystemPromptSchema
]);

export const CreateAgentSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-_]+$/, 'ID must contain only lowercase letters, numbers, hyphens, and underscores'),
  name: z.string().min(1),
  description: z.string(),
  systemPrompt: SystemPromptSchema,
  // maxTurns 可以是数字（1-100）、null（不限制）或 undefined（使用默认值）
  maxTurns: z.union([z.number().min(1).max(100), z.null()]).optional().default(25),
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan']).optional().default('acceptEdits'),
  model: z.string().min(1).optional().default('sonnet'),
  allowedTools: z.array(z.object({
    name: z.string(),
    enabled: z.boolean(),
    permissions: z.object({
      requireConfirmation: z.boolean().optional(),
      allowedPaths: z.array(z.string()).optional(),
      blockedPaths: z.array(z.string()).optional(),
    }).optional()
  })),
  ui: z.object({
    icon: z.string().optional().default('🤖'),
    primaryColor: z.string().optional().default('#3B82F6'),
    headerTitle: z.string(),
    headerDescription: z.string(),
    welcomeMessage: z.string().optional(),
    customComponent: z.string().optional()
  }),
  workingDirectory: z.string().optional(),
  dataDirectory: z.string().optional(),
  fileTypes: z.array(z.string()).optional(),
  author: z.string().min(1),
  homepage: z.string().url().optional(),
  tags: z.array(z.string()).optional().default([]),
  enabled: z.boolean().optional().default(true),
});

export const UpdateAgentSchema = CreateAgentSchema.partial().omit({ id: true });

export const ImageSchema = z.object({
  id: z.string(),
  data: z.string(), // base64 encoded image data
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
  filename: z.string().optional()
});

export const ChatRequestSchema = z.object({
  message: z.string(),
  images: z.array(ImageSchema).optional(),
  agentId: z.string().min(1),
  sessionId: z.string().optional().nullable(),
  projectPath: z.string().optional(),
  mcpTools: z.array(z.string()).optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan']).optional(),
  model: z.string().optional(),
  claudeVersion: z.string().optional(), // Claude版本ID
  channel: z.literal('web').optional().default('web'), // Channel for streaming control
  outputFormat: z.enum(['default', 'agui']).optional().default('default'), // Output format: default (SDK format) or agui (AGUI protocol)
  reconnect: z.boolean().optional(), // When true, re-attach to an in-progress SSE stream instead of sending a new message
  context: z.object({
    currentSlide: z.number().optional().nullable(),
    slideContent: z.string().optional(),
    allSlides: z.array(z.object({
      index: z.number(),
      title: z.string(),
      path: z.string(),
      exists: z.boolean().optional()
    })).optional(),
    currentItem: z.any().optional(),
    allItems: z.array(z.any()).optional(),
    customContext: z.record(z.string(), z.any()).optional(),
    environmentContext: z.string().optional(),
  }).optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  frontendTools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.object({
      type: z.literal('object'),
      properties: z.record(z.string(), z.any()),
      required: z.array(z.string()).optional(),
    }),
    mcpServerName: z.string().optional(),
    resultFormat: z.enum(['json', 'text']).optional(),
  })).optional(),
}).refine(data => {
  return data.message.trim().length > 0 || (data.images && data.images.length > 0);
}, {
  message: "Either message text or images must be provided"
});

export const FrontendToolResultSchema = z.object({
  toolCallId: z.string().min(1, 'toolCallId is required'),
  result: z.union([z.string(), z.record(z.string(), z.any()), z.array(z.any())]),
  isError: z.boolean().optional(),
  sessionId: z.string().min(1, 'sessionId is required'),
  agentId: z.string().min(1, 'agentId is required'),
  toolName: z.string().optional(),
});
