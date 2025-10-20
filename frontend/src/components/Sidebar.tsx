import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot,
  Server,
  Settings,
  FolderOpen,
  Command,
  ChevronDown,
  ChevronRight,
  Terminal,
  Brain,
  Palette
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ServiceStatusIndicator } from './ServiceStatusIndicator';
import { ServiceManagementModal } from './ServiceManagementModal';
import { useMobileContext } from '../contexts/MobileContext';

const getNavigationItems = (t: (key: string) => string) => [
  {
    name: t('nav.dashboard'),
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    name: t('nav.projects'),
    href: '/projects',
    icon: FolderOpen,
  },
  {
    name: t('nav.agents'),
    href: '/agents',
    icon: Bot,
  },
  {
    name: t('nav.mcp'),
    href: '/mcp',
    icon: Server,
  },
  {
    name: t('nav.settings'),
    href: '/settings',
    icon: Settings,
    submenu: [
      {
        name: t('nav.settingsSubmenu.general'),
        href: '/settings/general',
        icon: Palette,
      },
      {
        name: t('nav.settingsSubmenu.versions'),
        href: '/settings/versions',
        icon: Terminal,
      },
      {
        name: t('nav.settingsSubmenu.memory'),
        href: '/settings/memory',
        icon: Brain,
      },
      {
        name: t('nav.settingsSubmenu.commands'),
        href: '/settings/commands',
        icon: Command,
      },
      {
        name: t('nav.settingsSubmenu.subagents'),
        href: '/settings/subagents',
        icon: Bot,
      },
    ],
  },
];

interface SidebarProps {
  onClose?: () => void; // For mobile sidebar auto-close
}

export const Sidebar: React.FC<SidebarProps> = ({ onClose }) => {
  const { t } = useTranslation('pages');
  const location = useLocation();
  const navigate = useNavigate();
  const { isMobile } = useMobileContext();
  const [expandedMenus, setExpandedMenus] = useState<string[]>(() => {
    // Auto-expand the settings menu if we're on a settings page
    return location.pathname.startsWith('/settings') ? [t('nav.settings')] : [];
  });
  const [showServiceManagement, setShowServiceManagement] = useState(false);

  const navigationItems = getNavigationItems(t);

  const toggleMenu = (itemKey: string) => {
    setExpandedMenus(prev =>
      prev.includes(itemKey)
        ? prev.filter(key => key !== itemKey)
        : [...prev, itemKey]
    );
  };

  const isMenuExpanded = (itemKey: string) => expandedMenus.includes(itemKey);
  
  const isItemActive = (href: string, hasSubmenu: boolean) => {
    if (hasSubmenu) {
      return location.pathname.startsWith(href);
    }
    return location.pathname === href;
  };

  
  const renderNavItem = (item: any) => {
    const hasSubmenu = item.submenu && item.submenu.length > 0;
    const isExpanded = isMenuExpanded(item.name);
    const isActive = isItemActive(item.href, hasSubmenu);

    if (hasSubmenu) {
      return (
        <li key={item.nameKey}>
          <div className="space-y-1">
            {/* Parent Menu Item */}
            <button
              onClick={() => toggleMenu(item.name)}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium flex-1 text-left">{item.name}</span>
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>

            {/* Submenu */}
            {isExpanded && (
              <ul className="ml-6 space-y-1">
                {item.submenu.map((subItem: any) => (
                  <li key={subItem.name}>
                    <NavLink
                      to={subItem.href}
                      onClick={() => {
                        // Auto-close sidebar on mobile after navigation
                        if (isMobile && onClose) {
                          onClose();
                        }
                      }}
                      className={({ isActive }) =>
                        `flex items-center space-x-3 px-4 py-2 rounded-lg transition-colors text-sm ${
                          isActive
                            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
                        }`
                      }
                    >
                      <subItem.icon className="w-4 h-4" />
                      <span className="font-medium">{subItem.name}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      );
    }

    return (
      <li key={item.name}>
        <NavLink
          to={item.href}
          onClick={() => {
            // Auto-close sidebar on mobile after navigation
            if (isMobile && onClose) {
              onClose();
            }
          }}
          className={({ isActive }) =>
            `flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
              isActive
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
            }`
          }
        >
          <item.icon className="w-5 h-5" />
          <span className="font-medium">{item.name}</span>
        </NavLink>
      </li>
    );
  };

  return (
    <div className="w-64 bg-white dark:bg-gray-800 shadow-sm border-r border-gray-200 dark:border-gray-700 flex flex-col h-full z-40">
      {/* Logo */}
      <div className="px-6 py-8 flex-shrink-0">
        <button
          onClick={() => navigate('/')}
          className="flex items-center space-x-3 w-full text-left hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg p-2"
        >
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
            <img src="/cc-studio.png" alt="CC Studio" className="w-10 h-10" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">CC Studio</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Claude Code Studio</p>
          </div>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-4 pb-4">
        <ul className="space-y-2">
          {navigationItems.map(renderNavItem)}
        </ul>
      </nav>

      {/* Footer */}
      <div className="flex-shrink-0 p-4 border-t border-gray-200 dark:border-gray-700">
        <div className="space-y-3">
          {/* Service Status Indicator */}
          <ServiceStatusIndicator onManageServices={() => setShowServiceManagement(true)} />
        </div>
      </div>

      {/* Service Management Modal */}
      <ServiceManagementModal 
        isOpen={showServiceManagement}
        onClose={() => setShowServiceManagement(false)}
      />
    </div>
  );
};