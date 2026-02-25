import React, { useState, useRef, useEffect } from 'react';
import { Layers, PenTool, Maximize, Minimize } from 'lucide-react';

// 懒加载两个视图组件
const ProjectPanorama = React.lazy(() => import('./ProjectPanorama'));
const Whiteboard = React.lazy(() => import('./Whiteboard'));

type CanvasMode = 'panorama' | 'whiteboard';

export default function Canvas() {
  const [mode, setMode] = useState<CanvasMode>('panorama');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 监听全屏状态变化
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement && containerRef.current) {
      await containerRef.current.requestFullscreen();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col -m-8"
      style={{
        // 从左侧蓝色过渡到右侧紫色，与左侧导航栏协调
        background: 'linear-gradient(120deg, #1e2a5e 0%, #1e1b4b 40%, #0f172a 100%)',
        height: isFullscreen ? '100vh' : 'calc(100vh - 64px)',
      }}
    >
      {/* 顶部栏 - 模式切换和全屏按钮 */}
      <div className="h-11 flex items-center justify-between px-4 border-b border-indigo-500/20 bg-slate-900/40 backdrop-blur-sm">
        {/* 左侧：模式切换 */}
        <div className="flex items-center gap-0.5 p-0.5 bg-slate-900/60 border border-indigo-500/30 rounded-lg">
          <button
            onClick={() => setMode('panorama')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              mode === 'panorama'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            项目视图
          </button>
          <button
            onClick={() => setMode('whiteboard')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              mode === 'whiteboard'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            自由画布
          </button>
        </div>

        {/* 右侧：全屏按钮 */}
        <button
          onClick={toggleFullscreen}
          className="p-1.5 text-slate-400 hover:text-slate-200 bg-slate-900/60 border border-indigo-500/30 rounded-lg hover:bg-indigo-500/20 transition-colors"
          title={isFullscreen ? '退出全屏' : '全屏'}
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 min-h-0">
        <React.Suspense fallback={
          <div className="h-full flex items-center justify-center text-slate-500">
            加载中...
          </div>
        }>
          {mode === 'panorama' ? (
            <ProjectPanorama embedded />
          ) : (
            <Whiteboard embedded />
          )}
        </React.Suspense>
      </div>
    </div>
  );
}
