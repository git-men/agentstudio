import React, { useEffect, useState, lazy, Suspense } from 'react';
import { startConsoleCapture } from './utils/consoleCapture';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { PageGate } from './components/ProductGate';
import { Toaster } from './components/ui/toaster';
import { MobileProvider } from './contexts/MobileContext';
import { TelemetryProvider } from './components/TelemetryProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfirmProvider } from './hooks/useConfirm';
import { isExtensionEnvironment } from './utils/navigation';
import { isTauri } from './lib/environment';
import { useBackendReady } from './hooks/useBackendReady';
import { useUpdateChecker } from './hooks/useUpdateChecker';
import { UpdateDialog } from './components/desktop/UpdateDialog';
import { DesktopLaunchConfig } from './components/desktop/DesktopLaunchConfig';
import { BackendLogPanel } from './components/desktop/BackendLogPanel';
import { useBackendLogs } from './hooks/useBackendLogs';

// External redirect component for non-React routes
const ExternalRedirect: React.FC<{ url: string }> = ({ url }) => {
  useEffect(() => {
    window.location.href = url;
  }, [url]);
  return <div className="flex items-center justify-center h-screen">Redirecting...</div>;
};

// 懒加载页面组件
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(module => ({ default: module.DashboardPage })));
const NewDashboard = lazy(() => import('./pages/NewDashboard').then(module => ({ default: module.NewDashboard })));
const AgentsPage = lazy(() => import('./pages/AgentsPage').then(module => ({ default: module.AgentsPage })));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage').then(module => ({ default: module.ProjectsPage })));
const McpPage = lazy(() => import('./pages/McpPage').then(module => ({ default: module.McpPage })));
const IMChannelsPage = lazy(() => import('./pages/IMChannelsPage').then(module => ({ default: module.IMChannelsPage })));
const WecomBindPage = lazy(() => import('./pages/WecomBindPage').then(module => ({ default: module.WecomBindPage })));
const QQBotBindPage = lazy(() => import('./pages/QQBotBindPage').then(module => ({ default: module.QQBotBindPage })));
const WechatBindPage = lazy(() => import('./pages/WechatBindPage').then(module => ({ default: module.WechatBindPage })));
const SettingsLayout = lazy(() => import('./components/SettingsLayout').then(module => ({ default: module.SettingsLayout })));
const GeneralSettingsPage = lazy(() => import('./pages/settings/GeneralSettingsPage').then(module => ({ default: module.GeneralSettingsPage })));
const SupplierSettingsPage = lazy(() => import('./pages/settings/VersionSettingsPage').then(module => ({ default: module.VersionSettingsPage })));
const MemorySettingsPage = lazy(() => import('./pages/settings/MemorySettingsPage').then(module => ({ default: module.MemorySettingsPage })));
const SubagentsPage = lazy(() => import('./pages/settings/SubagentsPage').then(module => ({ default: module.SubagentsPage })));
const McpAdminSettingsPage = lazy(() => import('./pages/settings/McpAdminSettingsPage').then(module => ({ default: module.McpAdminSettingsPage })));
const TelemetrySettingsPage = lazy(() => import('./pages/settings/TelemetrySettingsPage').then(module => ({ default: module.TelemetrySettingsPage })));
const SystemInfoPage = lazy(() => import('./pages/settings/SystemInfoPage').then(module => ({ default: module.SystemInfoPage })));
const WebSocketTunnelPage = lazy(() => import('./pages/settings/WebSocketTunnelPage').then(module => ({ default: module.WebSocketTunnelPage })));
const VoiceSettingsPage = lazy(() => import('./pages/settings/VoiceSettingsPage').then(module => ({ default: module.VoiceSettingsPage })));
const CursorConfigPage = lazy(() => import('./pages/settings/CursorConfigPage').then(module => ({ default: module.CursorConfigPage })));
const RulesPage = lazy(() => import('./pages/RulesPage').then(module => ({ default: module.RulesPage })));
const HooksPage = lazy(() => import('./pages/HooksPage').then(module => ({ default: module.HooksPage })));
const CommandsPage = lazy(() => import('./pages/CommandsPage').then(module => ({ default: module.CommandsPage })));
const SkillsPage = lazy(() => import('./pages/SkillsPage').then(module => ({ default: module.SkillsPage })));
const PluginsPage = lazy(() => import('./pages/PluginsPage').then(module => ({ default: module.PluginsPage })));
const ScheduledTasksPage = lazy(() => import('./pages/ScheduledTasksPage').then(module => ({ default: module.ScheduledTasksPage })));
const ChatPage = lazy(() => import('./pages/ChatPage').then(module => ({ default: module.ChatPage })));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage').then(module => ({ default: module.WorkspacePage })));
const ProjectWorkspacePage = lazy(() => import('./pages/ProjectWorkspacePage').then(module => ({ default: module.ProjectWorkspacePage })));
const ModelsPage = lazy(() => import('./pages/ModelsPage').then(module => ({ default: module.default })));
const LandingPage = lazy(() => import('./pages/LandingPage').then(module => ({ default: module.default })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(module => ({ default: module.LoginPage })));
const ToastTestPage = lazy(() => import('./pages/ToastTestPage').then(module => ({ default: module.ToastTestPage })));

// 加载中组件
const LoadingFallback = () => (
  <div className="flex items-center justify-center h-64">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
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
  // Initialize theme on app startup
  useEffect(() => {
    const applyTheme = () => {
      const savedTheme = localStorage.getItem('theme') || 'auto';

      if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else if (savedTheme === 'light') {
        document.documentElement.classList.remove('dark');
      } else {
        // Auto theme - follow system preference
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        if (mediaQuery.matches) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }

        // Listen for system theme changes
        const handleChange = (e: MediaQueryListEvent) => {
          if (localStorage.getItem('theme') === 'auto') {
            if (e.matches) {
              document.documentElement.classList.add('dark');
            } else {
              document.documentElement.classList.remove('dark');
            }
          }
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
      }
    };

    applyTheme();
  }, []);

  const isExtension = isExtensionEnvironment();
  const RouterComponent = isExtension ? HashRouter : BrowserRouter;
  const routerProps = isExtension ? {} : { basename: import.meta.env.BASE_URL };

  return (
    <RouterComponent {...routerProps}>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/intro" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />

          {/* Protected routes */}
          <Route path="/chat/:agentId" element={
            <ProtectedRoute>
              <ChatPage />
            </ProtectedRoute>
          } />

          <Route path="/workspace/:agentId" element={
            <ProtectedRoute>
              <WorkspacePage />
            </ProtectedRoute>
          } />

          <Route path="/project-workspace" element={
            <ProtectedRoute>
              <ProjectWorkspacePage />
            </ProtectedRoute>
          } />

          {/* Admin pages with layout (protected + product gated) */}
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <PageGate module="manage.dashboard">
                <Layout><DashboardPage /></Layout>
              </PageGate>
            </ProtectedRoute>
          } />
          {/* [WIP] New Dashboard — for testing, will replace /dashboard once confirmed */}
          <Route path="/dashboard-new" element={
            <ProtectedRoute>
              <Layout><NewDashboard /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/agents" element={
            <ProtectedRoute>
              <PageGate module="manage.agents">
                <Layout><AgentsPage /></Layout>
              </PageGate>
            </ProtectedRoute>
          } />
          <Route path="/projects" element={
            <ProtectedRoute>
              <PageGate module="manage.projects">
                <Layout><ProjectsPage /></Layout>
              </PageGate>
            </ProtectedRoute>
          } />
          <Route path="/mcp" element={
            <ProtectedRoute>
              <PageGate module="manage.mcp">
                <Layout><McpPage /></Layout>
              </PageGate>
            </ProtectedRoute>
          } />
          <Route path="/im-channels" element={
            <ProtectedRoute>
              <Layout><IMChannelsPage /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/wecom-bind" element={
            <ProtectedRoute>
              <Layout><WecomBindPage /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/qqbot-bind" element={
            <ProtectedRoute>
              <Layout><QQBotBindPage /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/wechat-bind" element={
            <ProtectedRoute>
              <Layout><WechatBindPage /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/rules" element={
            <ProtectedRoute>
              <PageGate module="extend.rules">
                <Layout><RulesPage /></Layout>
              </PageGate>
            </ProtectedRoute>
          } />
          <Route path="/hooks" element={
            <ProtectedRoute>
              <PageGate module="extend.hooks">
                <Layout><HooksPage /></Layout>
              </PageGate>
            </ProtectedRoute>
          } />
          <Route path="/skills" element={
            <ProtectedRoute>
              <PageGate module="extend.skills">
                <Layout><SkillsPage /></Layout>
              </PageGate>
            </ProtectedRoute>
          } />
          <Route path="/plugins" element={
            <ProtectedRoute>
              <PageGate module="extend.plugins">
                <Layout><PluginsPage /></Layout>
              </PageGate>
            </ProtectedRoute>
          } />
          <Route path="/models" element={
            <ProtectedRoute>
              <PageGate module="system.settings">
                <Layout><ModelsPage /></Layout>
              </PageGate>
            </ProtectedRoute>
          } />
          <Route path="/scheduled-tasks" element={
            <ProtectedRoute>
              <PageGate module="system.scheduler">
                <Layout><ScheduledTasksPage /></Layout>
              </PageGate>
            </ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute>
              <PageGate module="system.settings">
                <Layout><SettingsLayout /></Layout>
              </PageGate>
            </ProtectedRoute>
          }>
            <Route index element={<GeneralSettingsPage />} />
            <Route path="general" element={<GeneralSettingsPage />} />
            <Route path="suppliers" element={<SupplierSettingsPage />} />
            <Route path="memory" element={<MemorySettingsPage />} />
            <Route path="commands" element={<CommandsPage />} />
            <Route path="subagents" element={<SubagentsPage />} />
            <Route path="mcp-admin" element={<McpAdminSettingsPage />} />
            <Route path="telemetry" element={<TelemetrySettingsPage />} />
            <Route path="system-info" element={<SystemInfoPage />} />
            <Route path="tunnel" element={<WebSocketTunnelPage />} />
            <Route path="voice" element={<VoiceSettingsPage />} />
            <Route path="cursor-config" element={<CursorConfigPage />} />
          </Route>

          {/* Toast Test Page */}
          <Route path="/toast-test" element={
            <ProtectedRoute>
              <Layout><ToastTestPage /></Layout>
            </ProtectedRoute>
          } />

          {/* Discord redirect */}
          <Route path="/discord" element={<ExternalRedirect url="https://discord.gg/6uYsrr66" />} />

          {/* Catch-all route for unmatched paths */}
          <Route path="*" element={
            <ProtectedRoute>
              <Layout><div className="p-4 text-center">Page not found</div></Layout>
            </ProtectedRoute>
          } />
        </Routes>
      </Suspense>
    </RouterComponent>
  );
};

