export interface BackendService {
  id: string;
  name: string;
  url: string;
  isDefault?: boolean;
}

export interface BackendServicesState {
  services: BackendService[];
  currentServiceId: string | null;
}

/**
 * Returns the sensible default backend URL for the current environment:
 * - Browser: window.location.origin (works for Docker / production / any host)
 * - Non-browser (tests, SSR): falls back to localhost:4936
 */
function getDefaultServiceUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://127.0.0.1:4936';
}

export function getDefaultServices(): BackendService[] {
  return [
    {
      id: 'default',
      name: 'Default',
      url: getDefaultServiceUrl(),
      isDefault: true
    }
  ];
}