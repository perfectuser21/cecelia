import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect } from 'react';

interface User {
  id: string;
  name: string;
  avatar?: string;
  email?: string;
  department?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (user: User, token: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  authLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCAL_ADMIN: User = {
  id: 'local-admin',
  name: 'Admin',
  email: 'admin@local',
  department: 'System',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // 始终以超级管理员身份自动登录
  useEffect(() => {
    setUser(LOCAL_ADMIN);
    setToken('local-access-token');
    setAuthLoading(false);
  }, []);

  // 保留 login/logout 接口避免改消费者组件，但实际为空操作
  const login = (_user: User, _token: string) => {};
  const logout = () => {};

  const value = {
    user,
    token,
    login,
    logout,
    isAuthenticated: !!user && !!token,
    isSuperAdmin: true,
    authLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
