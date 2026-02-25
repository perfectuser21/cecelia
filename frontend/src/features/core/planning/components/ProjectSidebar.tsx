import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  FolderOpen,
  Plus,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Trash2,
  Clock,
  FileText,
  Check,
  X,
} from 'lucide-react';

export interface WhiteboardProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
}

interface ProjectSidebarProps {
  projects: WhiteboardProject[];
  currentProjectId: string | null;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;
  return date.toLocaleDateString('zh-CN');
}

export default function ProjectSidebar({
  projects,
  currentProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onRenameProject,
  isCollapsed,
  onToggleCollapse,
}: ProjectSidebarProps) {
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Sort projects by updatedAt (most recent first) for history section
  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenu]);

  // Focus input when editing
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleContextMenu = useCallback((e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ id: projectId, x: e.clientX, y: e.clientY });
  }, []);

  const handleStartRename = useCallback((project: WhiteboardProject) => {
    setEditingId(project.id);
    setEditingName(project.name);
    setContextMenu(null);
  }, []);

  const handleConfirmRename = useCallback(() => {
    if (editingId && editingName.trim()) {
      onRenameProject(editingId, editingName.trim());
    }
    setEditingId(null);
    setEditingName('');
  }, [editingId, editingName, onRenameProject]);

  const handleCancelRename = useCallback(() => {
    setEditingId(null);
    setEditingName('');
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirmRename();
    } else if (e.key === 'Escape') {
      handleCancelRename();
    }
  }, [handleConfirmRename, handleCancelRename]);

  const handleDeleteClick = useCallback((projectId: string) => {
    setDeleteConfirmId(projectId);
    setContextMenu(null);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (deleteConfirmId) {
      onDeleteProject(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  }, [deleteConfirmId, onDeleteProject]);

  const handleCancelDelete = useCallback(() => {
    setDeleteConfirmId(null);
  }, []);

  // Collapsed state
  if (isCollapsed) {
    return (
      <div className="w-12 h-full border-r border-slate-700/50 flex flex-col items-center py-3 gap-2" style={{ background: 'linear-gradient(180deg, #1e2a5e 0%, #1e1b4b 100%)' }}>
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          title="展开侧边栏"
        >
          <ChevronRight size={18} />
        </button>
        <div className="w-8 h-px bg-slate-700 my-1" />
        <button
          onClick={onCreateProject}
          className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-blue-400 transition-colors"
          title="新建项目"
        >
          <Plus size={18} />
        </button>
        <button
          className="p-2 rounded-lg text-slate-400 cursor-default"
          title="项目列表"
        >
          <FolderOpen size={18} />
        </button>
        <button
          className="p-2 rounded-lg text-slate-400 cursor-default"
          title="最近项目"
        >
          <Clock size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-60 h-full border-r border-slate-700/50 flex flex-col" style={{ background: 'linear-gradient(180deg, #1e2a5e 0%, #1e1b4b 100%)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-slate-700">
        <div className="flex items-center gap-2 text-slate-200 font-medium">
          <FolderOpen size={18} className="text-slate-400" />
          <span>项目管理</span>
        </div>
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          title="收起侧边栏"
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      {/* New Project Button */}
      <div className="px-3 py-2">
        <button
          onClick={onCreateProject}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          新建项目
        </button>
      </div>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2">
          <div className="text-xs text-slate-500 font-medium mb-2 flex items-center gap-1.5">
            <FileText size={12} />
            所有项目 ({projects.length})
          </div>
          <div className="space-y-1">
            {projects.length === 0 ? (
              <div className="text-sm text-slate-500 py-4 text-center">
                暂无项目
              </div>
            ) : (
              projects.map((project) => (
                <div
                  key={project.id}
                  className={`group relative flex items-center px-2 py-2 rounded-lg cursor-pointer transition-colors ${
                    currentProjectId === project.id
                      ? 'bg-blue-600/20 text-blue-400'
                      : 'hover:bg-slate-800 text-slate-300'
                  }`}
                  onClick={() => onSelectProject(project.id)}
                  onContextMenu={(e) => handleContextMenu(e, project.id)}
                >
                  {editingId === project.id ? (
                    <div className="flex-1 flex items-center gap-1">
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onBlur={handleConfirmRename}
                        className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConfirmRename();
                        }}
                        className="p-1 text-green-400 hover:text-green-300"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelRename();
                        }}
                        className="p-1 text-red-400 hover:text-red-300"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{project.name}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-2">
                          <span>{project.nodeCount} 节点</span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleContextMenu(e, project.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-all"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Projects (History) */}
        {recentProjects.length > 0 && (
          <div className="px-3 py-2 border-t border-slate-800">
            <div className="text-xs text-slate-500 font-medium mb-2 flex items-center gap-1.5">
              <Clock size={12} />
              最近编辑
            </div>
            <div className="space-y-1">
              {recentProjects.map((project) => (
                <div
                  key={`recent-${project.id}`}
                  className={`flex items-center px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                    currentProjectId === project.id
                      ? 'bg-blue-600/10 text-blue-400'
                      : 'hover:bg-slate-800/50 text-slate-400'
                  }`}
                  onClick={() => onSelectProject(project.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate">{project.name}</div>
                    <div className="text-[10px] text-slate-600">
                      {formatRelativeTime(project.updatedAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-slate-700 text-xs text-slate-500">
        共 {projects.length} 个项目
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 z-50 min-w-[120px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              const project = projects.find((p) => p.id === contextMenu.id);
              if (project) handleStartRename(project);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
          >
            <Pencil size={14} />
            重命名
          </button>
          <button
            onClick={() => handleDeleteClick(contextMenu.id)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-slate-700 transition-colors"
          >
            <Trash2 size={14} />
            删除
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-4 max-w-sm mx-4">
            <h3 className="text-lg font-medium text-slate-200 mb-2">确认删除</h3>
            <p className="text-sm text-slate-400 mb-4">
              确定要删除项目 "{projects.find((p) => p.id === deleteConfirmId)?.name}" 吗？此操作无法撤销。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelDelete}
                className="px-3 py-1.5 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
