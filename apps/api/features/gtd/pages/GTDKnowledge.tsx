/**
 * GTD Knowledge — 知识库入口
 * 复用现有 KnowledgeHome 组件 + 嵌入 Learnings 数据库视图
 * 数据源: /api/brain/status/full (learnings stats)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { BookOpen, PenTool, Brain, Sparkles, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface KnowledgeCard {
  id: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  color: string;
}

const cards: KnowledgeCard[] = [
  { id: 'content', label: 'Content Studio', desc: '内容创作与媒体资源', icon: PenTool, path: '/knowledge/content', color: 'text-pink-400' },
  { id: 'brain', label: 'Super Brain', desc: '知识库与笔记', icon: Brain, path: '/knowledge/brain', color: 'text-purple-400' },
  { id: 'digestion', label: '知识消化', desc: '反刍洞察与知识归档', icon: Sparkles, path: '/knowledge/digestion', color: 'text-amber-400' },
];

export default function GTDKnowledge() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<{ learnings: number; memories: number } | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/brain/status/full');
      if (res.ok) {
        const data = await res.json();
        setStats({
          learnings: data.learnings?.total ?? 0,
          memories: data.memory?.stream_count ?? 0,
        });
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-900">
      {/* 工具栏 */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
          <BookOpen className="w-4 h-4 text-slate-400" />
          <span>Knowledge</span>
          {stats && (
            <span className="text-slate-500 font-normal text-xs">
              {stats.learnings} learnings / {stats.memories} memories
            </span>
          )}
        </div>
      </div>

      {/* 知识模块卡片 */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {cards.map(card => {
              const Icon = card.icon;
              return (
                <button
                  key={card.id}
                  onClick={() => navigate(card.path)}
                  className="group text-left p-5 rounded-xl border border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/60 hover:border-slate-600/50 transition-all"
                >
                  <div className="flex items-center justify-between mb-3">
                    <Icon className={`w-5 h-5 ${card.color}`} />
                    <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
                  </div>
                  <div className="text-sm font-medium text-gray-200 mb-1">{card.label}</div>
                  <div className="text-xs text-slate-500">{card.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
