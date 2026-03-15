/**
 * A2A Task Store Adapter
 *
 * Implements @a2a-js/sdk TaskStore interface backed by AgentStudio's existing taskManager.
 * Bridges between the SDK's Task type and our internal task representation.
 */

import type { TaskStore } from '@a2a-js/sdk/server';
import type { Task } from '@a2a-js/sdk';
import type { TaskStatus } from '../../types/a2a.js';
import { taskManager } from './taskManager.js';

export class A2ATaskStoreAdapter implements TaskStore {
  private workingDirectory: string;
  private a2aAgentId: string;

  constructor(workingDirectory: string, a2aAgentId = 'a2a-standard') {
    this.workingDirectory = workingDirectory;
    this.a2aAgentId = a2aAgentId;
  }

  async save(task: Task): Promise<void> {
    const existing = await taskManager.getTask(this.workingDirectory, task.id);

    if (!existing) {
      await taskManager.createTask({
        workingDirectory: this.workingDirectory,
        projectId: this.workingDirectory,
        agentId: 'a2a-standard',
        a2aAgentId: this.a2aAgentId,
        input: { message: this.extractMessageText(task) },
        timeoutMs: 600000,
      });
    }

    const state = task.status?.state;
    if (state) {
      const internalStatus = this.mapTaskState(state) as TaskStatus;
      const extra: Record<string, any> = {};

      if (state === 'completed' || state === 'failed' || state === 'canceled') {
        extra.completedAt = new Date().toISOString();
      }
      if (state === 'failed' && task.status?.message) {
        extra.errorDetails = { message: task.status.message.parts?.map((p: any) => p.text || '').join('') };
      }

      await taskManager.updateTaskStatus(
        this.workingDirectory,
        task.id,
        internalStatus,
        extra
      ).catch(() => {
        // Ignore errors from status updates for tasks we didn't fully create
      });
    }
  }

  async load(taskId: string): Promise<Task | undefined> {
    const internalTask = await taskManager.getTask(this.workingDirectory, taskId);
    if (!internalTask) return undefined;

    return this.toSdkTask(internalTask);
  }

  private extractMessageText(task: Task): string {
    if (task.history && task.history.length > 0) {
      const firstMsg = task.history[0];
      if (firstMsg.parts) {
        return firstMsg.parts
          .filter((p: any) => p.type === 'text' || p.kind === 'text')
          .map((p: any) => p.text || '')
          .join('');
      }
    }
    return '';
  }

  private mapTaskState(sdkState: string): string {
    const mapping: Record<string, string> = {
      submitted: 'pending',
      working: 'running',
      'input-required': 'running',
      completed: 'completed',
      failed: 'failed',
      canceled: 'canceled',
    };
    return mapping[sdkState] || 'pending';
  }

  private toSdkTask(internal: any): Task {
    const stateMapping: Record<string, string> = {
      pending: 'submitted',
      running: 'working',
      completed: 'completed',
      failed: 'failed',
      canceled: 'canceled',
    };

    return {
      id: internal.id,
      contextId: internal.id,
      status: {
        state: (stateMapping[internal.status] || 'submitted') as any,
        timestamp: internal.updatedAt || internal.createdAt,
      },
      history: [],
    } as unknown as Task;
  }
}
