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

/**
 * Open a project workspace in a new Tauri window.
 * If a window for the same project already exists, focus it instead.
 *
 * Falls back to `window.open()` in non-Tauri environments.
 */
export async function openProjectWindow(
  projectPath: string,
  projectName?: string,
): Promise<void> {
  if (!isTauri()) {
    const params = new URLSearchParams();
    params.set('project', projectPath);
    const url = `/project-workspace?${params.toString()}`;
    const windowName = sanitizeLabel(projectPath);
    window.open(url, windowName);
    return;
  }

  const label = sanitizeLabel(projectPath);

  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');

    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }

    const params = new URLSearchParams();
    params.set('project', projectPath);
    const url = `/project-workspace?${params.toString()}`;

    new WebviewWindow(label, {
      url,
      title: projectName || projectPath.split('/').pop() || 'Project',
      width: 1280,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      center: true,
    });
  } catch (err) {
    console.error('Failed to open project window:', err);
    const params = new URLSearchParams();
    params.set('project', projectPath);
    window.location.href = `/project-workspace?${params.toString()}`;
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
