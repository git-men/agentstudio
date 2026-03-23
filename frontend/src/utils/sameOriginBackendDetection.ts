/**
 * Same-origin backend detection utility
 * Detects if backend service is running on the same origin as the frontend
 * and automatically configures it for seamless startup
 */

import { setBackendOnboardingCompleted } from './onboardingStorage';
import {
  loadBackendServices,
  saveBackendServices,
  switchBackendService
} from './backendServiceStorage';

/**
 * Check if a backend service is available at the given URL
 */
async function testBackendHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000)
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Detect and auto-configure same-origin backend service
 * Returns true if same-origin backend was detected and configured
 */
export async function detectAndConfigureSameOriginBackend(): Promise<boolean> {
  // Get current origin (protocol + hostname + port)
  const currentOrigin = window.location.origin;

  // Skip detection if not on http/https
  if (!currentOrigin.startsWith('http://') && !currentOrigin.startsWith('https://')) {
    return false;
  }

  // Build candidate URLs to test
  const candidateUrls: string[] = [];
  
  // 1. Try current origin first (for production, where frontend and backend are on same port)
  candidateUrls.push(currentOrigin);

  // 2. For development: try common backend ports on the same host
  const currentUrl = new URL(currentOrigin);
  const currentHost = currentUrl.hostname;
  const currentProtocol = currentUrl.protocol;
  
  // Common development ports
  const commonPorts = ['4936', '4200', '3000'];
  for (const port of commonPorts) {
    // Skip if this is the current port
    if (port !== currentUrl.port) {
      candidateUrls.push(`${currentProtocol}//${currentHost}:${port}`);
    }
  }

  // Test each candidate URL
  let detectedUrl: string | null = null;
  for (const url of candidateUrls) {
    const isAvailable = await testBackendHealth(url);
    if (isAvailable) {
      detectedUrl = url;
      break;
    }
  }

  if (!detectedUrl) {
    return false;
  }

  // Backend is available - auto-configure it
  const isSameOrigin = detectedUrl === currentOrigin;
  console.log(`[QuickStart] Backend detected at: ${detectedUrl} (${isSameOrigin ? 'same-origin' : 'same-host'})`);

  // Load current backend services
  const state = loadBackendServices();

  // Check if service already exists at the detected URL
  const existingService = state.services.find(s => s.url === detectedUrl);

  if (existingService) {
    // Service exists, ensure it's selected
    if (state.currentServiceId !== existingService.id) {
      const newState = switchBackendService(state, existingService.id);
      saveBackendServices(newState);
    }
  } else {
    // Update the default service instead of creating a new one
    const defaultService = state.services.find(s => s.isDefault);
    if (defaultService) {
      const newState = {
        ...state,
        services: state.services.map(s =>
          s.id === defaultService.id
            ? { ...s, url: detectedUrl }
            : s
        ),
        currentServiceId: defaultService.id
      };
      saveBackendServices(newState);
    }
  }

  // Mark onboarding as completed (not skipped)
  setBackendOnboardingCompleted(false);

  console.log('[QuickStart] Backend auto-configured successfully');
  return true;
}

/**
 * Check if frontend and backend are on different origins
 * (different protocol, hostname, or port)
 */
export function isCrossOriginSetup(): boolean {
  const currentOrigin = window.location.origin;
  const state = loadBackendServices();
  const currentService = state.services.find(s => s.id === state.currentServiceId);

  if (!currentService) {
    return true; // No service configured = treat as cross-origin
  }

  // Parse backend service URL
  try {
    const serviceUrl = new URL(currentService.url);
    const serviceOrigin = serviceUrl.origin;
    return serviceOrigin !== currentOrigin;
  } catch (error) {
    return true; // Invalid URL = treat as cross-origin
  }
}
