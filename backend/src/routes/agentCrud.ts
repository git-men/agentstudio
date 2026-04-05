import express from 'express';
import { AgentStorage } from '../services/agentStorage.js';
import type { AgentConfig } from '../types/agents.js';
import { sessionManager } from '../services/sessionManager.js';
import {
  CreateAgentSchema,
  UpdateAgentSchema,
  FrontendToolResultSchema,
} from './agentSchemas.js';
import { frontendToolBridge } from '../services/frontendTools/index.js';

const router: express.Router = express.Router();

export const globalAgentStorage = new AgentStorage();

// 获取活跃会话列表 (需要在通用获取agents路由之前)
/**
 * @swagger
 * /api/agents/sessions:
 *   get:
 *     tags: [Agents]
 *     summary: 获取活跃会话概览
 *     responses:
 *       200:
 *         description: 成功
 *       500:
 *         description: 服务器错误
 */
router.get('/sessions', (req, res) => {
  try {
    const activeCount = sessionManager.getActiveSessionCount();
    const sessionsInfo = sessionManager.getSessionsInfo();

    res.json({
      activeSessionCount: activeCount,
      sessions: sessionsInfo,
      message: `${activeCount} active Claude sessions`
    });
  } catch (error) {
    console.error('Failed to get sessions:', error);
    res.status(500).json({ error: 'Failed to retrieve session info' });
  }
});

// 手动关闭指定会话
/**
 * @swagger
 * /api/agents/sessions/{sessionId}:
 *   delete:
 *     tags: [Agents]
 *     summary: 关闭指定会话
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 成功
 *       404:
 *         description: 未找到
 *       500:
 *         description: 服务器错误
 */
router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const removed = await sessionManager.removeSession(sessionId);

    if (removed) {
      res.json({ success: true, message: `Session ${sessionId} closed` });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  } catch (error) {
    console.error('Failed to close session:', error);
    res.status(500).json({ error: 'Failed to close session' });
  }
});

// 清除所有会话
/**
 * @swagger
 * /api/agents/sessions:
 *   delete:
 *     tags: [Agents]
 *     summary: 清除所有会话
 *     responses:
 *       200:
 *         description: 成功
 *       500:
 *         description: 服务器错误
 */
router.delete('/sessions', async (req, res) => {
  try {
    const clearedCount = await sessionManager.clearAllSessions();
    res.json({ 
      success: true, 
      clearedCount,
      message: `Successfully cleared ${clearedCount} sessions` 
    });
  } catch (error) {
    console.error('Failed to clear all sessions:', error);
    res.status(500).json({ error: 'Failed to clear all sessions' });
  }
});

// 中断指定会话的当前请求
/**
 * @swagger
 * /api/agents/sessions/{sessionId}/interrupt:
 *   post:
 *     tags: [Agents]
 *     summary: 中断会话当前请求
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 成功
 *       404:
 *         description: 未找到
 *       500:
 *         description: 服务器错误
 */
router.post('/sessions/:sessionId/interrupt', async (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log(`🛑 API: Interrupt request for session: ${sessionId}`);

    const result = await sessionManager.interruptSession(sessionId);

    if (result.success) {
      res.json({
        success: true,
        message: `Session ${sessionId} interrupted successfully`
      });
    } else {
      res.status(result.error === 'Session not found' ? 404 : 500).json({
        success: false,
        error: result.error || 'Failed to interrupt session'
      });
    }
  } catch (error) {
    console.error('Failed to interrupt session:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: 'Failed to interrupt session',
      details: errorMessage
    });
  }
});

// Get all agents
/**
 * @swagger
 * /api/agents:
 *   get:
 *     tags: [Agents]
 *     summary: 获取 Agent 列表
 *     parameters:
 *       - in: query
 *         name: enabled
 *         schema: { type: string, enum: ['true', 'false'] }
 *     responses:
 *       200:
 *         description: 成功
 *       500:
 *         description: 服务器错误
 */
router.get('/', (req, res) => {
  try {
    const { enabled } = req.query;
    let agents = globalAgentStorage.getAllAgents();

    // Filter by enabled status
    if (enabled !== undefined) {
      const isEnabled = enabled === 'true';
      agents = agents.filter(agent => agent.enabled === isEnabled);
    }

    // Filter by component type
    // componentType filtering removed - no longer needed

    res.json({ agents });
  } catch (error) {
    console.error('Failed to get agents:', error);
    res.status(500).json({ error: 'Failed to retrieve agents' });
  }
});

// Get specific agent
/**
 * @swagger
 * /api/agents/{agentId}:
 *   get:
 *     tags: [Agents]
 *     summary: 获取单个 Agent
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 成功
 *       404:
 *         description: 未找到
 *       500:
 *         description: 服务器错误
 */
