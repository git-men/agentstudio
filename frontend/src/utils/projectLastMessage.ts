import { API_BASE } from '../lib/config';
import { authFetch } from '../lib/authFetch';

/**
 * Fetch latest session titles per project from the server.
 * Returns a map of projectPath → last session title.
 */
export async function fetchProjectActivity(
  projectPaths: string[]
): Promise<Record<string, string | null>> {
  if (projectPaths.length === 0) return {};
  try {
    const params = new URLSearchParams();
    params.set('paths', projectPaths.join(','));
    const response = await authFetch(`${API_BASE}/projects/activity?${params.toString()}`);
    if (!response.ok) return {};
    const data = await response.json();
    return data.activity || {};
  } catch {
    return {};
  }
}
