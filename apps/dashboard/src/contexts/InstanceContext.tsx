import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import type { NavGroup } from '../config/navigation.config';

// 主题配置
interface ThemeConfig {
  logo: string;
  logoCollapsed?: string;
  favicon?: string;
  primaryColor: string;
  secondaryColor?: string;
  sidebarGradient?: string;
}

// Instance 配置类型
export interface InstanceConfig {
  instance: string;
  name: string;
  theme: ThemeConfig;
  features?: Record<string, boolean>;
}

// Core 动态配置类型
export interface CoreDynamicConfig {
  instanceConfig: InstanceConfig;
  navGroups: NavGroup[];
  pageComponents: Record<string, () => Promise<{ default: any }>>;
  allRoutes?: Array<{ path: string; component: string; requireAuth?: boolean }>;
}

// 缓存 Core 配置
let cachedCoreConfig: CoreDynamicConfig | null = null;

// 异步加载 Core 配置
export async function loadCoreConfig(): Promise<CoreDynamicConfig | null> {
  if (cachedCoreConfig) return cachedCoreConfig;

  try {
    const { buildCoreConfig } = await import('@features/core');
    cachedCoreConfig = await buildCoreConfig();
    return cachedCoreConfig;
  } catch (error) {
    console.warn('Core features not available:', error);
    return null;
  }
}

interface InstanceContextType {
  config: InstanceConfig | null;
  loading: boolean;
  error: string | null;
  isFeatureEnabled: (featureKey: string) => boolean;
  isCore: boolean;
  coreConfig: CoreDynamicConfig | null;
}

const InstanceContext = createContext<InstanceContextType | undefined>(undefined);

export function InstanceProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<InstanceConfig | null>(null);
  const [coreConfig, setCoreConfig] = useState<CoreDynamicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function initializeConfig() {
      // Core 实例: 动态加载配置
      try {
        const dynamicConfig = await loadCoreConfig();
        if (dynamicConfig) {
          setCoreConfig(dynamicConfig);
          setConfig(dynamicConfig.instanceConfig);
          applyTheme(dynamicConfig.instanceConfig.theme, dynamicConfig.instanceConfig.instance);
          document.title = 'Perfect21';
        } else {
          setError('Failed to load Core configuration');
        }
      } catch (err) {
        console.error('Failed to load Core config:', err);
        setError('Failed to load Core configuration');
      }

      setLoading(false);
    }

    initializeConfig();
  }, []);

  // 应用主题到 CSS 变量
  const applyTheme = (theme: ThemeConfig, instance: string) => {
    const root = document.documentElement;
    root.style.setProperty('--primary-color', theme.primaryColor);
    root.style.setProperty('--sidebar-gradient', theme.sidebarGradient || 'linear-gradient(180deg, #1e3a8a 0%, #1e2a5e 100%)');

    // 计算派生颜色
    const primaryHex = theme.primaryColor;
    root.style.setProperty('--primary-color-light', `${primaryHex}20`);
    root.style.setProperty('--primary-color-medium', `${primaryHex}40`);
    root.style.setProperty('--primary-color-dark', adjustColor(primaryHex, -20));

    // 为 body 添加实例类名
    document.body.classList.add(`instance-${instance}`);

    // 更新 favicon
    if (theme.favicon) {
      const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (link) {
        link.href = theme.favicon;
      }
    }
  };

  // 检查 feature 是否启用 - Core 实例所有 feature 默认启用
  const isFeatureEnabled = (_featureKey: string): boolean => {
    return true;
  };

  // 始终为 Core 实例
  const isCore = true;

  return (
    <InstanceContext.Provider value={{ config, loading, error, isFeatureEnabled, isCore, coreConfig }}>
      {children}
    </InstanceContext.Provider>
  );
}

export function useInstance() {
  const context = useContext(InstanceContext);
  if (context === undefined) {
    throw new Error('useInstance must be used within an InstanceProvider');
  }
  return context;
}

// 辅助函数：调整颜色亮度
function adjustColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, Math.max(0, (num >> 16) + amt));
  const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amt));
  const B = Math.min(255, Math.max(0, (num & 0x0000FF) + amt));
  return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
}
