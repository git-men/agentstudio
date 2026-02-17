/**
 * User Input Registry
 * 
 * 管理等待用户输入的工具调用，使用 Promise 机制实现真正的阻塞
 * 
 * 新架构：
 * - 使用 sessionId + toolUseId 标识请求
 * - 不再持有通知回调，改为发出事件
 * - 通知由 NotificationChannelManager 处理
 * 
 * 流程：
 * 1. MCP 工具调用 waitForUserInput，创建 pending entry
 * 2. Registry 发出 'awaiting_input' 事件
 * 3. NotificationChannelManager 监听事件，发送通知
 * 4. 用户提交答案，调用 submitUserResponse
 * 5. Registry resolve Promise，MCP 工具返回
 */

import { EventEmitter } from 'events';
import type { UserInputRequest } from './notificationChannel.js';

// 重新导出类型，保持向后兼容
export type { UserInputRequest } from './notificationChannel.js';

export interface PendingUserInput {
  request: UserInputRequest;
  resolve: (response: string) => void;
  reject: (error: Error) => void;
}

// 配置常量
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 小时
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 小时

class UserInputRegistry extends EventEmitter {
  private pendingInputs: Map<string, PendingUserInput> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private maxAgeMs: number = DEFAULT_MAX_AGE_MS;
  
  /**
   * 注册一个等待用户输入的请求
   * 返回一个 Promise，在用户提交答案时 resolve
   * 不设置超时，允许一直等待
   * 
   * @param sessionId - 会话 ID
   * @param agentId - Agent ID
   * @param toolUseId - 工具调用 ID
   * @param questions - 问题列表
   */
  async waitForUserInput(
    sessionId: string,
    agentId: string,
    toolUseId: string,
    questions: UserInputRequest['questions']
  ): Promise<string> {
    // 检查是否已存在
    if (this.pendingInputs.has(toolUseId)) {
      throw new Error(`Duplicate tool use ID: ${toolUseId}`);
    }
    
    console.log(`📝 [UserInputRegistry] Registering pending input for tool: ${toolUseId}, session: ${sessionId}`);
    
    // 创建请求对象
    const request: UserInputRequest = {
      toolUseId,
      sessionId,
      agentId,
      questions,
      createdAt: Date.now(),
    };
    
    return new Promise<string>((resolve, reject) => {
      // 注册 pending entry（不设置超时）
      const entry: PendingUserInput = {
        request,
        resolve: (response: string) => {
          this.pendingInputs.delete(toolUseId);
          console.log(`✅ [UserInputRegistry] Resolved input for tool: ${toolUseId}`);
          resolve(response);
        },
        reject: (error: Error) => {
          this.pendingInputs.delete(toolUseId);
          console.log(`❌ [UserInputRegistry] Rejected input for tool: ${toolUseId}`, error.message);
          console.log(`❌ [UserInputRegistry] Reject caller stack:`, new Error().stack);
          reject(error);
        },
      };
      
      this.pendingInputs.set(toolUseId, entry);
      
      // 发出事件，通知 NotificationChannelManager 发送通知
      console.log(`📡 [UserInputRegistry] Emitting awaiting_input event for tool: ${toolUseId}`);
      this.emit('awaiting_input', request);
    });
  }
  
  /**
   * 提交用户的答案
   * 会 resolve 对应的 Promise，使 MCP 工具返回
   */
  submitUserResponse(toolUseId: string, response: string): boolean {
    const entry = this.pendingInputs.get(toolUseId);
    
    if (!entry) {
      console.warn(`⚠️ [UserInputRegistry] No pending input found for tool: ${toolUseId}`);
      return false;
    }
    
    console.log(`📤 [UserInputRegistry] Submitting user response for tool: ${toolUseId}`);
    entry.resolve(response);
    return true;
  }
  
  /**
   * 取消等待用户输入
   */
  cancelUserInput(toolUseId: string, reason?: string): boolean {
    const entry = this.pendingInputs.get(toolUseId);
    
    if (!entry) {
      return false;
    }
    
    console.log(`🚫 [UserInputRegistry] Cancelling input for tool: ${toolUseId}`);
    entry.reject(new Error(reason || 'User input cancelled'));
    return true;
  }
  
  /**
   * 检查是否有等待中的输入
   */
  hasPendingInput(toolUseId: string): boolean {
    return this.pendingInputs.has(toolUseId);
  }
  
  /**
   * 获取 pending input 的请求信息（用于验证）
   */
  getPendingInput(toolUseId: string): UserInputRequest | null {
    const entry = this.pendingInputs.get(toolUseId);
    return entry ? entry.request : null;
  }
  
