/**
 * App.tsx - 配置驱动架构
 *
 * 菜单和路由都从 config/navigation.config.ts 读取
 * 添加新页面只需修改配置文件，无需改动这里
 */

import { useState, useMemo, lazy, Suspense, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeft, Sun, Moon, Monitor, Circle } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import CollapsibleNavItem from './components/CollapsibleNavItem';
import Breadcrumb from './components/Breadcrumb';
// 配置驱动
import { filterNavGroups, type NavGroup } from './config/navigation.config';
import DynamicRouter from './components/DynamicRouter';
// Context
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { InstanceProvider, useInstance } from './contexts/InstanceContext';
import { CeceliaProvider } from './contexts/CeceliaContext';

// Lazy load CeceliaChat for Core instance only
const CeceliaChat = lazy(() => import('@features/core/shared/components/CeceliaChat'));
import './App.css';

// 将 Core 的 NavGroup 格式转换为带 LucideIcon 的格式
function convertCoreNavGroups(
  coreNavGroups: Array<{ title: string; items: Array<{ path: string; icon: string; label: string; featureKey: string; component?: string; children?: Array<{ path: string; icon: string; label: string; featureKey: string }> }> }>
): NavGroup[] {
  return coreNavGroups.map(group => ({
    title: group.title,
    items: group.items.map(item => ({
      path: item.path,
      icon: (LucideIcons as any)[item.icon] || Circle,
      label: item.label,
      featureKey: item.featureKey,
      component: item.component,
      children: item.children?.map(child => ({
        path: child.path,
        icon: (LucideIcons as any)[child.icon] || Circle,
        label: child.label,
        featureKey: child.featureKey,
      })),
    })),
  }));
}

