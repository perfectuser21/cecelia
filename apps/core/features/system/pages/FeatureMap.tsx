import React, { useState, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { ZoomIn, ZoomOut, RotateCcw, Camera, X, Minimize2 } from 'lucide-react';

interface NodeData {
  id: string;
  name: string;
  x: number;
  y: number;
  type: 'code' | 'llm';
  health: 'healthy' | 'warning' | 'critical';
  size: number;
  file: string;
  description: string;
  layer: 'entry' | 'decision' | 'execution' | 'protection' | 'storage';
  problems?: string[];
  solution?: string;
  time?: string;
  llmModel?: string;
  responseTime?: string;
}

interface LinkData {
  source: string;
  target: string;
  seq?: string;
  desc: string;
}

// Brain architecture data (from brain-execution-paths.html)
const graphData = {
  nodes: [
    // Entry Layer
    { id: 'user', name: '用户\n请求', x: 200, y: 450, type: 'code' as const, health: 'healthy' as const, size: 55, file: 'External', description: '用户通过 API 发起请求', layer: 'entry' as const },
    { id: 'routes', name: 'Routes\n路由层', x: 400, y: 450, type: 'code' as const, health: 'critical' as const, size: 90, file: 'src/routes.js', description: 'Express 路由，接收并分发请求', problems: ['5326 行代码（过大）', '依赖 27 个模块', '150+ 个端点混在一个文件'], solution: '拆分成 6 个独立的路由文件', time: '2-3 小时', layer: 'entry' as const },
    { id: 'websocket', name: 'WebSocket\n实时通信', x: 400, y: 620, type: 'code' as const, health: 'healthy' as const, size: 50, file: 'src/websocket.js', description: 'WebSocket 实时连接', layer: 'entry' as const },
    { id: 'tick', name: 'Tick\n心跳', x: 400, y: 250, type: 'code' as const, health: 'warning' as const, size: 70, file: 'src/tick.js', description: '5 分钟心跳循环，驱动整个系统', problems: ['1464 行代码（偏大）'], solution: '拆分子模块', time: '1 小时', layer: 'entry' as const },
    // Decision Layer
    { id: 'thalamus', name: 'Thalamus\n丘脑', x: 680, y: 450, type: 'llm' as const, health: 'healthy' as const, size: 75, file: 'src/thalamus.js', description: 'Sonnet 模型，事件路由和快速决策（1-2秒）', llmModel: 'Claude Sonnet', responseTime: '1-2 秒', layer: 'decision' as const },
    { id: 'cortex', name: 'Cortex\n皮层', x: 920, y: 330, type: 'llm' as const, health: 'warning' as const, size: 75, file: 'src/cortex.js', description: 'Opus 模型，深度分析和战略决策（10-30秒）', llmModel: 'Claude Opus', responseTime: '10-30 秒', problems: ['cortex-quality.js 功能重叠'], solution: '整合 quality 逻辑', time: '30 分钟', layer: 'decision' as const },
    { id: 'planner', name: 'Planner\n规划', x: 920, y: 200, type: 'llm' as const, health: 'healthy' as const, size: 60, file: 'src/planner.js', description: 'LLM 辅助的任务规划', llmModel: 'Claude', responseTime: '2-5 秒', layer: 'decision' as const },
    { id: 'decision', name: 'Decision\n决策', x: 920, y: 450, type: 'llm' as const, health: 'healthy' as const, size: 60, file: 'src/decision.js', description: 'LLM 辅助的决策制定', llmModel: 'Claude', responseTime: '2-5 秒', layer: 'decision' as const },
    // Execution Layer
    { id: 'executor', name: 'Executor\n执行器', x: 1150, y: 450, type: 'code' as const, health: 'warning' as const, size: 70, file: 'src/executor.js', description: '任务执行器，调度和管理 Agent', problems: ['1402 行代码（偏大）'], solution: '拆分 Agent 管理逻辑', time: '1 小时', layer: 'execution' as const },
    { id: 'actions', name: 'Actions\n操作', x: 1300, y: 450, type: 'code' as const, health: 'warning' as const, size: 60, file: 'src/actions.js', description: '具体任务操作', problems: ['内部 2 处重复代码'], solution: '提取 queryTaskById()', time: '15 分钟', layer: 'execution' as const },
    // Protection Layer
    { id: 'quarantine', name: 'Quarantine\n免疫隔离', x: 1150, y: 650, type: 'code' as const, health: 'healthy' as const, size: 65, file: 'src/quarantine.js', description: '隔离有问题的任务，防止系统污染', layer: 'protection' as const },
    { id: 'alertness', name: 'Alertness\n警觉', x: 1300, y: 650, type: 'code' as const, health: 'critical' as const, size: 80, file: 'src/alertness.js', description: '系统健康监控和告警', problems: ['分散在 5 个文件', 'alertness-actions.js', 'alertness-decision.js', 'alertness/healing.js 重复'], solution: '整合为统一模块', time: '3 小时', layer: 'protection' as const },
    { id: 'focus', name: 'Focus\n焦点', x: 1225, y: 250, type: 'code' as const, health: 'healthy' as const, size: 55, file: 'src/focus.js', description: '焦点管理，优先级控制', layer: 'protection' as const },
    // Storage Layer
    { id: 'database', name: 'Database\n记忆存储', x: 1530, y: 450, type: 'code' as const, health: 'healthy' as const, size: 70, file: 'src/db.js', description: 'PostgreSQL 数据库，存储所有记忆', layer: 'storage' as const },
    { id: 'eventbus', name: 'Event Bus\n神经信号', x: 1530, y: 600, type: 'code' as const, health: 'healthy' as const, size: 60, file: 'src/event-bus.js', description: '事件总线，组件间通信', layer: 'storage' as const }
  ],
  links: [
    // Path A - Simple tasks
    { source: 'user', target: 'routes', seq: 'A1', desc: '用户请求' },
    { source: 'routes', target: 'thalamus', seq: 'A2', desc: '路由' },
    { source: 'thalamus', target: 'executor', seq: 'A3', desc: '简单任务' },
    { source: 'executor', target: 'actions', seq: 'A4', desc: '执行' },
    { source: 'actions', target: 'database', seq: 'A5', desc: '存储' },
    // Path B - Complex tasks
    { source: 'user', target: 'routes', seq: 'B1', desc: '用户请求' },
    { source: 'routes', target: 'thalamus', seq: 'B2', desc: '路由' },
    { source: 'thalamus', target: 'cortex', seq: 'B3', desc: '复杂任务' },
    { source: 'cortex', target: 'planner', seq: 'B4', desc: 'Opus分析' },
    { source: 'planner', target: 'decision', seq: 'B5', desc: '决策' },
    { source: 'decision', target: 'actions', seq: 'B6', desc: '执行' },
    { source: 'actions', target: 'database', seq: 'B7', desc: '存储' },
    // Path C - Autonomous loop
    { source: 'routes', target: 'tick', seq: 'C1', desc: '启动心跳' },
    { source: 'tick', target: 'planner', seq: 'C2', desc: '规划' },
    { source: 'tick', target: 'alertness', seq: 'C3', desc: '检查' },
    { source: 'tick', target: 'actions', seq: 'C4', desc: '调度' },
    // Path D - Protection layer
    { source: 'executor', target: 'quarantine', seq: 'D1', desc: '隔离失败' },
    { source: 'quarantine', target: 'database', seq: 'D2', desc: '记录' },
    { source: 'tick', target: 'alertness', seq: 'D3', desc: '监控' },
    { source: 'alertness', target: 'database', seq: 'D4', desc: '健康数据' },
    { source: 'planner', target: 'focus', seq: 'D5', desc: '优先级' },
    { source: 'focus', target: 'database', seq: 'D6', desc: '焦点数据' },
    // Infrastructure
    { source: 'routes', target: 'executor', desc: '备用直达' },
    { source: 'thalamus', target: 'decision', desc: '决策分支' },
    { source: 'cortex', target: 'decision', desc: '分析结果' },
    { source: 'websocket', target: 'thalamus', desc: 'WebSocket' },
    { source: 'actions', target: 'eventbus', desc: '事件' },
    { source: 'decision', target: 'database', desc: '日志' }
  ]
};

const FeatureMap: React.FC = () => {
  const chartRef = useRef<ReactECharts>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [detailsMinimized, setDetailsMinimized] = useState(false);
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);

  const typeColors = {
    'code': '#3b82f6',
    'llm': '#a855f7'
  };

  const healthBorders = {
    'healthy': { color: 'transparent', width: 0 },
    'warning': { color: '#fb7185', width: 3 },
    'critical': { color: '#dc2626', width: 5 }
  };

  const getChartOption = () => {
    const nodes = graphData.nodes.map(n => ({
      id: n.id,
      name: n.name,
      x: n.x,
      y: n.y,
      symbolSize: n.size,
      draggable: true,
      itemStyle: {
        color: typeColors[n.type],
        borderColor: healthBorders[n.health].color,
        borderWidth: healthBorders[n.health].width,
        shadowBlur: n.health === 'critical' ? 20 : 10,
        shadowColor: n.health === 'critical' ? 'rgba(220, 38, 38, 0.5)' : 'rgba(0, 0, 0, 0.3)'
      },
      label: {
        show: true,
        fontSize: n.health === 'critical' ? 11 : 9,
        fontWeight: n.health === 'critical' ? 'bold' : 'normal',
        color: '#fff'
      },
      data: n
    }));

    const links = graphData.links.map(l => {
      let lineColor = '#64748b';
      let lineWidth = 2;
      if (l.seq?.startsWith('A')) {
        lineColor = '#3b82f6';
        lineWidth = 3;
      } else if (l.seq?.startsWith('B')) {
        lineColor = '#a855f7';
        lineWidth = 3;
      } else if (l.seq?.startsWith('C')) {
        lineColor = '#f59e0b';
        lineWidth = 3;
      } else if (l.seq?.startsWith('D')) {
        lineColor = '#ef4444';
        lineWidth = 3;
      }

      return {
        source: l.source,
        target: l.target,
        label: l.seq ? {
          show: true,
          formatter: `${l.seq}\n${l.desc}`,
          fontSize: 9,
          color: '#e2e8f0'
        } : undefined,
        lineStyle: {
          color: lineColor,
          width: lineWidth,
          opacity: 0.7
        }
      };
    });

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          if (params.dataType === 'node') {
            const d = params.data.data;
            const typeText = d.type === 'code' ? '代码执行' : 'LLM 决策';
            const healthText = { 'healthy': '健康', 'warning': '警告', 'critical': '严重' };
            return `<strong>${d.name.replace(/\n/g, ' ')}</strong><br/>类型: ${typeText}<br/>状态: ${healthText[d.health]}`;
          }
          return '';
        },
        backgroundColor: 'rgba(30, 41, 59, 0.95)',
        borderColor: '#3b82f6',
        textStyle: { color: '#e2e8f0' }
      },
      series: [{
        type: 'graph',
        layout: 'none',
        data: nodes,
        links: links,
        roam: true,
        zoom: detailsVisible ? 0.85 : 1.05,
        center: detailsVisible ? ['75%', '45%'] : ['60%', '45%'],
        draggable: true,
        focusNodeAdjacency: true,
        edgeLabel: {
          show: true,
          fontSize: 9,
          color: '#e2e8f0'
        },
        emphasis: {
          focus: 'adjacency',
          lineStyle: { width: 6, opacity: 1 }
        },
        lineStyle: {
          opacity: 0.7
        }
      }]
    };
  };

  const handleChartClick = (params: any) => {
    if (params.dataType === 'node') {
      setSelectedNode(params.data.data);
      setDetailsVisible(true);
      setDetailsMinimized(false);

      // Delay resize to allow CSS transition to complete
      setTimeout(() => {
        chartRef.current?.getEchartsInstance().resize();
      }, 300);
    }
  };

  const handleZoomIn = () => {
    const chart = chartRef.current?.getEchartsInstance();
    if (chart) {
      const currentOpt = chart.getOption();
      const currentZoom = (currentOpt.series?.[0] as any)?.zoom || 1;
      chart.setOption({
        series: [{ zoom: currentZoom * 1.2 }]
      });
    }
  };

  const handleZoomOut = () => {
    const chart = chartRef.current?.getEchartsInstance();
    if (chart) {
      const currentOpt = chart.getOption();
      const currentZoom = (currentOpt.series?.[0] as any)?.zoom || 1;
      chart.setOption({
        series: [{ zoom: currentZoom * 0.8 }]
      });
    }
  };

  const handleResetView = () => {
    const chart = chartRef.current?.getEchartsInstance();
    if (chart) {
      chart.setOption({
        series: [{
          zoom: detailsVisible ? 0.85 : 1.05,
          center: detailsVisible ? ['75%', '45%'] : ['60%', '45%']
        }]
      });
    }
  };

  const handleExportImage = () => {
    const chart = chartRef.current?.getEchartsInstance();
    if (chart) {
      const url = chart.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: '#0f172a'
      });
      const link = document.createElement('a');
      link.download = `brain-graph-${new Date().getTime()}.png`;
      link.href = url;
      link.click();
    }
  };

  const closeDetails = () => {
    setDetailsVisible(false);
    setDetailsMinimized(false);
    setTimeout(() => {
      chartRef.current?.getEchartsInstance().resize();
    }, 300);
  };

  return (
    <div className="relative w-full h-screen bg-gradient-to-br from-slate-800 to-slate-900 overflow-visible">
      {/* Title and Controls */}
      <div className="absolute top-5 left-5 right-5 flex items-center justify-center z-10 pointer-events-none">
        <h1 className="absolute left-0 text-xl font-bold text-blue-400 pointer-events-auto">Brain 架构图</h1>
        <div className="flex gap-2 pointer-events-auto">
          <button
            onClick={handleZoomIn}
            className="px-4 py-2 bg-blue-500/20 border border-blue-500/40 rounded-md text-blue-400 hover:bg-blue-500/30 hover:border-blue-500/60 transition-all duration-200 flex items-center gap-2"
          >
            <ZoomIn className="w-4 h-4" />
            放大
          </button>
          <button
            onClick={handleZoomOut}
            className="px-4 py-2 bg-blue-500/20 border border-blue-500/40 rounded-md text-blue-400 hover:bg-blue-500/30 hover:border-blue-500/60 transition-all duration-200 flex items-center gap-2"
          >
            <ZoomOut className="w-4 h-4" />
            缩小
          </button>
          <button
            onClick={handleResetView}
            className="px-4 py-2 bg-blue-500/20 border border-blue-500/40 rounded-md text-blue-400 hover:bg-blue-500/30 hover:border-blue-500/60 transition-all duration-200 flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            重置视图
          </button>
          <button
            onClick={handleExportImage}
            className="px-4 py-2 bg-blue-500/20 border border-blue-500/40 rounded-md text-blue-400 hover:bg-blue-500/30 hover:border-blue-500/60 transition-all duration-200 flex items-center gap-2"
          >
            <Camera className="w-4 h-4" />
            截图
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute top-20 right-5 bg-slate-800/90 backdrop-blur-sm border border-blue-500/30 rounded-lg p-3 z-10 text-xs">
        <div className="font-semibold text-blue-400 mb-2">核心路径:</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5 bg-blue-500"></div>
            <span className="text-gray-300">A-简单任务</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5 bg-purple-500"></div>
            <span className="text-gray-300">B-复杂任务</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5 bg-orange-500"></div>
            <span className="text-gray-300">C-心跳</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5 bg-red-500"></div>
            <span className="text-gray-300">D-保护层</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5 bg-gray-500"></div>
            <span className="text-gray-300">基础设施</span>
          </div>
        </div>
      </div>

      {/* Details Panel */}
      {detailsVisible && selectedNode && (
        <div
          className={`fixed top-0 left-0 w-[275px] h-screen bg-slate-800/98 backdrop-blur-md border-r-2 border-blue-500/40 shadow-2xl z-50 transition-all duration-300 overflow-y-auto ${
            detailsMinimized ? 'max-h-auto' : ''
          }`}
          style={{ fontSize: '0.75rem' }}
        >
          <div
            className={`px-6 py-3 bg-blue-500/10 ${detailsMinimized ? 'rounded-xl cursor-pointer' : 'rounded-t-xl'} border-b ${
              detailsMinimized ? 'border-transparent' : 'border-blue-500/30'
            } relative`}
            onClick={() => detailsMinimized && setDetailsMinimized(false)}
          >
            <h2 className="text-[0.95rem] m-0 text-blue-400 pr-16">{selectedNode.name.replace(/\n/g, ' ')}</h2>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDetailsMinimized(!detailsMinimized);
              }}
              className="absolute top-4 right-12 w-7 h-7 bg-blue-500/20 border border-blue-500 rounded-md text-blue-500 flex items-center justify-center hover:bg-blue-500 hover:text-white transition-all"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
            <button
              onClick={closeDetails}
              className="absolute top-4 right-4 w-7 h-7 bg-blue-500/20 border border-blue-500 rounded-md text-blue-500 flex items-center justify-center hover:bg-blue-500 hover:text-white transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {!detailsMinimized && (
            <div className="p-5 max-h-[calc(80vh-60px)] overflow-y-auto">
              <div className="mb-4">
                <span
                  className={`inline-block px-3 py-1.5 rounded-md text-sm font-semibold mr-2 ${
                    selectedNode.type === 'code' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                  }`}
                >
                  {selectedNode.type === 'code' ? '代码执行' : 'LLM 决策'}
                </span>
                <span
                  className="inline-block px-3 py-1.5 rounded-md text-sm font-semibold"
                  style={{
                    backgroundColor:
                      selectedNode.health === 'healthy'
                        ? 'rgba(16, 185, 129, 0.2)'
                        : selectedNode.health === 'warning'
                        ? 'rgba(251, 113, 133, 0.2)'
                        : 'rgba(220, 38, 38, 0.2)',
                    color:
                      selectedNode.health === 'healthy'
                        ? '#10b981'
                        : selectedNode.health === 'warning'
                        ? '#fb7185'
                        : '#dc2626'
                  }}
                >
                  {selectedNode.health === 'healthy' ? '健康' : selectedNode.health === 'warning' ? '警告' : '严重'}
                </span>
              </div>

              <div className="mb-4">
                <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">描述</div>
                <div className="text-gray-200 leading-relaxed">{selectedNode.description}</div>
              </div>

              <div className="mb-4">
                <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">文件路径</div>
                <div className="text-gray-200">{selectedNode.file}</div>
              </div>

              {selectedNode.type === 'llm' && (
                <div className="mb-4">
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">LLM 信息</div>
                  <div className="text-gray-200">
                    <div>
                      <strong>模型:</strong> {selectedNode.llmModel}
                    </div>
                    <div>
                      <strong>响应时间:</strong> {selectedNode.responseTime}
                    </div>
                  </div>
                </div>
              )}

              {selectedNode.problems && selectedNode.problems.length > 0 && (
                <>
                  <div className="mb-4">
                    <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">问题清单</div>
                    <div className="bg-red-500/10 border-l-3 border-red-500 p-4 rounded">
                      {selectedNode.problems.map((p, i) => (
                        <div key={i} className="my-1">
                          • {p}
                        </div>
                      ))}
                    </div>
                  </div>

                  {selectedNode.solution && (
                    <div className="mb-4">
                      <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">解决方案</div>
                      <div className="bg-blue-500/10 border-l-3 border-blue-500 p-4 rounded">
                        <div>
                          <strong>{selectedNode.solution}</strong>
                        </div>
                        <div className="mt-2 text-gray-400">预计时间: {selectedNode.time}</div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Chart */}
      <div
        className={`w-full h-full transition-all duration-300 origin-left overflow-visible ${
          detailsVisible ? 'ml-[275px]' : ''
        }`}
      >
        <ReactECharts
          ref={chartRef}
          option={getChartOption()}
          style={{ width: '100%', height: '100%' }}
          onEvents={{
            click: handleChartClick
          }}
        />
      </div>
    </div>
  );
};

export default FeatureMap;
