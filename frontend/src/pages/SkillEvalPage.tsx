import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, FileArchive, CheckCircle, XCircle, Clock, Loader2, ExternalLink, RefreshCw } from 'lucide-react';
import { uploadSkillEval, getSkillEvalStatus, getSkillEvalReportUrl } from '../api/skill-eval.api';
import type { SkillEvalStatus } from '../api/skill-eval.api';
import { useAuth } from '../contexts/AuthContext';

type Phase = 'idle' | 'uploading' | 'polling' | 'done' | 'error';

export default function SkillEvalPage() {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [skillName, setSkillName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [evalStatus, setEvalStatus] = useState<SkillEvalStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const submitter = user?.name || user?.email || 'unknown';

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const startPolling = useCallback((id: string) => {
    const poll = async () => {
      try {
        const status = await getSkillEvalStatus(id);
        setEvalStatus(status);
        if (status.status === 'completed' || status.status === 'failed') {
          stopPolling();
          setPhase('done');
        }
      } catch {
        // keep polling on transient errors
      }
    };
    poll();
    pollRef.current = setInterval(poll, 4000);
  }, [stopPolling]);

  const handleFile = (f: File) => {
    if (!f.name.toLowerCase().endsWith('.zip')) {
      setErrorMsg('只支持 .zip 文件');
      return;
    }
    setFile(f);
    setErrorMsg('');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleSubmit = async () => {
    if (!file || !skillName.trim()) return;
    setPhase('uploading');
    setErrorMsg('');
    setUploadProgress(0);

    // fake progress animation while uploading
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => Math.min(prev + 10, 90));
    }, 200);

    try {
      const result = await uploadSkillEval(file, skillName.trim(), submitter);
      clearInterval(progressInterval);
      setUploadProgress(100);
      setTaskId(result.task_id);
      setPhase('polling');
      startPolling(result.task_id);
    } catch (err) {
      clearInterval(progressInterval);
      setErrorMsg(err instanceof Error ? err.message : '上传失败');
      setPhase('error');
    }
  };

  const handleReset = () => {
    stopPolling();
    setPhase('idle');
    setFile(null);
    setSkillName('');
    setTaskId(null);
    setEvalStatus(null);
    setErrorMsg('');
    setUploadProgress(0);
  };

  const statusLabel: Record<string, string> = {
    pending: '排队等待中',
    running: 'Claude 正在评估',
    completed: '评估完成',
    failed: '评估失败',
  };

  const statusColor: Record<string, string> = {
    pending: 'text-amber-500',
    running: 'text-blue-500',
    completed: 'text-emerald-500',
    failed: 'text-red-500',
  };

  return (
    <div className="px-4 sm:px-0 pb-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-800 dark:text-white mb-1 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
            <FileArchive className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          Skill 评估上传
        </h1>
        <p className="text-slate-500 dark:text-slate-400 ml-13 text-sm">
          上传 Skill zip 包，由 Claude AI 自动评估技能完整性和质量
        </p>
      </div>

      {/* 上传表单 */}
      {(phase === 'idle' || phase === 'error') && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 space-y-5">
          {/* Skill 名称 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Skill 名称
            </label>
            <input
              type="text"
              value={skillName}
              onChange={e => setSkillName(e.target.value)}
              placeholder="例如：douyin-publish-v2"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent text-sm"
            />
          </div>

          {/* 文件拖拽区 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Skill zip 包
            </label>
            <div
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`
                relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors
                ${dragOver
                  ? 'border-violet-400 bg-violet-50 dark:bg-violet-900/20'
                  : 'border-slate-300 dark:border-slate-600 hover:border-violet-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {file ? (
                <>
                  <FileArchive className="w-8 h-8 text-violet-500" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-800 dark:text-white">{file.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <p className="text-xs text-violet-500">点击重新选择</p>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-slate-400" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">拖拽或点击上传</p>
                    <p className="text-xs text-slate-400 mt-0.5">仅支持 .zip 格式，最大 10MB</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 错误提示 */}
          {errorMsg && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {errorMsg}
            </div>
          )}

          {/* 提交按钮 */}
          <button
            onClick={handleSubmit}
            disabled={!file || !skillName.trim()}
            className="w-full py-2.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
          >
            提交评估
          </button>
        </div>
      )}

      {/* 上传中 */}
      {phase === 'uploading' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-8 text-center space-y-4">
          <Loader2 className="w-10 h-10 text-violet-500 animate-spin mx-auto" />
          <p className="text-slate-700 dark:text-slate-300 font-medium">正在上传...</p>
          <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2">
            <div
              className="bg-violet-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="text-xs text-slate-400">{uploadProgress}%</p>
        </div>
      )}

      {/* 评估状态 */}
      {(phase === 'polling' || phase === 'done') && evalStatus && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 space-y-5">
          {/* 状态标题 */}
          <div className="flex items-center gap-3">
            {evalStatus.status === 'completed' && <CheckCircle className="w-6 h-6 text-emerald-500" />}
            {evalStatus.status === 'failed' && <XCircle className="w-6 h-6 text-red-500" />}
            {(evalStatus.status === 'pending' || evalStatus.status === 'running') && (
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            )}
            <div>
              <p className={`font-semibold ${statusColor[evalStatus.status]}`}>
                {statusLabel[evalStatus.status]}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">任务 ID: {evalStatus.task_id}</p>
            </div>
          </div>

          {/* 队列位次 */}
          {evalStatus.status === 'pending' && evalStatus.queue_position != null && (
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
              <Clock className="w-4 h-4" />
              队列位次：第 {evalStatus.queue_position} 位
            </div>
          )}

          {/* 失败原因 */}
          {evalStatus.status === 'failed' && evalStatus.failure_reason && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {evalStatus.failure_reason}
            </div>
          )}

          {/* 报告链接 */}
          {evalStatus.status === 'completed' && (
            <a
              href={getSkillEvalReportUrl(evalStatus.task_id)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              查看评估报告
            </a>
          )}

          {/* 轮询提示 */}
          {(evalStatus.status === 'pending' || evalStatus.status === 'running') && (
            <p className="text-xs text-slate-400 text-center flex items-center justify-center gap-1">
              <RefreshCw className="w-3 h-3" />
              每 4 秒自动刷新
            </p>
          )}

          {/* 重新提交 */}
          {phase === 'done' && (
            <button
              onClick={handleReset}
              className="w-full py-2 px-4 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              提交新的 Skill
            </button>
          )}
        </div>
      )}

      {/* 说明文字 */}
      {phase === 'idle' && (
        <div className="mt-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400 space-y-1.5">
          <p className="font-medium text-slate-700 dark:text-slate-300">上传格式要求</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>zip 包根目录必须包含 <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">SKILL.md</code></li>
            <li>不允许路径穿越（如 <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">../</code>）</li>
            <li>文件大小上限：10MB</li>
            <li>评估完成后报告链接有效期 30 天</li>
          </ul>
        </div>
      )}
    </div>
  );
}
