import React, { useState, useMemo } from 'react';
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
  Palette,
  Zap,
  Package,
  Clock,
  Key,
  Globe,
  Puzzle,
  Mic,
  FileCode,
  Webhook,
  PanelLeftClose,
  PanelLeftOpen,
  Building2,
  LogOut,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ServiceStatusIndicator } from './ServiceStatusIndicator';
import { ServiceManagementModal } from './ServiceManagementModal';
import { UpdateNotification } from './UpdateNotification';
import { useMobileContext } from '../contexts/MobileContext';
import useEngine from '../hooks/useEngine';
import useProduct from '../hooks/useProduct';
import { useEnterpriseProfile } from '../hooks/useEnterpriseProfile';
import type { EngineFeatureKey, ConfigCapabilityKey } from '../types/engine';

// Navigation item type with optional engine and product requirements
interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  submenu?: NavItem[];
  // Optional: require a feature to be supported
  requireFeature?: EngineFeatureKey;
  // Optional: require a config capability
  requireConfig?: ConfigCapabilityKey;
  // Optional: require a specific engine type
  requireEngine?: 'cursor-cli' | 'claude-sdk';
  // Optional: require a product feature module to be enabled
  requireModule?: string;
}

const getNavigationItems = (t: (key: string) => string): NavItem[] => [
  {
    name: t('nav.dashboard'),
    href: '/dashboard',
    icon: LayoutDashboard,
    requireModule: 'manage.dashboard',
  },
  {
    name: t('nav.projects'),
    href: '/projects',
    icon: FolderOpen,
    requireModule: 'manage.projects',
  },
  {
    name: t('nav.mcp'),
    href: '/mcp',
    icon: Server,
    requireConfig: 'mcp',
    requireModule: 'manage.mcp',
  },
  {
    name: t('nav.agents'),
    href: '/agents',
    icon: Bot,
    requireModule: 'manage.agents',
  },
  {
    name: t('nav.scheduledTasks'),
    href: '/scheduled-tasks',
    icon: Clock,
    requireModule: 'system.scheduler',
  },
  {
    name: t('nav.extensions'),
    href: '/plugins',
    icon: Puzzle,
    submenu: [
      {
        name: t('nav.plugins'),
        href: '/plugins',
        icon: Package,
        requireConfig: 'plugins',
        requireModule: 'extend.plugins',
      },
      {
        name: t('nav.commands'),
        href: '/settings/commands',
        icon: Command,
        requireConfig: 'commands',
        requireModule: 'extend.commands',
      },
      {
        name: t('nav.subagents'),
        href: '/settings/subagents',
        icon: Bot,
        requireFeature: 'subagents',
        requireModule: 'extend.subagents',
      },
      {
        name: t('nav.skills'),
        href: '/skills',
        icon: Zap,
        requireConfig: 'skills',
        requireModule: 'extend.skills',
      },
      {
        name: 'Rules',
        href: '/rules',
        icon: FileCode,
        requireConfig: 'rules',
        requireModule: 'extend.rules',
      },
      {
        name: 'Hooks',
        href: '/hooks',
        icon: Webhook,
        requireFeature: 'hooks',
        requireModule: 'extend.hooks',
      },
    ],
  },
  {
    name: t('nav.settings'),
    href: '/settings',
    icon: Settings,
    requireModule: 'system.settings',
    submenu: [
      {
        name: t('nav.settingsSubmenu.general'),
        href: '/settings/general',
        icon: Palette,
        requireModule: 'system.settings',
      },
      {
        name: t('nav.settingsSubmenu.suppliers'),
        href: '/settings/suppliers',
        icon: Terminal,
        requireFeature: 'provider',
        requireModule: 'system.settings',
      },
      {
        name: t('nav.settingsSubmenu.memory'),
        href: '/settings/memory',
        icon: Brain,
        requireModule: 'system.settings',
      },
      {
        name: t('nav.settingsSubmenu.mcpAdmin'),
        href: '/settings/mcp-admin',
        icon: Key,
        requireModule: 'system.mcp-admin',
      },
      {
        name: t('nav.settingsSubmenu.tunnel'),
        href: '/settings/tunnel',
        icon: Globe,
        requireModule: 'system.tunnel',
      },
      {
        name: t('nav.settingsSubmenu.voice'),
        href: '/settings/voice',
        icon: Mic,
        requireModule: 'system.voice',
      },
    ],
  },
];

