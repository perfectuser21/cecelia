/**
 * WarRoomGoldenPathPage — GP 二级页
 *
 * 路由：/warroom/gp/:gpId
 * 布局：双栏（左：GP 信息；右：ConversationsPanel with gpId 过滤）
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Zap, RefreshCw } from 'lucide-react';
import ConversationsPanel from './ConversationsPanel';

// ── 类型 ─────────────────────────────────────────────────────────────────────

interface GoldenPath {
  id: string;
  name: string;
  title?: string | null;
  one_liner?: string | null;
  status?: string | null;
  journey_id?: string | null;
  description?: string | null;
}

// ── 主页面 ────────────────────────────────────────────────────────────────────

export default function WarRoomGoldenPathPage() {
  const { gpId } = useParams<{ gpId: string }>();
  const navigate = useNavigate();
  const [gp, setGp] = useState<GoldenPath | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchGp = useCallback(async (silent = false) => {
    if (!gpId) return;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/brain/golden-path/${encodeURIComponent(gpId)}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError('GP 不存在或已归档');
        } else {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return;
      }
      const data = await res.json();
      setGp(data.golden_path || data);
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [gpId]);

  useEffect(() => { fetchGp(); }, [fetchGp]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">加载 GP 数据…</span>
        </div>
      </div>
    );
  }

  if (error || !gp) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
          <div className="text-sm text-red-400">{error || 'GP 不存在或已归档'}</div>
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-blue-400 hover:text-blue-300 underline"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  const displayTitle = gp.title || gp.name;
  const journeyId = gp.journey_id || '';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-800/60 bg-slate-900/80 backdrop-blur px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <Zap className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            data-testid="gp-title"
            className="text-sm font-semibold text-slate-100 truncate"
          >
            {displayTitle}
          </span>
          {gp.status && (
            <span className="text-[11px] text-slate-600 px-1.5 py-0.5 bg-slate-800 rounded font-mono flex-shrink-0">
              {gp.status}
            </span>
          )}
        </div>
        <button
          onClick={() => fetchGp(true)}
          disabled={refreshing}
          className="p-1.5 rounded hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Body — 双栏 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2 h-full">
          {/* 左栏：GP 信息 */}
          <div className="border-r border-slate-800/40 p-4 overflow-y-auto">
            <div className="space-y-4">
              {/* GP 基本信息 */}
              <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <Zap className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-100 leading-snug">{displayTitle}</div>
                    {gp.status && (
                      <div className="mt-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400 font-mono">
                          {gp.status}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {gp.one_liner && (
                  <div>
                    <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">One-liner</div>
                    <p className="text-[13px] text-slate-300 leading-relaxed">{gp.one_liner}</p>
                  </div>
                )}

                {gp.description && (
                  <div>
                    <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">描述</div>
                    <p className="text-[12px] text-slate-400 leading-relaxed">{gp.description}</p>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-700/40">
                  <div className="text-[11px] text-slate-600 font-mono">GP ID: {gpId}</div>
                  {journeyId && (
                    <div className="text-[11px] text-slate-600 font-mono mt-0.5">Journey ID: {journeyId}</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 右栏：议题对话（gpId 过滤） */}
          <div className="p-4 flex flex-col overflow-hidden">
            {journeyId ? (
              <ConversationsPanel journeyId={journeyId} gpId={gpId} />
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 py-8">
                <div className="text-[12px] text-slate-600 text-center">该 GP 未关联 Journey，无法加载对话</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
