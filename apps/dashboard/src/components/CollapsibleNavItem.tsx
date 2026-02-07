import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { NavItem } from '../config/navigation.config';

interface CollapsibleNavItemProps {
  item: NavItem;
  collapsed: boolean;
  currentPath: string;
}

export default function CollapsibleNavItem({
  item,
  collapsed,
  currentPath,
}: CollapsibleNavItemProps) {
  const Icon = item.icon;
  const children = item.children || [];

  // Check if any child is active
  const isChildActive = children.some(
    (child) => currentPath === child.path || currentPath.startsWith(child.path + '/')
  );
  const isParentExactActive = currentPath === item.path;
  const isParentActive = isChildActive || isParentExactActive;

  // Expand state: localStorage + auto-expand when child active
  const storageKey = `nav-expanded-${item.path}`;
  const [expanded, setExpanded] = useState(() => {
    if (isChildActive) return true;
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === 'true';
    } catch {
      return false;
    }
  });

  // Auto-expand when a child becomes active
  const prevChildActive = useRef(isChildActive);
  useEffect(() => {
    if (isChildActive && !prevChildActive.current) {
      setExpanded(true);
    }
    prevChildActive.current = isChildActive;
  }, [isChildActive]);

  // Persist expand state
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(expanded));
    } catch {
      // ignore
    }
  }, [expanded, storageKey]);

  const toggleExpand = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpanded(!expanded);
  };

  // Sidebar collapsed: just show icon, no children
  if (collapsed) {
    return (
      <Link
        to={item.path}
        title={item.label}
        className={`group relative flex items-center justify-center px-2 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${
          isParentActive
            ? 'bg-slate-600/30 text-white'
            : 'text-slate-400 hover:bg-white/5 hover:text-white'
        }`}
      >
        {isParentActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-slate-400" />
        )}
        <Icon className={`w-5 h-5 transition-transform duration-200 ${
          isParentActive
            ? 'text-slate-300'
            : 'text-slate-500 group-hover:text-white group-hover:scale-110'
        }`} />
      </Link>
    );
  }

  return (
    <div>
      {/* Parent item row */}
      <div
        className={`group relative flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 cursor-pointer ${
          isParentActive && !isChildActive
            ? 'bg-slate-600/30 text-white'
            : isParentActive
              ? 'text-white'
              : 'text-slate-400 hover:bg-white/5 hover:text-white'
        }`}
      >
        {isParentActive && !isChildActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-slate-400" />
        )}
        <Link to={item.path} className="flex items-center flex-1 min-w-0">
          <Icon className={`w-5 h-5 mr-3 flex-shrink-0 transition-transform duration-200 ${
            isParentActive
              ? 'text-slate-300'
              : 'text-slate-500 group-hover:text-white group-hover:scale-110'
          }`} />
          <span className="truncate">{item.label}</span>
        </Link>
        {/* Chevron toggle */}
        <button
          onClick={toggleExpand}
          className="ml-1 p-0.5 rounded transition-all duration-200 flex-shrink-0 text-slate-500 hover:text-slate-300 hover:bg-white/5"
        >
          <ChevronRight
            className={`w-4 h-4 transition-transform duration-200 ${
              expanded ? 'rotate-90' : ''
            }`}
          />
        </button>
      </div>

      {/* Children with CSS grid animation */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="pl-9 mt-0.5 space-y-0.5">
            {children.map((child) => {
              const ChildIcon = child.icon;
              const isActive = currentPath === child.path || currentPath.startsWith(child.path + '/');
              return (
                <Link
                  key={child.path}
                  to={child.path}
                  className={`group relative flex items-center px-3 py-2 text-[13px] font-medium rounded-lg transition-all duration-200 ${
                    isActive
                      ? 'bg-slate-600/25 text-white'
                      : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r-full bg-slate-400" />
                  )}
                  <ChildIcon className={`w-4 h-4 mr-2.5 flex-shrink-0 ${
                    isActive
                      ? 'text-slate-300'
                      : 'text-slate-600 group-hover:text-slate-400'
                  }`} />
                  <span className="truncate">{child.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
