import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Upload, Film, Scissors, Square, Type, Download, Trash2, RefreshCw,
  Play, Pause, ArrowLeft, CheckCircle2, XCircle, Loader2, Clock, Sparkles, Wand2,
  Volume2, VolumeX, SkipBack, SkipForward, Maximize2, ChevronRight, ChevronDown,
  Zap, Timer, Layers, FileVideo, Eye, EyeOff, Edit3, RotateCcw
} from 'lucide-react';
import type {
  UploadedVideo,
  VideoJob,
  ProcessOptions,
  AspectRatioPreset,
  StepInfo,
  AiAnalysisResult,
  AiEditOperation} from '../api/video-editor.api';
import {
  videoEditorApi,
  PRESET_INFO,
  PROCESSING_STEPS,
  TranscriptSegment
} from '../api/video-editor.api';

type ViewMode = 'upload' | 'edit';

// Timeline marker types
interface TimelineMarker {
  start: number;
  end: number;
  type: 'voice' | 'silence' | 'cut';
  label?: string;
}

export default function VideoEditor() {
  const [viewMode, setViewMode] = useState<ViewMode>('upload');
  const [videos, setVideos] = useState<UploadedVideo[]>([]);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<UploadedVideo | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // 处理选项
  const [preset, setPreset] = useState<AspectRatioPreset | ''>('');
  const [trimStart, setTrimStart] = useState('');
  const [trimEnd, setTrimEnd] = useState('');
  const [subtitleText, setSubtitleText] = useState('');
  const [subtitleStyle, setSubtitleStyle] = useState<'bottom' | 'top' | 'center'>('bottom');

  // AI 模式
  const [editMode, setEditMode] = useState<'manual' | 'ai'>('ai');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisResult | null>(null);

  // 视频播放器引用
  const originalVideoRef = useRef<HTMLVideoElement>(null);
  const processedVideoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // UI 状态
  const [showTranscript, setShowTranscript] = useState(true);
  const [expandedOperations, setExpandedOperations] = useState<Set<string>>(new Set());
  const [editingSegment, setEditingSegment] = useState<number | null>(null);
  const [editedTranscripts, setEditedTranscripts] = useState<Record<number, string>>({});

  // 当前正在处理的任务
  const [currentJob, setCurrentJob] = useState<VideoJob | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [videosData, jobsData] = await Promise.all([
        videoEditorApi.getVideos(),
        videoEditorApi.getJobs(),
      ]);
      setVideos(videosData);
      setJobs(jobsData);
    } catch (err: any) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 轮询处理中的任务
  useEffect(() => {
    const processingJobs = jobs.filter(j => j.status === 'processing' || j.status === 'pending');
    if (processingJobs.length === 0) return;

    const interval = setInterval(async () => {
      const updatedJobs = await Promise.all(
        jobs.map(async (job) => {
          if (job.status === 'processing' || job.status === 'pending') {
            try {
              const updated = await videoEditorApi.getJobStatus(job.id);
              // Update currentJob if it's being tracked
              if (currentJob?.id === updated.id) {
                setCurrentJob(updated);
              }
              return updated;
            } catch {
              return job;
            }
          }
          return job;
        })
      );
      setJobs(updatedJobs);
    }, 2000);

    return () => clearInterval(interval);
  }, [jobs, currentJob]);

  // 处理文件上传
  const handleUpload = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const videoFile = fileArray.find(f => f.type.startsWith('video/'));

    if (!videoFile) {
      setError('Please select a video file');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      const video = await videoEditorApi.uploadVideo(videoFile, (progress) => {
        setUploadProgress(progress);
      });
      setVideos(prev => [video, ...prev]);
      setSelectedVideo(video);
      setViewMode('edit');
      resetOptions();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, []);

  // 重置处理选项
  const resetOptions = () => {
    setPreset('');
    setTrimStart('');
    setTrimEnd('');
    setSubtitleText('');
    setSubtitleStyle('bottom');
    setAiAnalysis(null);
    setAiPrompt('');
    setCurrentJob(null);
    setEditedTranscripts({});
  };

  // 拖拽处理
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  // 开始处理
  const handleProcess = async () => {
    if (!selectedVideo) return;

    const options: ProcessOptions = {};

    if (preset) {
      options.preset = preset;
    }

    if (trimStart || trimEnd) {
      options.trim = {
        start: trimStart || '00:00:00',
        end: trimEnd || formatTime(duration),
      };
    }

    if (subtitleText.trim()) {
      options.subtitle = {
        text: subtitleText,
        style: subtitleStyle,
        fontSize: 48,
        fontColor: 'white',
      };
    }

    setProcessing(true);
    setError(null);

    try {
      const job = await videoEditorApi.processVideo(selectedVideo.id, options);
      const newJob = { ...job, originalVideo: selectedVideo, options } as VideoJob;
      setJobs(prev => [newJob, ...prev]);
      setCurrentJob(newJob);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Processing failed');
    } finally {
      setProcessing(false);
    }
  };

  // AI 分析（第一步：只分析，不处理）
  const handleAiAnalyze = async () => {
    if (!selectedVideo || !aiPrompt.trim()) return;

    setAiAnalyzing(true);
    setError(null);
    setAiAnalysis(null);

    try {
      const result = await videoEditorApi.aiAnalyze(selectedVideo.id, aiPrompt);
      setAiAnalysis(result);
    } catch (err: any) {
      setError(err.response?.data?.error || 'AI analysis failed');
    } finally {
      setAiAnalyzing(false);
    }
  };

  // AI 智能处理（第二步：确认后执行处理）
  const handleAiProcess = async () => {
    if (!selectedVideo || !aiPrompt.trim()) return;

    setAiProcessing(true);
    setError(null);

    try {
      const result = await videoEditorApi.aiProcess(selectedVideo.id, aiPrompt);
      // 添加到任务列表（初始化 steps 以便显示进度）
      const initialSteps = PROCESSING_STEPS.map(s => ({
        step: s.step,
        name: s.name,
        status: 'pending' as const,
        progress: 0,
      }));

      const newJob: VideoJob = {
        id: result.id,
        status: 'pending',
        progress: 0,
        options: {},
        originalVideo: selectedVideo,
        userPrompt: aiPrompt,
        steps: initialSteps,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setJobs(prev => [newJob, ...prev]);
      setCurrentJob(newJob);
    } catch (err: any) {
      setError(err.response?.data?.error || 'AI processing failed');
    } finally {
      setAiProcessing(false);
    }
  };

  // 删除视频
  const handleDeleteVideo = async (id: string) => {
    try {
      await videoEditorApi.deleteVideo(id);
      setVideos(prev => prev.filter(v => v.id !== id));
      if (selectedVideo?.id === id) {
        setSelectedVideo(null);
        setViewMode('upload');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Delete failed');
    }
  };

  // 删除任务
  const handleDeleteJob = async (id: string) => {
    try {
      await videoEditorApi.deleteJob(id);
      setJobs(prev => prev.filter(j => j.id !== id));
      if (currentJob?.id === id) {
        setCurrentJob(null);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Delete failed');
    }
  };

  // 视频播放控制
  const togglePlay = () => {
    const video = originalVideoRef.current;
    const processedVideo = processedVideoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      processedVideo?.pause();
    } else {
      video.play();
      processedVideo?.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (originalVideoRef.current) {
      setCurrentTime(originalVideoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (originalVideoRef.current) {
      setDuration(originalVideoRef.current.duration);
    }
  };

  const seekTo = (time: number) => {
    if (originalVideoRef.current) {
      originalVideoRef.current.currentTime = time;
      setCurrentTime(time);
    }
    if (processedVideoRef.current) {
      processedVideoRef.current.currentTime = time;
    }
  };

  const skipForward = () => seekTo(Math.min(currentTime + 5, duration));
  const skipBackward = () => seekTo(Math.max(currentTime - 5, 0));

  const toggleMute = () => {
    if (originalVideoRef.current) {
      originalVideoRef.current.muted = !isMuted;
    }
    if (processedVideoRef.current) {
      processedVideoRef.current.muted = !isMuted;
    }
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
    if (originalVideoRef.current) {
      originalVideoRef.current.volume = newVolume;
    }
    if (processedVideoRef.current) {
      processedVideoRef.current.volume = newVolume;
    }
  };

  // 设置当前时间为裁剪开始/结束
  const setTrimFromCurrentTime = (type: 'start' | 'end') => {
    const time = formatTime(currentTime);
    if (type === 'start') {
      setTrimStart(time);
    } else {
      setTrimEnd(time);
    }
  };

  // 格式化时间
  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatTimeShort = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  // 格式化文件大小
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // 获取状态图标
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'processing':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  // Timeline markers from AI analysis
  const timelineMarkers = useMemo<TimelineMarker[]>(() => {
    if (!aiAnalysis) return [];

    const markers: TimelineMarker[] = [];

    // Add silence ranges
    if (aiAnalysis.silenceRanges) {
      aiAnalysis.silenceRanges.forEach(range => {
        markers.push({
          start: range.start,
          end: range.end,
          type: 'silence',
          label: 'Silence',
        });
      });
    }

    // Add transcript segments as voice markers
    if (aiAnalysis.transcriptSegments) {
      aiAnalysis.transcriptSegments.forEach(seg => {
        if (!seg.isSilence) {
          markers.push({
            start: seg.start,
            end: seg.end,
            type: 'voice',
            label: seg.text.slice(0, 20) + (seg.text.length > 20 ? '...' : ''),
          });
        }
      });
    }

    // Add cut ranges from operations
    if (aiAnalysis.operations) {
      aiAnalysis.operations.forEach(op => {
        if (op.timeRange && (op.type === 'trim' || op.type === 'remove_silence')) {
          markers.push({
            start: op.timeRange.start,
            end: op.timeRange.end,
            type: 'cut',
            label: op.description,
          });
        }
      });
    }

    return markers;
  }, [aiAnalysis]);

  // Get operation icon
  const getOperationIcon = (type: AiEditOperation['type']) => {
    switch (type) {
      case 'trim':
        return <Scissors className="w-4 h-4" />;
      case 'remove_silence':
        return <VolumeX className="w-4 h-4" />;
      case 'resize':
        return <Square className="w-4 h-4" />;
      case 'add_subtitle':
        return <Type className="w-4 h-4" />;
      case 'speed_change':
        return <Zap className="w-4 h-4" />;
      case 'merge':
        return <Layers className="w-4 h-4" />;
      default:
        return <Film className="w-4 h-4" />;
    }
  };

  // Toggle operation expansion
  const toggleOperation = (id: string) => {
    setExpandedOperations(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Get step status icon
  const getStepStatusIcon = (step: StepInfo) => {
    const stepMeta = PROCESSING_STEPS.find(s => s.step === step.step);
    const icon = stepMeta?.icon || '?';

    switch (step.status) {
      case 'completed':
        return <span className="text-green-500">{icon}</span>;
      case 'failed':
        return <span className="text-red-500">{icon}</span>;
      case 'in_progress':
        return <span className="animate-pulse">{icon}</span>;
      default:
        return <span className="opacity-50">{icon}</span>;
    }
  };

  // Render processing progress panel
  const renderProcessingPanel = () => {
    if (!currentJob) return null;

    const isComplete = currentJob.status === 'completed';
    const isFailed = currentJob.status === 'failed';

    return (
      <div className={`mt-6 rounded-2xl border overflow-hidden ${
        isComplete
          ? 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-200 dark:border-green-800'
          : isFailed
          ? 'bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/20 border-red-200 dark:border-red-800'
          : 'bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-200 dark:border-blue-800'
      }`}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStatusIcon(currentJob.status)}
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {isComplete ? 'Processing Complete' : isFailed ? 'Processing Failed' : 'Processing Video'}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {currentJob.userPrompt || 'Manual processing'}
                </p>
              </div>
            </div>
            {!isComplete && !isFailed && (
              <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {currentJob.progress}%
              </span>
            )}
          </div>

          {/* Overall progress bar */}
          {!isComplete && !isFailed && (
            <div className="mt-4 h-2 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${currentJob.progress}%` }}
              />
            </div>
          )}
        </div>

        {/* Steps progress */}
        {currentJob.steps && currentJob.steps.length > 0 && (
          <div className="px-6 py-4">
            <div className="space-y-3">
              {currentJob.steps.map((step) => {
                const stepMeta = PROCESSING_STEPS.find(s => s.step === step.step);
                return (
                  <div key={step.step} className="flex items-center gap-4">
                    <div className="flex items-center gap-3 w-36 shrink-0">
                      {getStepStatusIcon(step)}
                      <span className={`text-sm ${
                        step.status === 'in_progress' ? 'text-blue-600 dark:text-blue-400 font-medium' :
                        step.status === 'completed' ? 'text-green-600 dark:text-green-400' :
                        step.status === 'failed' ? 'text-red-600 dark:text-red-400' :
                        'text-gray-400 dark:text-gray-500'
                      }`}>
                        {stepMeta?.name || step.step}
                      </span>
                    </div>
                    <div className="flex-1 h-2 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 rounded-full ${
                          step.status === 'completed' ? 'bg-green-500' :
                          step.status === 'failed' ? 'bg-red-500' :
                          step.status === 'in_progress' ? 'bg-blue-500' :
                          'bg-gray-300 dark:bg-slate-500'
                        }`}
                        style={{ width: `${step.progress}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 w-12 text-right">
                      {step.progress}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Completed - Show download and comparison */}
        {isComplete && (
          <div className="px-6 py-4">
            {/* Download button */}
            <a
              href={videoEditorApi.getDownloadUrl(currentJob.id)}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl font-medium shadow-lg shadow-green-500/25 hover:from-green-700 hover:to-emerald-700 transition-all"
            >
              <Download className="w-5 h-5" />
              Download Processed Video
            </a>
          </div>
        )}

        {/* Failed - Show error */}
        {isFailed && currentJob.error && (
          <div className="px-6 py-4">
            <div className="p-4 bg-red-100 dark:bg-red-900/30 rounded-xl">
              <p className="text-sm text-red-700 dark:text-red-400">{currentJob.error}</p>
            </div>
            <button
              onClick={() => setCurrentJob(null)}
              className="mt-4 flex items-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        )}
      </div>
    );
  };

  // Render timeline component
  const renderTimeline = () => {
    if (!duration) return null;

    const getMarkerColor = (type: TimelineMarker['type']) => {
      switch (type) {
        case 'voice':
          return 'bg-blue-500/60';
        case 'silence':
          return 'bg-gray-400/40';
        case 'cut':
          return 'bg-red-500/60';
        default:
          return 'bg-gray-300';
      }
    };

    return (
      <div className="mt-4 px-4">
        {/* Timeline ruler */}
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>{formatTimeShort(0)}</span>
          <span>{formatTimeShort(duration / 4)}</span>
          <span>{formatTimeShort(duration / 2)}</span>
          <span>{formatTimeShort(duration * 3 / 4)}</span>
          <span>{formatTimeShort(duration)}</span>
        </div>

        {/* Timeline track */}
        <div
          ref={timelineRef}
          className="relative h-12 bg-slate-800 rounded-lg overflow-hidden cursor-pointer"
          onClick={(e) => {
            if (timelineRef.current) {
              const rect = timelineRef.current.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const percent = x / rect.width;
              seekTo(percent * duration);
            }
          }}
        >
          {/* Base waveform placeholder */}
          <div className="absolute inset-0 bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 opacity-50" />

          {/* Markers */}
          {timelineMarkers.map((marker, idx) => {
            const left = (marker.start / duration) * 100;
            const width = ((marker.end - marker.start) / duration) * 100;
            return (
              <div
                key={`${marker.type}-${idx}`}
                className={`absolute top-1 bottom-1 ${getMarkerColor(marker.type)} rounded`}
                style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
                title={marker.label}
              />
            );
          })}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg z-10"
            style={{ left: `${(currentTime / duration) * 100}%` }}
          >
            <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-white rounded-full shadow" />
          </div>
        </div>

        {/* Legend */}
        {timelineMarkers.length > 0 && (
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-blue-500/60" /> Voice
            </span>
            <span className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-gray-400/40" /> Silence
            </span>
            <span className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-red-500/60" /> To Remove
            </span>
          </div>
        )}
      </div>
    );
  };

  // Render transcript panel
  const renderTranscriptPanel = () => {
    if (!aiAnalysis?.transcriptSegments?.length && !aiAnalysis?.transcript) return null;

    const segments = aiAnalysis.transcriptSegments || [];

    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <button
          onClick={() => setShowTranscript(!showTranscript)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Type className="w-5 h-5 text-blue-500" />
            <span className="font-medium text-gray-900 dark:text-white">Transcript</span>
            <span className="text-xs text-gray-500 dark:text-gray-400 px-2 py-0.5 bg-gray-100 dark:bg-slate-700 rounded-full">
              {segments.length} segments
            </span>
          </div>
          {showTranscript ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
        </button>

        {showTranscript && (
          <div className="border-t border-gray-200 dark:border-slate-700 max-h-64 overflow-y-auto">
            {segments.length > 0 ? (
              <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
                {segments.map((seg) => {
                  const isEditing = editingSegment === seg.id;
                  const displayText = editedTranscripts[seg.id] ?? seg.text;
                  const isCurrentSegment = currentTime >= seg.start && currentTime < seg.end;

                  return (
                    <div
                      key={seg.id}
                      className={`px-4 py-2 flex gap-3 transition-colors cursor-pointer ${
                        isCurrentSegment
                          ? 'bg-blue-50 dark:bg-blue-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-slate-700/50'
                      } ${seg.isSilence ? 'opacity-50' : ''}`}
                      onClick={() => seekTo(seg.start)}
                    >
                      <span className="text-xs text-gray-400 dark:text-gray-500 font-mono w-20 shrink-0 pt-0.5">
                        {formatTimeShort(seg.start)}
                      </span>
                      <div className="flex-1">
                        {isEditing ? (
                          <input
                            type="text"
                            value={displayText}
                            onChange={(e) => setEditedTranscripts(prev => ({
                              ...prev,
                              [seg.id]: e.target.value
                            }))}
                            onBlur={() => setEditingSegment(null)}
                            onKeyDown={(e) => e.key === 'Enter' && setEditingSegment(null)}
                            className="w-full px-2 py-1 text-sm bg-white dark:bg-slate-700 border border-blue-500 rounded focus:outline-none"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <p className={`text-sm ${seg.isSilence ? 'text-gray-400 italic' : 'text-gray-700 dark:text-gray-300'}`}>
                            {seg.isSilence ? '[Silence]' : displayText}
                          </p>
                        )}
                      </div>
                      {!seg.isSilence && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingSegment(isEditing ? null : seg.id);
                          }}
                          className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : aiAnalysis.transcript ? (
              <div className="px-4 py-3">
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                  {aiAnalysis.transcript}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  // Render AI operations panel
  const renderOperationsPanel = () => {
    if (!aiAnalysis?.operations?.length) return null;

    const totalSaving = aiAnalysis.operations.reduce((sum, op) => sum + (op.estimatedSaving || 0), 0);

    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-purple-500" />
              <span className="font-medium text-gray-900 dark:text-white">AI Edit Plan</span>
            </div>
            {totalSaving > 0 && (
              <span className="text-xs text-green-600 dark:text-green-400 px-2 py-1 bg-green-50 dark:bg-green-900/30 rounded-full">
                -{formatTimeShort(totalSaving)} shorter
              </span>
            )}
          </div>
          {aiAnalysis.estimatedDuration && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Estimated output: {formatTimeShort(aiAnalysis.estimatedDuration)} (from {formatTimeShort(duration)})
            </p>
          )}
        </div>

        <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
          {aiAnalysis.operations.map((op, idx) => {
            const isExpanded = expandedOperations.has(op.id);

            return (
              <div key={op.id} className="px-4 py-3">
                <button
                  onClick={() => toggleOperation(op.id)}
                  className="w-full flex items-start gap-3 text-left"
                >
                  <div className={`p-2 rounded-lg ${
                    op.type === 'remove_silence' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' :
                    op.type === 'resize' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' :
                    op.type === 'add_subtitle' ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' :
                    'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  }`}>
                    {getOperationIcon(op.type)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 dark:text-gray-500">#{idx + 1}</span>
                      <span className="font-medium text-gray-900 dark:text-white text-sm">
                        {op.description}
                      </span>
                    </div>
                    {op.timeRange && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {formatTimeShort(op.timeRange.start)} - {formatTimeShort(op.timeRange.end)}
                        {op.estimatedSaving && ` (-${formatTimeShort(op.estimatedSaving)})`}
                      </p>
                    )}
                  </div>
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                </button>

                {isExpanded && (
                  <div className="mt-3 ml-11 p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
                    <pre className="text-xs text-gray-600 dark:text-gray-400 overflow-x-auto">
                      {JSON.stringify(op.params, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // 上传视图
  if (viewMode === 'upload' || !selectedVideo) {
    return (
      <div className="max-w-6xl mx-auto">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Video Editor
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">AI-powered video editing with FFmpeg</p>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* 上传区域 */}
        <div
          className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all ${
            dragOver
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-slate-800 dark:to-slate-900'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => e.target.files && handleUpload(e.target.files)}
          />

          {uploading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="w-20 h-20 rounded-full border-4 border-blue-100 dark:border-blue-900" />
                <div
                  className="absolute inset-0 w-20 h-20 rounded-full border-4 border-transparent border-t-blue-500 animate-spin"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold text-blue-600 dark:text-blue-400">{uploadProgress}%</span>
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-300">Uploading video...</p>
              <div className="w-64 bg-gray-200 dark:bg-slate-600 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
                <Upload className="w-10 h-10 text-white" />
              </div>
              <div>
                <p className="text-xl font-semibold text-gray-900 dark:text-white">
                  Drop video here or click to upload
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  Supports MP4, MOV, WebM, AVI, MKV (max 2GB)
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 已上传的视频 */}
        {videos.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <FileVideo className="w-5 h-5 text-blue-500" />
              Uploaded Videos
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {videos.map((video) => (
                <div
                  key={video.id}
                  className="group bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden hover:shadow-xl hover:border-blue-300 dark:hover:border-blue-700 transition-all cursor-pointer"
                  onClick={() => {
                    setSelectedVideo(video);
                    setViewMode('edit');
                    resetOptions();
                  }}
                >
                  <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 dark:from-slate-700 dark:to-slate-800 flex items-center justify-center relative">
                    <Film className="w-12 h-12 text-gray-400" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Play className="w-12 h-12 text-white" />
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="font-medium text-gray-900 dark:text-white truncate">
                      {video.originalName}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-sm text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1">
                        <FileVideo className="w-3.5 h-3.5" />
                        {formatSize(video.fileSize)}
                      </span>
                      {video.duration && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {formatTime(video.duration)}
                        </span>
                      )}
                      {video.width && video.height && (
                        <span>{video.width}x{video.height}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 处理历史 */}
        {jobs.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Timer className="w-5 h-5 text-purple-500" />
              Processing History
            </h2>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
              <div className="divide-y divide-gray-200 dark:divide-slate-700">
                {jobs.map((job) => (
                  <div key={job.id} className="p-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        {getStatusIcon(job.status)}
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {job.originalVideo?.originalName || 'Unknown'}
                          </p>
                          {job.userPrompt && (
                            <p className="text-sm text-purple-600 dark:text-purple-400 mt-0.5 truncate max-w-xs">
                              <Wand2 className="w-3 h-3 inline mr-1" />
                              {job.userPrompt}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {job.status === 'processing' && (
                          <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                            {job.progress}%
                          </span>
                        )}
                        {job.status === 'completed' && (
                          <a
                            href={videoEditorApi.getDownloadUrl(job.id)}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg text-sm font-medium shadow-md shadow-green-500/20 hover:from-green-700 hover:to-emerald-700 transition-all"
                          >
                            <Download className="w-4 h-4" />
                            Download
                          </a>
                        )}
                        <button
                          onClick={() => handleDeleteJob(job.id)}
                          className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Progress bar for processing jobs */}
                    {(job.status === 'processing' || job.status === 'pending') && (
                      <div className="mt-3">
                        <div className="h-1.5 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                        {job.steps && job.steps.length > 0 && (
                          <div className="flex items-center gap-4 mt-2">
                            {job.steps.map((step) => (
                              <span
                                key={step.step}
                                className={`text-xs flex items-center gap-1 ${
                                  step.status === 'in_progress' ? 'text-blue-600 dark:text-blue-400' :
                                  step.status === 'completed' ? 'text-green-600 dark:text-green-400' :
                                  'text-gray-400'
                                }`}
                              >
                                {getStepStatusIcon(step)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 编辑视图
  return (
    <div className="max-w-[1600px] mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              setViewMode('upload');
              setSelectedVideo(null);
              resetOptions();
            }}
            className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-all"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              {selectedVideo.originalName}
            </h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1">
                <FileVideo className="w-3.5 h-3.5" />
                {formatSize(selectedVideo.fileSize)}
              </span>
              {selectedVideo.duration && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {formatTime(selectedVideo.duration)}
                </span>
              )}
              {selectedVideo.width && selectedVideo.height && (
                <span>{selectedVideo.width}x{selectedVideo.height}</span>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={() => handleDeleteVideo(selectedVideo.id)}
          className="flex items-center gap-2 px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all text-sm"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 flex items-center gap-3">
          <XCircle className="w-5 h-5 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main layout - Video preview and controls */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left side - Video preview area */}
        <div className="xl:col-span-2 space-y-4">
          {/* Dual video preview */}
          <div className="bg-slate-900 rounded-2xl overflow-hidden shadow-2xl">
            <div className="grid grid-cols-2 divide-x divide-slate-700">
              {/* Original video */}
              <div className="relative">
                <div className="absolute top-3 left-3 z-10 px-2 py-1 bg-black/60 rounded text-xs text-white font-medium">
                  Original
                </div>
                <div className="aspect-video bg-black">
                  <video
                    ref={originalVideoRef}
                    src={videoEditorApi.getPreviewUrl(selectedVideo.filePath)}
                    className="w-full h-full object-contain"
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={() => setIsPlaying(false)}
                  />
                </div>
              </div>

              {/* Processed video */}
              <div className="relative">
                <div className="absolute top-3 left-3 z-10 px-2 py-1 bg-black/60 rounded text-xs text-white font-medium">
                  {currentJob?.status === 'completed' ? 'Processed' : 'Preview'}
                </div>
                <div className="aspect-video bg-black flex items-center justify-center">
                  {currentJob?.status === 'completed' && currentJob.outputPath ? (
                    <video
                      ref={processedVideoRef}
                      src={videoEditorApi.getDownloadUrl(currentJob.id)}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="text-center text-gray-500">
                      <Eye className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Process video to see result</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Video controls */}
            <div className="px-6 py-4 bg-slate-800 border-t border-slate-700">
              <div className="flex items-center gap-4">
                {/* Play controls */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={skipBackward}
                    className="p-2 text-gray-400 hover:text-white transition-colors"
                  >
                    <SkipBack className="w-5 h-5" />
                  </button>
                  <button
                    onClick={togglePlay}
                    className="p-3 bg-white rounded-full text-slate-900 hover:bg-gray-200 transition-all shadow-lg"
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                  </button>
                  <button
                    onClick={skipForward}
                    className="p-2 text-gray-400 hover:text-white transition-colors"
                  >
                    <SkipForward className="w-5 h-5" />
                  </button>
                </div>

                {/* Time display */}
                <span className="text-sm text-gray-300 font-mono min-w-[120px]">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>

                {/* Progress slider */}
                <div className="flex-1">
                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={currentTime}
                    onChange={(e) => seekTo(parseFloat(e.target.value))}
                    className="w-full h-1 bg-slate-600 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg"
                  />
                </div>

                {/* Volume control */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleMute}
                    className="p-2 text-gray-400 hover:text-white transition-colors"
                  >
                    {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="w-20 h-1 bg-slate-600 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                  />
                </div>
              </div>
            </div>

            {/* Timeline */}
            {renderTimeline()}
          </div>

          {/* Transcript panel */}
          {aiAnalysis && renderTranscriptPanel()}

          {/* AI Operations panel */}
          {aiAnalysis && renderOperationsPanel()}

          {/* Processing status panel */}
          {currentJob && renderProcessingPanel()}
        </div>

        {/* Right side - Edit controls */}
        <div className="space-y-4">
          {/* Mode toggle */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-3">
            <div className="flex gap-2">
              <button
                onClick={() => setEditMode('ai')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all ${
                  editMode === 'ai'
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/25'
                    : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                }`}
              >
                <Wand2 className="w-5 h-5" />
                AI Mode
              </button>
              <button
                onClick={() => setEditMode('manual')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all ${
                  editMode === 'manual'
                    ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-lg shadow-blue-500/25'
                    : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                }`}
              >
                <Scissors className="w-5 h-5" />
                Manual
              </button>
            </div>
          </div>

          {/* AI Mode panel */}
          {editMode === 'ai' && (
            <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-xl border border-purple-200 dark:border-purple-800 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                <h3 className="font-semibold text-gray-900 dark:text-white">AI Video Editor</h3>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Describe what you want to do with the video. AI will analyze and suggest edits.
              </p>
              <textarea
                value={aiPrompt}
                onChange={(e) => {
                  setAiPrompt(e.target.value);
                  setAiAnalysis(null);
                }}
                placeholder="Example: Remove silence gaps, add subtitles, convert to 9:16 for TikTok"
                rows={4}
                className="w-full px-4 py-3 border border-purple-200 dark:border-purple-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white resize-none focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all text-sm"
              />

              {/* AI Analysis summary */}
              {aiAnalysis && (
                <div className="mt-4 p-4 bg-white dark:bg-slate-800 rounded-xl border border-purple-200 dark:border-purple-700">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
                    <div>
                      <h4 className="font-medium text-gray-900 dark:text-white text-sm">AI Understanding</h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{aiAnalysis.summary}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="mt-4 space-y-2">
                {!aiAnalysis ? (
                  <button
                    onClick={handleAiAnalyze}
                    disabled={aiAnalyzing || !aiPrompt.trim()}
                    className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all ${
                      aiAnalyzing || !aiPrompt.trim()
                        ? 'bg-gray-200 dark:bg-slate-600 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 shadow-lg shadow-purple-500/25'
                    }`}
                  >
                    {aiAnalyzing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        Analyze Video
                      </>
                    )}
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAiAnalysis(null)}
                      className="flex-1 py-3 rounded-xl font-medium bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600 transition-all text-sm"
                    >
                      Edit Prompt
                    </button>
                    <button
                      onClick={handleAiProcess}
                      disabled={aiProcessing}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all text-sm ${
                        aiProcessing
                          ? 'bg-gray-200 dark:bg-slate-600 text-gray-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-700 hover:to-emerald-700 shadow-lg shadow-green-500/25'
                      }`}
                    >
                      {aiProcessing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-5 h-5" />
                          Process
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Manual Mode panel */}
          {editMode === 'manual' && (
            <>
              {/* Aspect Ratio preset */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Square className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <h3 className="font-semibold text-gray-900 dark:text-white">Aspect Ratio</h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(PRESET_INFO) as AspectRatioPreset[]).map((key) => {
                    const info = PRESET_INFO[key];
                    const isSelected = preset === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setPreset(isSelected ? '' : key)}
                        className={`p-3 rounded-xl border-2 text-left transition-all ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-slate-600 hover:border-gray-300 dark:hover:border-slate-500'
                        }`}
                      >
                        <p className={`font-medium text-sm ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-white'}`}>
                          {key}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {info.platforms[0]}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Trim controls */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Scissors className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <h3 className="font-semibold text-gray-900 dark:text-white">Trim</h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Start Time</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={trimStart}
                        onChange={(e) => setTrimStart(e.target.value)}
                        placeholder="00:00:00"
                        className="flex-1 px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white font-mono text-sm"
                      />
                      <button
                        onClick={() => setTrimFromCurrentTime('start')}
                        className="px-3 py-2 bg-gray-100 dark:bg-slate-600 text-gray-600 dark:text-gray-300 rounded-lg text-xs hover:bg-gray-200 dark:hover:bg-slate-500 transition-all"
                      >
                        Set
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">End Time</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={trimEnd}
                        onChange={(e) => setTrimEnd(e.target.value)}
                        placeholder="00:00:00"
                        className="flex-1 px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white font-mono text-sm"
                      />
                      <button
                        onClick={() => setTrimFromCurrentTime('end')}
                        className="px-3 py-2 bg-gray-100 dark:bg-slate-600 text-gray-600 dark:text-gray-300 rounded-lg text-xs hover:bg-gray-200 dark:hover:bg-slate-500 transition-all"
                      >
                        Set
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Subtitle controls */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Type className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <h3 className="font-semibold text-gray-900 dark:text-white">Subtitle</h3>
                </div>
                <div className="space-y-3">
                  <textarea
                    value={subtitleText}
                    onChange={(e) => setSubtitleText(e.target.value)}
                    placeholder="Enter subtitle text..."
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white resize-none text-sm"
                  />
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Position</label>
                    <div className="flex gap-2">
                      {(['bottom', 'center', 'top'] as const).map((style) => (
                        <button
                          key={style}
                          onClick={() => setSubtitleStyle(style)}
                          className={`flex-1 py-2 rounded-lg text-xs capitalize transition-all ${
                            subtitleStyle === style
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium'
                              : 'bg-gray-100 dark:bg-slate-600 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-500'
                          }`}
                        >
                          {style}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Process button */}
              <button
                onClick={handleProcess}
                disabled={processing || (!preset && !trimStart && !trimEnd && !subtitleText)}
                className={`w-full flex items-center justify-center gap-2 py-4 rounded-xl font-medium transition-all ${
                  processing || (!preset && !trimStart && !trimEnd && !subtitleText)
                    ? 'bg-gray-200 dark:bg-slate-600 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white hover:from-blue-700 hover:to-cyan-700 shadow-lg shadow-blue-500/25'
                }`}
              >
                {processing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Film className="w-5 h-5" />
                    Start Processing
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
