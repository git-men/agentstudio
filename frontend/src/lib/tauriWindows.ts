/**
 * Tauri multi-window management for project workspaces.
 *
 * Each project gets its own native window. If the window already exists,
 * it is focused instead of creating a duplicate.
 */

import { isTauri } from './environment';

function sanitizeLabel(projectPath: string): string {
  return `project_${projectPath.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50)}`;
}

export interface OpenProjectOptions {
  projectPath: string;
  projectName?: string;
  agentId?: string;
  sessionId?: string;
}

/**
 * Open a project workspace in a new Tauri window.
 * If a window for the same project already exists, focus it instead.
 *
 * Falls back to `window.open()` in non-Tauri environments.
 */
export async function openProjectWindow(
  projectPathOrOpts: string | OpenProjectOptions,
  projectName?: string,
): Promise<void> {
  const opts: OpenProjectOptions = typeof projectPathOrOpts === 'string'
    ? { projectPath: projectPathOrOpts, projectName }
    : projectPathOrOpts;

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    params.set('project', opts.projectPath);
    if (opts.agentId) params.set('agent', opts.agentId);
    if (opts.sessionId) params.set('session', opts.sessionId);
    return params;
  }

  if (!isTauri()) {
    const url = `/project-workspace?${buildParams().toString()}`;
    const windowName = sanitizeLabel(opts.projectPath);
    window.open(url, windowName);
    return;
  }

  const label = sanitizeLabel(opts.projectPath);

  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');

    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }

    const url = `/project-workspace?${buildParams().toString()}`;

    new WebviewWindow(label, {
      url,
      title: opts.projectName || opts.projectPath.split('/').pop() || 'Project',
      width: 1280,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      center: true,
    });
  } catch (err) {
    console.error('Failed to open project window:', err);
    window.location.href = `/project-workspace?${buildParams().toString()}`;
  }
}

/**
 * Close the current Tauri window. Falls back to window.close() in
 * non-Tauri environments, or navigates to dashboard if close fails.
 */
export async function closeCurrentWindow(): Promise<void> {
  if (!isTauri()) {
    window.close();
    return;
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const label = win.label;

    if (label === 'main') {
      window.location.href = '/dashboard';
    } else {
      await win.close();
    }
  } catch {
    window.location.href = '/dashboard';
  }
}
