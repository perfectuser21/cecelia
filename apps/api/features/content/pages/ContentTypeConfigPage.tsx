/**
 * ContentTypeConfigPage — 内容类型配置管理页
 *
 * 功能：列出所有内容类型，允许编辑 notebook_id 字段并保存到 DB。
 */

import { useState, useEffect, useCallback } from 'react';
import { Settings, Save, Loader2, AlertCircle, CheckCircle, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

const BRAIN_API = '/api/brain';

interface ContentTypeConfig {
  content_type: string;
  source: string;
  config: {
    title?: string;
    notebook_id?: string;
    [key: string]: unknown;
  };
  updated_at?: string;
  updated_by?: string;
}

function formatTime(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TypeRow({
  typeName,
  onSaved,
}: {
  typeName: string;
  onSaved: () => void;
}) {
  const [config, setConfig] = useState<ContentTypeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [notebookId, setNotebookId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BRAIN_API}/content-types/${encodeURIComponent(typeName)}/config`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ContentTypeConfig = await res.json();
      setConfig(data);
      setNotebookId(data.config?.notebook_id ?? '');
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, [typeName]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const updatedConfig = { ...config.config, notebook_id: notebookId.trim(), _updated_by: 'content-type-config-page' };
      const res = await fetch(`${BRAIN_API}/content-types/${encodeURIComponent(typeName)}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      setSaveSuccess(true);
      onSaved();
      await loadConfig();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-lg border border-gray-100 dark:border-gray-700">
        <div className="w-32 h-4 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
        <div className="flex-1 h-9 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg border border-gray-100 dark:border-gray-700 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {config?.config?.title ?? typeName}
          </span>
          <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{typeName}</span>
          {config?.source === 'db' && config.updated_at && (
            <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
              · 上次编辑：{formatTime(config.updated_at)}
            </span>
          )}
        </div>
        <span className={`text-xs px-1.5 py-0.5 rounded ${config?.source === 'db' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
          {config?.source === 'db' ? 'DB' : 'YAML'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 dark:text-gray-400 w-28 flex-shrink-0">NotebookLM ID</label>
        <input
          type="text"
          value={notebookId}
          onChange={e => setNotebookId(e.target.value)}
          placeholder="留空则不使用 NotebookLM"
          className="flex-1 px-3 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      {saveError && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3 h-3" />
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <CheckCircle className="w-3 h-3" />
          已保存
        </div>
      )}
    </div>
  );
}

export default function ContentTypeConfigPage() {
  const [contentTypes, setContentTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTypes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BRAIN_API}/content-types`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setContentTypes(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTypes();
  }, [loadTypes]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <Settings className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">内容类型配置</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">管理各内容类型的 NotebookLM ID 及其他配置</p>
          </div>
        </div>
        <Link
          to="/content-factory"
          className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          内容工厂
        </Link>
      </div>

      {/* 内容区 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">内容类型列表</h2>

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            加载失败：{error}
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {!loading && contentTypes.length === 0 && !error && (
          <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-8">暂无内容类型</p>
        )}

        {!loading && contentTypes.map(type => (
          <TypeRow key={type} typeName={type} onSaved={() => {}} />
        ))}
      </div>
    </div>
  );
}
