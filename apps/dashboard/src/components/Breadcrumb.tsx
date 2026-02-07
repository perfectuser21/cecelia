import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { NavGroup } from '../config/navigation.config';

interface BreadcrumbProps {
  navGroups: NavGroup[];
}

interface BreadcrumbSegment {
  label: string;
  path: string;
  icon?: any;
}

export default function Breadcrumb({ navGroups }: BreadcrumbProps) {
  const location = useLocation();
  const segments: BreadcrumbSegment[] = [];

  // Find matching parent > child from navGroups
  for (const group of navGroups) {
    for (const item of group.items) {
      // Check children first for deeper match
      if (item.children && item.children.length > 0) {
        for (const child of item.children) {
          if (location.pathname === child.path || location.pathname.startsWith(child.path + '/')) {
            // Don't add parent if child path === parent path (e.g. /today -> Daily)
            if (child.path !== item.path) {
              segments.push({ label: item.label, path: item.path, icon: item.icon });
            }
            segments.push({ label: child.label, path: child.path, icon: child.icon });
            break;
          }
        }
        if (segments.length > 0) break;
      }

      // Fallback: exact match on parent (no child match)
      if (location.pathname === item.path || location.pathname.startsWith(item.path + '/')) {
        segments.push({ label: item.label, path: item.path, icon: item.icon });
        break;
      }
    }
    if (segments.length > 0) break;
  }

  // Single segment or none: show as simple title
  if (segments.length <= 1) {
    const label = segments[0]?.label || '工作台';
    return (
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
        {label}
      </h2>
    );
  }

  // Multiple segments: breadcrumb
  return (
    <nav className="flex items-center gap-1.5 text-sm">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <span key={segment.path} className="flex items-center gap-1.5">
            {index > 0 && (
              <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
            )}
            {isLast ? (
              <span className="font-semibold text-gray-900 dark:text-white">
                {segment.label}
              </span>
            ) : (
              <Link
                to={segment.path}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                {segment.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
