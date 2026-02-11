import { BackendService, BackendServicesState, DEFAULT_SERVICES } from '../types/backendServices';

const STORAGE_KEY = 'backendServices';

/**
 * Normalize a service URL by removing trailing slashes.
 * This prevents double-slash issues when constructing API URLs like `${url}/api/health`.
 */
export const normalizeServiceUrl = (url: string): string => {
  return url.replace(/\/+$/, '');
};

export const loadBackendServices = (): BackendServicesState => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Ensure we always have at least the default service
      if (!parsed.services || parsed.services.length === 0) {
        return {
          services: DEFAULT_SERVICES,
          currentServiceId: DEFAULT_SERVICES[0].id
        };
      }
      // Normalize URLs on load to fix any previously stored trailing slashes
      return {
        ...parsed,
        services: parsed.services.map((s: BackendService) => ({
          ...s,
          url: normalizeServiceUrl(s.url)
        }))
      };
    }
  } catch (error) {
    console.error('Failed to load backend services:', error);
  }

  // Return default state if nothing is stored
  return {
    services: DEFAULT_SERVICES,
    currentServiceId: DEFAULT_SERVICES[0].id
  };
};

export const saveBackendServices = (state: BackendServicesState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save backend services:', error);
  }
};

export const getCurrentService = (state: BackendServicesState): BackendService | null => {
  return state.services.find(service => service.id === state.currentServiceId) || null;
};

export const addBackendService = (state: BackendServicesState, service: Omit<BackendService, 'id'>): BackendServicesState => {
  const newService: BackendService = {
    ...service,
    url: normalizeServiceUrl(service.url),
    id: Date.now().toString()
  };

  const newState = {
    ...state,
    services: [...state.services, newService]
  };

  saveBackendServices(newState);
  return newState;
};

export const updateBackendService = (state: BackendServicesState, serviceId: string, updates: Partial<BackendService>): BackendServicesState => {
  const normalizedUpdates = updates.url ? { ...updates, url: normalizeServiceUrl(updates.url) } : updates;
  const newState = {
    ...state,
    services: state.services.map(service =>
      service.id === serviceId ? { ...service, ...normalizedUpdates } : service
    )
  };

  saveBackendServices(newState);
  return newState;
};

export const removeBackendService = (state: BackendServicesState, serviceId: string): BackendServicesState => {
  // Cannot remove the default service
  const serviceToRemove = state.services.find(s => s.id === serviceId);
  if (serviceToRemove?.isDefault) {
    return state;
  }

  const newState = {
    ...state,
    services: state.services.filter(service => service.id !== serviceId),
    currentServiceId: state.currentServiceId === serviceId ?
      (state.services.find(s => s.id !== serviceId)?.id || null) : state.currentServiceId
  };

  saveBackendServices(newState);
  return newState;
};

export const switchBackendService = (state: BackendServicesState, serviceId: string): BackendServicesState => {
  const service = state.services.find(s => s.id === serviceId);
  if (!service) {
    return state;
  }

  const newState = {
    ...state,
    currentServiceId: serviceId
  };

  saveBackendServices(newState);
  return newState;
};