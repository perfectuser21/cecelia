/**
 * DocList — 文档列表页
 *
 * 展示所有 design_docs 文档，支持按类型筛选，点击进入编辑器
 * 路由：/docs/list
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, Search, ChevronRight } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

interface DocItem {
  id: string;
  type: string;
  title: string;
  status: string;
  area?: string;
  author: string;
  updated_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  diary: '日报',
  research: '调研',
  architecture: '架构',
  proposal: '提案',
  analysis: '分析',
  note: '笔记',
};

const TYPE_COLORS: Record<string, string> = {
  diary: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  research: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  architecture: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  proposal: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  analysis: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  note: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

export default function DocList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const url = typeFilter
    ? `/api/brain/design-docs?type=${typeFilter}&limit=50`
    : '/api/brain/design-docs?limit=50';

  const { data, loading } = useApi<{ success: boolean; data: DocItem[]; total: number }>(url, {
    staleTime: 30_000,
  });

  const docs = data?.data || [];

  const filtered = search.trim()
    ? docs.filter(d => d.title.toLowerCase().includes(search.toLowerCase()))
    : docs;

  async function createNewDoc() {
    const title = `新文档 ${new Date().toLocaleDateString('zh-CN')}`;
    try {
      const r = await fetch('/api/brain/design-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'note', title, content: '', author: 'user' }),
      });
      const data = await r.json();
      if (data.success && data.data?.id) {
        navigate(`/docs/${data.data.id}`);
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4" data-testid="doc-list">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <FileText className="text-blue-500" size={20} />
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">文档</h1>
          {data?.total !== undefined && (
            <span className="text-sm text-gray-400">（{data.total} 个）</span>
          )}
        </div>
        <button
          onClick={createNewDoc}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          <Plus size={14} /> 新建文档
        </button>
      </div>

      {/* 筛选栏 */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full pl-8 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:border-blue-400"
            placeholder="搜索文档标题..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="doc-search"
          />
        </div>
        <select
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          data-testid="type-filter"
        >
          <option value="">全部类型</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* 文档列表 */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          {search ? '没有匹配的文档' : '暂无文档，点击"新建文档"开始'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(doc => (
            <button
              key={doc.id}
              onClick={() => navigate(`/docs/${doc.id}`)}
              className="w-full flex items-center gap-3 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm transition-all text-left"
              data-testid={`doc-item-${doc.id}`}
            >
              <FileText size={16} className="text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{doc.title}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${TYPE_COLORS[doc.type] || TYPE_COLORS.note}`}>
                    {TYPE_LABELS[doc.type] || doc.type}
                  </span>
                </div>
                <div className="text-xs text-gray-400">
                  {doc.author} · {new Date(doc.updated_at).toLocaleDateString('zh-CN')}
                  {doc.area && ` · ${doc.area}`}
                </div>
              </div>
              <ChevronRight size={14} className="text-gray-300 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