/**
 * In Tauri mode, gate the React tree behind backend readiness.
 *
 * - Web mode / Tauri dev: passes through immediately.
 * - Tauri prod (VITE_TAURI=true): shows DesktopLaunchConfig first.
 *   Once the user confirms, the sidecar is started via IPC and we poll
 *   for the backend port before rendering the main app.
 */
function TauriBackendGate({ children }: { children: React.ReactNode }) {
  const isTauriProd = isTauri() && import.meta.env.VITE_TAURI === 'true';
  const [backendStarted, setBackendStarted] = useState(!isTauriProd);
  const { isReady, error } = useBackendReady(backendStarted);

  if (!isTauri()) return <>{children}</>;

  if (isTauriProd && !backendStarted) {
    return <DesktopLaunchConfig onStarted={() => setBackendStarted(true)} />;
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: '16px',
          fontFamily: 'system-ui, sans-serif',
          background: '#0f172a',
          color: '#e2e8f0',
        }}
      >
        <p style={{ color: '#f87171', fontSize: '14px', textAlign: 'center', maxWidth: '400px' }}>
          后端启动失败：{error}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 20px',
            background: '#6366f1',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          重试
        </button>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: '16px',
          background: '#0f172a',
          color: '#94a3b8',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{
          width: '24px', height: '24px',
          border: '2px solid #1e293b', borderTopColor: '#6366f1',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{ fontSize: '13px' }}>Starting backend...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return <>{children}</>;
}

