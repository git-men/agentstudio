import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { SessionListPanel } from '../SessionListPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock('../../../hooks/useAgents', () => ({
  useAgentSessions: () => ({
    data: {
      sessions: [
        { id: 's1', title: 'First Session', messageCount: 5, lastUpdated: '2026-03-04T10:00:00Z' },
        { id: 's2', title: 'Second Session', messageCount: 3, lastUpdated: '2026-03-04T09:00:00Z' },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock('../../../services/SessionStoreManager', () => ({
  sessionStoreManager: {
    getStore: () => undefined,
  },
}));

describe('SessionListPanel', () => {
  it('renders session list', () => {
    render(
      <SessionListPanel
        agentId="agent-1"
        activeSessionId="s1"
        onSessionSelect={() => {}}
        onNewSession={() => {}}
      />,
    );

    expect(screen.getByText('First Session')).toBeDefined();
    expect(screen.getByText('Second Session')).toBeDefined();
  });

  it('calls onSessionSelect when session is clicked', () => {
    const onSelect = vi.fn();
    render(
      <SessionListPanel
        agentId="agent-1"
        activeSessionId="s1"
        onSessionSelect={onSelect}
        onNewSession={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('Second Session'));
    expect(onSelect).toHaveBeenCalledWith('s2');
  });

  it('shows New Session button', () => {
    render(
      <SessionListPanel
        agentId="agent-1"
        activeSessionId={null}
        onSessionSelect={() => {}}
        onNewSession={() => {}}
      />,
    );

    expect(screen.getByText('New Session')).toBeDefined();
  });

  it('calls onNewSession when New Session button is clicked', () => {
    const onNew = vi.fn();
    render(
      <SessionListPanel
        agentId="agent-1"
        activeSessionId={null}
        onSessionSelect={() => {}}
        onNewSession={onNew}
      />,
    );

    const buttons = screen.getAllByText('New Session');
    fireEvent.click(buttons[0]);
    expect(onNew).toHaveBeenCalled();
  });

  it('has a search input', () => {
    render(
      <SessionListPanel
        agentId="agent-1"
        activeSessionId={null}
        onSessionSelect={() => {}}
        onNewSession={() => {}}
      />,
    );

    const searchInput = screen.getByPlaceholderText('Search sessions…');
    expect(searchInput).toBeDefined();
  });
});
