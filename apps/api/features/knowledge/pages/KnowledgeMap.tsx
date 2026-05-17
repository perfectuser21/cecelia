import { useNavigate } from 'react-router-dom';
import { GitMerge, Scale, FolderOpen, BookOpen, Map } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

interface CountResult {
  success: boolean;
  total?: number;
  data?: unknown[];
}

function MapCard({
  title,
  description,
  icon: Icon,
  path,
  color,
  count,
  loading,
}: {
  title: string;
  description: string;
  icon: typeof Map;
  path: string;
  color: string;
  count?: number;
  loading: boolean;
}) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(path)}
      className="bg-white border border-gray-200 rounded-xl p-5 text-left hover:border-gray-400 hover:shadow-md transition-all group"
    >
      <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center mb-3`}>
        <Icon size={20} className="text-white" />
      </div>
      <h3 className="text-base font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
        {title}
      </h3>
      <p className="text-sm text-gray-500 mt-1">{description}</p>
      <div className="mt-3 text-xs text-gray-400">
        {loading ? '...' : `${count ?? 0} 条记录`}
      </div>
    </button>
  );
}

export default function KnowledgeMap() {
  const { data: devData, loading: devLoading } = useApi<CountResult>(
    '/api/brain/dev-records?limit=1',
    { staleTime: 60_000 }
  );
  const { data: decData, loading: decLoading } = useApi<{ decisions?: unknown[] }>(
    '/api/brain/decisions?limit=1',
    { staleTime: 60_000 }
  );
  const { data: designData, loading: designLoading } = useApi<CountResult>(
    '/api/brain/design-docs?limit=1',
    { staleTime: 60_000 }
  );
  const { data: diaryData, loading: diaryLoading } = useApi<CountResult>(
    '/api/brain/design-docs?type=diary&limit=1',
    { staleTime: 60_000 }
  );

  const cards = [
    {
      title: 'Dev Log',
      description: 'PR 完整开发档案，含 PRD/DoD/CI/Learning',
      icon: GitMerge,
      path: '/knowledge/dev-log',
      color: 'bg-purple-500',
      count: devData?.total,
      loading: devLoading,
    },
    {
      title: 'Decision Registry',
      description: '重要决策台账，带原因、状态、标注',
      icon: Scale,
      path: '/knowledge/decisions',
      color: 'bg-blue-500',
      count: (decData?.decisions || []).length,
      loading: decLoading,
    },
    {
      title: 'Design Vault',
      description: '调研报告、架构方案、技术评估存档',
      icon: FolderOpen,
      path: '/knowledge/designs',
      color: 'bg-orange-500',
      count: designData?.total,
      loading: designLoading,
    },
    {
      title: 'Daily Diary',
      description: '每日自动生成日报，可追加备注',
      icon: BookOpen,
      path: '/knowledge/diary',
      color: 'bg-teal-500',
      count: diaryData?.total,
      loading: diaryLoading,
    },
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Map size={24} className="text-gray-700" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Knowledge Map</h1>
          <p className="text-sm text-gray-500">Cecelia 统一知识库入口</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map(card => (
          <MapCard key={card.path} {...card} />
        ))}
      </div>

      <div className="mt-8 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-xs text-gray-500 font-medium mb-1">关于知识系统</p>
        <p className="text-sm text-gray-600">
          Cecelia 自动将 PR 记录写入 Dev Log，将每日数据汇总为日报。
          你在任意记录上添加的备注会持久保存并在下次对话中可查阅。
        </p>
      </div>
    </div>
  );
}