function AppContent() {
  const location = useLocation();
  const { isAuthenticated, isSuperAdmin, authLoading } = useAuth();
  const { theme, setTheme } = useTheme();
  const { config, loading: instanceLoading, isFeatureEnabled, isCore, coreConfig } = useInstance();
  const [collapsed, setCollapsed] = useState(false);

  // Tab 路由不加 p-8 内边距（TabbedPage 自带布局）
  const isTabbedRoute = (path: string) =>
    path.startsWith('/system') || path.startsWith('/work') || path.startsWith('/immune') || path.startsWith('/cecelia');

  // 设置浏览器标题
  useEffect(() => {
    document.title = 'Cecelia';
  }, []);

  // 主题切换
  const cycleTheme = () => {
    const themes: Array<'light' | 'dark' | 'auto'> = ['light', 'dark', 'auto'];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  // ============ 配置驱动菜单 ============
  const baseNavGroups = useMemo(() => {
    if (coreConfig) {
      return convertCoreNavGroups(coreConfig.navGroups);
    }
    return [];
  }, [coreConfig]);
  const navGroups = filterNavGroups(baseNavGroups, isFeatureEnabled, isSuperAdmin);

  // 兼容旧代码
  const navItems = navGroups.flatMap(g => g.items);

  // 配置或认证加载中时显示加载状态
  if (instanceLoading || authLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        isCore
          ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900'
          : 'bg-gradient-to-br from-slate-50 to-blue-50/30 dark:from-slate-900 dark:to-slate-800'
      }`}>
        <div className="text-center">
          <div className={`w-12 h-12 border-4 ${isCore ? 'border-slate-400' : 'border-blue-500'} border-t-transparent rounded-full animate-spin mx-auto mb-4`} />
          <p className={isCore ? 'text-slate-400' : 'text-gray-500 dark:text-gray-400'}>加载中...</p>
        </div>
      </div>
    );
  }

  // Callback for voice navigation - collapse sidebar for full-screen view
  const handleNavigation = () => {
    setCollapsed(true);
  };

  return (
    <CeceliaProvider onNavigate={handleNavigation}>
    <div className={`h-screen overflow-hidden flex flex-col transition-colors ${
      isCore
        ? 'bg-gradient-to-br from-slate-200 via-slate-300 to-slate-400/50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800'
        : 'bg-gradient-to-br from-slate-50 to-blue-50/30 dark:from-slate-900 dark:to-slate-800'
    }`}>
      {isAuthenticated && (
        <>
          {/* 左侧导航栏 - 使用配置的渐变色 */}
          <aside className={`fixed inset-y-0 left-0 ${collapsed ? 'w-16' : 'w-64'} flex flex-col shadow-2xl transition-all duration-300 z-20`} style={{ background: config?.theme.sidebarGradient || 'var(--sidebar-gradient)' }}>
            {/* Logo 区域 */}
            <div className={`h-16 flex items-center justify-center border-b border-white/10`}>
              {collapsed ? (
                <div className="relative w-10 h-10 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-lg bg-cyan-500/15 blur-md" />
                  <div className="relative w-10 h-10 rounded-lg bg-slate-800/80 border border-cyan-500/25 flex items-center justify-center backdrop-blur-sm"
                    style={{ boxShadow: '0 0 12px rgba(6,182,212,0.15), inset 0 1px 0 rgba(255,255,255,0.05)' }}>
                    <span className="logo-glow">
                      <span className="text-[13px] font-black tracking-wide bg-gradient-to-b from-cyan-300 to-blue-400 bg-clip-text text-transparent" style={{ fontFamily: 'system-ui' }}>
                        XX
                      </span>
                    </span>
                  </div>
                </div>
              ) : (
                <div className="logo-glow flex items-baseline tracking-tighter" style={{ fontFamily: 'system-ui' }}>
                  <span className="text-[28px] font-light text-slate-300/90">Perfect</span>
                  <span className="text-[28px] font-extrabold text-white">21</span>
                </div>
              )}
            </div>

            {/* 收缩按钮 */}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={`absolute -right-3 top-20 w-6 h-6 rounded-full flex items-center justify-center transition-all shadow-lg ${
                isCore
                  ? 'text-slate-300 hover:text-white border border-slate-500/30 bg-slate-800 hover:bg-slate-700'
                  : 'text-sky-200 hover:text-white border border-sky-400/30 bg-blue-900 hover:bg-blue-800'
              }`}
              title={collapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              {collapsed ? <PanelLeft className="w-3 h-3" /> : <PanelLeftClose className="w-3 h-3" />}
            </button>

            {/* 导航菜单 */}
            <nav className={`flex-1 ${collapsed ? 'px-2' : 'px-3'} py-4 overflow-y-auto`}>
              {navGroups.map((group, groupIndex) => (
                <div key={group.title} className={groupIndex > 0 ? 'mt-6' : ''}>
                  {!collapsed && (
                    <p className={`px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider ${
                      isCore ? 'text-slate-500' : 'text-sky-400/60'
                    }`}>
                      {group.title}
                    </p>
                  )}
                  {collapsed && groupIndex > 0 && (
                    <div className="mx-2 mb-2 border-t border-white/5" />
                  )}
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      if (item.children && item.children.length > 0) {
                        return (
                          <CollapsibleNavItem
                            key={item.path}
                            item={item}
                            collapsed={collapsed}
                            isCore={isCore}
                            currentPath={location.pathname}
                          />
                        );
                      }
                      const Icon = item.icon;
                      const isActive = location.pathname === item.path;
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          title={collapsed ? item.label : undefined}
                          className={`group relative flex items-center ${collapsed ? 'justify-center px-2' : 'px-3'} py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${
                            isActive
                              ? isCore
                                ? 'bg-slate-600/30 text-white'
                                : 'bg-sky-500/20 text-white'
                              : isCore
                                ? 'text-slate-400 hover:bg-white/5 hover:text-white'
                                : 'text-blue-200/70 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          {isActive && (
                            <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full ${
                              isCore ? 'bg-slate-400' : 'bg-sky-400'
                            }`} />
                          )}
                          <Icon className={`w-5 h-5 ${collapsed ? '' : 'mr-3'} transition-transform duration-200 ${
                            isActive
                              ? isCore ? 'text-slate-300' : 'text-sky-300'
                              : isCore
                                ? 'text-slate-500 group-hover:text-white group-hover:scale-110'
                                : 'text-blue-300/60 group-hover:text-white group-hover:scale-110'
                          }`} />
                          {!collapsed && item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

          </aside>

          {/* 顶部栏 - Canvas 页面使用深色主题 */}
          <div className={`fixed top-0 ${collapsed ? 'left-16' : 'left-64'} right-0 h-16 ${
            location.pathname === '/canvas'
              ? 'bg-slate-900/90 border-indigo-500/20'
              : 'bg-white/90 dark:bg-slate-800/90 border-slate-200/80 dark:border-slate-700/50'
          } backdrop-blur-xl border-b flex items-center justify-between px-8 z-10 shadow-sm transition-all duration-300`}>
            {/* 左侧：面包屑导航 */}
            <div>
              {location.pathname === '/canvas' ? (
                <h2 className="text-lg font-semibold text-white">
                  {navItems.find(item => item.path === location.pathname)?.label || '工作台'}
                </h2>
              ) : (
                <Breadcrumb navGroups={navGroups} />
              )}
            </div>

            {/* 右侧：主题切换 */}
            <div className="flex items-center">
              <button
                onClick={cycleTheme}
                className={`relative p-2 rounded-lg transition-colors ${
                  location.pathname === '/canvas'
                    ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                    : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700'
                }`}
                title={theme === 'auto' ? '自动模式' : theme === 'dark' ? '深色模式' : '浅色模式'}
              >
                {theme === 'auto' ? (
                  <Monitor className="w-5 h-5" />
                ) : theme === 'dark' ? (
                  <Moon className="w-5 h-5" />
                ) : (
                  <Sun className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </>
      )}

      {/* 主内容区域 - 配置驱动路由 */}
      <main className={isAuthenticated ? `flex-1 overflow-auto ${collapsed ? 'ml-16' : 'ml-64'} pt-16 transition-all duration-300` : "flex-1 overflow-auto"}>
        <div key={location.pathname} className={isAuthenticated ? (isTabbedRoute(location.pathname) ? "page-fade-in" : "p-8 page-fade-in") : ""}>
          <DynamicRouter />
        </div>
      </main>

      {/* Global Cecelia Chat - Core instance only */}
      {isCore && isAuthenticated && (
        <Suspense fallback={null}>
          <CeceliaChat />
        </Suspense>
      )}
    </div>
    </CeceliaProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <InstanceProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </InstanceProvider>
    </ThemeProvider>
  );
}

export default App;