router.get('/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    const agent = globalAgentStorage.getAgent(agentId);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json({ agent });
  } catch (error) {
    console.error('Failed to get agent:', error);
    res.status(500).json({ error: 'Failed to retrieve agent' });
  }
});

// Create new agent
/**
 * @swagger
 * /api/agents:
 *   post:
 *     tags: [Agents]
 *     summary: 创建 Agent
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: 成功
 *       400:
 *         description: 参数错误
 *       409:
 *         description: 已存在
 *       500:
 *         description: 服务器错误
 */
router.post('/', (req, res) => {
  try {
    const validation = CreateAgentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid agent data', details: validation.error });
    }

    const agentData = validation.data;

    // Check if agent ID already exists
    const existingAgent = globalAgentStorage.getAgent(agentData.id);
    if (existingAgent) {
      return res.status(409).json({ error: 'Agent with this ID already exists' });
    }

    const agent = globalAgentStorage.createAgent({
      ...agentData,
      version: '1.0.0',
      model: 'sonnet',
      source: 'local'
    } as Omit<AgentConfig, 'createdAt' | 'updatedAt'>);

    res.json({ agent, message: 'Agent created successfully' });
  } catch (error) {
    console.error('Failed to create agent:', error);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

// Update agent
/**
 * @swagger
 * /api/agents/{agentId}:
 *   put:
 *     tags: [Agents]
 *     summary: 更新 Agent
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: 成功
 *       400:
 *         description: 参数错误
 *       404:
 *         description: 未找到
 *       500:
 *         description: 服务器错误
 */
router.put('/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    const validation = UpdateAgentSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid agent data', details: validation.error });
    }

    const existingAgent = globalAgentStorage.getAgent(agentId);
    if (!existingAgent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // 过滤并转换 validation.data，将 maxTurns: null 转换为 undefined
    const updateData: Partial<AgentConfig> = { ...validation.data as any };
    if (updateData.maxTurns === null) {
      updateData.maxTurns = undefined;
    }

    // 构建更新后的 agent
    const updatedAgent: AgentConfig = {
      ...existingAgent,
      ...updateData,
      id: agentId, // Ensure ID doesn't change
      updatedAt: new Date().toISOString()
    };

    globalAgentStorage.saveAgent(updatedAgent);
    res.json({ agent: updatedAgent, message: 'Agent updated successfully' });
  } catch (error) {
    console.error('Failed to update agent:', error);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

// Delete agent
/**
 * @swagger
 * /api/agents/{agentId}:
 *   delete:
 *     tags: [Agents]
 *     summary: 删除 Agent
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 成功
 *       404:
 *         description: 未找到
 *       500:
 *         description: 服务器错误
 */
router.delete('/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    console.log(`🗑️ [ROUTE DEBUG] DELETE request for agent: ${agentId}`);

    const deleted = globalAgentStorage.deleteAgent(agentId);
    console.log(`🗑️ [ROUTE DEBUG] Delete result:`, deleted);

    if (!deleted) {
      console.log(`❌ [ROUTE DEBUG] Agent not found: ${agentId}`);
      return res.status(404).json({ error: 'Agent not found' });
    }

    console.log(`✅ [ROUTE DEBUG] Agent deleted successfully: ${agentId}`);
    res.json({ success: true, message: 'Agent deleted successfully' });
  } catch (error) {
    console.error('❌ [ROUTE DEBUG] Failed to delete agent:', error);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

// =================================================================================
// Frontend Tool Result API
// =================================================================================
/**
 * @swagger
 * /api/agents/frontend-tool-result:
 *   post:
 *     tags: [Agents]
 *     summary: 提交前端工具执行结果
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: 成功
 *       400:
 *         description: 参数错误
 *       403:
 *         description: 禁止
 *       404:
 *         description: 未找到
 *       500:
 *         description: 服务器错误
 */
router.post('/frontend-tool-result', async (req, res) => {
  try {
    const validation = FrontendToolResultSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid request body', details: validation.error.issues });
    }

    const { toolCallId, result: rawResult, isError, sessionId, agentId, toolName } = validation.data;

    const resultStr = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);

    if (isError) {
      const cancelOk = frontendToolBridge.cancel(toolCallId, resultStr, sessionId, agentId, toolName);
      if (cancelOk) {
        return res.json({ success: true });
      }
      return res.status(404).json({ success: false, error: 'No pending tool call found' });
    }

    const outcome = frontendToolBridge.submitResult(toolCallId, resultStr, sessionId, agentId, toolName);

    if (outcome.success) {
      res.json({ success: true });
    } else {
      const status = outcome.error?.includes('mismatch') ? 403 : 404;
      res.status(status).json({ success: false, error: outcome.error });
    }
  } catch (error) {
    console.error('[FrontendToolResult] Error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
