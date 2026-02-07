/**
 * 动态侧边栏组件 - 配置驱动 UI
 *
 * 根据配置文件动态生成菜单，无需手动添加菜单项
 */

import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeft, Circle } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import CollapsibleNavItem from './CollapsibleNavItem';
import { useAuth } from '../contexts/AuthContext';
import { useInstance } from '../contexts/InstanceContext';

import {
  getAutopilotNavGroups,
  filterNavGroups,
  type NavGroup,
} from '../config/navigation.config';

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

interface DynamicSidebarProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

export default function DynamicSidebar({
  collapsed,
  onCollapsedChange,
}: DynamicSidebarProps) {
  const location = useLocation();
  const { isSuperAdmin } = useAuth();
  const { config, isFeatureEnabled, coreConfig } = useInstance();

  // 获取并过滤导航配置
  const baseNavGroups = useMemo(() => {
    if (coreConfig) {
      return convertCoreNavGroups(coreConfig.navGroups);
    }
    return getAutopilotNavGroups();
  }, [coreConfig]);
  const navGroups = filterNavGroups(baseNavGroups, isFeatureEnabled, isSuperAdmin);

  return (
    <aside
      className={`fixed inset-y-0 left-0 ${
        collapsed ? 'w-16' : 'w-64'
      } flex flex-col shadow-2xl transition-all duration-300 z-20`}
      style={{ background: config?.theme.sidebarGradient || 'var(--sidebar-gradient)' }}
    >
      {/* Logo 区域 */}
      <div
        className="h-16 flex items-center justify-center border-b border-white/10"
      >
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
        onClick={() => onCollapsedChange(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full flex items-center justify-center text-slate-300 hover:text-white transition-all shadow-lg border border-slate-500/30 bg-slate-800 hover:bg-slate-700"
        title={collapsed ? '展开侧边栏' : '收起侧边栏'}
      >
        {collapsed ? (
          <PanelLeft className="w-3 h-3" />
        ) : (
          <PanelLeftClose className="w-3 h-3" />
        )}
      </button>

      {/* 导航菜单 */}
      <nav className={`flex-1 ${collapsed ? 'px-2' : 'px-3'} py-4 overflow-y-auto`}>
        {navGroups.map((group, groupIndex) => (
          <div key={group.title} className={groupIndex > 0 ? 'mt-6' : ''}>
            {!collapsed && (
              <p className="px-3 mb-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
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
                    className={`group relative flex items-center ${
                      collapsed ? 'justify-center px-2' : 'px-3'
                    } py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${
                      isActive
                        ? 'bg-slate-600/30 text-white'
                        : 'text-slate-400 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-slate-400" />
                    )}
                    <Icon
                      className={`w-5 h-5 ${
                        collapsed ? '' : 'mr-3'
                      } transition-transform duration-200 ${
                        isActive
                          ? 'text-slate-300'
                          : 'text-slate-500 group-hover:text-white group-hover:scale-110'
                      }`}
                    />
                    {!collapsed && item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

    </aside>
  );
}
