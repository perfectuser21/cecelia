import { useEffect, useState } from 'react';
import { Bot, Users, AlertCircle, Loader2, Building2, Brain } from 'lucide-react';
import { fetchStaff, type Team, type AreaConfig } from '../api/staffApi';

function ModelBadge({ provider, name }: { provider: string | null; name: string | null }) {
  if (!provider || !name) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">
        未配置
      </span>
    );
  }

  const providerColors: Record<string, string> = {
    anthropic: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
    minimax: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    openai: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  };

  const shortName = name
    .replace('claude-', '')
    .replace('-20250514', '')
    .replace('MiniMax-', '');

  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
        providerColors[provider] || 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
      }`}
    >
      {shortName}
    </span>
  );
}

function AreaIcon({ areaId }: { areaId: string }) {
  if (areaId === 'zenithjoy') return <Building2 size={20} className="text-indigo-500" />;
  return <Brain size={20} className="text-purple-500" />;
}

export default function StaffPage() {
  const [areas, setAreas] = useState<Record<string, AreaConfig>>({});
  const [teams, setTeams] = useState<Team[]>([]);
  const [totalWorkers, setTotalWorkers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStaff()
      .then(data => {
        setAreas(data.areas || {});
        setTeams(data.teams);
        setTotalWorkers(data.total_workers);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-500 p-8">
        <AlertCircle size={20} />
        <span>{error}</span>
      </div>
    );
  }

  // 按 area 分组
  const areaIds = Object.keys(areas).length > 0
    ? Object.keys(areas)
    : [...new Set(teams.map(t => t.area).filter(Boolean) as string[])];

  // 同一个 area 下按 department 分组
  const groupByDept = (areaId: string) => {
    const areaTeams = teams.filter(t => t.area === areaId);
    const deptMap: Record<string, Team[]> = {};
    for (const team of areaTeams) {
      const dept = team.department || team.name;
      if (!deptMap[dept]) deptMap[dept] = [];
      deptMap[dept].push(team);
    }
    return deptMap;
  };

  // 没有 area 字段的 team（兜底）
  const unassignedTeams = teams.filter(t => !t.area);

  return (
    <div className="p-6 space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users size={24} /> 员工配置
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">共 {totalWorkers} 名员工</p>
        </div>
      </div>

      {areaIds.map(areaId => {
        const areaConfig = areas[areaId];
        const deptMap = groupByDept(areaId);
        if (Object.keys(deptMap).length === 0) return null;

        return (
          <div key={areaId}>
            {/* Area 标题 */}
            <div className="flex items-center gap-3 mb-6">
              <AreaIcon areaId={areaId} />
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {areaConfig?.name || areaId}
                </h2>
                {areaConfig?.description && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">{areaConfig.description}</p>
                )}
              </div>
            </div>

            {/* Department 分组 */}
            <div className="space-y-6 pl-2 border-l-2 border-gray-100 dark:border-gray-800">
              {Object.entries(deptMap).map(([dept, deptTeams]) => {
                const allWorkers = deptTeams.flatMap(t => t.workers);
                return (
                  <div key={dept}>
                    <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2 pl-4">
                      <span>{dept}</span>
                      <span className="text-xs normal-case bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full font-normal">
                        {allWorkers.length} 人
                      </span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pl-4">
                      {allWorkers.map(worker => (
                        <div
                          key={worker.id}
                          className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <div className="font-semibold text-gray-900 dark:text-gray-100">
                                {worker.name}
                                {worker.alias && (
                                  <span className="ml-2 text-sm text-gray-400">({worker.alias})</span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                {worker.role}
                              </div>
                            </div>
                            <Bot size={18} className="text-gray-400 mt-0.5 shrink-0" />
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                            {worker.description}
                          </p>
                          <div className="flex items-center justify-between">
                            <ModelBadge provider={worker.model.provider} name={worker.model.name} />
                            {worker.skill && (
                              <span className="text-xs text-gray-400 font-mono">{worker.skill}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* 兜底：没有 area 字段的 team */}
      {unassignedTeams.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">其他</h2>
          {unassignedTeams.map(team => (
            <div key={team.id} className="mb-4">
              <h3 className="text-sm font-medium text-gray-500 mb-2">{team.name}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {team.workers.map(worker => (
                  <div
                    key={worker.id}
                    className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4"
                  >
                    <div className="font-semibold">{worker.name}</div>
                    <div className="text-xs text-gray-500">{worker.role}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
