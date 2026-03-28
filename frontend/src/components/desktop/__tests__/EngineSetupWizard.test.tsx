import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EngineSetupWizard } from '../EngineSetupWizard';
import type { EngineOption } from '../../../hooks/useLaunchConfig';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const claudeInternalEngine: EngineOption = {
  value: 'claude-internal-sdk',
  label: 'Claude Internal',
  description: 'Claude Internal SDK (~/.claude-internal)',
  cliName: 'claude-internal',
  npmPackage: '@tencent/claude-code-internal',
  internalOnly: true,
  internalDomain: 'agentstudio.woa.com',
};

const cursorEngine: EngineOption = {
  value: 'cursor-cli',
  label: 'Cursor CLI',
  description: 'Cursor Agent CLI',
  cliName: 'agent',
  installCmd: 'curl https://cursor.com/install -fsS | bash',
};

const codexEngine: EngineOption = {
  value: 'codex-cli',
  label: 'Codex CLI',
  description: 'OpenAI Codex CLI',
  cliName: 'codex',
  npmPackage: '@openai/codex',
};

describe('EngineSetupWizard', () => {
  const onReady = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows checking state initially', () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}));

    render(
      <EngineSetupWizard engine={claudeInternalEngine} onReady={onReady} onCancel={onCancel} />,
    );

    expect(screen.getByText(/Checking if/)).toBeTruthy();
    expect(screen.getByText('claude-internal')).toBeTruthy();
  });

  it('shows ready state when CLI is found', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_cli_installed') {
        return Promise.resolve('/usr/local/bin/claude-internal');
      }
      return Promise.resolve();
    });

    render(
      <EngineSetupWizard engine={claudeInternalEngine} onReady={onReady} onCancel={onCancel} />,
    );

    await waitFor(() => {
      expect(screen.getByText('is ready')).toBeTruthy();
      expect(screen.getByText('/usr/local/bin/claude-internal')).toBeTruthy();
      expect(screen.getByText('Continue')).toBeTruthy();
    });
  });

  it('calls onReady with path when Continue is clicked', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_cli_installed') {
        return Promise.resolve('/usr/local/bin/claude-internal');
      }
      return Promise.resolve();
    });

    render(
      <EngineSetupWizard engine={claudeInternalEngine} onReady={onReady} onCancel={onCancel} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Continue')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Continue'));
    expect(onReady).toHaveBeenCalledWith('/usr/local/bin/claude-internal');
  });

  it('shows not_installed state when CLI is not found', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_cli_installed') {
        return Promise.resolve(null);
      }
      return Promise.resolve();
    });

    render(
      <EngineSetupWizard engine={claudeInternalEngine} onReady={onReady} onCancel={onCancel} />,
    );

    await waitFor(() => {
      expect(screen.getByText('is not installed')).toBeTruthy();
      expect(screen.getByText('Install Now')).toBeTruthy();
    });
  });

  it('shows npm install command for npm-based engines', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_cli_installed') return Promise.resolve(null);
      return Promise.resolve();
    });

    render(
      <EngineSetupWizard engine={claudeInternalEngine} onReady={onReady} onCancel={onCancel} />,
    );

    await waitFor(() => {
      expect(screen.getByText('npm install -g @tencent/claude-code-internal')).toBeTruthy();
    });
  });

  it('shows shell command for cursor CLI engine', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_cli_installed') return Promise.resolve(null);
      return Promise.resolve();
    });

    render(
      <EngineSetupWizard engine={cursorEngine} onReady={onReady} onCancel={onCancel} />,
    );

    await waitFor(() => {
      expect(screen.getByText('curl https://cursor.com/install -fsS | bash')).toBeTruthy();
    });
  });

  it('uses install_npm_package for npm-based engines', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_cli_installed') return Promise.resolve(null);
      if (cmd === 'install_npm_package') {
        return Promise.resolve('Installed successfully');
      }
      return Promise.resolve();
    });

    render(
      <EngineSetupWizard engine={codexEngine} onReady={onReady} onCancel={onCancel} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Install Now')).toBeTruthy();
    });

    // After first check, update mock so second check finds the CLI
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_cli_installed') return Promise.resolve('/usr/local/bin/codex');
      if (cmd === 'install_npm_package') return Promise.resolve('Done');
      return Promise.resolve();
    });

    fireEvent.click(screen.getByText('Install Now'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('install_npm_package', {
        packageName: '@openai/codex',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('is ready')).toBeTruthy();
    });
  });

  it('uses run_shell_command for installCmd-based engines', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_cli_installed') return Promise.resolve(null);
      if (cmd === 'run_shell_command') {
        return Promise.resolve('Installed');
      }
      return Promise.resolve();
    });

    render(
      <EngineSetupWizard engine={cursorEngine} onReady={onReady} onCancel={onCancel} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Install Now')).toBeTruthy();
    });

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_cli_installed') return Promise.resolve('/usr/local/bin/agent');
      if (cmd === 'run_shell_command') return Promise.resolve('OK');
      return Promise.resolve();
    });

    fireEvent.click(screen.getByText('Install Now'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('run_shell_command', {
        command: 'curl https://cursor.com/install -fsS | bash',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('is ready')).toBeTruthy();
    });
  });

  it('shows install_failed state with Retry button on failure', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_cli_installed') return Promise.resolve(null);
      if (cmd === 'install_npm_package') {
        return Promise.reject(new Error('Permission denied'));
      }
      return Promise.resolve();
    });

    render(
      <EngineSetupWizard engine={codexEngine} onReady={onReady} onCancel={onCancel} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Install Now')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Install Now'));

    await waitFor(() => {
      expect(screen.getByText('Installation failed')).toBeTruthy();
      expect(screen.getByText('Permission denied')).toBeTruthy();
      expect(screen.getByText('Retry')).toBeTruthy();
    });
  });

  it('shows install_failed when CLI not found after install succeeds', async () => {
    let callCount = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_cli_installed') {
        callCount++;
        return Promise.resolve(null);
      }
      if (cmd === 'install_npm_package') {
        return Promise.resolve('Installed');
      }
      return Promise.resolve();
    });

    render(
      <EngineSetupWizard engine={codexEngine} onReady={onReady} onCancel={onCancel} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Install Now')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Install Now'));

    await waitFor(() => {
      expect(screen.getByText('Installation failed')).toBeTruthy();
      expect(screen.getByText(/CLI not found in PATH/)).toBeTruthy();
    });
  });

  it('calls onCancel when Cancel button is clicked', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_cli_installed') return Promise.resolve(null);
      return Promise.resolve();
    });

    render(
      <EngineSetupWizard engine={codexEngine} onReady={onReady} onCancel={onCancel} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('displays correct engine name in header', async () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}));

    render(
      <EngineSetupWizard engine={codexEngine} onReady={onReady} onCancel={onCancel} />,
    );

    expect(screen.getByText('Codex CLI Setup')).toBeTruthy();
  });

  it('shows installing state during installation', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_cli_installed') return Promise.resolve(null);
      if (cmd === 'install_npm_package') return new Promise(() => {});
      return Promise.resolve();
    });

    render(
      <EngineSetupWizard engine={codexEngine} onReady={onReady} onCancel={onCancel} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Install Now')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Install Now'));

    await waitFor(() => {
      expect(screen.getByText(/Installing/)).toBeTruthy();
      expect(screen.getByText(/This may take a minute/)).toBeTruthy();
    });
  });
});
