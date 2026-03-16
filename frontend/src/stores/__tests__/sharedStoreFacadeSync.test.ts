import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../hooks/useAGUIChat', () => ({
  getDefaultUICapabilities: (engine: string) => ({
    supportsThinking: engine === 'claude',
    supportsTools: true,
    supportsVision: false,
    supportsMcp: engine === 'claude',
    supportsA2A: engine === 'claude',
    supportsSubAgents: engine === 'claude',
    supportsPermissions: engine === 'claude',
    supportsMaxTurns: engine === 'claude',
    supportsMaxBudget: engine === 'claude',
  }),
}));

/**
 * T034: Verify useSharedStore and facade sync
 *
 * When the legacy ChatPage route sets `selectedEngine` or `currentAgent`
 * via the `useAgentStore` facade, the change must propagate to `useSharedStore`
 * (and vice versa).
 */
describe('useSharedStore ↔ useAgentStore facade sync', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadStores() {
    const { useSharedStore } = await import('../useSharedStore');
    const { useAgentStore } = await import('../useAgentStore');
    return { useSharedStore, useAgentStore };
  }

  it('facade.setSelectedEngine propagates to useSharedStore', async () => {
    const { useSharedStore, useAgentStore } = await loadStores();

    useAgentStore.getState().setSelectedEngine('cursor');

    expect(useSharedStore.getState().selectedEngine).toBe('cursor');
    expect(useAgentStore.getState().selectedEngine).toBe('cursor');
  });

  it('facade.setCurrentAgent propagates to useSharedStore', async () => {
    const { useSharedStore, useAgentStore } = await loadStores();

    const agent = { id: 'test-agent', name: 'Test Agent' } as any;
    useAgentStore.getState().setCurrentAgent(agent);

    expect(useSharedStore.getState().currentAgent?.id).toBe('test-agent');
    expect(useAgentStore.getState().currentAgent?.id).toBe('test-agent');
  });

  it('facade.setEngineUICapabilities propagates to useSharedStore', async () => {
    const { useSharedStore, useAgentStore } = await loadStores();

    const caps = {
      supportsThinking: false,
      supportsTools: true,
      supportsVision: true,
      supportsMcp: false,
      supportsA2A: false,
      supportsSubAgents: false,
      supportsPermissions: false,
      supportsMaxTurns: false,
      supportsMaxBudget: false,
    };
    useAgentStore.getState().setEngineUICapabilities(caps);

    expect(useSharedStore.getState().engineUICapabilities.supportsVision).toBe(true);
    expect(useSharedStore.getState().engineUICapabilities.supportsThinking).toBe(false);
  });

  it('facade.setEngineModels propagates to useSharedStore', async () => {
    const { useSharedStore, useAgentStore } = await loadStores();

    const models = [{ id: 'model-1', name: 'Model 1' }];
    useAgentStore.getState().setEngineModels(models);

    expect(useSharedStore.getState().engineModels).toEqual(models);
  });

  it('facade.setSidebarCollapsed propagates to useSharedStore', async () => {
    const { useSharedStore, useAgentStore } = await loadStores();

    useAgentStore.getState().setSidebarCollapsed(true);

    expect(useSharedStore.getState().sidebarCollapsed).toBe(true);
  });

  it('useSharedStore changes propagate back to facade', async () => {
    const { useSharedStore, useAgentStore } = await loadStores();

    useSharedStore.getState().setSelectedEngine('codebuddy');

    // Allow microtask for subscriber to fire
    await new Promise((r) => setTimeout(r, 0));

    expect(useAgentStore.getState().selectedEngine).toBe('codebuddy');
  });

  it('both routes see same agent config', async () => {
    const { useSharedStore, useAgentStore } = await loadStores();

    const agent = { id: 'shared-agent', name: 'Shared' } as any;

    useAgentStore.getState().setCurrentAgent(agent);

    expect(useSharedStore.getState().currentAgent?.id).toBe('shared-agent');

    // Simulate workspace route reading from useSharedStore
    expect(useSharedStore.getState().currentAgent?.name).toBe('Shared');

    // Simulate legacy route reading from facade
    expect(useAgentStore.getState().currentAgent?.name).toBe('Shared');
  });

  it('setCurrentAgentAndSession creates session store and syncs agent', async () => {
    const { useSharedStore, useAgentStore } = await loadStores();

    const agent = { id: 'agent-with-session', name: 'Agent' } as any;
    useAgentStore.getState().setCurrentAgentAndSession(agent, 'session-123');

    expect(useSharedStore.getState().currentAgent?.id).toBe('agent-with-session');
    expect(useAgentStore.getState().currentSessionId).toBe('session-123');
  });
});
