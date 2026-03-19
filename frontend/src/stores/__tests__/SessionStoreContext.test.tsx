import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { createSessionStore } from '../createSessionStore';
import {
  SessionStoreProvider,
  useSessionStore,
  useSessionStoreOptional,
  useIsWorkspaceMode,
} from '../SessionStoreContext';

function ConsumerComponent({ selector }: { selector: (s: any) => any }) {
  const value = useSessionStore(selector);
  return <div data-testid="value">{JSON.stringify(value)}</div>;
}

function OptionalConsumerComponent({ selector }: { selector: (s: any) => any }) {
  const value = useSessionStoreOptional(selector);
  return <div data-testid="value">{JSON.stringify(value)}</div>;
}

function WorkspaceModeIndicator() {
  const isWorkspace = useIsWorkspaceMode();
  return <div data-testid="mode">{isWorkspace ? 'workspace' : 'legacy'}</div>;
}

describe('SessionStoreContext', () => {
  describe('useSessionStore', () => {
    it('throws error when used outside Provider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() =>
        render(<ConsumerComponent selector={(s) => s.sessionId} />),
      ).toThrow('useSessionStore must be used within a <SessionStoreProvider>');
      consoleSpy.mockRestore();
    });

    it('returns selected state slice from provided store', () => {
      const store = createSessionStore('session-1', 'agent-1');

      render(
        <SessionStoreProvider value={store}>
          <ConsumerComponent selector={(s) => s.sessionId} />
        </SessionStoreProvider>,
      );

      expect(screen.getByTestId('value').textContent).toBe('"session-1"');
    });

    it('returns complex state slices correctly', () => {
      const store = createSessionStore('s1', 'a1');
      store.getState().setAiTyping(true);

      render(
        <SessionStoreProvider value={store}>
          <ConsumerComponent selector={(s) => s.isAiTyping} />
        </SessionStoreProvider>,
      );

      expect(screen.getByTestId('value').textContent).toBe('true');
    });

    it('re-renders when selected value changes', () => {
      const store = createSessionStore('s1', 'a1');
      const renderSpy = vi.fn();

      function TrackedConsumer() {
        const status = useSessionStore((s) => s.status);
        renderSpy();
        return <div data-testid="status">{status}</div>;
      }

      render(
        <SessionStoreProvider value={store}>
          <TrackedConsumer />
        </SessionStoreProvider>,
      );

      expect(screen.getByTestId('status').textContent).toBe('idle');
      const initialRenders = renderSpy.mock.calls.length;

      act(() => {
        store.getState().setStatus('running');
      });

      expect(screen.getByTestId('status').textContent).toBe('running');
      expect(renderSpy.mock.calls.length).toBeGreaterThan(initialRenders);
    });

    it('does NOT re-render when unrelated state changes', () => {
      const store = createSessionStore('s1', 'a1');
      const renderSpy = vi.fn();

      function TrackedConsumer() {
        const title = useSessionStore((s) => s.title);
        renderSpy();
        return <div data-testid="title">{title ?? 'null'}</div>;
      }

      render(
        <SessionStoreProvider value={store}>
          <TrackedConsumer />
        </SessionStoreProvider>,
      );

      const renderCountBefore = renderSpy.mock.calls.length;

      act(() => {
        store.getState().setAiTyping(true);
      });

      expect(renderSpy.mock.calls.length).toBe(renderCountBefore);
    });

    it('switching Provider value re-renders with new store state', () => {
      const storeA = createSessionStore('session-a', 'agent-1');
      const storeB = createSessionStore('session-b', 'agent-1');
      storeA.getState().setTitle('Store A Title');
      storeB.getState().setTitle('Store B Title');

      function Wrapper({ activeStore }: { activeStore: any }) {
        return (
          <SessionStoreProvider value={activeStore}>
            <ConsumerComponent selector={(s) => s.title} />
          </SessionStoreProvider>
        );
      }

      const { rerender } = render(<Wrapper activeStore={storeA} />);
      expect(screen.getByTestId('value').textContent).toBe('"Store A Title"');

      rerender(<Wrapper activeStore={storeB} />);
      expect(screen.getByTestId('value').textContent).toBe('"Store B Title"');
    });
  });

  describe('useSessionStoreOptional', () => {
    it('returns fallback value when outside Provider', () => {
      render(
        <OptionalConsumerComponent selector={(s) => s.sessionId} />,
      );
      expect(screen.getByTestId('value').textContent).toBe('"__fallback__"');
    });

    it('returns provided store value when inside Provider', () => {
      const store = createSessionStore('real-session', 'agent-1');

      render(
        <SessionStoreProvider value={store}>
          <OptionalConsumerComponent selector={(s) => s.sessionId} />
        </SessionStoreProvider>,
      );

      expect(screen.getByTestId('value').textContent).toBe('"real-session"');
    });
  });

  describe('useIsWorkspaceMode', () => {
    it('returns false outside Provider', () => {
      render(<WorkspaceModeIndicator />);
      expect(screen.getByTestId('mode').textContent).toBe('legacy');
    });

    it('returns true inside Provider', () => {
      const store = createSessionStore('s1', 'a1');
      render(
        <SessionStoreProvider value={store}>
          <WorkspaceModeIndicator />
        </SessionStoreProvider>,
      );
      expect(screen.getByTestId('mode').textContent).toBe('workspace');
    });
  });
});
