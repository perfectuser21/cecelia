/**
 * Auth utilities for Core features
 * Reads user info directly from cookie (shared with Autopilot)
 */

interface User {
  id: string;
  feishu_user_id?: string;
  name: string;
  avatar?: string;
  email?: string;
  department?: string;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Get current user from cookie
 */
export function getCurrentUser(): User | null {
  const userCookie = getCookie('user');
  if (!userCookie) return null;
  
  try {
    return JSON.parse(userCookie);
  } catch {
    return null;
  }
}

/**
 * Hook to get current user (for React components)
 */
export function useCurrentUser(): User | null {
  // Simple implementation - just read from cookie
  // In a real app, you might want to use useState/useEffect for reactivity
  return getCurrentUser();
}
