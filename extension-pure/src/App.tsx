import React, { useEffect, lazy, Suspense } from 'react';
import { startConsoleCapture } from '@/utils/consoleCapture';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Toaster } from '@/components/ui/toaster';
import { MobileProvider } from '@/contexts/MobileContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ConfirmProvider } from '@/hooks/useConfirm';

const LoginPage = lazy(() => import('@/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const ExtensionChatPage = lazy(() => import('./pages/ExtensionChatPage').then(m => ({ default: m.ExtensionChatPage })));

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

startConsoleCapture();

const AppContent: React.FC = () => {
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'auto';

    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (savedTheme === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      document.documentElement.classList.toggle('dark', mediaQuery.matches);

      const handleChange = (e: MediaQueryListEvent) => {
        if (localStorage.getItem('theme') === 'auto') {
          document.documentElement.classList.toggle('dark', e.matches);
        }
      };
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);

  return (
    <HashRouter>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/chat/:agentId" element={
            <ProtectedRoute>
              <ExtensionChatPage />
            </ProtectedRoute>
          } />
          <Route path="/" element={
            <ProtectedRoute>
              <ExtensionChatPage />
            </ProtectedRoute>
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
};

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MobileProvider>
          <ConfirmProvider>
            <AppContent />
            <Toaster />
          </ConfirmProvider>
        </MobileProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
