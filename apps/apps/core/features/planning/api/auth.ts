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
 * Falls back to default dev user if no cookie is set (local dev environment)
 */
export function getCurrentUser(): User {
  const userCookie = getCookie('user');
  if (userCookie) {
    try {
      return JSON.parse(userCookie);
    } catch {
      // Fall through to default
    }
  }

  // Default user for local dev environment (matches sidebar display)
  return { id: 'dev', name: '开发者' };
}

/**
 * Hook to get current user (for React components)
 */
export function useCurrentUser(): User {
  return getCurrentUser();
}
