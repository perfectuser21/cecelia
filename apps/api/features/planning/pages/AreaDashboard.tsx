/**
 * Area Dashboard — 展示 areas 表（生活/工作领域）
 * 数据源: /api/tasks/areas + /api/tasks/projects（统计关联 project 数）
 */

import { useState, useEffect, useCallback } from 'react';
import { Layers, Briefcase, BookOpen, Heart, Settings } from 'lucide-react';

interface Area {
  id: string;
  name: string;
  domain: string | null;
  archived: boolean;
}

interface Project {
  id: string;
  area_id: string | null;
  type: string;
}

type DomainMeta = { label: string; color: string; bg: string; Icon: React.ComponentType<{className?: string}> };

const DOMAIN_META: Record<string, DomainMeta> = {
  Work:   { label: '工作', color: 'text-blue-400',   bg: 'bg-blue-500/10',   Icon: Briefcase },
  Study:  { label: '学习', color: 'text-purple-400', bg: 'bg-purple-500/10', Icon: BookOpen },
  Life:   { label: '生活', color: 'text-green-400',  bg: 'bg-green-500/10',  Icon: Heart },
  System: { label: '系统', color: 'text-slate-400',  bg: 'bg-slate-500/10',  Icon: Settings },
};

export default function AreaDashboard() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [projectCounts, setProjectCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [areasRes, projectsRes] = await Promise.all([
        fetch('/api/tasks/areas'),
        fetch('/api/tasks/projects?limit=2000'),
      ]);
      const areaList: Area[] = areasRes.ok ? await areasRes.json() : [];
      const projectList: Project[] = projectsRes.ok ? await projectsRes.json() : [];

      setAreas(areaList);

      // 统计每个 area 下的 project 数量
      const counts: Record<string, number> = {};
      projectList.filter(p => p.type === 'project' && p.area_id).forEach(p => {
        counts[p.area_id!] = (counts[p.area_id!] ?? 0) + 1;
      });
      setProjectCounts(counts);
    } catch {
      setAreas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 按 domain 分组
  const grouped = areas.reduce<Record<string, Area[]>>((acc, a) => {
    const d = a.domain ?? 'Other';
    if (!acc[d]) acc[d] = [];
    acc[d].push(a);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
        加载中…
      </div>
    );
  }

  if (areas.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
        暂无 Area 数据
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {Object.entries(grouped).map(([domain, domainAreas]) => {
          const meta: DomainMeta = DOMAIN_META[domain] ?? { label: domain, color: 'text-slate-400', bg: 'bg-slate-500/10', Icon: Layers };
          const { Icon } = meta;
          return (
            <div key={domain}>
              <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wider mb-3 ${meta.color}`}>
                <Icon className="w-3.5 h-3.5" />
                {meta.label}
                <span className="text-slate-600 normal-case font-normal ml-1">{domain}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {domainAreas.map(area => {
                  const projCount = projectCounts[area.id] ?? 0;
                  return (
                    <div
                      key={area.id}
                      className={`rounded-lg border border-slate-700/60 p-4 hover:border-slate-600 transition-colors cursor-default ${meta.bg}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon className={`w-4 h-4 shrink-0 ${meta.color}`} />
                          <span className="text-sm font-medium text-gray-200 truncate">{area.name}</span>
                        </div>
                        {projCount > 0 && (
                          <span className="text-xs text-slate-400 shrink-0">{projCount} Projects</span>
                        )}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">{domain}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
