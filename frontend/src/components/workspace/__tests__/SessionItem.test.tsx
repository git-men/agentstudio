import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { SessionItem } from '../SessionItem';
import { createSessionStore } from '../../../stores/createSessionStore';

describe('SessionItem', () => {
  it('displays session title', () => {
    render(
      <SessionItem
        sessionId="s1"
        title="My Chat"
        lastActivity={Date.now()}
        isActive={false}
        storeApi={undefined}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText('My Chat')).toBeDefined();
  });

  it('displays "New Session" when title is null', () => {
    render(
      <SessionItem
        sessionId="s1"
        title={null}
        lastActivity={Date.now()}
        isActive={false}
        storeApi={undefined}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText('New Session')).toBeDefined();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      <SessionItem
        sessionId="s1"
        title="Clickable"
        lastActivity={Date.now()}
        isActive={false}
        storeApi={undefined}
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByText('Clickable'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows running indicator when isAiTyping is true', () => {
    const store = createSessionStore('s-typing', 'agent-1');
    store.getState().setAiTyping(true);

    const { container } = render(
      <SessionItem
        sessionId="s-typing"
        title="Typing Session"
        lastActivity={Date.now()}
        isActive={false}
        storeApi={store}
        onClick={() => {}}
      />,
    );

    const pingIndicator = container.querySelector('.animate-ping');
    expect(pingIndicator).toBeDefined();
  });

  it('does not show running indicator when idle', () => {
    const store = createSessionStore('s-idle', 'agent-1');

    const { container } = render(
      <SessionItem
        sessionId="s-idle"
        title="Idle Session"
        lastActivity={Date.now()}
        isActive={false}
        storeApi={store}
        onClick={() => {}}
      />,
    );

    const pingIndicator = container.querySelector('.animate-ping');
    expect(pingIndicator).toBeNull();
  });

  it('shows active styling when isActive', () => {
    const { container } = render(
      <SessionItem
        sessionId="s1"
        title="Active"
        lastActivity={Date.now()}
        isActive={true}
        storeApi={undefined}
        onClick={() => {}}
      />,
    );

    const button = container.querySelector('button');
    expect(button?.className).toContain('bg-blue-50');
  });

  it('shows relative time (just now)', () => {
    render(
      <SessionItem
        sessionId="s1"
        title="Recent"
        lastActivity={Date.now()}
        isActive={false}
        storeApi={undefined}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText('just now')).toBeDefined();
  });

  it('shows correct status badge for error', () => {
    const store = createSessionStore('s-err', 'agent-1');
    store.getState().setStatus('error');

    const { container } = render(
      <SessionItem
        sessionId="s-err"
        title="Error Session"
        lastActivity={Date.now()}
        isActive={false}
        storeApi={store}
        onClick={() => {}}
      />,
    );

    const dot = container.querySelector('.bg-red-500');
    expect(dot).toBeDefined();
  });
});
