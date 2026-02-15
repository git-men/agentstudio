import { ReactNode, useEffect, useState, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAuthStore } from '../stores/authStore';
import { useBackendServices } from '../hooks/useBackendServices';
import { BackendOnboardingWizard } from './BackendOnboardingWizard';
import { getBackendOnboardingStatus } from '../utils/onboardingStorage';
import { isTokenExpired, shouldRefreshToken } from '../utils/authHelpers';
import { detectAndConfigureSameOriginBackend } from '../utils/sameOriginBackendDetection';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, verifyToken } = useAuth();
  const { getToken } = useAuthStore();
  const { currentService } = useBackendServices();
  const location = useLocation();
  const [isVerifying, setIsVerifying] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [showBackendOnboarding, setShowBackendOnboarding] = useState(false);
  const [isDetectingSameOrigin, setIsDetectingSameOrigin] = useState(false);
  const lastServiceId = useRef<string | null>(null);
  const lastVerifyTime = useRef<number>(0);

  // Quick Start: Auto-detect same-origin backend before showing onboarding wizard
  useEffect(() => {
    const quickStart = async () => {
      // Check if onboarding is already completed
      const status = getBackendOnboardingStatus();
      if (status.completed) {
        setIsVerifying(true);
        return;
      }

      // Try to detect and configure same-origin backend
      setIsDetectingSameOrigin(true);
      const sameOriginDetected = await detectAndConfigureSameOriginBackend();
      setIsDetectingSameOrigin(false);

      if (sameOriginDetected) {
        // Same-origin backend detected and configured
        // Reload to apply new service configuration and proceed with auto-login
        console.log('[QuickStart] Reloading to apply same-origin backend configuration');
        window.location.reload();
      } else {
        // No same-origin backend found - show onboarding wizard
        setShowBackendOnboarding(true);
        setIsVerifying(false);
      }
    };

    quickStart();
  }, []);

  useEffect(() => {
    const verify = async () => {
      // Skip verification if showing backend onboarding
      if (showBackendOnboarding) {
        return;
      }

      const currentServiceId = currentService?.id || null;
      const currentToken = currentServiceId ? getToken(currentServiceId) : null;

      // Skip verification if no token
      if (!currentToken) {
        setIsValid(false);
        setIsVerifying(false);
        return;
      }

      // Check if token is expired locally first
      if (isTokenExpired(currentToken)) {
        setIsValid(false);
        setIsVerifying(false);
        return;
      }

      // Only verify if:
      // 1. Service has changed
      // 2. Initial load (lastVerifyTime is 0)
      // 3. Token should be refreshed
      // 4. Last verification was more than 5 minutes ago
      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;
      const shouldVerify =
        currentServiceId !== lastServiceId.current ||
        lastVerifyTime.current === 0 ||
        shouldRefreshToken(currentToken) ||
        lastVerifyTime.current < fiveMinutesAgo;

      if (!shouldVerify && !isVerifying) {
        // Token is still valid based on our local check
        setIsValid(true);
        return;
      }

      setIsVerifying(true);
      lastServiceId.current = currentServiceId;
      lastVerifyTime.current = now;

      if (isAuthenticated) {
        const valid = await verifyToken();
        setIsValid(valid);
      } else {
        setIsValid(false);
      }
      setIsVerifying(false);
    };

    verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentService?.id, showBackendOnboarding, isAuthenticated]); // Add isAuthenticated to dependency array

  // Handle backend onboarding completion
  const handleBackendOnboardingComplete = () => {
    setShowBackendOnboarding(false);
    setIsVerifying(true); // Start verifying login after onboarding
  };

  // Show loading state while detecting same-origin backend
  if (isDetectingSameOrigin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">🚀 Quick Start...</p>
        </div>
      </div>
    );
  }

  // Show backend onboarding wizard if needed (highest priority)
  if (showBackendOnboarding) {
    return <BackendOnboardingWizard onComplete={handleBackendOnboardingComplete} />;
  }

  // Show loading state while verifying token
  if (isVerifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Verifying...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated or token is invalid
  if (!isAuthenticated || !isValid) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
