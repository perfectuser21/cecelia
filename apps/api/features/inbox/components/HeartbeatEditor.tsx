import React, { useState, useEffect, useCallback } from 'react';
import { Save, RotateCcw, FileText, Loader2, AlertCircle, Clock } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

interface HeartbeatLog {
  timestamp: string;
  status: 'ok' | 'warning' | 'proposal';
  message: string;
}

export default function HeartbeatEditor(): React.ReactElement {
  const { data: heartbeatData, loading, error: fetchError } = useApi<{ content: string; logs?: HeartbeatLog[] }>(
    '/api/brain/heartbeat',
    { staleTime: 30000 }
  );

  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const notAvailable = fetchError?.includes('404') || fetchError?.includes('Cannot GET');

  useEffect(() => {
    if (heartbeatData?.content) {
      setContent(heartbeatData.content);
      setOriginalContent(heartbeatData.content);
    }
  }, [heartbeatData]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/brain/heartbeat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setOriginalContent(content);
      setSaveMsg({ type: 'ok', text: '保存成功' });
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      setSaveMsg({ type: 'error', text: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setSaving(false);
    }
  }, [content]);

  const handleReset = () => {
    setContent(originalContent);
    setSaveMsg(null);
  };

  const isDirty = content !== originalContent;
  const logs = heartbeatData?.logs || [];

  if (notAvailable) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
            <AlertCircle className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">巡检设置</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">HEARTBEAT API 尚未部署（Phase 2）</p>
          </div>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          巡检功能需要 Brain 服务的 HEARTBEAT API 支持。当 Phase 2 后端部署后，此编辑器将自动可用。
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 p-6">
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
            <FileText className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">巡检设置</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">HEARTBEAT.md 检查清单</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saveMsg && (
            <span className={`text-xs ${saveMsg.type === 'ok' ? 'text-emerald-500' : 'text-red-500'}`}>
              {saveMsg.text}
            </span>
          )}
          <button
            onClick={handleReset}
            disabled={!isDirty || saving}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            重置
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            保存
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="p-4">
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          className="w-full h-64 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 text-sm font-mono text-slate-700 dark:text-slate-200 resize-y outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
          placeholder="# Cecelia 巡检清单&#10;&#10;## 自主权边界&#10;### 必须问我的&#10;- OKR 拆解结果&#10;- 每周计划&#10;..."
        />
      </div>

      {/* Logs */}
      {logs.length > 0 && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">最近巡检记录</p>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {logs.slice(0, 20).map((log, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="text-[10px] font-mono whitespace-nowrap">
                  {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span>{log.status === 'ok' ? '✓' : log.status === 'warning' ? '⚠' : '📋'}</span>
                <span className="truncate">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
