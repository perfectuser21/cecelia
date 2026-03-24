import { useEffect, useState } from 'react';
import { Map, GitPullRequest, Layers, BookOpen, Scale, Database } from 'lucide-react';

interface Stats {
  dev_records: number;
  design_docs: number;
  daily_diary: number;
  decisions: number;
  learnings: number;
}

function StatCard({ icon: Icon, label, count, path }: { icon: any; label: string; count: number; path: string }) {
  return (
    <a href={path}
      className="border rounded-xl p-5 bg-white dark:bg-gray-800 hover:shadow-md transition-shadow flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
        <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900 dark:text-white">{count}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </a>
  );
}

export default function KnowledgeMapPage() {
  const [stats, setStats] = useState<Stats>({ dev_records: 0, design_docs: 0, daily_diary: 0, decisions: 0, learnings: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      fetch('/api/brain/dev-records?limit=1').then(r => r.json()),
      fetch('/api/brain/design-docs?status=active&limit=1').then(r => r.json()),
      fetch('/api/brain/user-annotations?annotation_type=daily_diary&limit=1').then(r => r.json()),
      fetch('/api/brain/decisions?limit=1').then(r => r.json()),
      fetch('/api/brain/knowledge?limit=1').then(r => r.json()),
    ]).then(async ([dr, dd, diary, dec, know]) => {
      // Fetch actual counts with larger limit for approximate counts
      const [drFull, ddFull, diaryFull, decFull, knowFull] = await Promise.allSettled([
        fetch('/api/brain/dev-records?limit=200').then(r => r.json()),
        fetch('/api/brain/design-docs?status=all&limit=200').then(r => r.json()),
        fetch('/api/brain/user-annotations?annotation_type=daily_diary&limit=200').then(r => r.json()),
        fetch('/api/brain/decisions?limit=200').then(r => r.json()),
        fetch('/api/brain/knowledge?limit=200').then(r => r.json()),
      ]);
      setStats({
        dev_records: drFull.status === 'fulfilled' && Array.isArray(drFull.value) ? drFull.value.length : 0,
        design_docs: ddFull.status === 'fulfilled' && Array.isArray(ddFull.value) ? ddFull.value.length : 0,
        daily_diary: diaryFull.status === 'fulfilled' && Array.isArray(diaryFull.value) ? diaryFull.value.length : 0,
        decisions: decFull.status === 'fulfilled' && Array.isArray(decFull.value) ? decFull.value.length : 0,
        learnings: knowFull.status === 'fulfilled' && Array.isArray(knowFull.value) ? knowFull.value.length : 0,
      });
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
        <Map className="w-6 h-6" /> Knowledge Map
      </h1>
      <p className="text-gray-500 mb-6 text-sm">Cecelia 知识系统全景 — 各模块记录数量一览</p>
      {loading ? (
        <div className="text-gray-500">加载中...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard icon={GitPullRequest} label="开发记录" count={stats.dev_records} path="/knowledge/dev-log" />
          <StatCard icon={Layers} label="设计文档" count={stats.design_docs} path="/knowledge/design-vault" />
          <StatCard icon={BookOpen} label="日记条目" count={stats.daily_diary} path="/knowledge/diary" />
          <StatCard icon={Scale} label="决策记录" count={stats.decisions} path="/knowledge/decisions" />
          <StatCard icon={Database} label="知识库条目" count={stats.learnings} path="/knowledge/brain" />
        </div>
      )}
    </div>
  );
}
