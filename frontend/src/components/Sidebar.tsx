import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  MessageSquare,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ServiceStatusIndicator } from './ServiceStatusIndicator';
import { ServiceManagementModal } from './ServiceManagementModal';
import { UpdateNotification } from './UpdateNotification';
import { useMobileContext } from '../contexts/MobileContext';
import { useDesktopUpdate } from '../contexts/DesktopUpdateContext';
import { isTauri } from '../lib/environment';
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
    name: t('nav.imChannels'),
    href: '/im-channels',
    icon: MessageSquare,
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
  const [activeFloatingMenu, setActiveFloatingMenu] = useState<{name: string, rect: DOMRect, submenu: any[]} | null>(null);
  const [showServiceManagement, setShowServiceManagement] = useState(false);
  const [showEnterpriseMenu, setShowEnterpriseMenu] = useState(false);
  const { profile: enterpriseProfile, isAuthenticated: isEnterpriseAuth, startLogin: enterpriseLogin, logout: enterpriseLogout } = useEnterpriseProfile();
  const desktopUpdate = useDesktopUpdate();
  const [showUpdateCheck, setShowUpdateCheck] = useState(false);

  useEffect(() => {
    if (showUpdateCheck && desktopUpdate?.updatePayload) {
      setShowUpdateCheck(false);
    }
  }, [showUpdateCheck, desktopUpdate?.updatePayload]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Close if click is outside the floating menu and not on an icon button
      if (!target.closest('.floating-submenu') && !target.closest('.sidebar-menu-btn')) {
        setActiveFloatingMenu(null);
      }
    };
    
    // Auto-close on scroll
    const handleScroll = () => setActiveFloatingMenu(null);

    if (activeFloatingMenu) {
      document.addEventListener('mousedown', handleOutsideClick);
      window.addEventListener('resize', handleScroll);
      window.addEventListener('scroll', handleScroll, true); // true for capturing phase to catch sidebar scroll
    }

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('resize', handleScroll);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [activeFloatingMenu]);

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
      // Collapsed mode: icon only, clicking shows floating submenu if it has one
      const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (hasSubmenu) {
          e.preventDefault();
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          if (activeFloatingMenu?.name === item.name) {
             setActiveFloatingMenu(null);
          } else {
             setActiveFloatingMenu({
               name: item.name,
               rect,
               submenu: item.submenu,
             });
          }
        } else {
          setActiveFloatingMenu(null);
          if (isMobile && onClose) onClose();
        }
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
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200'
              } sidebar-menu-btn`}
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
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200'
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
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200'
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
                            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200'
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
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200'
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
    <div className={`${collapsed ? 'w-16' : 'w-56'} bg-white dark:bg-gray-800 shadow-sm border-r border-gray-200 dark:border-gray-700 flex flex-col h-full z-40 transition-all duration-200`}>
      {/* Logo */}
      <div className={`${collapsed ? 'px-2 py-4' : 'px-4 py-5'} flex-shrink-0`}>
        <button
          onClick={() => navigate('/')}
          title="ClawStudio"
          className={`flex items-center gap-3 hover:opacity-80 transition-opacity focus:outline-none rounded-lg ${collapsed ? 'justify-center w-full p-1' : 'w-full p-2'}`}
        >
          <img src={`${import.meta.env.BASE_URL}cc-studio.png`} alt="ClawStudio" className="w-8 h-8 rounded-lg flex-shrink-0 object-contain" />
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <h1 className="text-lg font-bold text-gray-900 dark:text-white whitespace-nowrap">ClawStudio</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Your Agent Workspace</p>
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
      <div className={`flex-shrink-0 border-t border-gray-200/80 dark:border-gray-700/80 ${collapsed ? 'px-2 py-2' : 'px-3 py-2'}`}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            {isEnterpriseAuth ? (
              <div className="relative">
                <button
                  onClick={() => setShowEnterpriseMenu(!showEnterpriseMenu)}
                  title={enterpriseProfile?.name || enterpriseProfile?.email || '企业用户'}
                  className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {enterpriseProfile?.avatarUrl ? (
                    <img src={enterpriseProfile.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[8px] font-bold text-white">
                      {(enterpriseProfile?.name || enterpriseProfile?.email || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                </button>

                {showEnterpriseMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowEnterpriseMenu(false)} />
                    <div className="absolute bottom-full left-0 mb-1 w-36 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 py-1">
                      {enterpriseProfile?.name && (
                        <div className="px-3 py-1.5 text-[11px] text-gray-500 dark:text-gray-400 truncate border-b border-gray-100 dark:border-gray-700">
                          {enterpriseProfile.email || enterpriseProfile.name}
                        </div>
                      )}
                      <button
                        onClick={() => { setShowEnterpriseMenu(false); enterpriseLogin(); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        <Building2 className="w-3 h-3" />
                        重新登录
                      </button>
                      <button
                        onClick={() => { setShowEnterpriseMenu(false); enterpriseLogout(); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <LogOut className="w-3 h-3" />
                        退出
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button
                onClick={() => enterpriseLogin()}
                title="连接企业版"
                className="p-1.5 rounded-md text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <Building2 className="w-4 h-4" />
              </button>
            )}
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                title="展开侧边栏"
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              >
                <PanelLeftOpen className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <UpdateNotification compact />

            {/* User identity row */}
            <div className="relative">
              {isEnterpriseAuth ? (
                <>
                  <button
                    onClick={() => setShowEnterpriseMenu(!showEnterpriseMenu)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    {enterpriseProfile?.avatarUrl ? (
                      <img src={enterpriseProfile.avatarUrl} alt="" className="flex-shrink-0 w-5 h-5 rounded-full object-cover ring-1 ring-gray-200 dark:ring-gray-600" />
                    ) : (
                      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[9px] font-semibold text-white">
                        {(enterpriseProfile?.name || enterpriseProfile?.email || '?').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="flex-1 min-w-0 text-left text-[11px] font-medium text-gray-700 dark:text-gray-200 truncate">
                      {enterpriseProfile?.name || enterpriseProfile?.email || '企业用户'}
                    </span>
                    <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform flex-shrink-0 ${showEnterpriseMenu ? 'rotate-180' : ''}`} />
                  </button>

                  {showEnterpriseMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowEnterpriseMenu(false)} />
                      <div className="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 py-1">
                        {enterpriseProfile?.email && enterpriseProfile?.name && enterpriseProfile.email !== enterpriseProfile.name && (
                          <div className="px-3 py-1.5 text-[10px] text-gray-400 dark:text-gray-500 truncate border-b border-gray-100 dark:border-gray-700 mb-0.5">
                            {enterpriseProfile.email}
                          </div>
                        )}
                        {/* Desktop update check */}
                        {isTauri() && desktopUpdate && (
                          <button
                            onClick={() => {
                              setShowEnterpriseMenu(false);
                              setShowUpdateCheck(true);
                              desktopUpdate.checkForUpdate();
                            }}
                            className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                          >
                            <span className="flex items-center gap-2">
                              <RefreshCw className="w-3 h-3" />
                              检查更新
                            </span>
                            <span className="text-gray-400 dark:text-gray-500">
                              v{desktopUpdate.currentVersion || '...'}
                            </span>
                          </button>
                        )}
                        <div className="border-t border-gray-100 dark:border-gray-700 my-0.5" />
                        <button
                          onClick={() => { setShowEnterpriseMenu(false); enterpriseLogin(); }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          <Building2 className="w-3 h-3" />
                          重新登录
                        </button>
                        <button
                          onClick={() => { setShowEnterpriseMenu(false); enterpriseLogout(); }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <LogOut className="w-3 h-3" />
                          退出企业版
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <button
                  onClick={() => enterpriseLogin()}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md border border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors group"
                >
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 transition-colors">
                    <Building2 className="w-3 h-3 text-gray-400 group-hover:text-blue-500 transition-colors" />
                  </div>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    连接企业版
                  </span>
                </button>
              )}
            </div>

            {/* Service status + collapse toggle */}
            <div className="flex items-center">
              <div className="flex-1 min-w-0">
                <ServiceStatusIndicator onManageServices={() => setShowServiceManagement(true)} />
              </div>
              {onToggleCollapse && (
                <button
                  onClick={onToggleCollapse}
                  title="收起侧边栏"
                  className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-700 rounded-md transition-colors"
                >
                  <PanelLeftClose className="w-3.5 h-3.5" />
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

      {/* Floating Menu Portal for Collapsed Sidebar */}
      {activeFloatingMenu && createPortal(
        <div 
          className="floating-submenu fixed z-50 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-2 top-0 left-0"
          style={{
            top: `${activeFloatingMenu.rect.top}px`,
            left: `${activeFloatingMenu.rect.right + 12}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
            {activeFloatingMenu.name}
          </div>
          <ul className="space-y-1">
            {activeFloatingMenu.submenu.map((subItem: any) => (
              <li key={subItem.name}>
                <NavLink
                  to={subItem.href}
                  onClick={() => {
                    setActiveFloatingMenu(null);
                    if (isMobile && onClose) onClose();
                  }}
                  className={({ isActive }) =>
                    `flex items-center space-x-3 px-4 py-2 text-sm transition-colors ${
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200'
                    }`
                  }
                >
                  <subItem.icon className="w-4 h-4 flex-shrink-0 opacity-80" />
                  <span className="truncate">{subItem.name}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>,
        document.body
      )}

      {/* Update check dialog */}
      {showUpdateCheck && desktopUpdate && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setShowUpdateCheck(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-5 w-80 mx-4" onClick={(e) => e.stopPropagation()}>
            {desktopUpdate.checkStatus === 'checking' ? (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">正在检查更新…</h3>
                </div>
                <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div className="h-full w-1/2 rounded-full bg-blue-500 animate-pulse" />
                </div>
              </>
            ) : desktopUpdate.checkStatus === 'error' ? (
              <>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                    <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">检查更新失败</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">当前版本 v{desktopUpdate.currentVersion}</p>
                  </div>
                </div>
                {desktopUpdate.checkError && (
                  <div className="my-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-xs text-red-600 dark:text-red-400 max-h-24 overflow-y-auto break-all">
                    {desktopUpdate.checkError}
                  </div>
                )}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => { desktopUpdate.checkForUpdate(); }}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                  >
                    重试
                  </button>
                  <button
                    onClick={() => setShowUpdateCheck(false)}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    关闭
                  </button>
                </div>
              </>
            ) : desktopUpdate.updatePayload ? (
              <>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                    <RefreshCw className="w-[1.125rem] h-[1.125rem] text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">发现新版本</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">v{desktopUpdate.currentVersion} → v{desktopUpdate.updatePayload.version}</p>
                  </div>
                </div>
                {desktopUpdate.updatePayload.notes && (
                  <div className="my-3 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900 text-xs text-gray-600 dark:text-gray-400 max-h-24 overflow-y-auto whitespace-pre-wrap">
                    {desktopUpdate.updatePayload.notes}
                  </div>
                )}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setShowUpdateCheck(false)}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    稍后再说
                  </button>
                  <button
                    onClick={() => setShowUpdateCheck(false)}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                  >
                    立即更新
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                    <CheckCircle2 className="w-[1.125rem] h-[1.125rem] text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">已是最新版本</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">当前版本 v{desktopUpdate.currentVersion}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowUpdateCheck(false)}
                  className="w-full px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  确定
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};