interface SidebarProps {
  onClose?: () => void; // For mobile sidebar auto-close
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onClose, collapsed = false, onToggleCollapse }) => {
  const { t } = useTranslation('pages');
  const location = useLocation();
  const navigate = useNavigate();
  const { isMobile } = useMobileContext();
  const [expandedMenus, setExpandedMenus] = useState<string[]>(() => {
    // Auto-expand the settings menu if we're on a settings page
    return location.pathname.startsWith('/settings') ? [t('nav.settings')] : [];
  });
  const [showServiceManagement, setShowServiceManagement] = useState(false);
  const [showEnterpriseMenu, setShowEnterpriseMenu] = useState(false);
  const { profile: enterpriseProfile, isAuthenticated: isEnterpriseAuth, startLogin: enterpriseLogin, logout: enterpriseLogout } = useEnterpriseProfile();

  // Get engine capabilities for filtering navigation items
  const { isFeatureSupported, isConfigSupported, engineType, isLoading: isEngineLoading } = useEngine();
  // Get product module status for filtering
  const { isModuleEnabled, isLoading: isProductLoading, isFullEdition } = useProduct();

  // Filter navigation items based on engine capabilities AND product modules
  const filterNavItems = (items: NavItem[]): NavItem[] => {
    return items
      .filter(item => {
        // Check engine type requirement
        if (item.requireEngine && engineType !== item.requireEngine) {
          return false;
        }
        // Check feature requirement
        if (item.requireFeature && !isFeatureSupported(item.requireFeature)) {
          return false;
        }
        // Check config requirement
        if (item.requireConfig && !isConfigSupported(item.requireConfig)) {
          return false;
        }
        // Check product module requirement
        if (item.requireModule && !isFullEdition && !isModuleEnabled(item.requireModule)) {
          return false;
        }
        return true;
      })
      .map(item => {
        // Recursively filter submenus
        if (item.submenu) {
          const filteredSubmenu = filterNavItems(item.submenu);
          // If all submenu items are filtered out, remove the parent too
          if (filteredSubmenu.length === 0) {
            return null;
          }
          return { ...item, submenu: filteredSubmenu };
        }
        return item;
      })
      .filter((item): item is NavItem => item !== null);
  };

  // Get filtered navigation items
  const navigationItems = useMemo(() => {
    const allItems = getNavigationItems(t);
    // Don't filter while engine or product config is loading to prevent flash
    if (isEngineLoading || isProductLoading) {
      return allItems;
    }
    return filterNavItems(allItems);
  }, [t, isEngineLoading, isProductLoading, isFeatureSupported, isConfigSupported, engineType, isModuleEnabled, isFullEdition]);

  const toggleMenu = (itemKey: string) => {
    setExpandedMenus(prev =>
      prev.includes(itemKey)
        ? prev.filter(key => key !== itemKey)
        : [...prev, itemKey]
    );
  };

  const isMenuExpanded = (itemKey: string) => expandedMenus.includes(itemKey);
  
  const isItemActive = (item: any) => {
    const hasSubmenu = item.submenu && item.submenu.length > 0;
    
    if (hasSubmenu) {
      // 对于有子菜单的项目，只有当前路径匹配子菜单中的某一项时才高亮
      return item.submenu.some((subItem: any) => 
        location.pathname === subItem.href || 
        location.pathname.startsWith(subItem.href + '/')
      );
    }
    return location.pathname === item.href || location.pathname.startsWith(item.href + '/');
  };

  
  const renderNavItem = (item: any) => {
    const hasSubmenu = item.submenu && item.submenu.length > 0;
    const isExpanded = isMenuExpanded(item.name);
    const isActive = isItemActive(item);

    if (collapsed) {
      // Collapsed mode: icon only, no submenu
      const handleClick = () => {
        if (hasSubmenu) {
          // Navigate to the first submenu item
          navigate(item.submenu[0].href);
        }
        if (isMobile && onClose) onClose();
      };
      const icon = (
        <item.icon className="w-5 h-5 flex-shrink-0" />
      );
      if (hasSubmenu) {
        return (
          <li key={item.name}>
            <button
              onClick={handleClick}
              title={item.name}
              className={`w-full flex items-center justify-center p-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {icon}
            </button>
          </li>
        );
      }
      return (
        <li key={item.name}>
          <NavLink
            to={item.href}
            onClick={() => { if (isMobile && onClose) onClose(); }}
            title={item.name}
            className={({ isActive }) =>
              `flex items-center justify-center p-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
              }`
            }
          >
            {icon}
          </NavLink>
        </li>
      );
    }

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
    <div className={`${collapsed ? 'w-16' : 'w-64'} bg-white dark:bg-gray-800 shadow-sm border-r border-gray-200 dark:border-gray-700 flex flex-col h-full z-40 transition-all duration-200`}>
      {/* Logo */}
      <div className={`${collapsed ? 'px-2 py-4' : 'px-6 py-8'} flex-shrink-0`}>
        <button
          onClick={() => navigate('/')}
          title="ClawStudio"
          className={`flex items-center gap-3 hover:opacity-80 transition-opacity focus:outline-none rounded-lg ${collapsed ? 'justify-center w-full p-1' : 'w-full p-2'}`}
        >
          <img src={`${import.meta.env.BASE_URL}cc-studio.png`} alt="ClawStudio" className="w-10 h-10 rounded-lg flex-shrink-0 object-contain" />
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white whitespace-nowrap">ClawStudio</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">Your Agent Workspace</p>
            </div>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className={`flex-1 overflow-y-auto ${collapsed ? 'px-2' : 'px-4'} pb-4`}>
        <ul className="space-y-1">
          {navigationItems.map(renderNavItem)}
        </ul>
      </nav>

      {/* Footer */}
      <div className={`flex-shrink-0 border-t border-gray-200 dark:border-gray-700 ${collapsed ? 'p-2' : 'p-4'}`}>
        {collapsed ? (
          <div className="space-y-2">
            {/* Enterprise identity (collapsed) */}
            {isEnterpriseAuth ? (
              <div
                title={enterpriseProfile?.name || enterpriseProfile?.email || '企业用户'}
                className="w-full flex items-center justify-center p-2"
              >
                {enterpriseProfile?.avatarUrl ? (
                  <img src={enterpriseProfile.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-[10px] font-bold text-blue-600 dark:text-blue-400">
                    {(enterpriseProfile?.name || enterpriseProfile?.email || '?').charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => enterpriseLogin()}
                title="连接企业版"
                className="w-full flex items-center justify-center p-2 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <Building2 className="w-5 h-5" />
              </button>
            )}
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                title="展开侧边栏"
                className="w-full flex items-center justify-center p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <UpdateNotification compact />

            {/* Enterprise identity */}
            <div className="relative">
              {isEnterpriseAuth ? (
                <>
                  <button
                    onClick={() => setShowEnterpriseMenu(!showEnterpriseMenu)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors group"
                  >
                    {enterpriseProfile?.avatarUrl ? (
                      <img src={enterpriseProfile.avatarUrl} alt="" className="flex-shrink-0 w-7 h-7 rounded-full object-cover" />
                    ) : (
                      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-[10px] font-bold text-blue-600 dark:text-blue-400">
                        {(enterpriseProfile?.name || enterpriseProfile?.email || '?').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                        {enterpriseProfile?.name || enterpriseProfile?.email || '企业用户'}
                      </div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                        Enterprise
                      </div>
                    </div>
                    <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showEnterpriseMenu ? 'rotate-180' : ''}`} />
                  </button>

                  {showEnterpriseMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowEnterpriseMenu(false)} />
                      <div className="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 py-1">
                        <button
                          onClick={() => {
                            setShowEnterpriseMenu(false);
                            enterpriseLogin();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          <Building2 className="w-3.5 h-3.5" />
                          重新登录
                        </button>
                        <button
                          onClick={() => {
                            setShowEnterpriseMenu(false);
                            enterpriseLogout();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          退出企业版
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <button
                  onClick={() => enterpriseLogin()}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors group"
                >
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 transition-colors">
                    <Building2 className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-500 transition-colors" />
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    连接企业版
                  </span>
                </button>
              )}
            </div>

            {/* Service status + collapse toggle in same row */}
            <div className="flex items-center gap-1">
              <div className="flex-1 min-w-0">
                <ServiceStatusIndicator onManageServices={() => setShowServiceManagement(true)} />
              </div>
              {onToggleCollapse && (
                <button
                  onClick={onToggleCollapse}
                  title="收起侧边栏"
                  className="flex-shrink-0 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Service Management Modal */}
      <ServiceManagementModal 
        isOpen={showServiceManagement}
        onClose={() => setShowServiceManagement(false)}
      />
    </div>
  );
};