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
      if (cmd === 'check_domain_accessible') {
        return Promise.resolve(true);
      }
      if (cmd === 'start_backend') {
        return Promise.resolve();
      }
      if (cmd === 'check_cli_installed') {
        return Promise.resolve('/usr/local/bin/claude-internal');
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

  it('displays all engine options when domain is accessible', async () => {
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

  it('hides Claude Internal when domain is not accessible', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_launch_config') {
        return Promise.resolve({ engine: 'claude-sdk' });
      }
      if (cmd === 'check_domain_accessible') {
        return Promise.resolve(false);
      }
      return Promise.resolve();
    });

    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(screen.getByText('Claude Agent SDK')).toBeTruthy();
    });

    expect(screen.queryByText('Claude Internal')).toBeNull();
  });

  it('launches directly for engines without CLI requirement', async () => {
    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(screen.getByText('Launch')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Launch'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start_backend', {
        engine: 'claude-sdk',
      });
      expect(onStarted).toHaveBeenCalledTimes(1);
    });
  });

  it('shows setup wizard when selecting Claude Internal', async () => {
    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(screen.getByText('Claude Internal')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Claude Internal'));
    fireEvent.click(screen.getByText('Launch'));

    await waitFor(() => {
      expect(screen.getByText('Claude Internal Setup')).toBeTruthy();
    });
  });

  it('shows CLI path when installed and proceeds on Continue', async () => {
    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(screen.getByText('Claude Internal')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Claude Internal'));
    fireEvent.click(screen.getByText('Launch'));

    await waitFor(() => {
      expect(screen.getByText('/usr/local/bin/claude-internal')).toBeTruthy();
      expect(screen.getByText('Continue')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Continue'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('start_backend', {
        engine: 'claude-internal-sdk',
      });
    });
  });

  it('shows install option when CLI is not found', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_launch_config') {
        return Promise.resolve({ engine: 'claude-sdk' });
      }
      if (cmd === 'check_domain_accessible') {
        return Promise.resolve(true);
      }
      if (cmd === 'check_cli_installed') {
        return Promise.resolve(null);
      }
      return Promise.resolve();
    });

    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(screen.getByText('Claude Internal')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Claude Internal'));
    fireEvent.click(screen.getByText('Launch'));

    await waitFor(() => {
      expect(screen.getByText('is not installed')).toBeTruthy();
      expect(screen.getByText('Install Now')).toBeTruthy();
    });
  });

  it('does NOT call onStarted when start_backend fails', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_launch_config') {
        return Promise.resolve({ engine: 'claude-sdk' });
      }
      if (cmd === 'check_domain_accessible') {
        return Promise.resolve(true);
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
    mockInvoke.mockImplementation(() => new Promise(() => {}));

    const { container } = render(<DesktopLaunchConfig onStarted={onStarted} />);

    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.queryByText('Launch')).toBeNull();
  });

  it('dismisses setup wizard on Cancel', async () => {
    render(<DesktopLaunchConfig onStarted={onStarted} />);

    await waitFor(() => {
      expect(screen.getByText('Claude Internal')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Claude Internal'));
    fireEvent.click(screen.getByText('Launch'));

    await waitFor(() => {
      expect(screen.getByText('Claude Internal Setup')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(screen.queryByText('Claude Internal Setup')).toBeNull();
    });
  });
});
