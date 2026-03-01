import type { NavigateFunction } from 'react-router-dom';

export const isExtensionEnvironment = (): boolean => {
  if (typeof window === 'undefined') return false;
  const protocol = window.location.protocol;
  return (
    protocol === 'chrome-extension:' ||
    protocol === 'moz-extension:' ||
    protocol === 'edge-extension:'
  );
};

export const openUrlInContext = (url: string, navigate?: NavigateFunction): void => {
  if (isExtensionEnvironment()) {
    if (navigate) {
      navigate(url);
    } else {
      window.location.href = url;
    }
    return;
  }

  window.open(url, '_blank');
};
