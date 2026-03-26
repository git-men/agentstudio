import React, { useState, useCallback } from 'react';
import { Menu } from 'lucide-react';
import { MobileSidebar } from './MobileSidebar';
import { Sidebar } from './Sidebar';
import { MetaAgentBubble } from './MetaAgentBubble';
import { useMobileContext } from '../contexts/MobileContext';

const SIDEBAR_COLLAPSED_KEY = 'agentstudio:sidebar-collapsed';

function getSidebarCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored !== null) return stored === 'true';
  } catch { /* ignore */ }
  return true; // default: collapsed
}

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { isMobile, sidebarOpen, setSidebarOpen } = useMobileContext();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getSidebarCollapsed);

  const handleToggleCollapse = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-900 flex">
      {/* Desktop Sidebar - Visible on md (768px) and above */}
      <div className="hidden md:block flex-shrink-0">
        <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={handleToggleCollapse} />
      </div>

      {/* Mobile Sidebar - Overlay for all mobile sizes */}
      <MobileSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Mobile Header - Only on mobile (below md) */}
        {isMobile && (
          <header className="flex-shrink-0 sticky top-0 z-40 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                aria-label="Open sidebar"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="flex items-center space-x-2">
                <img src={`${import.meta.env.BASE_URL}cc-studio.png`} alt="ClawStudio" className="w-8 h-8 rounded-lg" />
                <h1 className="text-lg font-semibold text-gray-900 dark:text-white">ClawStudio</h1>
              </div>
              <div className="w-9 h-9" /> {/* Spacer for balance */}
            </div>
          </header>
        )}

        {/* Page Content — flex-1 + min-h-0 lets children use h-full while keeping overflow-auto for scrollable pages */}
        <div className={`flex-1 min-h-0 overflow-auto ${isMobile ? 'pb-4' : ''}`}>
          {children}
        </div>
      </main>

      {/* Global floating Meta Agent assistant */}
      <MetaAgentBubble />
    </div>
  );
};