/**
 * TaskTypeConfigPage — 动态任务类型路由配置
 * 路由：/task-type-configs
 * 展示并编辑 B类非编码 Codex 任务的路由参数（location/executor/skill）
 */

import { useState, useEffect, useCallback } from 'react';

interface TaskTypeConfig {
  task_type: string;
  location: 'us' | 'hk' | 'xian';
  executor: string;
  skill: string | null;
  description: string | null;
  is_dynamic: boolean;
  updated_at: string;
}

const LOCATION_LABELS: Record<string, string> = {
  us:   '🇺🇸 美国本机',
  hk:   '🇭🇰 香港',
  xian: '🀄 西安',
};

const LOCATION_COLORS: Record<string, string> = {
  us:   'bg-blue-100 text-blue-700',
  hk:   'bg-red-100 text-red-700',
  xian: 'bg-amber-100 text-amber-700',
};

export default function TaskTypeConfigPage() {
  const [configs, setConfigs] = useState<TaskTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<TaskTypeConfig>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/cecelia/task-type-configs');
      const data = await res.json();
      if (data.success) {
        setConfigs(data.configs);
        setError(null);
      } else {
        setError(data.error || '加载失败');
      }
    } catch (e) {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const startEdit = (config: TaskTypeConfig) => {
    setEditing(config.task_type);
    setEditValues({ location: config.location, executor: config.executor, skill: config.skill || '' });
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditValues({});
  };

  const saveEdit = async (taskType: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/cecelia/task-type-configs/${taskType}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editValues),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(taskType);
        setTimeout(() => setSaved(null), 2000);
        setEditing(null);
        await fetchConfigs();
      } else {
        setError(data.error || '保存失败');
      }
    } catch (e) {
      setError('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        加载中...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">任务类型路由配置</h1>
        <p className="mt-1 text-sm text-gray-500">
          配置 B类非编码 Codex 任务的路由参数。保存后 Brain 立即生效，无需重启。
        </p>
        <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          <strong>注意：</strong>A类（dev）和 Coding pathway B类（code_review/decomp_review 等）路由固定，不在此配置。
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left font-medium text-gray-600">任务类型</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">路由到</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Executor</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Skill</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">说明</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {configs.map(config => (
              <tr key={config.task_type} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs font-medium text-gray-800">
                  {config.task_type}
                </td>
                <td className="px-4 py-3">
                  {editing === config.task_type ? (
                    <select
                      value={editValues.location || config.location}
                      onChange={e => setEditValues(v => ({ ...v, location: e.target.value as 'us' | 'hk' | 'xian' }))}
                      className="border border-gray-300 rounded px-2 py-1 text-sm"
                    >
                      <option value="us">🇺🇸 美国本机</option>
                      <option value="hk">🇭🇰 香港</option>
                      <option value="xian">🀄 西安</option>
                    </select>
                  ) : (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${LOCATION_COLORS[config.location] || 'bg-gray-100 text-gray-600'}`}>
                      {LOCATION_LABELS[config.location] || config.location}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                  {editing === config.task_type ? (
                    <input
                      value={editValues.executor || ''}
                      onChange={e => setEditValues(v => ({ ...v, executor: e.target.value }))}
                      className="border border-gray-300 rounded px-2 py-1 text-sm w-32"
                    />
                  ) : (
                    config.executor
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                  {editing === config.task_type ? (
                    <input
                      value={editValues.skill || ''}
                      onChange={e => setEditValues(v => ({ ...v, skill: e.target.value }))}
                      className="border border-gray-300 rounded px-2 py-1 text-sm w-32"
                    />
                  ) : (
                    config.skill || '-'
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs max-w-[200px] truncate">
                  {config.description || '-'}
                </td>
                <td className="px-4 py-3 text-center">
                  {editing === config.task_type ? (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => saveEdit(config.task_type)}
                        disabled={saving}
                        className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        {saving ? '保存中…' : '保存'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEdit(config)}
                      className="px-3 py-1 bg-gray-100 text-gray-600 text-xs rounded hover:bg-gray-200"
                    >
                      {saved === config.task_type ? '✓ 已保存' : '编辑'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {configs.length === 0 && !loading && (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">
            暂无动态配置项
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-gray-400">
        更新时间：{configs[0]?.updated_at ? new Date(configs[0].updated_at).toLocaleString('zh-CN') : '-'}
      </p>
    </div>
  );
}
