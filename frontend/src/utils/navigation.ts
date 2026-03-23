import type { NavigateFunction } from 'react-router-dom';
import { isTauri } from '../lib/environment';

export const isExtensionEnvironment = (): boolean => {
  if (typeof window === 'undefined') return false;
  const protocol = window.location.protocol;
  return (
    protocol === 'chrome-extension:' ||
    protocol === 'moz-extension:' ||
    protocol === 'edge-extension:'
  );
};

function isExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin !== window.location.origin;
  } catch {
    return false;
  }
}

export const openUrlInContext = (url: string, navigate?: NavigateFunction): void => {
  if (isExtensionEnvironment()) {
    if (navigate) {
      navigate(url);
    } else {
      window.location.href = url;
    }
    return;
  }

  if (isTauri()) {
    if (isExternalUrl(url)) {
      import('@tauri-apps/plugin-shell').then(({ open }) => open(url)).catch(() => {
        window.open(url, '_blank');
      });
    } else if (navigate) {
      navigate(url);
    } else {
      window.location.href = url;
    }
    return;
  }

  window.open(url, '_blank');
};

export const openExternalUrl = (url: string): void => {
  if (isTauri()) {
    import('@tauri-apps/plugin-shell').then(({ open }) => open(url)).catch(() => {
      window.open(url, '_blank');
    });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};
