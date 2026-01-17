import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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
  features: Record<string, boolean>;
}

// Dashboard 配置（蓝色主题）
const dashboardConfig: InstanceConfig = {
  instance: 'dashboard',
  name: '悦升云端',
  theme: {
    logo: '/logo-white.png',
    logoCollapsed: 'Z',
    primaryColor: '#3467D6',
    sidebarGradient: 'linear-gradient(180deg, #1e3a8a 0%, #1e2a5e 100%)',
  },
  features: {
    'workbench': true,
    'execution-status': true,
    'tasks': true,
    'data-center': true,
    'content': true,
    'platform-status': true,
    'publish-stats': true,
    'scraping': true,
    'tools': true,
    'canvas': true,
    'settings': true,
  },
};

// Core 配置（AI黑客透明风格）
const ceciliaConfig: InstanceConfig = {
  instance: 'cecilia',
  name: 'Core',
  theme: {
    logo: '/logo-white.png',
    logoCollapsed: 'C',
    primaryColor: '#00d4ff',  // 电光青色
    secondaryColor: '#00ff88', // 霓虹绿
    sidebarGradient: 'linear-gradient(180deg, rgba(0,10,20,0.95) 0%, rgba(0,20,40,0.9) 50%, rgba(0,30,50,0.85) 100%)',
  },
  features: {
    // Engine 功能
    'engine-capabilities': true,
    'task-monitor': true,
    // Cecilia 功能
    'cecilia-tasks': true,
    'cecilia-history': true,
    'cecilia-stats': true,
    'cecilia-logs': true,
    // 通用
    'settings': true,
  },
};

// 根据域名获取配置
function getConfigByHostname(): InstanceConfig {
  const hostname = window.location.hostname;

  if (hostname.startsWith('core.') || hostname.includes('core')) {
    return ceciliaConfig;
  }

  return dashboardConfig;
}

interface InstanceContextType {
  config: InstanceConfig | null;
  loading: boolean;
  error: string | null;
  isFeatureEnabled: (featureKey: string) => boolean;
  isCecilia: boolean;
}

const InstanceContext = createContext<InstanceContextType | undefined>(undefined);

export function InstanceProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<InstanceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 根据域名自动选择配置
    const selectedConfig = getConfigByHostname();
    setConfig(selectedConfig);
    applyTheme(selectedConfig.theme);

    // 更新页面标题
    document.title = selectedConfig.instance === 'cecilia'
      ? 'Cecilia - AI Code Executor'
      : '悦升云端 - 运营中台';

    setLoading(false);
  }, []);

  // 应用主题到 CSS 变量
  const applyTheme = (theme: ThemeConfig) => {
    const root = document.documentElement;
    root.style.setProperty('--primary-color', theme.primaryColor);
    root.style.setProperty('--sidebar-gradient', theme.sidebarGradient || 'linear-gradient(180deg, #1e3a8a 0%, #1e2a5e 100%)');

    // 计算派生颜色
    const primaryHex = theme.primaryColor;
    root.style.setProperty('--primary-color-light', `${primaryHex}20`);
    root.style.setProperty('--primary-color-medium', `${primaryHex}40`);
    root.style.setProperty('--primary-color-dark', adjustColor(primaryHex, -20));

    // 更新 favicon
    if (theme.favicon) {
      const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (link) {
        link.href = theme.favicon;
      }
    }
  };

  // 检查 feature 是否启用
  const isFeatureEnabled = (featureKey: string): boolean => {
    if (!config) return false;
    return config.features[featureKey] === true;
  };

  // 是否为 Cecilia 实例
  const isCecilia = config?.instance === 'cecilia';

  return (
    <InstanceContext.Provider value={{ config, loading, error, isFeatureEnabled, isCecilia }}>
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
