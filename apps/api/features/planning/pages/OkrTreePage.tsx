import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, Target, Layers, FolderKanban, Eye, Rocket, CheckSquare } from 'lucide-react';
import StatusIcon from '../../shared/components/StatusIcon';

interface TreeTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  completed_at: string | null;
}

interface TreeInitiative {
  id: string;
  title: string;
  status: string;
  tasks: TreeTask[];
}

interface TreeScope {
  id: string;
  title: string;
  status: string;
  okr_initiatives: TreeInitiative[];
}

interface TreeProject {
  id: string;
  title: string;
  status: string;
  okr_scopes: TreeScope[];
}

interface TreeKR {
  id: string;
  title: string;
  status: string;
  current_value?: number;
  target_value?: number;
  unit?: string;
  okr_projects: TreeProject[];
}

interface TreeObjective {
  id: string;
  title: string;
  status: string;
  key_results: TreeKR[];
}

interface TreeVision {
  id: string;
  title: string;
  status: string;
  objectives: TreeObjective[];
}

type NodeType = 'vision' | 'objective' | 'kr' | 'project' | 'scope' | 'initiative' | 'task';

const NODE_CONFIG: Record<NodeType, { icon: typeof Target; color: string; bgColor: string; label: string }> = {
  vision: { icon: Target, color: 'text-purple-600 dark:text-purple-400', bgColor: 'bg-purple-50 dark:bg-purple-900/20', label: 'Vision' },
  objective: { icon: Target, color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/20', label: 'Objective' },
  kr: { icon: Layers, color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/20', label: 'KR' },
  project: { icon: FolderKanban, color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-50 dark:bg-orange-900/20', label: 'Project' },
  scope: { icon: Eye, color: 'text-cyan-600 dark:text-cyan-400', bgColor: 'bg-cyan-50 dark:bg-cyan-900/20', label: 'Scope' },
  initiative: { icon: Rocket, color: 'text-pink-600 dark:text-pink-400', bgColor: 'bg-pink-50 dark:bg-pink-900/20', label: 'Initiative' },
  task: { icon: CheckSquare, color: 'text-gray-600 dark:text-gray-400', bgColor: 'bg-gray-50 dark:bg-gray-900/20', label: 'Task' },
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  in_progress: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  pending: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  archived: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || STATUS_COLORS.pending}`}>
      <StatusIcon status={status} className="w-3 h-3 mr-1" />
      {status}
    </span>
  );
}

function TreeNode({ type, title, status, children, detail, depth = 0, expandAll }: {
  type: NodeType;
  title: string;
  status: string;
  children?: React.ReactNode;
  detail?: React.ReactNode;
  depth?: number;
  expandAll?: boolean;
}) {
  const [expanded, setExpanded] = useState(expandAll ?? depth < 2);
  const config = NODE_CONFIG[type];
  const Icon = config.icon;
  const hasChildren = !!children;

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-gray-200 dark:border-gray-700 pl-3' : ''}>
      <div
        className={`flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${expanded ? config.bgColor : ''}`}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          expanded ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        ) : (
          <span className="w-4 h-4 flex-shrink-0" />
        )}
        <Icon className={`w-4 h-4 flex-shrink-0 ${config.color}`} />
        <span className={`text-xs font-medium uppercase tracking-wide ${config.color}`}>{config.label}</span>
        <span className="text-sm font-medium text-gray-900 dark:text-white truncate flex-1">{title}</span>
        <StatusBadge status={status} />
        {detail}
      </div>
      {expanded && hasChildren && <div className="mt-1">{children}</div>}
    </div>
  );
}

export default function OkrTreePage() {
  const [tree, setTree] = useState<TreeVision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState(false);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/brain/okr/tree');
      const data = await res.json();
      if (data.success) {
        setTree(data.tree);
      } else {
        setError(data.error || 'Failed to load OKR tree');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  const countNodes = (visions: TreeVision[]) => {
    let count = { visions: 0, objectives: 0, krs: 0, projects: 0, scopes: 0, initiatives: 0, tasks: 0 };
    for (const v of visions) {
      count.visions++;
      for (const o of v.objectives) {
        count.objectives++;
        for (const kr of o.key_results) {
          count.krs++;
          for (const p of kr.okr_projects) {
            count.projects++;
            for (const s of p.okr_scopes) {
              count.scopes++;
              for (const i of s.okr_initiatives) {
                count.initiatives++;
                count.tasks += i.tasks.length;
              }
            }
          }
        }
      }
    }
    return count;
  };

  const stats = countNodes(tree);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">OKR Tree</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {stats.visions} Vision · {stats.objectives} Objective · {stats.krs} KR · {stats.projects} Project · {stats.scopes} Scope · {stats.initiatives} Initiative · {stats.tasks} Task
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpandAll(!expandAll)}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {expandAll ? '收起全部' : '展开全部'}
          </button>
          <button
            onClick={fetchTree}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {tree.length === 0 && !error ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>暂无 OKR 数据</p>
        </div>
      ) : (
        <div key={expandAll ? 'expanded' : 'collapsed'} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2">
          {tree.map(vision => (
            <TreeNode key={vision.id} type="vision" title={vision.title} status={vision.status} expandAll={expandAll}>
              {vision.objectives.map(obj => (
                <TreeNode key={obj.id} type="objective" title={obj.title} status={obj.status} depth={1} expandAll={expandAll}>
                  {obj.key_results.map(kr => (
                    <TreeNode
                      key={kr.id}
                      type="kr"
                      title={kr.title}
                      status={kr.status}
                      depth={2}
                      expandAll={expandAll}
                      detail={kr.target_value ? (
                        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {kr.current_value ?? 0}/{kr.target_value} {kr.unit || ''}
                        </span>
                      ) : undefined}
                    >
                      {kr.okr_projects.map(proj => (
                        <TreeNode key={proj.id} type="project" title={proj.title} status={proj.status} depth={3} expandAll={expandAll}>
                          {proj.okr_scopes.map(scope => (
                            <TreeNode key={scope.id} type="scope" title={scope.title} status={scope.status} depth={4} expandAll={expandAll}>
                              {scope.okr_initiatives.map(init => (
                                <TreeNode key={init.id} type="initiative" title={init.title} status={init.status} depth={5} expandAll={expandAll}>
                                  {init.tasks.map(task => (
                                    <TreeNode key={task.id} type="task" title={task.title} status={task.status} depth={6} expandAll={expandAll} />
                                  ))}
                                </TreeNode>
                              ))}
                            </TreeNode>
                          ))}
                        </TreeNode>
                      ))}
                    </TreeNode>
                  ))}
                </TreeNode>
              ))}
            </TreeNode>
          ))}
        </div>
      )}
    </div>
  );
}
