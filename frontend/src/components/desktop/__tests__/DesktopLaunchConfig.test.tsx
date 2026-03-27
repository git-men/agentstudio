import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DesktopLaunchConfig } from '../DesktopLaunchConfig';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('../../../lib/environment', () => ({
  isTauri: () => true,
}));

// @ts-expect-error - test global
globalThis.__APP_VERSION__ = '1.0.0-test';

describe('DesktopLaunchConfig', () => {
  const onStarted = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_launch_config') {
        return Promise.resolve({ engine: 'claude-sdk' });
      }
      if (cmd === 'start_backend') {
        return Promise.resolve();
      }
      return Promise.resolve();
    });
  });

  it('renders the launch page with logo and engine options', async () => {
    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(screen.getByText('ClawStudio')).toBeTruthy();
      expect(screen.getByText('Execution Engine')).toBeTruthy();
      expect(screen.getByText('Launch')).toBeTruthy();
    });
  });

  it('displays all engine options including Claude Internal', async () => {
    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(screen.getByText('Claude Agent SDK')).toBeTruthy();
      expect(screen.getByText('Claude Internal')).toBeTruthy();
      expect(screen.getByText('CodeBuddy')).toBeTruthy();
      expect(screen.getByText('Codex CLI')).toBeTruthy();
      expect(screen.getByText('Codex SDK')).toBeTruthy();
      expect(screen.getByText('Cursor CLI')).toBeTruthy();
    });
  });

  it('loads saved config on mount', async () => {
    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('load_launch_config');
    });
  });

  it('allows selecting Claude Internal engine and launching', async () => {
    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(screen.getByText('Claude Internal')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Claude Internal'));
    fireEvent.click(screen.getByText('Launch'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start_backend', {
        engine: 'claude-internal-sdk',
      });
    });
  });

  it('allows changing engine selection and launches with it', async () => {
    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(screen.getByText('CodeBuddy')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('CodeBuddy'));
    fireEvent.click(screen.getByText('Launch'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start_backend', {
        engine: 'codebuddy-sdk',
      });
    });
  });

  it('does not show Advanced Options / SDK Variant section', async () => {
    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(screen.getByText('Launch')).toBeTruthy();
    });

    expect(screen.queryByText('Advanced Options')).toBeNull();
    expect(screen.queryByText('SDK Variant')).toBeNull();
  });

  it('calls onStarted after successful launch', async () => {
    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(screen.getByText('Launch')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Launch'));

    await waitFor(() => {
      expect(onStarted).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT call onStarted when start_backend fails', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_launch_config') {
        return Promise.resolve({ engine: 'claude-sdk' });
      }
      if (cmd === 'start_backend') {
        return Promise.reject(new Error('Backend is already running'));
      }
      return Promise.resolve();
    });

    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(screen.getByText('Launch')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Launch'));

    await waitFor(() => {
      expect(screen.getByText('Backend is already running')).toBeTruthy();
    });

    expect(onStarted).not.toHaveBeenCalled();
  });

  it('shows loading spinner while config is loading', () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_launch_config') {
        return new Promise(() => {});
      }
      return Promise.resolve();
    });

    const { container } = render(<DesktopLaunchConfig onStarted={onStarted} />);

    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.queryByText('Launch')).toBeNull();
  });

  it('shows starting state while backend is launching', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_launch_config') {
        return Promise.resolve({ engine: 'claude-sdk' });
      }
      if (cmd === 'start_backend') {
        return new Promise(() => {});
      }
      return Promise.resolve();
    });

    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(screen.getByText('Launch')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Launch'));

    await waitFor(() => {
      expect(screen.getByText('Starting...')).toBeTruthy();
    });
  });
});
