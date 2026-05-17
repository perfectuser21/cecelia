/**
 * 类型桩：apps/api/features 的对外接口声明
 *
 * 运行时通过 Vite alias 解析（moduleResolution: bundler），
 * tsc 用这里的桩类型完成静态检查，不编译 api 目录源文件。
 */

declare module '@features/core' {
  export interface NavGroupItem {
    path: string;
    icon: string;
    label: string;
    featureKey: string;
    component?: string;
    requireSuperAdmin?: boolean;
    children?: NavGroupItem[];
  }
  export interface NavGroup {
    title: string;
    items: NavGroupItem[];
  }
  export interface CoreConfig {
    instanceConfig: {
      instance: string;
      name: string;
      theme: {
        logo: string;
        logoCollapsed?: string;
        favicon?: string;
        primaryColor: string;
        secondaryColor?: string;
        sidebarGradient?: string;
      };
      features?: Record<string, boolean>;
    };
    navGroups: NavGroup[];
    pageComponents: Record<string, () => Promise<{ default: any }>>;
    allRoutes?: Array<{ path: string; component: string; requireAuth?: boolean }>;
  }
  export function buildCoreConfig(): Promise<CoreConfig>;
}

declare module '@features/core/shared/components/CeceliaChat' {
  const CeceliaChat: React.ComponentType<Record<string, never>>;
  export default CeceliaChat;
}
