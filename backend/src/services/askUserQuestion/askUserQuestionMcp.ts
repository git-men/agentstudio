/**
 * AskUserQuestion SDK MCP Server
 *
 * 实现一个进程内 MCP server，使 agent 能够向用户提问并等待回答
 * 
 * 新架构（事件驱动）：
 * 1. MCP 工具调用 userInputRegistry.waitForUserInput()
 * 2. UserInputRegistry 发出 'awaiting_input' 事件
 * 3. NotificationChannelManager 监听事件，通过活跃渠道发送通知
 * 4. 用户提交答案后，通过 HTTP API 触发 Promise resolve
 * 5. MCP 工具返回用户的答案，Claude 继续执行
 * 
 * 优势：
 * - MCP 工具不需要知道通知渠道
 * - 支持多种通知渠道（SSE、Slack、企业微信等）
 * - 连接断开重连不会影响等待中的请求
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { userInputRegistry } from './userInputRegistry.js';

export type AskUserQuestionInput = {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
    }>;
    multiSelect: boolean;
    customInput?: boolean | {
      enabled: boolean;
      placeholder?: string;
      maxLength?: number;
      rows?: number;
      required?: boolean;
    };
  }>;
};

/**
 * Tool description for AskUserQuestion
 */
const TOOL_DESCRIPTION = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- By default, a free-text input box is shown so users can type a custom answer. Set customInput to false to disable it and only allow selecting from the provided options.
- Use multiSelect: true to allow multiple answers to be selected for a question
- The tool will pause execution until the user provides their answers
- This tool supports multiple notification channels (Web, Slack, WeChat, etc.)

IMPORTANT: This tool will block until the user responds. Do not call it in situations where immediate response is needed.`;

/**
 * Session reference object - allows dynamic session ID updates
 */
export interface SessionRef {
  current: string;
}

/**
 * Create SDK MCP server for AskUserQuestion tool
 *
 * @param sessionRef - 可更新的会话 ID 引用，用于路由用户通知
 * @param agentId - Agent ID
 * @returns SDK MCP server instance and session reference
 */
export async function createAskUserQuestionMcpServer(sessionRef: SessionRef, agentId: string) {
  // Define the tool with session context
  const askUserQuestionTool = tool(
    'ask_user_question',
    TOOL_DESCRIPTION,
    {
      questions: z
        .array(
          z.object({
            question: z.string().describe(
              'The complete question to ask the user. Should be clear, specific, and end with a question mark.'
            ),
            header: z.string().max(12).describe(
              'Very short label displayed as a chip/tag (max 12 chars). Examples: "Auth method", "Library", "Approach".'
            ),
            options: z
              .array(
                z.object({
                  label: z.string().describe('The display text for this option.'),
                  description: z.string().describe('Explanation of what this option means.'),
                })
              )
              .min(2)
              .max(4)
              .describe('The available choices (2-4 options).'),
            multiSelect: z.boolean().describe(
              'Set to true to allow multiple options to be selected.'
            ),
            customInput: z.union([
              z.boolean(),
              z.object({
                enabled: z.boolean(),
                placeholder: z.string().optional(),
                maxLength: z.number().optional(),
                rows: z.number().optional(),
                required: z.boolean().optional(),
              })
            ]).optional().describe(
              'Controls whether a free-text input box is shown. undefined/true = show (default), false = hide (user can only pick from options), object = full control over placeholder, maxLength, rows, required.'
            ),
          })
        )
        .min(1)
        .max(4)
        .describe('Questions to ask the user (1-4 questions)'),
    },
    async (args, context) => {
      // 获取工具调用 ID（从 context 或生成一个）
      const toolUseId = (context as any)?.toolUseId || `ask_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 使用动态 session ID（可能已从临时 ID 更新为真实 ID）
      const currentSessionId = sessionRef.current;
      console.log(`🎤 [AskUserQuestion MCP] Tool called with ${args.questions.length} questions`);
      console.log(`🎤 [AskUserQuestion MCP] Session: ${currentSessionId}, Agent: ${agentId}, ToolUseId: ${toolUseId}`);
      
      try {
        // 注册等待用户输入（无超时限制，允许一直等待）
        // UserInputRegistry 会发出事件，NotificationChannelManager 会处理通知
        const userResponse = await userInputRegistry.waitForUserInput(
          currentSessionId,
          agentId,
          toolUseId,
          args.questions
        );
        
        console.log(`✅ [AskUserQuestion MCP] Received user response for tool: ${toolUseId}`);
        
        // 返回用户的回答
        return {
          content: [
            {
              type: 'text',
              text: `User response:\n\n${userResponse}`,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ [AskUserQuestion MCP] Error:`, error);

        return {
          content: [
            {
              type: 'text',
              text: `Failed to get user input: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Create SDK MCP server with the tool
  const server = createSdkMcpServer({
    name: 'ask-user-question',
    version: '1.0.0',
    tools: [askUserQuestionTool],
  });

  return {
    server,
    tool: askUserQuestionTool,
    sessionRef, // 返回 session 引用，供外部更新
  };
}

/**
 * Get tool name as it appears to Claude
 */
export function getAskUserQuestionToolName(): string {
  return 'mcp__ask-user-question__ask_user_question';
}

/**
 * Check if a tool name is the AskUserQuestion tool
 */
export function isAskUserQuestionTool(toolName: string): boolean {
  return toolName === getAskUserQuestionToolName() || toolName === 'ask_user_question';
}
