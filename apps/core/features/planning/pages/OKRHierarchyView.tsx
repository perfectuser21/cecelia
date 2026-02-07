/**
 * OKR Hierarchy View
 * Tree view showing Personal → Business → Department OKR layers
 */

import React, { useState, useMemo } from 'react';
import { useApi } from '../../shared/hooks/useApi';
import { SkeletonCard } from '../../shared/components/LoadingState';

interface Goal {
  id: string;
  parent_id: string | null;
  title: string;
  type: 'objective' | 'key_result';
  scope: 'personal' | 'business' | 'department' | null;
  cycle: '3months' | '1month' | '2weeks' | null;
  status: string;
  priority: string;
  progress: number;
  business_id: string | null;
  department_id: string | null;
  expected_start_date: string | null;
  expected_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  business?: {
    id: string;
    name: string;
  };
  department?: {
    id: string;
    name: string;
  };
}

export default function OKRHierarchyView() {
  const { data: allGoals, loading } = useApi<Goal[]>('/api/tasks/goals', {
    fetcher: async () => {
      const response = await fetch('/api/tasks/goals');
      if (!response.ok) throw new Error('Failed to fetch goals');
      return response.json();
    },
  });

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Build tree structure
  const tree = useMemo(() => {
    if (!allGoals) return [];

    const goalsMap = new Map<string, Goal & { children: Goal[] }>();
    allGoals.forEach((goal) => {
      goalsMap.set(goal.id, { ...goal, children: [] });
    });

    const roots: (Goal & { children: Goal[] })[] = [];
    allGoals.forEach((goal) => {
      const node = goalsMap.get(goal.id)!;
      if (goal.parent_id && goalsMap.has(goal.parent_id)) {
        goalsMap.get(goal.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    // Sort by scope: personal → business → department
    const scopeOrder = { personal: 1, business: 2, department: 3, null: 4 };
    return roots.sort((a, b) => scopeOrder[a.scope || 'null'] - scopeOrder[b.scope || 'null']);
  }, [allGoals]);

  const toggleNode = (id: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedNodes(newExpanded);
  };

  if (loading) {
    return (
      <div className="p-6">
        <SkeletonCard count={3} />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">OKR Hierarchy</h1>
        <p className="text-gray-600 mt-1">
          Personal (3 months) → Business (1 month) → Department (2 weeks)
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        {tree.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No OKRs yet. Create some to see the hierarchy.
          </div>
        ) : (
          <div className="space-y-2">
            {tree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                level={0}
                expandedNodes={expandedNodes}
                onToggle={toggleNode}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  level,
  expandedNodes,
  onToggle,
}: {
  node: Goal & { children: Goal[] };
  level: number;
  expandedNodes: Set<string>;
  onToggle: (id: string) => void;
}) {
  const isExpanded = expandedNodes.has(node.id);
  const hasChildren = node.children.length > 0;

  const scopeColors = {
    personal: 'bg-purple-100 text-purple-800',
    business: 'bg-blue-100 text-blue-800',
    department: 'bg-green-100 text-green-800',
  };

  const priorityColors = {
    P0: 'bg-red-100 text-red-800',
    P1: 'bg-orange-100 text-orange-800',
    P2: 'bg-yellow-100 text-yellow-800',
  };

  return (
    <div>
      <div
        className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
        style={{ paddingLeft: `${level * 24 + 12}px` }}
      >
        {/* Expand/Collapse Icon */}
        <div className="w-4 h-4 flex-shrink-0">
          {hasChildren ? (
            <button onClick={() => onToggle(node.id)} className="text-gray-500 hover:text-gray-700">
              {isExpanded ? '▼' : '▶'}
            </button>
          ) : (
            <span className="text-gray-300">•</span>
          )}
        </div>

        {/* Icon */}
        <div className="text-lg">
          {node.type === 'objective' ? '🎯' : '📊'}
        </div>

        {/* Title */}
        <div className="flex-1 font-medium text-gray-900">{node.title}</div>

        {/* Scope Badge */}
        {node.scope && (
          <span className={`px-2 py-1 text-xs font-semibold rounded ${scopeColors[node.scope]}`}>
            {node.scope}
          </span>
        )}

        {/* Priority Badge */}
        <span className={`px-2 py-1 text-xs font-semibold rounded ${priorityColors[node.priority] || 'bg-gray-100 text-gray-800'}`}>
          {node.priority}
        </span>

        {/* Progress Bar */}
        <div className="w-32">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${node.progress}%` }}
              />
            </div>
            <span className="text-xs text-gray-600 w-8 text-right">{node.progress}%</span>
          </div>
        </div>

        {/* Business/Department Tag */}
        {node.business && (
          <span className="text-xs text-gray-500">→ {node.business.name}</span>
        )}
        {node.department && (
          <span className="text-xs text-gray-500">→ {node.department.name}</span>
        )}
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              expandedNodes={expandedNodes}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