  /**
   * 验证并提交用户响应
   * 验证 sessionId 和 agentId 是否匹配，防止伪造响应
   * 
   * @returns { success: boolean; error?: string }
   */
  validateAndSubmitUserResponse(
    toolUseId: string, 
    response: string,
    sessionId?: string,
    agentId?: string
  ): { success: boolean; error?: string } {
    const entry = this.pendingInputs.get(toolUseId);
    
    if (!entry) {
      return { success: false, error: 'No pending input found for this tool use ID' };
    }
    
    // 验证 sessionId（如果提供）
    if (sessionId && entry.request.sessionId !== sessionId) {
      console.warn(`⚠️ [UserInputRegistry] Session ID mismatch for tool: ${toolUseId}`);
      console.warn(`   Expected: ${entry.request.sessionId}, Got: ${sessionId}`);
      return { success: false, error: 'Session ID mismatch' };
    }
    
    // 验证 agentId（如果提供）
    if (agentId && entry.request.agentId !== agentId) {
      console.warn(`⚠️ [UserInputRegistry] Agent ID mismatch for tool: ${toolUseId}`);
      console.warn(`   Expected: ${entry.request.agentId}, Got: ${agentId}`);
      return { success: false, error: 'Agent ID mismatch' };
    }
    
    console.log(`📤 [UserInputRegistry] Validated and submitting user response for tool: ${toolUseId}`);
    entry.resolve(response);
    return { success: true };
  }
  
  /**
   * 获取 session 的所有等待中的输入
   */
  getPendingInputsBySession(sessionId: string): UserInputRequest[] {
    const results: UserInputRequest[] = [];
    for (const entry of this.pendingInputs.values()) {
      if (entry.request.sessionId === sessionId) {
        results.push(entry.request);
      }
    }
    console.log(`🔍 [UserInputRegistry] getPendingInputsBySession(${sessionId}): found ${results.length}, total pending: ${this.pendingInputs.size}`);
    return results;
  }
  
  /**
   * 取消 session 的所有等待中的输入
   */
  cancelAllBySession(sessionId: string, reason?: string): number {
    let count = 0;
    for (const [toolUseId, entry] of this.pendingInputs.entries()) {
      if (entry.request.sessionId === sessionId) {
        entry.reject(new Error(reason || 'Session terminated'));
        this.pendingInputs.delete(toolUseId);
        count++;
      }
    }
    console.log(`🚫 [UserInputRegistry] Cancelled ${count} pending inputs for session: ${sessionId}, reason: ${reason}`);
    if (count > 0) {
      console.log(`🚫 [UserInputRegistry] Cancel caller stack:`, new Error().stack);
    }
    return count;
  }
  
  /**
   * 获取统计信息
   */
  getStats(): { totalPending: number; oldestPendingAge: number | null } {
    const now = Date.now();
    let oldestAge: number | null = null;
    
    for (const entry of this.pendingInputs.values()) {
      const age = now - entry.request.createdAt;
      if (oldestAge === null || age > oldestAge) {
        oldestAge = age;
      }
    }
    
    return {
      totalPending: this.pendingInputs.size,
      oldestPendingAge: oldestAge
    };
  }
  
  /**
   * 更新 session 的所有 pending inputs 的 sessionId
   * 用于临时 sessionId 更新为真实 sessionId 的场景
   */
  updateSessionId(oldSessionId: string, newSessionId: string): number {
    let count = 0;
    for (const entry of this.pendingInputs.values()) {
      if (entry.request.sessionId === oldSessionId) {
        entry.request.sessionId = newSessionId;
        count++;
      }
    }
    if (count > 0) {
      console.log(`📡 [UserInputRegistry] Updated ${count} pending inputs from session ${oldSessionId} to ${newSessionId}`);
    }
    return count;
  }
  
  /**
   * 启动定期清理任务
   * 清理超过 maxAge 的过期 pending inputs
   * 
   * @param intervalMs - 清理间隔（毫秒），默认 1 小时
   * @param maxAgeMs - 最大存活时间（毫秒），默认 24 小时
   */
  startCleanupJob(intervalMs: number = DEFAULT_CLEANUP_INTERVAL_MS, maxAgeMs: number = DEFAULT_MAX_AGE_MS): void {
    if (this.cleanupInterval) {
      console.warn('⚠️ [UserInputRegistry] Cleanup job already running');
      return;
    }
    
    this.maxAgeMs = maxAgeMs;
    
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredInputs();
    }, intervalMs);
    
    console.log(`🧹 [UserInputRegistry] Started cleanup job: interval=${intervalMs}ms, maxAge=${maxAgeMs}ms`);
  }
  
  /**
   * 停止定期清理任务
   */
  stopCleanupJob(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('🛑 [UserInputRegistry] Stopped cleanup job');
    }
  }
  
  /**
   * 清理过期的 pending inputs
   * @returns 清理的条目数量
   */
  cleanupExpiredInputs(): number {
    const now = Date.now();
    let count = 0;
    
    for (const [toolUseId, entry] of this.pendingInputs.entries()) {
      const age = now - entry.request.createdAt;
      if (age > this.maxAgeMs) {
        entry.reject(new Error(`Request expired after ${Math.round(age / 1000 / 60)} minutes`));
        this.pendingInputs.delete(toolUseId);
        count++;
        console.log(`🗑️ [UserInputRegistry] Cleaned up expired input: ${toolUseId} (age: ${Math.round(age / 1000 / 60)} minutes)`);
      }
    }
    
    if (count > 0) {
      console.log(`🧹 [UserInputRegistry] Cleanup completed: removed ${count} expired inputs`);
    }
    
    return count;
  }
}

// 单例实例
export const userInputRegistry = new UserInputRegistry();
