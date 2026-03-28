import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BackendLogPanel } from '../BackendLogPanel';
import type { BackendLogEntry } from '../../../hooks/useBackendLogs';

describe('BackendLogPanel', () => {
  const mockBackendLogs: BackendLogEntry[] = [
    { level: 'stdout', message: 'Server starting...', timestamp: '2026-03-27T08:00:00.000Z', source: 'backend' },
    { level: 'stdout', message: 'BACKEND_PORT=4936', timestamp: '2026-03-27T08:00:01.000Z', source: 'backend' },
    { level: 'stderr', message: 'Warning: deprecated API', timestamp: '2026-03-27T08:00:02.000Z', source: 'backend' },
    { level: 'error', message: 'Connection refused', timestamp: '2026-03-27T08:00:03.000Z', source: 'backend' },
  ];

  const mockFrontendLogs: BackendLogEntry[] = [
    { level: 'log', message: 'App mounted', timestamp: '2026-03-27T08:00:00.000Z', source: 'frontend' },
    { level: 'warn', message: 'Deprecated hook usage', timestamp: '2026-03-27T08:00:01.000Z', source: 'frontend' },
  ];

  const defaultProps = {
    backendLogs: mockBackendLogs,
    frontendLogs: mockFrontendLogs,
    onClearBackend: vi.fn(),
    onClearFrontend: vi.fn(),
    onClose: vi.fn(),
  };

  function clickFilterButton(label: string) {
    const matches = screen.getAllByText(label);
    const btn = matches.find(el => el.tagName === 'BUTTON' && el.classList.contains('text-[10px]'));
    if (!btn) throw new Error(`Filter button "${label}" not found`);
    fireEvent.click(btn);
  }

  it('renders backend logs by default', () => {
    render(<BackendLogPanel {...defaultProps} />);

    expect(screen.getByText('Server starting...')).toBeTruthy();
    expect(screen.getByText('BACKEND_PORT=4936')).toBeTruthy();
  });

  it('shows entry count', () => {
    render(<BackendLogPanel {...defaultProps} />);

    expect(screen.getByText('4 entries')).toBeTruthy();
  });

  it('switches to frontend tab', () => {
    render(<BackendLogPanel {...defaultProps} />);

    fireEvent.click(screen.getByText('Frontend'));

    expect(screen.getByText('App mounted')).toBeTruthy();
    expect(screen.getByText('Deprecated hook usage')).toBeTruthy();
    expect(screen.getByText('2 entries')).toBeTruthy();
  });

  it('filters by log level', () => {
    render(<BackendLogPanel {...defaultProps} />);

    clickFilterButton('stderr');

    expect(screen.getByText('1 entries')).toBeTruthy();
    expect(screen.getByText('Warning: deprecated API')).toBeTruthy();
    expect(screen.queryByText('Server starting...')).toBeNull();
  });

  it('calls onClearBackend when clearing backend tab', () => {
    render(<BackendLogPanel {...defaultProps} />);

    fireEvent.click(screen.getByText('Clear'));

    expect(defaultProps.onClearBackend).toHaveBeenCalledTimes(1);
  });

  it('calls onClearFrontend when clearing frontend tab', () => {
    render(<BackendLogPanel {...defaultProps} />);

    fireEvent.click(screen.getByText('Frontend'));
    fireEvent.click(screen.getByText('Clear'));

    expect(defaultProps.onClearFrontend).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', () => {
    render(<BackendLogPanel {...defaultProps} />);

    const buttons = screen.getAllByRole('button');
    const closeButton = buttons[buttons.length - 1];
    fireEvent.click(closeButton);

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows empty state when no backend logs', () => {
    render(<BackendLogPanel {...defaultProps} backendLogs={[]} />);

    expect(screen.getByText('Waiting for backend logs...')).toBeTruthy();
  });

  it('shows empty state when no frontend logs', () => {
    render(<BackendLogPanel {...defaultProps} frontendLogs={[]} />);

    fireEvent.click(screen.getByText('Frontend'));

    expect(screen.getByText('No frontend logs captured')).toBeTruthy();
  });

  it('resets filter when switching tabs', () => {
    render(<BackendLogPanel {...defaultProps} />);

    clickFilterButton('stderr');
    expect(screen.getByText('1 entries')).toBeTruthy();

    fireEvent.click(screen.getByText('Frontend'));
    expect(screen.getByText('2 entries')).toBeTruthy();
  });
});
