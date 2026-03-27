import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Clock, FileCode, BookOpen } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

interface ModuleItem {
  id: string;
  title: string;
  desc: string;
  priority: string;
  status: string;
  output_url: string | null;
  source_files: string[];
  completed: string | null;
}

interface ModuleGroup {
  id: string;
  label: string;
  items: ModuleItem[];
}

interface ModulesData {
  meta: Record<string, unknown>;
  groups: ModuleGroup[];
}

const PRIORITY_LABEL: Record<string, string> = {
  P0: '最高优先级',
  P1: '高优先级',
  P2: '一般',
};

const PRIORITY_COLOR: Record<string, string> = {
  P0: 'text-red-600 bg-red-50 border-red-200',
  P1: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  P2: 'text-gray-500 bg-gray-50 border-gray-200',
};

export default function KnowledgeModuleDetail() {
  const { groupId, moduleId } = useParams<{ groupId: string; moduleId: string }>();
  const navigate = useNavigate();

  const { data, loading, error } = useApi<ModulesData>(
    '/api/brain/knowledge/modules',
    { staleTime: 300_000 }
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>加载失败：{error || '未知错误'}</p>
      </div>
    );
  }

  const group = data.groups.find(g => g.id === groupId);
  const module = group?.items.find(i => i.id === moduleId);

  if (!group || !module) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">模块不存在</p>
        <button
          onClick={() => navigate('/knowledge/modules')}
          className="text-blue-600 hover:underline text-sm"
        >
          返回模块列表
        </button>
      </div>
    );
  }

  const isDone = module.status === 'done';

  return (
    <div className="max-w-3xl mx-auto">
      {/* 返回按钮 */}
      <button
        onClick={() => navigate('/knowledge/modules')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        <span>返回模块列表</span>
      </button>

      {/* 标题卡片 */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h1 className="text-xl font-bold text-gray-900 leading-tight">{module.title}</h1>
          <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded border ${PRIORITY_COLOR[module.priority] || PRIORITY_COLOR.P2}`}>
            {module.priority} · {PRIORITY_LABEL[module.priority] || '一般'}
          </span>
        </div>
        <p className="text-gray-600 text-sm leading-relaxed mb-4">{module.desc}</p>
        <div className="flex items-center gap-4 text-sm">
          <div className={`flex items-center gap-1.5 ${isDone ? 'text-green-600' : 'text-gray-400'}`}>
            {isDone ? <CheckCircle size={15} /> : <Clock size={15} />}
            <span>{isDone ? `已完成 · ${module.completed || ''}` : '知识页待生成'}</span>
          </div>
          <span className="text-gray-300">·</span>
          <span className="text-gray-400">{group.label}</span>
        </div>
      </div>

      {/* 来源文件 */}
      {module.source_files.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <FileCode size={15} />
            来源文件
          </h2>
          <ul className="space-y-1.5">
            {module.source_files.map(file => (
              <li key={file} className="text-sm font-mono text-gray-600 bg-gray-50 rounded px-3 py-1.5">
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 知识页链接 */}
      {isDone && module.output_url && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-blue-700 mb-3">深度知识页</h2>
          <p className="text-sm text-blue-600 mb-3">
            此模块已由西安 Codex 生成完整的深度知识 HTML 页面。
          </p>
          <button
            onClick={() => navigate(`/knowledge/view?url=${encodeURIComponent(module.output_url!)}`)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 bg-white border border-blue-300 rounded-lg px-4 py-2 hover:border-blue-500 transition-colors"
          >
            <BookOpen size={14} />
            在 Dashboard 中查看
          </button>
        </div>
      )}
    </div>
  );
}
