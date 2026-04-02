import { API_BASE } from './config';
import { authFetch } from './authFetch';
import { isTauri } from './environment';

interface SaveToProjectOptions {
  fileName: string;
  projectPath: string;
  content?: string;
  blobContent?: Blob;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Save a file to the project directory via the backend write API.
 * Used in Tauri/Desktop mode to bypass the browser's default download behavior.
 *
 * Returns true if saved successfully, false otherwise.
 */
export async function saveFileToProject(options: SaveToProjectOptions): Promise<boolean> {
  const { fileName, projectPath, content, blobContent } = options;

  try {
    let body: { path: string; content: string; encoding?: string };

    if (blobContent) {
      const base64 = await blobToBase64(blobContent);
      body = { path: fileName, content: base64, encoding: 'base64' };
    } else if (content !== undefined) {
      body = { path: fileName, content };
    } else {
      return false;
    }

    const resp = await authFetch(
      `${API_BASE}/files/write?projectPath=${encodeURIComponent(projectPath)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    return resp.ok;
  } catch (e) {
    console.error('Failed to save file to project:', e);
    return false;
  }
}

/**
 * Download a file: saves to project directory if projectPath is available,
 * otherwise falls back to browser default download.
 */
export async function downloadFile(options: {
  fileName: string;
  projectPath?: string;
  content?: string;
  blob?: Blob;
  url?: string;
}): Promise<{ saved: boolean; toProject: boolean }> {
  const { fileName, projectPath, content, blob, url } = options;

  if (projectPath && isTauri()) {
    let blobContent = blob;

    if (!blobContent && !content && url) {
      try {
        const resp = await fetch(url);
        blobContent = await resp.blob();
      } catch {
        return browserDownload({ fileName, content, blob, url });
      }
    }

    const ok = await saveFileToProject({
      fileName,
      projectPath,
      content,
      blobContent,
    });

    if (ok) return { saved: true, toProject: true };
  }

  return browserDownload({ fileName, content, blob, url });
}

function browserDownload(options: {
  fileName: string;
  content?: string;
  blob?: Blob;
  url?: string;
}): { saved: boolean; toProject: boolean } {
  const { fileName, content, blob, url } = options;
  const link = document.createElement('a');

  if (blob) {
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  } else if (content) {
    const b = new Blob([content], { type: 'application/octet-stream' });
    link.href = URL.createObjectURL(b);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  } else if (url) {
    link.href = url;
    link.download = fileName;
    link.click();
  }

  return { saved: true, toProject: false };
}