function DesktopUpdateLayer({ children }: { children: React.ReactNode }) {
  const { updatePayload, dismiss } = useUpdateChecker();
  const { logs, visible: logPanelVisible, setVisible: setLogPanelVisible, clearLogs, getFrontendLogs, clearFrontendLogs } = useBackendLogs();

  return (
    <>
      {children}
      {updatePayload && (
        <UpdateDialog
          version={updatePayload.version}
          notes={updatePayload.notes}
          onDismiss={dismiss}
        />
      )}

      {/* Log panel toggle (Tauri only) */}
      {isTauri() && !logPanelVisible && (
        <button
          onClick={() => setLogPanelVisible(true)}
          className="fixed bottom-4 right-4 z-[60] w-9 h-9 rounded-full bg-[#1e293b] border border-[#334155] text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#334155] transition-all shadow-lg flex items-center justify-center"
          title="Toggle Log Panel"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M4 6h8M4 8.5h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
        </button>
      )}

      {logPanelVisible && (
        <BackendLogPanel
          backendLogs={logs}
          getFrontendLogs={getFrontendLogs}
          onClearBackend={clearLogs}
          onClearFrontend={clearFrontendLogs}
          onClose={() => setLogPanelVisible(false)}
        />
      )}
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MobileProvider>
          <TelemetryProvider>
            <ConfirmProvider>
              <TauriBackendGate>
                <DesktopUpdateLayer>
                  <AppContent />
                </DesktopUpdateLayer>
              </TauriBackendGate>
              <Toaster />
            </ConfirmProvider>
          </TelemetryProvider>
        </MobileProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;