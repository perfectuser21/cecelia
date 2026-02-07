/**
 * Area Detail - 显示 Area 的树形 OKR 视图
 */

import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';
import { SkeletonCard } from '../../shared/components/LoadingState';

interface Goal {
  id: string;
  parent_id: string | null;
  title: string;
  status: string;
  priority: string;
  progress: number;
  business_id: string | null;
  project_id: string | null;
  department_id: string | null;
  expected_start_date: string | null;
  expected_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  business?: {
    id: string;
    name: string;
  };
  project?: {
    id: string;
    name: string;
  };
  department?: {
    id: string;
    name: string;
  };
}

interface Business {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
}

interface Department {
  id: string;
  name: string;
}

const priorityColors: Record<string, string> = {
  P0: 'bg-red-100 text-red-800 border-red-300',
  P1: 'bg-orange-100 text-orange-800 border-orange-300',
  P2: 'bg-yellow-100 text-yellow-800 border-yellow-300',
};

const statusColors: Record<string, string> = {
  pending: 'text-gray-500',
  in_progress: 'text-blue-600',
  completed: 'text-green-600',
  blocked: 'text-red-600',
};

function formatDate(date: string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function OKRNode({
  goal,
  level,
  expandedNodes,
  onToggle,
}: {
  goal: Goal & { children: Goal[] };
  level: number;
  expandedNodes: Set<string>;
  onToggle: (id: string) => void;
}) {
  const isExpanded = expandedNodes.has(goal.id);
  const hasChildren = goal.children.length > 0;

  const levelLabel = level === 0 ? 'Area OKR' : level === 1 ? 'Project OKR' : 'SubProject OKR';

  return (
    <div>
      {/* OKR 节点 */}
      <div
        className="flex items-start gap-3 p-4 rounded-lg hover:bg-gray-50 transition-colors"
        style={{ marginLeft: `${level * 24}px` }}
      >
        {/* 展开/折叠图标 */}
        <div className="w-4 h-4 flex-shrink-0 mt-1">
          {hasChildren ? (
            <button
              onClick={() => onToggle(goal.id)}
              className="text-gray-500 hover:text-gray-700"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          ) : (
            <div className="w-1 h-1 bg-gray-300 rounded-full ml-1.5" />
          )}
        </div>

        {/* 内容 */}
        <div className="flex-1">
          {/* 标题行 */}
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-base font-semibold text-gray-900">{goal.title}</h3>

            {/* 优先级 */}
            <span className={`px-2 py-0.5 text-xs font-semibold rounded border ${
              priorityColors[goal.priority] || 'bg-gray-100 text-gray-800 border-gray-300'
            }`}>
              {goal.priority}
            </span>

            {/* 状态 */}
            <span className={`text-xs font-medium ${statusColors[goal.status] || 'text-gray-500'}`}>
              {goal.status}
            </span>

            {/* 层级标签 */}
            <span className="text-xs text-gray-400">({levelLabel})</span>
          </div>

          {/* 进度条 */}
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${goal.progress}%` }}
              />
            </div>
            <span className="text-sm text-gray-600 font-medium w-12 text-right">
              {goal.progress}%
            </span>
          </div>

          {/* 时间信息 */}
          {goal.expected_start_date && goal.expected_end_date && (
            <div className="text-xs text-gray-500">
              Expected: {formatDate(goal.expected_start_date)} ~ {formatDate(goal.expected_end_date)}
              {goal.actual_start_date && (
                <>
                  {' | '}Actual: {formatDate(goal.actual_start_date)}
                  {goal.actual_end_date && ` ~ ${formatDate(goal.actual_end_date)}`}
                </>
              )}
            </div>
          )}

          {/* Project/Department 信息 */}
          {(goal.project || goal.department) && (
            <div className="text-xs text-gray-400 mt-1">
              {goal.project && `Project: ${goal.project.name}`}
              {goal.department && ` | SubProject: ${goal.department.name}`}
            </div>
          )}
        </div>
      </div>

      {/* 子节点 */}
      {isExpanded && hasChildren && (
        <div>
          {goal.children.map(child => (
            <OKRNode
              key={child.id}
              goal={child}
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

export default function AreaDetail() {
  const { areaId } = useParams<{ areaId: string }>();
  const navigate = useNavigate();
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // 获取 Area 信息
  const { data: business } = useApi<Business>(`/api/tasks/businesses/${areaId}`, {
    fetcher: async () => {
      const response = await fetch(`/api/tasks/businesses/${areaId}`);
      if (!response.ok) throw new Error('Failed to fetch business');
      return response.json();
    },
  });

  // 获取所有 goals
  const { data: allGoals, loading } = useApi<Goal[]>('/api/tasks/goals', {
    fetcher: async () => {
      const response = await fetch('/api/tasks/goals');
      if (!response.ok) throw new Error('Failed to fetch goals');
      return response.json();
    },
  });

  // 过滤该 Area 的 goals
  const areaGoals = useMemo(() => {
    if (!allGoals) return [];
    return allGoals.filter(goal => goal.business_id === areaId);
  }, [allGoals, areaId]);

  // 构建树形结构
  const tree = useMemo(() => {
    const goalsMap = new Map<string, Goal & { children: Goal[] }>();
    areaGoals.forEach((goal) => {
      goalsMap.set(goal.id, { ...goal, children: [] });
    });

    const roots: (Goal & { children: Goal[] })[] = [];
    areaGoals.forEach((goal) => {
      const node = goalsMap.get(goal.id)!;
      if (goal.parent_id && goalsMap.has(goal.parent_id)) {
        goalsMap.get(goal.parent_id)!.children.push(node);
      } else {
        // 只有 Area 层级的 OKR 作为根节点（有 business_id，没有 project_id）
        if (!goal.project_id) {
          roots.push(node);
        }
      }
    });

    return roots;
  }, [areaGoals]);

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
      {/* 返回按钮 */}
      <button
        onClick={() => navigate('/work/okr')}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back to Dashboard</span>
      </button>

      {/* 标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          {business?.name} Area
        </h1>
        <p className="text-gray-600 mt-1">
          {areaGoals.length} OKRs total
        </p>
      </div>

      {/* OKR 树形视图 */}
      <div className="bg-white rounded-lg border border-gray-200">
        {tree.length > 0 ? (
          <div>
            {tree.map(node => (
              <OKRNode
                key={node.id}
                goal={node}
                level={0}
                expandedNodes={expandedNodes}
                onToggle={toggleNode}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">
            No OKRs found for this area.
          </div>
        )}
      </div>
    </div>
  );
}
