/**
 * Unit tests for UpdateDialog component.
 *
 * Tests:
 *  1. Renders version number and release notes correctly
 *  2. "立即更新" button triggers invoke('install_update')
 *  3. "稍后提醒" button calls onDismiss to close the dialog
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UpdateDialog } from '../UpdateDialog';

// Mock @tauri-apps/api/core
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

describe('UpdateDialog', () => {
  const defaultProps = {
    version: '1.2.3',
    notes: 'Bug fixes and performance improvements.',
    onDismiss: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays version number and release notes', () => {
    render(<UpdateDialog {...defaultProps} />);

    expect(screen.getByText('发现新版本')).toBeTruthy();
    expect(screen.getByText('v1.2.3')).toBeTruthy();
    expect(screen.getByText('Bug fixes and performance improvements.')).toBeTruthy();
  });

  it('"立即更新" button triggers invoke("install_update")', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    render(<UpdateDialog {...defaultProps} />);

    const installButton = screen.getByText('立即更新');
    fireEvent.click(installButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('install_update');
    });
  });

  it('shows loading state while downloading', async () => {
    // Never resolves so we can check the loading state
    mockInvoke.mockReturnValue(new Promise(() => {}));

    render(<UpdateDialog {...defaultProps} />);

    const installButton = screen.getByText('立即更新');
    fireEvent.click(installButton);

    await waitFor(() => {
      expect(screen.getByText('正在下载...')).toBeTruthy();
    });
  });

  it('shows error state and retry option on install failure', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Network error'));

    render(<UpdateDialog {...defaultProps} />);

    const installButton = screen.getByText('立即更新');
    fireEvent.click(installButton);

    await waitFor(() => {
      expect(screen.getByText('下载失败')).toBeTruthy();
      expect(screen.getByText('重试')).toBeTruthy();
    });
  });

  it('"稍后提醒" button calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(<UpdateDialog {...defaultProps} onDismiss={onDismiss} />);

    const dismissButton = screen.getByText('稍后提醒');
    fireEvent.click(dismissButton);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('renders nothing when notes are empty', () => {
    render(<UpdateDialog {...defaultProps} notes="" />);

    // Dialog still shows, notes section should not render
    expect(screen.getByText('发现新版本')).toBeTruthy();
    // The notes container should not be present
    const notesArea = screen.queryByText('Bug fixes');
    expect(notesArea).toBeNull();
  });
});
