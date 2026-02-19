/**
 * useRatingTool
 *
 * Registers a `rate_response` frontend tool via `useFrontendTool`.
 * Call this hook inside any component that stays mounted during a chat session
 * (e.g. AgentChatPanel) to make the tool available to the AI agent.
 *
 * When the AI calls `rate_response`, the chat will render a star-rating
 * widget. After the user submits, the rating is sent back to the AI so
 * it can continue the conversation.
 *
 * Tool arguments (sent by the AI):
 *   - question  {string}   — The prompt shown above the stars
 *   - max_stars {number}   — Max stars (default 5, optional)
 *   - labels    {string[]} — Per-star label text (optional)
 */

import React from 'react';
import { useFrontendTool } from './useFrontendTool.js';
import { StarRatingTool } from '../components/tools/StarRatingTool.js';

export function useRatingTool(): void {
  useFrontendTool({
    name: 'rate_response',
    description:
      '在对话界面渲染一个星级评分组件，让用户对 AI 的回答或某项内容进行评分。' +
      '调用后前端会展示交互式星级选择器，用户提交后返回评分数字。',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: '展示给用户的评分问题或提示文字，例如"你对本次回答的满意度是？"',
        },
        max_stars: {
          type: 'integer',
          description: '最高星数，默认 5，允许 2-10',
        },
        labels: {
          type: 'array',
          description: '每个星级的文字标签，数组长度应等于 max_stars，例如 ["很差","差","一般","好","非常好"]',
          items: { type: 'string' },
        },
      },
      required: ['question'],
    },
    render: ({ args, onSubmit }) => {
      return React.createElement(StarRatingTool, {
        question: (args.question as string) || '请评分',
        maxStars: typeof args.max_stars === 'number' ? args.max_stars : 5,
        labels: Array.isArray(args.labels) ? (args.labels as string[]) : undefined,
        onSubmit,
      });
    },
  });
}
