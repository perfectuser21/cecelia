import React, { useState, useCallback, useRef, useEffect, DragEvent } from 'react';
import { ZoomIn, ZoomOut, RefreshCw, Save, Check, Loader2, Maximize, Minimize, Download, Image, AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignCenterVertical, AlignEndVertical, Trash2, Palette, Copy, AlignHorizontalSpaceBetween, AlignVerticalSpaceBetween, HelpCircle, LayoutGrid, GitBranch, Group, Ungroup, X, Plus, ChevronRight, ChevronDown, FileText, FolderOpen } from 'lucide-react';
import MiniMap from '../components/MiniMap';
import { KeyboardHelp } from '../components/KeyboardHelp';
import { treeLayout, forceDirectedLayout, gridLayout, circularLayout, applyLayout } from '../components/layoutUtils';
import ProjectSidebar, { WhiteboardProject } from '../components/ProjectSidebar';

const API_BASE = import.meta.env.VITE_API_URL || 'https://dashboard.zenjoymedia.media';

// 简化为思维导图常用形状
type ShapeType = 'rounded' | 'rect' | 'pill' | 'diamond';
type AnchorPosition = 'top' | 'right' | 'bottom' | 'left';
type LineType = 'none' | 'arrow-end' | 'arrow-start' | 'arrow-both';
type LineStyle = 'solid' | 'dashed';

// 层级类型：Feature（可无限嵌套）+ Code（叶子节点）+ Annotation（便签注释）
// 兼容旧数据：module/logic 视为 feature
type LayerType = 'feature' | 'code' | 'module' | 'logic' | 'annotation';

// Feature 深度颜色渐变（从深到浅）
const featureDepthColors = [
  '#1e40af', // 深度0 - 深蓝
  '#2563eb', // 深度1 - 蓝
  '#3b82f6', // 深度2 - 亮蓝
  '#60a5fa', // 深度3 - 浅蓝
  '#93c5fd', // 深度4 - 更浅蓝
  '#bfdbfe', // 深度5+ - 最浅蓝
];

// 根据深度获取 feature 颜色
const getFeatureColor = (depth: number): string => {
  return featureDepthColors[Math.min(depth, featureDepthColors.length - 1)];
};

// 层级配置（module/logic 作为 feature 的别名，兼容旧数据）
const layerConfig: Record<LayerType, { label: string; color: string; bgColor: string; desc: string }> = {
  feature: { label: 'Feature', color: '#3b82f6', bgColor: '#3b82f620', desc: '功能模块' },
  code: { label: 'Code', color: '#10b981', bgColor: '#10b98120', desc: '代码实现' },
  annotation: { label: '注释', color: '#fbbf24', bgColor: '#fbbf2415', desc: '便签注释' },
  // 兼容旧数据
  module: { label: 'Module', color: '#3b82f6', bgColor: '#3b82f620', desc: '功能模块' },
  logic: { label: 'Logic', color: '#8b5cf6', bgColor: '#8b5cf620', desc: '逻辑层' },
};

interface WhiteboardNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  shape: ShapeType;
  color?: string;
  groupId?: string;
  description?: string;  // 节点描述/备注
  parentId?: string;     // 父节点ID，用于层级结构
  layerType?: LayerType; // 层级类型
  filePath?: string;     // Code 层专用：文件路径 (如 src/pages/Whiteboard.tsx:100)
  attachedTo?: string;   // 便签注释附着的主节点ID
  attachPosition?: 'top-right' | 'bottom-right' | 'bottom-left' | 'top-left'; // 便签附着位置
}

interface NodeGroup {
  name: string;
  color: string;
}

interface WhiteboardEdge {
  id: string;
  from: string;
  fromAnchor: AnchorPosition;
  to: string;
  toAnchor: AnchorPosition;
  lineType?: LineType;
  lineStyle?: LineStyle;
  color?: string;
}

// 思维导图常用形状
const shapeConfig: Record<ShapeType, { label: string; icon: string }> = {
  rounded: { label: '圆角矩形', icon: '▢' },
  rect: { label: '矩形', icon: '▬' },
  pill: { label: '胶囊', icon: '⬭' },
  diamond: { label: '菱形', icon: '◆' },
};

const lineTypeConfig: Record<LineType, { label: string; icon: string }> = {
  'none': { label: '无箭头', icon: '―' },
  'arrow-end': { label: '→', icon: '→' },
  'arrow-start': { label: '←', icon: '←' },
  'arrow-both': { label: '↔', icon: '↔' },
};

const lineStyleConfig: Record<LineStyle, { label: string }> = {
  'solid': { label: '实线' },
  'dashed': { label: '虚线' },
};

const defaultColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// Group colors for visual distinction
const groupColors = ['#f472b6', '#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#fb923c'];

interface WhiteboardProps {
  embedded?: boolean;
}

export default function Whiteboard({ embedded = false }: WhiteboardProps) {
  const [nodes, setNodes] = useState<WhiteboardNode[]>([]);
  const [edges, setEdges] = useState<WhiteboardEdge[]>([]);
  const [groups, setGroups] = useState<Map<string, NodeGroup>>(new Map());

  // Project management state
  const [projects, setProjects] = useState<WhiteboardProject[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 层级导航 - path 记录当前浏览路径，null 表示根层级
  const [viewPath, setViewPath] = useState<string[]>([]);
  const currentParentId = viewPath.length > 0 ? viewPath[viewPath.length - 1] : null;

  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  // Box selection state
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredAnchor, setHoveredAnchor] = useState<{ nodeId: string; anchor: AnchorPosition } | null>(null);
  // 悬浮 Tooltip 位置（屏幕坐标）
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  // 双击下钻动画状态
  const [drillingNode, setDrillingNode] = useState<string | null>(null);

  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  // Offsets for all selected nodes during batch drag
  const [batchDragOffsets, setBatchDragOffsets] = useState<Map<string, { x: number; y: number }>>(new Map());

  // 对齐辅助线
  const [alignGuides, setAlignGuides] = useState<{ type: 'h' | 'v'; pos: number }[]>([]);

  // 连线状态 - 包含鼠标位置用于预览线
  const [connecting, setConnecting] = useState<{ nodeId: string; anchor: AnchorPosition } | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // 编辑连线端点
  const [editingEdge, setEditingEdge] = useState<{ edgeId: string; end: 'from' | 'to' } | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const [currentShape, setCurrentShape] = useState<ShapeType>('rounded');
  const [currentColor, setCurrentColor] = useState(defaultColors[0]);
  const [currentLineType, setCurrentLineType] = useState<LineType>('arrow-end');
  const [currentLineStyle, setCurrentLineStyle] = useState<LineStyle>('solid');
  const [currentEdgeColor, setCurrentEdgeColor] = useState('#64748b');
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Clipboard for copy/paste
  const [clipboard, setClipboard] = useState<{ nodes: WhiteboardNode[]; edges: WhiteboardEdge[] } | null>(null);

  // History for undo/redo
  const [history, setHistory] = useState<{ nodes: WhiteboardNode[]; edges: WhiteboardEdge[] }[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isUndoRedo, setIsUndoRedo] = useState(false);

  // 双击编辑节点文字
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // 拖动调整节点大小
  const [resizing, setResizing] = useState<{ nodeId: string; corner: string } | null>(null);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

  // 键盘帮助弹窗
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  // 布局菜单
  // showLayoutMenu removed - 只用一个"整理"按钮
  // 详情面板
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);
  // 脑图模式 - 展开的节点集合
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  // 布局方向：horizontal (左→右) 或 vertical (上→下)
  const [layoutDirection, setLayoutDirection] = useState<'horizontal' | 'vertical'>('horizontal');

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // 编辑模式激活时自动聚焦输入框
  useEffect(() => {
    if (editingNodeId && editInputRef.current) {
      // 使用 setTimeout 确保 DOM 更新后再聚焦
      setTimeout(() => {
        editInputRef.current?.focus();
        editInputRef.current?.select();
      }, 0);
    }
  }, [editingNodeId]);

  // Fullscreen
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Dirty state
  useEffect(() => { setIsDirty(true); }, [nodes, edges]);

  // Save history when nodes or edges change (for undo/redo)
  useEffect(() => {
    if (isUndoRedo) {
      setIsUndoRedo(false);
      return;
    }
    // Only save if there are actual changes
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ nodes: [...nodes], edges: [...edges] });
    // Limit history length
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [nodes, edges]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen();
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    }
  }, []);

const screenToSvg = useCallback((clientX: number, clientY: number) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
  }, [pan, zoom]);

  const getAnchorPos = useCallback((node: WhiteboardNode, anchor: AnchorPosition) => {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    switch (anchor) {
      case 'top': return { x: cx, y: node.y };
      case 'right': return { x: node.x + node.width, y: cy };
      case 'bottom': return { x: cx, y: node.y + node.height };
      case 'left': return { x: node.x, y: cy };
    }
  }, []);

  const addNode = useCallback((x?: number, y?: number, shape?: ShapeType) => {
    const id = `node-${Date.now()}`;
    const newNode: WhiteboardNode = {
      id,
      x: x ?? 100 + nodes.length * 50 % 400,
      y: y ?? 100 + Math.floor(nodes.length / 4) * 80,
      width: 120, height: 50,
      name: `节点 ${nodes.length + 1}`,
      shape: shape ?? currentShape,
      color: currentColor,
    };
    setNodes([...nodes, newNode]);
    setSelectedNodes(new Set([id]));
  }, [nodes, currentShape, currentColor]);

  const handleDrop = useCallback((e: DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    const shapeData = e.dataTransfer.getData('application/whiteboard-shape');
    if (shapeData) {
      const shape = shapeData as ShapeType;
      const svgPos = screenToSvg(e.clientX, e.clientY);
      addNode(svgPos.x - 60, svgPos.y - 25, shape);
    }
  }, [screenToSvg, addNode]);

  const handleDragOver = useCallback((e: DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes(n => n.filter(node => node.id !== nodeId));
    setEdges(e => e.filter(edge => edge.from !== nodeId && edge.to !== nodeId));
    setSelectedNodes(prev => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  }, []);

  // Delete multiple selected nodes
  const deleteSelectedNodes = useCallback(() => {
    if (selectedNodes.size === 0) return;
    const nodeIds = Array.from(selectedNodes);
    setNodes(n => n.filter(node => !nodeIds.includes(node.id)));
    setEdges(e => e.filter(edge => !nodeIds.includes(edge.from) && !nodeIds.includes(edge.to)));
    setSelectedNodes(new Set());
  }, [selectedNodes]);

  const addEdge = useCallback((from: string, fromAnchor: AnchorPosition, to: string, toAnchor: AnchorPosition) => {
    if (from === to) return;
    // 只检查完全相同的连接（同样的锚点），允许不同锚点间有多条线
    const exists = edges.some(e =>
      e.from === from && e.fromAnchor === fromAnchor && e.to === to && e.toAnchor === toAnchor
    );
    if (exists) return;
    setEdges([...edges, { id: `edge-${Date.now()}`, from, fromAnchor, to, toAnchor, lineType: currentLineType, lineStyle: currentLineStyle, color: currentEdgeColor }]);
  }, [edges, currentLineType, currentLineStyle, currentEdgeColor]);

  const deleteEdge = useCallback((edgeId: string) => {
    setEdges(e => e.filter(edge => edge.id !== edgeId));
    if (selectedEdge === edgeId) setSelectedEdge(null);
  }, [selectedEdge]);

  // Keyboard shortcuts (Delete, Copy, Paste, Undo, Redo)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      // Delete/Backspace - delete selected elements
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodes.size > 0) {
          deleteSelectedNodes();
        } else if (selectedEdge) {
          deleteEdge(selectedEdge);
        }
      }

      // Cmd+C or Ctrl+C - copy selected nodes
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault();
        if (selectedNodes.size > 0) {
          const selectedNodesList = nodes.filter(n => selectedNodes.has(n.id));
          // Also copy edges between selected nodes
          const selectedEdges = edges.filter(ed =>
            selectedNodes.has(ed.from) && selectedNodes.has(ed.to)
          );
          setClipboard({ nodes: selectedNodesList.map(n => ({ ...n })), edges: selectedEdges.map(ed => ({ ...ed })) });
        } else if (selectedEdge) {
          const edge = edges.find(ed => ed.id === selectedEdge);
          if (edge) {
            setClipboard({ nodes: [], edges: [{ ...edge }] });
          }
        }
      }

      // Cmd+V or Ctrl+V - paste
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        e.preventDefault();
        if (clipboard && clipboard.nodes.length > 0) {
          // Create ID mapping for nodes
          const idMap = new Map<string, string>();
          const newNodes = clipboard.nodes.map(n => {
            const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            idMap.set(n.id, newId);
            return {
              ...n,
              id: newId,
              x: n.x + 30,
              y: n.y + 30,
            };
          });
          // Create new edges with updated IDs
          const newEdges = clipboard.edges.map(ed => ({
            ...ed,
            id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            from: idMap.get(ed.from) || ed.from,
            to: idMap.get(ed.to) || ed.to,
          })).filter(ed => idMap.has(ed.from) && idMap.has(ed.to));

          setNodes(prev => [...prev, ...newNodes]);
          setEdges(prev => [...prev, ...newEdges]);
          setSelectedNodes(new Set(newNodes.map(n => n.id)));
        }
      }

      // Cmd+A or Ctrl+A - select all
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedNodes(new Set(nodes.map(n => n.id)));
      }

      // Escape - clear selection
      if (e.key === 'Escape') {
        setSelectedNodes(new Set());
        setSelectedEdge(null);
        setShowKeyboardHelp(false);
      }

      // ? - show keyboard help
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowKeyboardHelp(true);
      }

      // Cmd+Z or Ctrl+Z - undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (historyIndex > 0) {
          setIsUndoRedo(true);
          const prev = history[historyIndex - 1];
          setNodes(prev.nodes);
          setEdges(prev.edges);
          setHistoryIndex(historyIndex - 1);
        }
      }

      // Cmd+Shift+Z or Ctrl+Shift+Z - redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        if (historyIndex < history.length - 1) {
          setIsUndoRedo(true);
          const next = history[historyIndex + 1];
          setNodes(next.nodes);
          setEdges(next.edges);
          setHistoryIndex(historyIndex + 1);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedNodes, selectedEdge, nodes, edges, clipboard, history, historyIndex, deleteSelectedNodes, deleteEdge]);

  // 更新选中线条的箭头方向
  const updateEdgeLineType = useCallback((lineType: LineType) => {
    if (!selectedEdge) return;
    setEdges(edges.map(e => e.id === selectedEdge ? { ...e, lineType } : e));
  }, [selectedEdge, edges]);
  // 更新选中线条的颜色
  const updateEdgeColor = useCallback((color: string) => {
    if (!selectedEdge) return;
    setEdges(edges.map(e => e.id === selectedEdge ? { ...e, color } : e));
  }, [selectedEdge, edges]);

  // 更新选中线条的样式
  const updateEdgeLineStyle = useCallback((lineStyle: LineStyle) => {
    if (!selectedEdge) return;
    setEdges(edges.map(e => e.id === selectedEdge ? { ...e, lineStyle } : e));
  }, [selectedEdge, edges]);
  // 更新选中线条的颜色
  // 更新连线端点
  const updateEdgeEndpoint = useCallback((edgeId: string, end: 'from' | 'to', nodeId: string, anchor: AnchorPosition) => {
    setEdges(edges.map(e => {
      if (e.id !== edgeId) return e;
      if (end === 'from') {
        return { ...e, from: nodeId, fromAnchor: anchor };
      } else {
        return { ...e, to: nodeId, toAnchor: anchor };
      }
    }));
  }, [edges]);

  const clearAll = useCallback(() => {
    if (confirm('确定清空画布？')) {
      setNodes([]);
      setEdges([]);
      setSelectedNodes(new Set());
      setSelectedEdge(null);
    }
  }, []);

  // 双击：进入子页面（drill-down）
  const handleNodeDoubleClick = useCallback((node: WhiteboardNode) => {
    const nodeHasChildren = nodes.some(n => n.parentId === node.id);
    if (nodeHasChildren) {
      // 播放下钻动画
      setDrillingNode(node.id);
      setTimeout(() => {
        setDrillingNode(null);
        // 有子节点，进入下一层（drill-down）
        setViewPath(prev => [...prev, node.id]);
        setExpandedNodes(prev => new Set([...prev, node.id]));
        setSelectedNodes(new Set());
        setSelectedEdge(null);
        setNeedsAutoLayout(true); // 触发自动布局
      }, 300);
    }
    // 无子节点时不做任何操作（不再进入编辑模式，避免误操作）
  }, [nodes]);

  // 更新节点名称
  const updateNodeName = useCallback((nodeId: string, name: string) => {
    setNodes(nodes.map(n => n.id === nodeId ? { ...n, name } : n));
    setEditingNodeId(null);
  }, [nodes]);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, node: WhiteboardNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    // 检测双击：如果是双击（e.detail === 2），进入编辑模式而不是拖拽
    if (e.detail === 2) {
      setEditingNodeId(node.id);
      setEditingText(node.name);
      return;
    }

    const svgP = screenToSvg(e.clientX, e.clientY);

    // Shift+click: toggle selection
    if (e.shiftKey) {
      setSelectedNodes(prev => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
      setSelectedEdge(null);
      return;
    }

    // If clicking on an already selected node, drag all selected nodes
    if (selectedNodes.has(node.id)) {
      // Calculate offsets for all selected nodes
      const offsets = new Map<string, { x: number; y: number }>();
      selectedNodes.forEach(nodeId => {
        const n = nodes.find(nd => nd.id === nodeId);
        if (n) {
          offsets.set(nodeId, { x: svgP.x - n.x, y: svgP.y - n.y });
        }
      });
      setBatchDragOffsets(offsets);
      setDragging(node.id);
      setDragOffset({ x: svgP.x - node.x, y: svgP.y - node.y });
    } else {
      // Click on unselected node: select only this node
      setSelectedNodes(new Set([node.id]));
      setDragging(node.id);
      setDragOffset({ x: svgP.x - node.x, y: svgP.y - node.y });
      setBatchDragOffsets(new Map([[node.id, { x: svgP.x - node.x, y: svgP.y - node.y }]]));
    }
    setSelectedEdge(null);
  }, [screenToSvg, selectedNodes, nodes]);

  // 锚点按下 - 开始连线
  const handleAnchorMouseDown = useCallback((e: React.MouseEvent, nodeId: string, anchor: AnchorPosition) => {
    e.stopPropagation();
    e.preventDefault();
    const svgP = screenToSvg(e.clientX, e.clientY);
    setConnecting({ nodeId, anchor });
    setMousePos(svgP);
  }, [screenToSvg]);

  // 锚点松开 - 完成连线
  const handleAnchorMouseUp = useCallback((nodeId: string, anchor: AnchorPosition) => {
    if (connecting && connecting.nodeId !== nodeId) {
      addEdge(connecting.nodeId, connecting.anchor, nodeId, anchor);
    }
    setConnecting(null);
  }, [connecting, addEdge]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    // 只响应直接点击画布背景
    const target = e.target as Element;
    if (target.tagName !== 'rect' && target.tagName !== 'svg') return;

    if (connecting) { setConnecting(null); return; }

    // Middle button or Alt+click: pan
    if (e.button === 1 || e.altKey) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    // Left click on canvas: start box selection
    if (e.button === 0) {
      const svgP = screenToSvg(e.clientX, e.clientY);
      // If not shift, clear selection
      if (!e.shiftKey) {
        setSelectedNodes(new Set());
      }
      setSelectedEdge(null);
      setIsBoxSelecting(true);
      setSelectionBox({ startX: svgP.x, startY: svgP.y, endX: svgP.x, endY: svgP.y });
    }
  }, [connecting, pan, screenToSvg]);

  // 磁吸检测 - 找到最近的锚点
  const findNearestAnchor = useCallback((svgPos: { x: number; y: number }, excludeNodeId?: string) => {
    const SNAP_DISTANCE = 35; // 磁吸距离（像素）
    let nearest: { nodeId: string; anchor: AnchorPosition; dist: number } | null = null;

    for (const node of nodes) {
      if (node.id === excludeNodeId) continue;
      for (const anchor of ['top', 'right', 'bottom', 'left'] as AnchorPosition[]) {
        const pos = getAnchorPos(node, anchor);
        const dist = Math.sqrt((pos.x - svgPos.x) ** 2 + (pos.y - svgPos.y) ** 2);
        if (dist < SNAP_DISTANCE && (!nearest || dist < nearest.dist)) {
          nearest = { nodeId: node.id, anchor, dist };
        }
      }
    }
    return nearest;
  }, [nodes, getAnchorPos]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    const svgP = screenToSvg(e.clientX, e.clientY);

    // Box selection
    if (isBoxSelecting && selectionBox) {
      setSelectionBox({ ...selectionBox, endX: svgP.x, endY: svgP.y });
      return;
    }

    // 连线时更新鼠标位置并检测磁吸
    if (connecting) {
      setMousePos(svgP);
      // 磁吸检测
      const nearest = findNearestAnchor(svgP, connecting.nodeId);
      if (nearest) {
        setHoveredAnchor({ nodeId: nearest.nodeId, anchor: nearest.anchor });
      } else {
        setHoveredAnchor(null);
      }
    }

    // 编辑连线端点时
    if (editingEdge) {
      setMousePos(svgP);
      const edge = edges.find(e => e.id === editingEdge.edgeId);
      if (edge) {
        const excludeNodeId = editingEdge.end === 'from' ? edge.to : edge.from;
        const nearest = findNearestAnchor(svgP, excludeNodeId);
        if (nearest) {
          setHoveredAnchor({ nodeId: nearest.nodeId, anchor: nearest.anchor });
        } else {
          setHoveredAnchor(null);
        }
      }
    }

    // 调整节点大小
    if (resizing) {
      const dx = (e.clientX - resizeStart.x) / zoom;
      const dy = (e.clientY - resizeStart.y) / zoom;
      const newWidth = Math.max(60, resizeStart.width + dx);
      const newHeight = Math.max(30, resizeStart.height + dy);
      setNodes(nodes.map(n => n.id === resizing.nodeId ? { ...n, width: newWidth, height: newHeight } : n));
    }

    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    } else if (dragging) {
      const dragNode = nodes.find(n => n.id === dragging);
      if (!dragNode) return;

      // Calculate base position for the dragged node
      let newX = svgP.x - dragOffset.x;
      let newY = svgP.y - dragOffset.y;

      // Calculate delta from original position
      const deltaX = newX - dragNode.x;
      const deltaY = newY - dragNode.y;

      // 对齐检测 (only for single node drag)
      const guides: { type: 'h' | 'v'; pos: number }[] = [];
      if (selectedNodes.size === 1) {
        const SNAP_THRESHOLD = 8;
        const dragCenterX = newX + dragNode.width / 2;
        const dragCenterY = newY + dragNode.height / 2;
        const dragRight = newX + dragNode.width;
        const dragBottom = newY + dragNode.height;

        for (const other of nodes) {
          if (selectedNodes.has(other.id)) continue;
          const otherCenterX = other.x + other.width / 2;
          const otherCenterY = other.y + other.height / 2;
          const otherRight = other.x + other.width;
          const otherBottom = other.y + other.height;

          // 垂直对齐（X轴）
          if (Math.abs(dragCenterX - otherCenterX) < SNAP_THRESHOLD) {
            newX = otherCenterX - dragNode.width / 2;
            guides.push({ type: 'v', pos: otherCenterX });
          } else if (Math.abs(newX - other.x) < SNAP_THRESHOLD) {
            newX = other.x;
            guides.push({ type: 'v', pos: other.x });
          } else if (Math.abs(dragRight - otherRight) < SNAP_THRESHOLD) {
            newX = otherRight - dragNode.width;
            guides.push({ type: 'v', pos: otherRight });
          }

          // 水平对齐（Y轴）
          if (Math.abs(dragCenterY - otherCenterY) < SNAP_THRESHOLD) {
            newY = otherCenterY - dragNode.height / 2;
            guides.push({ type: 'h', pos: otherCenterY });
          } else if (Math.abs(newY - other.y) < SNAP_THRESHOLD) {
            newY = other.y;
            guides.push({ type: 'h', pos: other.y });
          } else if (Math.abs(dragBottom - otherBottom) < SNAP_THRESHOLD) {
            newY = otherBottom - dragNode.height;
            guides.push({ type: 'h', pos: otherBottom });
          }
        }
      }

      setAlignGuides(guides);

      // Batch move all selected nodes
      if (selectedNodes.size > 1 && batchDragOffsets.size > 0) {
        setNodes(nodes.map(n => {
          if (selectedNodes.has(n.id)) {
            const offset = batchDragOffsets.get(n.id);
            if (offset) {
              return { ...n, x: svgP.x - offset.x, y: svgP.y - offset.y };
            }
          }
          return n;
        }));
      } else {
        setNodes(nodes.map(n => n.id === dragging ? { ...n, x: newX, y: newY } : n));
      }
    }
  }, [connecting, editingEdge, edges, isPanning, panStart, dragging, dragOffset, screenToSvg, nodes, findNearestAnchor, resizing, resizeStart, zoom, isBoxSelecting, selectionBox, selectedNodes, batchDragOffsets]);

  const handleCanvasMouseUp = useCallback(() => {
    setIsPanning(false);
    setDragging(null);
    setAlignGuides([]); // 清除辅助线
    setResizing(null); // 清除调整大小状态
    setBatchDragOffsets(new Map());

    // Box selection complete
    if (isBoxSelecting && selectionBox) {
      const minX = Math.min(selectionBox.startX, selectionBox.endX);
      const maxX = Math.max(selectionBox.startX, selectionBox.endX);
      const minY = Math.min(selectionBox.startY, selectionBox.endY);
      const maxY = Math.max(selectionBox.startY, selectionBox.endY);

      // Find nodes within selection box
      const selectedIds = new Set<string>();
      nodes.forEach(node => {
        const nodeCenterX = node.x + node.width / 2;
        const nodeCenterY = node.y + node.height / 2;
        // Check if node center is within selection box
        if (nodeCenterX >= minX && nodeCenterX <= maxX &&
            nodeCenterY >= minY && nodeCenterY <= maxY) {
          selectedIds.add(node.id);
        }
      });

      setSelectedNodes(prev => {
        const next = new Set(prev);
        selectedIds.forEach(id => next.add(id));
        return next;
      });
      setIsBoxSelecting(false);
      setSelectionBox(null);
    }

    // 连线模式：如果悬停在有效锚点上，自动连接
    if (connecting) {
      if (hoveredAnchor && hoveredAnchor.nodeId !== connecting.nodeId) {
        addEdge(connecting.nodeId, connecting.anchor, hoveredAnchor.nodeId, hoveredAnchor.anchor);
      }
      setConnecting(null);
      setHoveredAnchor(null);
    }

    // 编辑连线端点：如果悬停在有效锚点上，更新端点
    if (editingEdge) {
      if (hoveredAnchor) {
        const edge = edges.find(e => e.id === editingEdge.edgeId);
        if (edge) {
          const otherNodeId = editingEdge.end === 'from' ? edge.to : edge.from;
          if (hoveredAnchor.nodeId !== otherNodeId) {
            updateEdgeEndpoint(editingEdge.edgeId, editingEdge.end, hoveredAnchor.nodeId, hoveredAnchor.anchor);
          }
        }
      }
      setEditingEdge(null);
      setHoveredAnchor(null);
    }
  }, [connecting, hoveredAnchor, addEdge, editingEdge, edges, updateEdgeEndpoint, isBoxSelecting, selectionBox, nodes]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    // 需要按住 Cmd/Ctrl 键才能缩放，避免触摸板误触
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      // 使用更小的缩放步长，更可控
      const delta = e.deltaY > 0 ? 0.95 : 1.05;
      setZoom(z => Math.min(3, Math.max(0.3, z * delta)));
    } else {
      // 没有按键时，用于平移画布
      e.preventDefault();
      setPan(p => ({
        x: p.x - e.deltaX,
        y: p.y - e.deltaY
      }));
    }
  }, []);

  const renderShape = (node: WhiteboardNode, isSelected: boolean, isHovered: boolean, nodeColor?: string) => {
    const { width, height, shape } = node;
    const color = nodeColor || node.color || '#3b82f6';
    const fill = `${color}20`;
    const stroke = isSelected ? '#fbbf24' : isHovered ? '#60a5fa' : color;
    const strokeWidth = isSelected ? 2.5 : isHovered ? 2 : 1.5;

    // 便签注释 - 特殊样式：半透明背景 + 小三角 + 虚线边框
    if (node.layerType === 'annotation') {
      const annotationColor = '#fbbf24';
      const annotationFill = 'rgba(251, 191, 36, 0.08)';
      const annotationStroke = isSelected ? '#fbbf24' : isHovered ? '#fcd34d' : 'rgba(251, 191, 36, 0.4)';
      // 根据附着位置决定小三角方向
      const pos = node.attachPosition || 'top-left';
      let trianglePoints = '';
      if (pos === 'top-right' || pos === 'bottom-right') {
        // 三角在左边，指向左
        trianglePoints = `-8,${height/2 - 6} 0,${height/2} -8,${height/2 + 6}`;
      } else {
        // 三角在右边，指向右
        trianglePoints = `${width + 8},${height/2 - 6} ${width},${height/2} ${width + 8},${height/2 + 6}`;
      }
      return (
        <g>
          {/* 便签主体 - 带圆角的半透明矩形 */}
          <rect
            width={width}
            height={height}
            rx={6}
            fill={annotationFill}
            stroke={annotationStroke}
            strokeWidth={isSelected ? 2 : 1}
            strokeDasharray={isSelected ? undefined : '4 2'}
          />
          {/* 小三角指向主节点 */}
          {node.attachedTo && (
            <polygon
              points={trianglePoints}
              fill={annotationFill}
              stroke={annotationStroke}
              strokeWidth={1}
              strokeDasharray="4 2"
            />
          )}
          {/* 左上角便签图标 */}
          <text x={6} y={14} fontSize={10} fill={annotationColor} style={{ pointerEvents: 'none' }}>
            📝
          </text>
        </g>
      );
    }

    switch (shape) {
      case 'rect':
        return <rect width={width} height={height} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
      case 'rounded':
        return <rect width={width} height={height} rx={8} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
      case 'pill':
        return <rect width={width} height={height} rx={height/2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
      case 'diamond':
        return <polygon points={`${width/2},0 ${width},${height/2} ${width/2},${height} 0,${height/2}`} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
    }
  };

  // 渲染锚点 - 连线时所有节点都显示锚点
  const renderAnchors = (node: WhiteboardNode) => {
    const anchors: AnchorPosition[] = ['top', 'right', 'bottom', 'left'];
    const showAnchors = hoveredNode === node.id || selectedNodes.has(node.id) || connecting !== null || editingEdge !== null;

    if (!showAnchors) return null;

    return anchors.map(anchor => {
      const pos = getAnchorPos(node, anchor);
      const relX = pos.x - node.x;
      const relY = pos.y - node.y;
      const isHovered = hoveredAnchor?.nodeId === node.id && hoveredAnchor?.anchor === anchor;
      const isConnectingFrom = connecting?.nodeId === node.id && connecting?.anchor === anchor;
      const isValidTarget = connecting && connecting.nodeId !== node.id;

      return (
        <circle
          key={anchor}
          cx={relX}
          cy={relY}
          r={isHovered || isConnectingFrom ? 7 : 5}
          fill={isConnectingFrom ? '#10b981' : isHovered ? '#60a5fa' : isValidTarget ? '#94a3b8' : '#64748b'}
          stroke="#1e293b"
          strokeWidth={2}
          style={{ cursor: 'crosshair' }}
          onMouseDown={e => handleAnchorMouseDown(e, node.id, anchor)}
          onMouseUp={() => handleAnchorMouseUp(node.id, anchor)}
          onMouseEnter={() => setHoveredAnchor({ nodeId: node.id, anchor })}
          onMouseLeave={() => setHoveredAnchor(null)}
        />
      );
    });
  };

  const renderEdge = (edge: WhiteboardEdge) => {
    const fromNode = nodes.find(n => n.id === edge.from);
    const toNode = nodes.find(n => n.id === edge.to);
    if (!fromNode || !toNode) return null;

    const fromPos = getAnchorPos(fromNode, edge.fromAnchor);
    const toPos = getAnchorPos(toNode, edge.toAnchor);
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const ctrl = Math.min(Math.abs(dx), Math.abs(dy), 60) + 30;

    let cp1x = fromPos.x, cp1y = fromPos.y, cp2x = toPos.x, cp2y = toPos.y;
    switch (edge.fromAnchor) {
      case 'top': cp1y -= ctrl; break;
      case 'right': cp1x += ctrl; break;
      case 'bottom': cp1y += ctrl; break;
      case 'left': cp1x -= ctrl; break;
    }
    switch (edge.toAnchor) {
      case 'top': cp2y -= ctrl; break;
      case 'right': cp2x += ctrl; break;
      case 'bottom': cp2y += ctrl; break;
      case 'left': cp2x -= ctrl; break;
    }

    const pathD = `M ${fromPos.x} ${fromPos.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toPos.x} ${toPos.y}`;
    const isSelected = selectedEdge === edge.id;
    const lineType = edge.lineType || 'arrow-end';
    const lineStyle = edge.lineStyle || 'solid';
    const strokeDasharray = lineStyle === 'dashed' ? '6 4' : undefined;

    // 根据箭头方向设置 marker（使用对应颜色的 marker）
    const edgeColorId = (edge.color || '#64748b').slice(1);
    let markerEnd: string | undefined;
    let markerStart: string | undefined;

    switch (lineType) {
      case 'arrow-end':
        markerEnd = `url(#arrowhead-${edgeColorId})`;
        break;
      case 'arrow-start':
        markerStart = `url(#arrowhead-start-${edgeColorId})`;
        break;
      case 'arrow-both':
        markerEnd = `url(#arrowhead-${edgeColorId})`;
        markerStart = `url(#arrowhead-start-${edgeColorId})`;
        break;
      case 'none':
      default:
        // 无箭头
        break;
    }

    return (
      <g key={edge.id}>
        <path d={pathD} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }}
          onClick={() => { setSelectedEdge(edge.id); setSelectedNodes(new Set()); }} />
        <path d={pathD} fill="none" stroke={isSelected ? '#ef4444' : (edge.color || '#64748b')}
          strokeWidth={isSelected ? 2.5 : 2} strokeDasharray={strokeDasharray}
          markerEnd={markerEnd} markerStart={markerStart} pointerEvents="none" />
        {/* 选中时显示可拖动的端点 */}
        {isSelected && (
          <>
            <circle
              cx={fromPos.x} cy={fromPos.y} r={8}
              fill="#ef4444" stroke="#fff" strokeWidth={2}
              style={{ cursor: 'grab' }}
              onMouseDown={(e) => {
                e.stopPropagation();
                setEditingEdge({ edgeId: edge.id, end: 'from' });
                setMousePos(fromPos);
              }}
            />
            <circle
              cx={toPos.x} cy={toPos.y} r={8}
              fill="#ef4444" stroke="#fff" strokeWidth={2}
              style={{ cursor: 'grab' }}
              onMouseDown={(e) => {
                e.stopPropagation();
                setEditingEdge({ edgeId: edge.id, end: 'to' });
                setMousePos(toPos);
              }}
            />
          </>
        )}
      </g>
    );
  };

  // 渲染连线预览 - 从锚点到鼠标位置
  const renderConnectingPreview = () => {
    if (!connecting) return null;

    const fromNode = nodes.find(n => n.id === connecting.nodeId);
    if (!fromNode) return null;

    const fromPos = getAnchorPos(fromNode, connecting.anchor);

    // 如果悬停在有效锚点上，连到锚点，否则连到鼠标位置
    let toX = mousePos.x;
    let toY = mousePos.y;

    if (hoveredAnchor && hoveredAnchor.nodeId !== connecting.nodeId) {
      const toNode = nodes.find(n => n.id === hoveredAnchor.nodeId);
      if (toNode) {
        const toPos = getAnchorPos(toNode, hoveredAnchor.anchor);
        toX = toPos.x;
        toY = toPos.y;
      }
    }

    return (
      <line
        x1={fromPos.x}
        y1={fromPos.y}
        x2={toX}
        y2={toY}
        stroke="#10b981"
        strokeWidth={2}
        strokeDasharray="8 4"
        pointerEvents="none"
      />
    );
  };

  // 渲染编辑端点预览线
  const renderEditingEdgePreview = () => {
    if (!editingEdge) return null;

    const edge = edges.find(e => e.id === editingEdge.edgeId);
    if (!edge) return null;

    // 固定端的位置
    const fixedEnd = editingEdge.end === 'from' ? 'to' : 'from';
    const fixedNodeId = fixedEnd === 'from' ? edge.from : edge.to;
    const fixedAnchor = fixedEnd === 'from' ? edge.fromAnchor : edge.toAnchor;
    const fixedNode = nodes.find(n => n.id === fixedNodeId);
    if (!fixedNode) return null;
    const fixedPos = getAnchorPos(fixedNode, fixedAnchor);

    // 移动端位置
    let movingX = mousePos.x;
    let movingY = mousePos.y;
    if (hoveredAnchor) {
      const hoverNode = nodes.find(n => n.id === hoveredAnchor.nodeId);
      if (hoverNode) {
        const hoverPos = getAnchorPos(hoverNode, hoveredAnchor.anchor);
        movingX = hoverPos.x;
        movingY = hoverPos.y;
      }
    }

    return (
      <line
        x1={fixedPos.x}
        y1={fixedPos.y}
        x2={movingX}
        y2={movingY}
        stroke="#f59e0b"
        strokeWidth={2}
        strokeDasharray="8 4"
        pointerEvents="none"
      />
    );
  };

  // Project management functions
  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/panorama/projects`);
      const data = await res.json();
      if (data.projects) {
        setProjects(data.projects);
      }
    } catch { /* ignore */ }
  }, []);

  // 标记是否需要自动展开布局（项目加载后）
  const [needsAutoLayout, setNeedsAutoLayout] = useState(false);
  const [needsFitToContent, setNeedsFitToContent] = useState(false);

  const loadProject = useCallback(async (projectId: string) => {
    try {
      setIsLoading(true);
      const res = await fetch(`${API_BASE}/api/v1/panorama/projects/${projectId}`);
      const data = await res.json();
      if (data.project) {
        const project = data.project;
        setNodes(project.nodes || []);
        setEdges(project.edges || []);
        setCurrentProjectId(projectId);
        setViewPath([]); // 重置到根层级
        setExpandedNodes(new Set()); // 重置展开状态
        setIsDirty(false);
        setNeedsAutoLayout(true); // 标记需要自动布局
      }
    } catch (err) { /* Load error handled silently */ }
    finally { setIsLoading(false); }
  }, []);

  const saveProject = useCallback(async () => {
    if (!currentProjectId) return;
    try {
      setSaveStatus('saving');
      setIsLoading(true);
      await fetch(`${API_BASE}/api/v1/panorama/projects/${currentProjectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, edges })
      });
      setSaveStatus('saved');
      setIsDirty(false);
      loadProjects(); // Refresh project list
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } finally {
      setIsLoading(false);
    }
  }, [currentProjectId, nodes, edges, loadProjects]);

  const createProject = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/panorama/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `新项目 ${projects.length + 1}` })
      });
      const data = await res.json();
      if (data.project) {
        await loadProjects();
        loadProject(data.project.id);
      }
    } catch { /* ignore */ }
  }, [projects.length, loadProjects, loadProject]);

  const deleteProject = useCallback(async (projectId: string) => {
    try {
      await fetch(`${API_BASE}/api/v1/panorama/projects/${projectId}`, {
        method: 'DELETE'
      });
      await loadProjects();
      if (currentProjectId === projectId) {
        setCurrentProjectId(null);
        setNodes([]);
        setEdges([]);
      }
    } catch { /* ignore */ }
  }, [currentProjectId, loadProjects]);

  const renameProject = useCallback(async (projectId: string, name: string) => {
    try {
      await fetch(`${API_BASE}/api/v1/panorama/projects/${projectId}/name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      await loadProjects();
    } catch { /* ignore */ }
  }, [loadProjects]);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // 项目加载或 drill-down 后自动布局
  useEffect(() => {
    if (needsAutoLayout && nodes.length > 0) {
      setNeedsAutoLayout(false);

      // 找出所有有子节点的节点，全部展开
      const allParents = new Set<string>();
      nodes.forEach(n => {
        if (nodes.some(child => child.parentId === n.id)) {
          allParents.add(n.id);
        }
      });
      setExpandedNodes(allParents);

      // 根据 layoutDirection 决定布局方向
      const isHorizontal = layoutDirection === 'horizontal';
      const LAYER_GAP = isHorizontal ? 200 : 100;
      const SIBLING_GAP = isHorizontal ? 30 : 40;
      const NODE_HEIGHT = 50;
      const NODE_WIDTH = 150;
      const START_X = 80;
      const START_Y = 80;

      const updates: { id: string; x: number; y: number }[] = [];

      const getSubtreeSize = (nodeId: string): number => {
        const nodeSize = isHorizontal ? NODE_HEIGHT : NODE_WIDTH;
        if (!allParents.has(nodeId)) return nodeSize;
        const children = nodes.filter(n => n.parentId === nodeId);
        if (children.length === 0) return nodeSize;
        const childrenSize = children.reduce((sum, child) =>
          sum + getSubtreeSize(child.id) + SIBLING_GAP, -SIBLING_GAP);
        return Math.max(nodeSize, childrenSize);
      };

      const layoutNode = (nodeId: string, primaryPos: number, secondaryPos: number, availableSize: number) => {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) return;

        const nodeSize = isHorizontal ? NODE_HEIGHT : NODE_WIDTH;
        const centeredPos = secondaryPos + (availableSize - nodeSize) / 2;

        if (isHorizontal) {
          updates.push({ id: nodeId, x: primaryPos, y: centeredPos });
        } else {
          updates.push({ id: nodeId, x: centeredPos, y: primaryPos });
        }

        if (allParents.has(nodeId)) {
          const children = nodes.filter(n => n.parentId === nodeId);
          if (children.length > 0) {
            const childPrimary = primaryPos + (isHorizontal ? NODE_WIDTH : NODE_HEIGHT) + LAYER_GAP;
            let childSecondary = secondaryPos;
            children.forEach(child => {
              const subtreeSize = getSubtreeSize(child.id);
              layoutNode(child.id, childPrimary, childSecondary, subtreeSize);
              childSecondary += subtreeSize + SIBLING_GAP;
            });
          }
        }
      };

      // 根据当前视图确定要布局的根节点
      const viewRoot = currentParentId;
      if (viewRoot) {
        const subtreeSize = getSubtreeSize(viewRoot);
        layoutNode(viewRoot, START_X, START_Y, subtreeSize);
      } else {
        const rootNodes = nodes.filter(n => !n.parentId);
        if (rootNodes.length === 0) return;

        let currentSecondary = START_Y;
        rootNodes.forEach(root => {
          const subtreeSize = getSubtreeSize(root.id);
          layoutNode(root.id, START_X, currentSecondary, subtreeSize);
          currentSecondary += subtreeSize + SIBLING_GAP * 2;
        });
      }

      if (updates.length > 0) {
        setNodes(prev => prev.map(n => {
          const update = updates.find(u => u.id === n.id);
          return update ? { ...n, x: update.x, y: update.y } : n;
        }));
        // 布局完成后触发自动缩放居中
        setTimeout(() => setNeedsFitToContent(true), 50);
      }
    }
  }, [needsAutoLayout, nodes, currentParentId, layoutDirection]);

  // 自动缩放居中到内容的函数
  const fitToContent = useCallback(() => {
    if (nodes.length === 0 || !svgRef.current) return;

    // 计算所有节点的边界框
    const minX = Math.min(...nodes.map(n => n.x));
    const minY = Math.min(...nodes.map(n => n.y));
    const maxX = Math.max(...nodes.map(n => n.x + n.width));
    const maxY = Math.max(...nodes.map(n => n.y + n.height));

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    // 获取画布尺寸
    const rect = svgRef.current.getBoundingClientRect();
    const canvasWidth = rect.width;
    const canvasHeight = rect.height;

    // 计算缩放比例（留一些边距）
    const padding = 40;
    const scaleX = (canvasWidth - padding * 2) / contentWidth;
    const scaleY = (canvasHeight - padding * 2) / contentHeight;
    // 限制缩放范围：最小 0.8，最大 1.2（保持接近原始大小）
    const newZoom = Math.min(Math.max(scaleX, scaleY, 0.8), 1.2);

    // 计算居中的平移量
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const newPanX = canvasWidth / 2 - centerX * newZoom;
    const newPanY = canvasHeight / 2 - centerY * newZoom;

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [nodes]);

  // needsFitToContent 触发时自动缩放
  useEffect(() => {
    if (!needsFitToContent) return;
    setNeedsFitToContent(false);
    fitToContent();
  }, [needsFitToContent, fitToContent]);

  // 监听画布尺寸变化（侧边栏开关时）只调整位置保持居中，不改变缩放
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    let lastWidth = 0;
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const newWidth = entry.contentRect.width;
      // 只在宽度变化时调整（避免无限循环）
      if (lastWidth && Math.abs(newWidth - lastWidth) > 10) {
        const widthDiff = newWidth - lastWidth;
        // 只调整 pan.x，保持内容在新宽度下居中
        setPan(p => ({ ...p, x: p.x + widthDiff / 2 }));
      }
      lastWidth = newWidth;
    });

    resizeObserver.observe(svgRef.current);
    return () => resizeObserver.disconnect();
  }, [nodes.length]);

  // Batch color change for selected nodes
  const updateSelectedNodesColor = useCallback((color: string) => {
    if (selectedNodes.size === 0) return;
    setNodes(nodes.map(n => selectedNodes.has(n.id) ? { ...n, color } : n));
  }, [selectedNodes, nodes]);

  // Alignment functions for selected nodes
  const getSelectedNodesList = useCallback(() => {
    return nodes.filter(n => selectedNodes.has(n.id));
  }, [nodes, selectedNodes]);

  const alignLeft = useCallback(() => {
    const selected = getSelectedNodesList();
    if (selected.length < 2) return;
    const minX = Math.min(...selected.map(n => n.x));
    setNodes(nodes.map(n => selectedNodes.has(n.id) ? { ...n, x: minX } : n));
  }, [getSelectedNodesList, nodes, selectedNodes]);

  const alignCenterH = useCallback(() => {
    const selected = getSelectedNodesList();
    if (selected.length < 2) return;
    const centerX = selected.reduce((sum, n) => sum + n.x + n.width / 2, 0) / selected.length;
    setNodes(nodes.map(n => selectedNodes.has(n.id) ? { ...n, x: centerX - n.width / 2 } : n));
  }, [getSelectedNodesList, nodes, selectedNodes]);

  const alignRight = useCallback(() => {
    const selected = getSelectedNodesList();
    if (selected.length < 2) return;
    const maxRight = Math.max(...selected.map(n => n.x + n.width));
    setNodes(nodes.map(n => selectedNodes.has(n.id) ? { ...n, x: maxRight - n.width } : n));
  }, [getSelectedNodesList, nodes, selectedNodes]);

  const alignTop = useCallback(() => {
    const selected = getSelectedNodesList();
    if (selected.length < 2) return;
    const minY = Math.min(...selected.map(n => n.y));
    setNodes(nodes.map(n => selectedNodes.has(n.id) ? { ...n, y: minY } : n));
  }, [getSelectedNodesList, nodes, selectedNodes]);

  const alignCenterV = useCallback(() => {
    const selected = getSelectedNodesList();
    if (selected.length < 2) return;
    const centerY = selected.reduce((sum, n) => sum + n.y + n.height / 2, 0) / selected.length;
    setNodes(nodes.map(n => selectedNodes.has(n.id) ? { ...n, y: centerY - n.height / 2 } : n));
  }, [getSelectedNodesList, nodes, selectedNodes]);

  const alignBottom = useCallback(() => {
    const selected = getSelectedNodesList();
    if (selected.length < 2) return;
    const maxBottom = Math.max(...selected.map(n => n.y + n.height));
    setNodes(nodes.map(n => selectedNodes.has(n.id) ? { ...n, y: maxBottom - n.height } : n));
  }, [getSelectedNodesList, nodes, selectedNodes]);

  const distributeHorizontally = useCallback(() => {
    const selected = getSelectedNodesList();
    if (selected.length < 3) return;
    const sorted = [...selected].sort((a, b) => a.x - b.x);
    const minX = sorted[0].x;
    const maxX = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width;
    const totalWidth = sorted.reduce((sum, n) => sum + n.width, 0);
    const gap = (maxX - minX - totalWidth) / (sorted.length - 1);

    let currentX = minX;
    const updates = new Map<string, number>();
    sorted.forEach((n, i) => {
      updates.set(n.id, currentX);
      currentX += n.width + gap;
    });

    setNodes(nodes.map(n => {
      const newX = updates.get(n.id);
      return newX !== undefined ? { ...n, x: newX } : n;
    }));
  }, [getSelectedNodesList, nodes]);

  const distributeVertically = useCallback(() => {
    const selected = getSelectedNodesList();
    if (selected.length < 3) return;
    const sorted = [...selected].sort((a, b) => a.y - b.y);
    const minY = sorted[0].y;
    const maxY = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height;
    const totalHeight = sorted.reduce((sum, n) => sum + n.height, 0);
    const gap = (maxY - minY - totalHeight) / (sorted.length - 1);

    let currentY = minY;
    const updates = new Map<string, number>();
    sorted.forEach((n, i) => {
      updates.set(n.id, currentY);
      currentY += n.height + gap;
    });

    setNodes(nodes.map(n => {
      const newY = updates.get(n.id);
      return newY !== undefined ? { ...n, y: newY } : n;
    }));
  }, [getSelectedNodesList, nodes]);

  // Group functions
  const createGroup = useCallback(() => {
    if (selectedNodes.size < 2) return;
    const groupId = `group-${Date.now()}`;
    const groupColor = groupColors[groups.size % groupColors.length];
    const groupName = `Group ${groups.size + 1}`;

    // Create new group
    setGroups(prev => {
      const next = new Map(prev);
      next.set(groupId, { name: groupName, color: groupColor });
      return next;
    });

    // Assign groupId to selected nodes
    setNodes(nodes.map(n =>
      selectedNodes.has(n.id) ? { ...n, groupId } : n
    ));
  }, [selectedNodes, nodes, groups.size]);

  const dissolveGroup = useCallback((groupId: string) => {
    // Remove groupId from all nodes in this group
    setNodes(nodes.map(n =>
      n.groupId === groupId ? { ...n, groupId: undefined } : n
    ));

    // Remove the group from groups map
    setGroups(prev => {
      const next = new Map(prev);
      next.delete(groupId);
      return next;
    });
  }, [nodes]);

  const selectGroup = useCallback((groupId: string) => {
    const groupNodeIds = nodes.filter(n => n.groupId === groupId).map(n => n.id);
    setSelectedNodes(new Set(groupNodeIds));
  }, [nodes]);

  // Check if all selected nodes are in the same group
  const getSelectedNodesGroupId = useCallback((): string | null => {
    if (selectedNodes.size === 0) return null;
    const selectedNodesList = nodes.filter(n => selectedNodes.has(n.id));
    const groupIds = new Set(selectedNodesList.map(n => n.groupId).filter(Boolean));
    if (groupIds.size === 1) {
      const groupId = selectedNodesList[0].groupId;
      // Check if ALL nodes in this group are selected
      const groupNodes = nodes.filter(n => n.groupId === groupId);
      if (groupNodes.length === selectedNodesList.length &&
          groupNodes.every(n => selectedNodes.has(n.id))) {
        return groupId || null;
      }
    }
    return null;
  }, [selectedNodes, nodes]);

  // 层级导航函数 - 支持脑图模式展开
  // 获取节点是否应该可见（在当前层级，或是展开节点的后代）
  const isNodeVisible = useCallback((node: WhiteboardNode): boolean => {
    // 当前聚焦的父节点本身也要显示（作为根入口）
    if (currentParentId && node.id === currentParentId) return true;

    // 根层级节点（在当前 drill-down 视图中）
    if ((node.parentId || null) === currentParentId) return true;

    // 检查是否是展开节点链的后代
    // 从当前节点向上遍历，检查每个祖先是否都已展开
    const path: string[] = [];
    let current = node.parentId;
    while (current) {
      path.unshift(current);
      const parentNode = nodes.find(n => n.id === current);
      if (!parentNode) break;
      current = parentNode.parentId;
    }

    // path 现在包含从根到直接父节点的路径
    // 检查从当前层级开始，路径上的每个节点是否都展开了
    let checkingFromCurrentLevel = false;
    for (const ancestorId of path) {
      const ancestor = nodes.find(n => n.id === ancestorId);
      if (!ancestor) return false;

      // 找到当前层级的祖先
      if ((ancestor.parentId || null) === currentParentId) {
        checkingFromCurrentLevel = true;
      }

      // 如果在当前层级或更深层级，检查是否展开
      if (checkingFromCurrentLevel) {
        if (!expandedNodes.has(ancestorId)) return false;
      }
    }

    return checkingFromCurrentLevel;
  }, [nodes, currentParentId, expandedNodes]);

  const visibleNodes = nodes.filter(isNodeVisible);
  const visibleEdges = edges.filter(e => {
    // 在下钻视图中，隐藏指向当前根节点的边（根节点已经是最顶层，不需要外部连线）
    if (currentParentId && e.to === currentParentId) {
      return false;
    }
    const fromNode = nodes.find(n => n.id === e.from);
    const toNode = nodes.find(n => n.id === e.to);
    return fromNode && toNode && isNodeVisible(fromNode) && isNodeVisible(toNode);
  });

  // 计算节点的层级深度
  const getNodeDepth = useCallback((nodeId: string): number => {
    let depth = 0;
    let current = nodes.find(n => n.id === nodeId);
    while (current?.parentId) {
      depth++;
      current = nodes.find(n => n.id === current!.parentId);
    }
    return depth;
  }, [nodes]);

  // 获取节点颜色（feature 按深度渐变，code 固定绿色）
  const getNodeColor = useCallback((node: WhiteboardNode): string => {
    if (node.layerType === 'code') {
      return layerConfig.code.color; // 绿色
    }
    // feature/module/logic 都按深度渐变（兼容旧数据）
    if (node.layerType === 'feature' || node.layerType === 'module' || node.layerType === 'logic') {
      const depth = getNodeDepth(node.id);
      return getFeatureColor(depth);
    }
    // 无 layerType 的节点使用自定义颜色或默认蓝色
    return node.color || '#3b82f6';
  }, [getNodeDepth]);

  // 树形布局算法：支持水平（左→右）和垂直（上→下）两种方向
  const computeTreeLayout = useCallback((expandedSet: Set<string>) => {
    const isHorizontal = layoutDirection === 'horizontal';

    // 水平布局：层级左→右，同级上→下
    // 垂直布局：层级上→下，同级左→右
    const LAYER_GAP = isHorizontal ? 200 : 100;   // 层级间距
    const SIBLING_GAP = isHorizontal ? 30 : 40;   // 同级间距
    const NODE_HEIGHT = 50;
    const NODE_WIDTH = 150;
    const START_X = 80;
    const START_Y = 80;

    const updates: { id: string; x: number; y: number }[] = [];

    // 计算节点及其子树在同级方向上的尺寸
    const getSubtreeSize = (nodeId: string): number => {
      const nodeSize = isHorizontal ? NODE_HEIGHT : NODE_WIDTH;
      if (!expandedSet.has(nodeId)) return nodeSize;
      const children = nodes.filter(n => n.parentId === nodeId);
      if (children.length === 0) return nodeSize;
      const childrenSize = children.reduce((sum, child) =>
        sum + getSubtreeSize(child.id) + SIBLING_GAP, -SIBLING_GAP);
      return Math.max(nodeSize, childrenSize);
    };

    // 递归布局
    const layoutNode = (nodeId: string, primaryPos: number, secondaryPos: number, availableSize: number) => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return;

      // 节点居中于可用空间
      const nodeSize = isHorizontal ? NODE_HEIGHT : NODE_WIDTH;
      const centeredPos = secondaryPos + (availableSize - nodeSize) / 2;

      if (isHorizontal) {
        updates.push({ id: nodeId, x: primaryPos, y: centeredPos });
      } else {
        updates.push({ id: nodeId, x: centeredPos, y: primaryPos });
      }

      // 如果展开了，布局子节点
      if (expandedSet.has(nodeId)) {
        const children = nodes.filter(n => n.parentId === nodeId);
        if (children.length > 0) {
          const childPrimary = primaryPos + (isHorizontal ? NODE_WIDTH : NODE_HEIGHT) + LAYER_GAP;
          let childSecondary = secondaryPos;

          children.forEach(child => {
            const subtreeSize = getSubtreeSize(child.id);
            layoutNode(child.id, childPrimary, childSecondary, subtreeSize);
            childSecondary += subtreeSize + SIBLING_GAP;
          });
        }
      }
    };

    // 如果已经 drill-down 到某个父节点，把父节点作为根
    if (currentParentId) {
      const parentNode = nodes.find(n => n.id === currentParentId);
      if (parentNode) {
        const subtreeSize = getSubtreeSize(currentParentId);
        layoutNode(currentParentId, START_X, START_Y, subtreeSize);
        return updates;
      }
    }

    // 根层级：布局所有根节点
    const rootNodes = nodes.filter(n => (n.parentId || null) === currentParentId);
    if (rootNodes.length === 0) return [];

    let currentSecondary = START_Y;
    rootNodes.forEach(root => {
      const subtreeSize = getSubtreeSize(root.id);
      layoutNode(root.id, START_X, currentSecondary, subtreeSize);
      currentSecondary += subtreeSize + SIBLING_GAP * 2;
    });

    return updates;
  }, [nodes, currentParentId, layoutDirection]);

  // 应用树形布局
  const applyTreeLayout = useCallback((expandedSet: Set<string>) => {
    const updates = computeTreeLayout(expandedSet);
    if (updates.length > 0) {
      setNodes(prev => prev.map(n => {
        const update = updates.find(u => u.id === n.id);
        return update ? { ...n, x: update.x, y: update.y } : n;
      }));
    }
  }, [computeTreeLayout]);

  // 切换节点展开状态
  const toggleExpand = useCallback((nodeId: string) => {
    const isCurrentlyExpanded = expandedNodes.has(nodeId);

    const newExpandedSet = new Set(expandedNodes);
    if (isCurrentlyExpanded) {
      newExpandedSet.delete(nodeId);
      // 同时收起所有子孙节点
      const collapseDescendants = (id: string) => {
        nodes.filter(n => n.parentId === id).forEach(child => {
          newExpandedSet.delete(child.id);
          collapseDescendants(child.id);
        });
      };
      collapseDescendants(nodeId);
    } else {
      newExpandedSet.add(nodeId);
    }

    setExpandedNodes(newExpandedSet);
    // 使用新的展开集合重新布局
    setTimeout(() => applyTreeLayout(newExpandedSet), 0);
  }, [nodes, expandedNodes, applyTreeLayout]);

  // 展开所有节点
  const expandAll = useCallback(() => {
    const allParents = new Set<string>();
    nodes.forEach(n => {
      if (nodes.some(child => child.parentId === n.id)) {
        allParents.add(n.id);
      }
    });
    setExpandedNodes(allParents);
    // 用新的展开集合计算布局
    setTimeout(() => applyTreeLayout(allParents), 0);
  }, [nodes, applyTreeLayout]);

  // 收起所有节点
  const collapseAll = useCallback(() => {
    setExpandedNodes(new Set());
    // 收起后重新布局根节点
    setTimeout(() => applyTreeLayout(new Set()), 0);
  }, [applyTreeLayout]);

  const drillDown = useCallback((nodeId: string) => {
    const children = nodes.filter(n => n.parentId === nodeId);
    if (children.length > 0) {
      setViewPath([...viewPath, nodeId]);
      // 自动展开父节点，这样子节点可见
      setExpandedNodes(prev => new Set([...prev, nodeId]));
      setSelectedNodes(new Set());
      setSelectedEdge(null);
      // 触发自动布局
      setNeedsAutoLayout(true);
    }
  }, [nodes, viewPath]);

  const goBack = useCallback(() => {
    if (viewPath.length > 0) {
      setViewPath(viewPath.slice(0, -1));
      setSelectedNodes(new Set());
      setSelectedEdge(null);
    }
  }, [viewPath]);

  const goToLevel = useCallback((index: number) => {
    setViewPath(viewPath.slice(0, index));
    setSelectedNodes(new Set());
    setSelectedEdge(null);
  }, [viewPath]);

  const getNodePath = useCallback((nodeId: string): WhiteboardNode[] => {
    const result: WhiteboardNode[] = [];
    let current = nodes.find(n => n.id === nodeId);
    while (current) {
      result.unshift(current);
      current = current.parentId ? nodes.find(n => n.id === current!.parentId) : undefined;
    }
    return result;
  }, [nodes]);

  // Check if node has children
  const hasChildren = useCallback((nodeId: string) => {
    return nodes.some(n => n.parentId === nodeId);
  }, [nodes]);

  // Detail panel functions
  const openDetailPanel = useCallback((nodeId: string) => {
    setDetailNodeId(nodeId);
    setShowDetailPanel(true);
  }, []);

  const closeDetailPanel = useCallback(() => {
    setShowDetailPanel(false);
    setDetailNodeId(null);
  }, []);

  const updateNodeDescription = useCallback((nodeId: string, description: string) => {
    setNodes(nodes.map(n => n.id === nodeId ? { ...n, description } : n));
  }, [nodes]);

  // Get children of a node
  const getChildNodes = useCallback((parentId: string) => {
    return nodes.filter(n => n.parentId === parentId);
  }, [nodes]);

  // Add a child node
  const addChildNode = useCallback((parentId: string) => {
    const parent = nodes.find(n => n.id === parentId);
    if (!parent) return;

    const children = getChildNodes(parentId);
    const childId = `node-${Date.now()}`;
    const newNode: WhiteboardNode = {
      id: childId,
      x: parent.x + parent.width + 80,
      y: parent.y + children.length * 70,
      width: 120,
      height: 50,
      name: `子节点 ${children.length + 1}`,
      shape: parent.shape,
      color: parent.color,
      parentId: parentId,
    };

    // Add node and edge
    setNodes([...nodes, newNode]);
    setEdges([...edges, {
      id: `edge-${Date.now()}`,
      from: parentId,
      fromAnchor: 'right',
      to: childId,
      toAnchor: 'left',
      lineType: 'arrow-end',
      lineStyle: 'solid',
      color: parent.color,
    }]);
  }, [nodes, edges, getChildNodes]);

  // 智能自动布局 - 根据连线关系和布局方向自动排列
  const autoArrangeLayout = useCallback(() => {
    if (nodes.length === 0) return;

    const isHorizontal = layoutDirection === 'horizontal';
    // 水平布局：父左→子右，同级上→下
    // 垂直布局：父上→子下，同级左→右
    const LAYER_GAP = isHorizontal ? 200 : 100;
    const SIBLING_GAP = isHorizontal ? 40 : 50;
    const NODE_HEIGHT = 55;
    const NODE_WIDTH = 150;
    const START_X = 80;
    const START_Y = 80;

    const updates = new Map<string, { x: number; y: number }>();

    // 找出所有有子节点的节点
    const parentsSet = new Set<string>();
    nodes.forEach(n => {
      if (nodes.some(child => child.parentId === n.id)) {
        parentsSet.add(n.id);
      }
    });

    // 计算子树在同级方向的尺寸
    const getSubtreeSize = (nodeId: string): number => {
      const nodeSize = isHorizontal ? NODE_HEIGHT : NODE_WIDTH;
      if (!parentsSet.has(nodeId)) return nodeSize;
      const children = nodes.filter(n => n.parentId === nodeId);
      if (children.length === 0) return nodeSize;
      const childrenSize = children.reduce((sum, child) =>
        sum + getSubtreeSize(child.id) + SIBLING_GAP, -SIBLING_GAP);
      return Math.max(nodeSize, childrenSize);
    };

    // 递归布局
    const layoutNode = (nodeId: string, primaryPos: number, secondaryPos: number, availableSize: number) => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return;

      const nodeSize = isHorizontal ? NODE_HEIGHT : NODE_WIDTH;
      const centeredPos = secondaryPos + (availableSize - nodeSize) / 2;

      if (isHorizontal) {
        updates.set(nodeId, { x: primaryPos, y: centeredPos });
      } else {
        updates.set(nodeId, { x: centeredPos, y: primaryPos });
      }

      // 布局子节点
      if (parentsSet.has(nodeId)) {
        const children = nodes.filter(n => n.parentId === nodeId);
        if (children.length > 0) {
          const childPrimary = primaryPos + (isHorizontal ? NODE_WIDTH : NODE_HEIGHT) + LAYER_GAP;
          let childSecondary = secondaryPos;
          children.forEach(child => {
            const subtreeSize = getSubtreeSize(child.id);
            layoutNode(child.id, childPrimary, childSecondary, subtreeSize);
            childSecondary += subtreeSize + SIBLING_GAP;
          });
        }
      }
    };

    // 根据当前视图模式布局
    if (currentParentId) {
      const subtreeSize = getSubtreeSize(currentParentId);
      layoutNode(currentParentId, START_X, START_Y, subtreeSize);
    } else {
      const rootNodes = nodes.filter(n => !n.parentId);
      let currentSecondary = START_Y;
      rootNodes.forEach(root => {
        const subtreeSize = getSubtreeSize(root.id);
        layoutNode(root.id, START_X, currentSecondary, subtreeSize);
        currentSecondary += subtreeSize + SIBLING_GAP * 2;
      });
    }

    setNodes(prev => prev.map(n => {
      const pos = updates.get(n.id);
      return pos ? { ...n, x: pos.x, y: pos.y } : n;
    }));

    // 重置视图
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, [nodes, currentParentId, layoutDirection]);

  // 展开所有子节点到当前视图
  const expandAllChildren = useCallback(() => {
    if (!currentParentId) return;

    // 获取当前父节点的所有子节点及其子孙节点
    const getAllDescendants = (parentId: string): WhiteboardNode[] => {
      const children = nodes.filter(n => n.parentId === parentId);
      const descendants: WhiteboardNode[] = [...children];
      children.forEach(child => {
        descendants.push(...getAllDescendants(child.id));
      });
      return descendants;
    };

    const descendants = getAllDescendants(currentParentId);
    if (descendants.length === 0) return;

    // 将所有子孙节点的 parentId 改为当前层级
    setNodes(nodes.map(n => {
      if (descendants.some(d => d.id === n.id)) {
        return { ...n, parentId: currentParentId };
      }
      return n;
    }));

    // 自动布局
    setTimeout(() => autoArrangeLayout(), 100);
  }, [currentParentId, nodes, autoArrangeLayout]);

  const applyForceLayout = useCallback(() => {
    if (visibleNodes.length === 0) return;
    const layoutNodes = visibleNodes.map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }));
    const layoutEdges = visibleEdges.map(e => ({ from: e.from, to: e.to }));
    const result = forceDirectedLayout(layoutNodes, layoutEdges, { startX: 400, startY: 300 });
    setNodes(nodes.map(n => {
      const pos = result.find(r => r.id === n.id);
      return pos ? { ...n, x: pos.x, y: pos.y } : n;
    }));
  }, [visibleNodes, visibleEdges, nodes]);

  const applyGridLayout = useCallback(() => {
    if (visibleNodes.length === 0) return;
    const layoutNodes = visibleNodes.map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }));
    const result = gridLayout(layoutNodes, { startX: 100, startY: 100, nodeSpacingH: 50, nodeSpacingV: 50 });
    setNodes(nodes.map(n => {
      const pos = result.find(r => r.id === n.id);
      return pos ? { ...n, x: pos.x, y: pos.y } : n;
    }));
  }, [visibleNodes, nodes]);

  const applyCircularLayout = useCallback(() => {
    if (visibleNodes.length === 0) return;
    const layoutNodes = visibleNodes.map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }));
    const result = circularLayout(layoutNodes, { startX: 400, startY: 300 });
    setNodes(nodes.map(n => {
      const pos = result.find(r => r.id === n.id);
      return pos ? { ...n, x: pos.x, y: pos.y } : n;
    }));
  }, [visibleNodes, nodes]);

  // MiniMap panTo handler
  const handlePanTo = useCallback((x: number, y: number) => {
    setPan({ x: -x * zoom, y: -y * zoom });
  }, [zoom]);

  // Calculate viewBox for MiniMap
  const getViewBox = useCallback(() => {
    if (!svgRef.current) return { x: 0, y: 0, width: 800, height: 600 };
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: -pan.x / zoom,
      y: -pan.y / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    };
  }, [pan, zoom]);

  // 导出为 JSON
  const exportJSON = useCallback(() => {
    const currentProject = projects.find(p => p.id === currentProjectId);
    const data = {
      title: currentProject?.name || '白板',
      nodes: nodes.map(n => ({ ...n })),
      edges: edges.map(e => ({ ...e })),
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whiteboard-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, projects, currentProjectId]);

  // 导出为 PNG
  const exportPNG = useCallback(async () => {
    if (!svgRef.current || nodes.length === 0) return;

    // 计算边界
    const padding = 40;
    const minX = Math.min(...nodes.map(n => n.x)) - padding;
    const minY = Math.min(...nodes.map(n => n.y)) - padding;
    const maxX = Math.max(...nodes.map(n => n.x + n.width)) + padding;
    const maxY = Math.max(...nodes.map(n => n.y + n.height)) + padding;
    const width = maxX - minX;
    const height = maxY - minY;

    // 创建临时 SVG
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);

    // 背景
    const bg = document.createElementNS(svgNS, 'rect');
    bg.setAttribute('x', String(minX));
    bg.setAttribute('y', String(minY));
    bg.setAttribute('width', String(width));
    bg.setAttribute('height', String(height));
    bg.setAttribute('fill', '#0f172a');
    svg.appendChild(bg);

    // 复制内容（简化版）
    const content = svgRef.current.querySelector('g[transform]');
    if (content) {
      const clone = content.cloneNode(true) as SVGGElement;
      clone.setAttribute('transform', '');
      svg.appendChild(clone);
    }

    // 转换为图片
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(blob => {
          if (blob) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `whiteboard-${Date.now()}.png`;
            a.click();
          }
        }, 'image/png');
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [nodes]);

  return (
    <div ref={containerRef} className={`flex relative bg-slate-900 ${embedded ? 'h-full w-full' : 'h-screen'} ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* 左侧项目边栏 */}
      <ProjectSidebar
        projects={projects}
        currentProjectId={currentProjectId}
        onSelectProject={loadProject}
        onCreateProject={createProject}
        onDeleteProject={deleteProject}
        onRenameProject={renameProject}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* 主内容区域（包含画布和右侧边栏的水平布局） */}
      <div className="flex-1 flex min-w-0 h-full overflow-hidden">
        {/* 画布和工具栏的垂直布局 */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* 工具栏 */}
        <div className={`h-12 flex-shrink-0 flex items-center gap-1 px-2 border-b border-indigo-500/20 min-w-0 relative z-30 ${embedded ? 'bg-slate-900/40 backdrop-blur-sm' : 'bg-slate-900/40'}`}>
        {/* 面包屑导航 */}
        {viewPath.length > 0 && (
          <div className="flex items-center gap-1 mr-2">
            <button
              onClick={goBack}
              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-300 bg-slate-900/60 border border-indigo-500/30 rounded hover:bg-indigo-500/20"
            >
              ← 返回
            </button>
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <button
                onClick={() => goToLevel(0)}
                className="hover:text-slate-200"
              >
                根
              </button>
              {viewPath.map((nodeId, index) => {
                const node = nodes.find(n => n.id === nodeId);
                return (
                  <React.Fragment key={nodeId}>
                    <ChevronRight className="w-3 h-3" />
                    <button
                      onClick={() => goToLevel(index + 1)}
                      className="hover:text-slate-200 max-w-[80px] truncate"
                      title={node?.name}
                    >
                      {node?.name || nodeId}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
            <div className="w-px h-6 bg-slate-700/50 ml-2" />
          </div>
        )}
        {/* 形状 - 可压缩 */}
        <div className="flex items-center gap-0.5 p-0.5 bg-slate-900/60 border border-indigo-500/30 rounded-lg min-w-0 overflow-hidden">
          {(Object.keys(shapeConfig) as ShapeType[]).map(shape => (
            <div
              key={shape}
              draggable
              onDragStart={(e) => {
                setCurrentShape(shape);
                e.dataTransfer.setData('application/whiteboard-shape', shape);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => setCurrentShape(shape)}
              className={`w-8 h-8 flex items-center justify-center text-base rounded cursor-grab active:cursor-grabbing transition-all ${
                currentShape === shape
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
              }`}
              title={`${shapeConfig[shape].label} - 拖到画布`}
            >
              {shapeConfig[shape].icon}
            </div>
          ))}
        </div>

        {/* 颜色 - 可压缩 */}
        <div className="flex items-center gap-0.5 p-0.5 bg-slate-900/60 border border-indigo-500/30 rounded-lg min-w-0 overflow-hidden">
          {defaultColors.map(color => (
            <button
              key={color}
              onClick={() => setCurrentColor(color)}
              className={`w-6 h-6 rounded-full border-2 transition-all ${
                currentColor === color ? 'border-white scale-110' : 'border-transparent hover:scale-105'
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>

        <div className="w-px h-5 bg-slate-700/50" />

        {/* 箭头方向 */}
        <div className="flex items-center gap-0.5 p-0.5 bg-slate-900/60 border border-indigo-500/30 rounded-lg">
          {(Object.keys(lineTypeConfig) as LineType[]).map(lt => (
            <button
              key={lt}
              onClick={() => setCurrentLineType(lt)}
              className={`w-8 h-8 flex items-center justify-center text-base rounded transition-all ${
                currentLineType === lt
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
              }`}
              title={lineTypeConfig[lt].label}
            >
              {lineTypeConfig[lt].icon}
            </button>
          ))}
        </div>

        {/* 线条样式 */}
        <div className="flex items-center gap-0.5 p-0.5 bg-slate-900/60 border border-indigo-500/30 rounded-lg">
          {(Object.keys(lineStyleConfig) as LineStyle[]).map(ls => (
            <button
              key={ls}
              onClick={() => setCurrentLineStyle(ls)}
              className={`px-2 h-8 flex items-center justify-center text-xs rounded transition-all ${
                currentLineStyle === ls
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
              }`}
              title={lineStyleConfig[ls].label}
            >
              {lineStyleConfig[ls].label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* 缩放 */}
        <div className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-900/60 border border-indigo-500/30 rounded-lg">
          <button onClick={() => setZoom(z => Math.max(0.3, z * 0.8))} className="p-1 text-slate-400 hover:text-slate-200">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-slate-400 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z * 1.25))} className="p-1 text-slate-400 hover:text-slate-200">
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        {nodes.length > 0 && (
          <button onClick={clearAll} className="px-2 py-1 text-xs text-red-400 bg-slate-800/50 border border-slate-700/50 rounded hover:bg-red-500/10">
            清空
          </button>
        )}

        {/* 导出按钮 */}
        <div className="flex items-center gap-0.5 p-0.5 bg-slate-900/60 border border-indigo-500/30 rounded-lg">
          <button
            onClick={exportPNG}
            disabled={nodes.length === 0}
            className="p-1.5 text-slate-400 hover:text-slate-200 disabled:opacity-30"
            title="导出 PNG"
          >
            <Image className="w-4 h-4" />
          </button>
          <button
            onClick={exportJSON}
            disabled={nodes.length === 0}
            className="p-1.5 text-slate-400 hover:text-slate-200 disabled:opacity-30"
            title="导出 JSON"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>

        {/* 布局整理 - 不压缩 */}
        {/* 布局方向切换 + 整理 */}
        <div className="flex-shrink-0 flex items-center gap-1 bg-slate-800/50 border border-slate-700/50 rounded-lg p-0.5">
          <button
            onClick={() => { setLayoutDirection('horizontal'); setTimeout(autoArrangeLayout, 50); }}
            className={`px-2 py-1 text-xs rounded transition-colors ${layoutDirection === 'horizontal' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            title="水平布局：父→子从左到右"
          >
            左→右
          </button>
          <button
            onClick={() => { setLayoutDirection('vertical'); setTimeout(autoArrangeLayout, 50); }}
            className={`px-2 py-1 text-xs rounded transition-colors ${layoutDirection === 'vertical' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            title="垂直布局：父→子从上到下"
          >
            上→下
          </button>
          <div className="w-px h-4 bg-slate-600" />
          <button
            onClick={autoArrangeLayout}
            disabled={visibleNodes.length === 0}
            className="px-2 py-1 text-xs text-green-400 hover:bg-green-500/20 rounded disabled:opacity-30"
            title="重新整理布局"
          >
            整理
          </button>
        </div>

        {/* 展开/收起全部 - 不压缩 */}
        <div className="flex-shrink-0 flex items-center gap-1 bg-slate-800/50 border border-slate-700/50 rounded-lg p-0.5">
          <button
            onClick={expandAll}
            disabled={visibleNodes.length === 0}
            className="px-2 py-1 text-xs text-green-400 hover:bg-green-500/20 rounded disabled:opacity-30"
            title="展开所有子节点"
          >
            展开
          </button>
          <div className="w-px h-4 bg-slate-600" />
          <button
            onClick={collapseAll}
            disabled={expandedNodes.size === 0}
            className="px-2 py-1 text-xs text-orange-400 hover:bg-orange-500/20 rounded disabled:opacity-30"
            title="收起所有子节点"
          >
            收起
          </button>
        </div>


        {/* 缩放控制 */}
        <div className="flex items-center gap-1 px-2 py-1 bg-slate-900/60 border border-indigo-500/30 rounded-lg">
          <button
            onClick={() => setZoom(z => Math.max(0.3, z * 0.8))}
            className="p-1 text-slate-400 hover:text-slate-200"
            title="缩小"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-slate-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(z => Math.min(3, z * 1.25))}
            className="p-1 text-slate-400 hover:text-slate-200"
            title="放大"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-slate-700 mx-1" />
          <button
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className="px-1.5 py-0.5 text-xs text-slate-400 hover:text-slate-200"
            title="重置视图"
          >
            1:1
          </button>
        </div>

        {/* 帮助按钮 */}
        <button
          onClick={() => setShowKeyboardHelp(true)}
          className="p-1.5 text-slate-400 bg-slate-800/50 border border-slate-700/50 rounded hover:text-slate-200"
          title="快捷键帮助 (?)"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        <div className="relative">
          <button
            onClick={saveProject}
            disabled={saveStatus === 'saving' || !currentProjectId}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-all ${
              !currentProjectId
                ? 'bg-slate-800/30 text-slate-500 border border-slate-700/30 cursor-not-allowed'
                : saveStatus === 'saved'
                ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                : saveStatus === 'error'
                ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                : 'bg-slate-800/50 text-slate-300 border border-slate-700/50 hover:bg-slate-700/50'
            }`}
            title={!currentProjectId ? '请先选择或创建项目' : '保存'}
          >
            {saveStatus === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
             saveStatus === 'saved' ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saveStatus === 'saving' ? '保存中' : saveStatus === 'saved' ? '已保存' : '保存'}
          </button>
          {isDirty && saveStatus === 'idle' && currentProjectId && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full" />
          )}
        </div>

        {/* 全屏按钮 - 非嵌入模式显示 */}
        {!embedded && (
          <button
            onClick={toggleFullscreen}
            className="p-1.5 text-slate-400 bg-slate-800/50 border border-slate-700/50 rounded hover:text-slate-200"
            title={isFullscreen ? '退出全屏' : '全屏'}
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* 画布区域容器 */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* 画布 */}
        <div className="flex-1 relative overflow-hidden bg-slate-900">
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ cursor: isPanning ? 'grabbing' : dragging ? 'grabbing' : connecting ? 'crosshair' : 'default' }}
          onWheel={handleWheel}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <defs>
            <pattern id="grid" width={30 * zoom} height={30 * zoom} patternUnits="userSpaceOnUse">
              <path d={`M ${30 * zoom} 0 L 0 0 0 ${30 * zoom}`} fill="none" stroke="rgba(71,85,105,0.15)" strokeWidth="1" />
            </pattern>
            {/* 为每种颜色创建对应的箭头 marker */}
            {[...defaultColors, '#64748b'].map(color => (
              <React.Fragment key={color}>
                <marker id={`arrowhead-${color.slice(1)}`} markerWidth="12" markerHeight="8" refX="10" refY="4" orient="auto">
                  <polygon points="0 0, 12 4, 0 8" fill={color} />
                </marker>
                <marker id={`arrowhead-start-${color.slice(1)}`} markerWidth="12" markerHeight="8" refX="2" refY="4" orient="auto-start-reverse">
                  <polygon points="0 0, 12 4, 0 8" fill={color} />
                </marker>
              </React.Fragment>
            ))}
          </defs>

          <rect width="100%" height="100%" fill="url(#grid)" />

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* 边 - 只显示当前层级 */}
            {visibleEdges.map(renderEdge)}

            {/* 展开状态下的父子连接线 - 根据布局方向决定锚点 */}
            {visibleNodes.filter(n => n.parentId && expandedNodes.has(n.parentId)).map(child => {
              // 在下钻视图中，不绘制指向当前根节点的连线（它已经是顶层）
              if (currentParentId && child.id === currentParentId) return null;
              // 确保父节点也是可见的
              const parent = visibleNodes.find(n => n.id === child.parentId);
              if (!parent) return null;
              const color = getNodeColor(parent);

              // 水平布局：父右 → 子左；垂直布局：父下 → 子上
              const isHorizontal = layoutDirection === 'horizontal';
              let x1, y1, x2, y2, pathD, arrowPoints;

              if (isHorizontal) {
                // 父节点右侧中点 → 子节点左侧中点
                x1 = parent.x + parent.width;
                y1 = parent.y + parent.height / 2;
                x2 = child.x;
                y2 = child.y + child.height / 2;
                const midX = (x1 + x2) / 2;
                pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
                arrowPoints = `${x2},${y2} ${x2-8},${y2-4} ${x2-8},${y2+4}`;
              } else {
                // 父节点底部中点 → 子节点顶部中点
                x1 = parent.x + parent.width / 2;
                y1 = parent.y + parent.height;
                x2 = child.x + child.width / 2;
                y2 = child.y;
                const midY = (y1 + y2) / 2;
                pathD = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
                arrowPoints = `${x2},${y2} ${x2-4},${y2-8} ${x2+4},${y2-8}`;
              }

              return (
                <g key={`expand-edge-${parent.id}-${child.id}`}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeOpacity={0.5}
                    strokeDasharray="6 4"
                  />
                  <polygon
                    points={arrowPoints}
                    fill={color}
                    fillOpacity={0.7}
                  />
                </g>
              );
            })}

            {/* 连线预览 */}
            {renderConnectingPreview()}

            {/* 编辑端点预览 */}
            {renderEditingEdgePreview()}

            {/* 对齐辅助线 */}
            {alignGuides.map((guide, i) => (
              guide.type === 'v' ? (
                <line key={i} x1={guide.pos} y1={-10000} x2={guide.pos} y2={10000}
                  stroke="#f472b6" strokeWidth={1} strokeDasharray="4 4" pointerEvents="none" />
              ) : (
                <line key={i} x1={-10000} y1={guide.pos} x2={10000} y2={guide.pos}
                  stroke="#f472b6" strokeWidth={1} strokeDasharray="4 4" pointerEvents="none" />
              )
            ))}

            {/* 节点 - 只显示当前层级 */}
            {visibleNodes.map(node => {
              const isSelected = selectedNodes.has(node.id);
              const isHovered = hoveredNode === node.id;
              const isEditing = editingNodeId === node.id;
              const nodeGroup = node.groupId ? groups.get(node.groupId) : null;
              const nodeHasChildren = hasChildren(node.id);
              const isDrilling = drillingNode === node.id;
              const childCount = nodeHasChildren ? nodes.filter(n => n.parentId === node.id).length : 0;
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onMouseDown={e => handleNodeMouseDown(e, node)}
                  onDoubleClick={() => handleNodeDoubleClick(node)}
                  onMouseEnter={(e) => {
                    setHoveredNode(node.id);
                    // 计算 Tooltip 位置（节点右上角）
                    if (svgRef.current) {
                      const rect = svgRef.current.getBoundingClientRect();
                      const screenX = rect.left + pan.x + (node.x + node.width + 10) * zoom;
                      const screenY = rect.top + pan.y + node.y * zoom;
                      setTooltipPos({ x: screenX, y: screenY });
                    }
                  }}
                  onMouseLeave={() => {
                    setHoveredNode(null);
                    setTooltipPos(null);
                  }}
                  style={{ cursor: nodeHasChildren ? 'pointer' : (dragging === node.id ? 'grabbing' : 'grab') }}
                >
                  {/* 可下钻节点悬浮发光效果 */}
                  {nodeHasChildren && isHovered && !isDrilling && (
                    <rect
                      x={-6}
                      y={-6}
                      width={node.width + 12}
                      height={node.height + 12}
                      rx={14}
                      fill="none"
                      stroke={getNodeColor(node)}
                      strokeWidth={2}
                      opacity={0.6}
                      pointerEvents="none"
                    >
                      <animate attributeName="opacity" values="0.3;0.7;0.3" dur="1.5s" repeatCount="indefinite" />
                    </rect>
                  )}
                  {/* 下钻动画效果 */}
                  {isDrilling && (
                    <rect
                      x={-8}
                      y={-8}
                      width={node.width + 16}
                      height={node.height + 16}
                      rx={16}
                      fill="none"
                      stroke="#22c55e"
                      strokeWidth={3}
                      pointerEvents="none"
                    >
                      <animate attributeName="opacity" values="1;0" dur="0.3s" fill="freeze" />
                      <animate attributeName="stroke-width" values="3;6" dur="0.3s" fill="freeze" />
                    </rect>
                  )}
                  {/* Group visual indicator - background glow */}
                  {nodeGroup && (
                    <rect
                      x={-6}
                      y={-6}
                      width={node.width + 12}
                      height={node.height + 12}
                      rx={14}
                      fill={`${nodeGroup.color}15`}
                      stroke={nodeGroup.color}
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      pointerEvents="none"
                    />
                  )}
                  {isSelected && (
                    <rect x={-4} y={-4} width={node.width + 8} height={node.height + 8} rx={12}
                      fill="none" stroke="#fbbf24" strokeWidth={2} />
                  )}
                  {renderShape(node, isSelected, isHovered, getNodeColor(node))}
                  {isEditing ? (
                    <foreignObject x={4} y={node.height/2 - 12} width={node.width - 8} height={24}>
                      <input
                        ref={editInputRef}
                        autoFocus
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onBlur={() => updateNodeName(node.id, editingText)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') updateNodeName(node.id, editingText);
                          if (e.key === 'Escape') setEditingNodeId(null);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          width: '100%',
                          background: 'transparent',
                          border: 'none',
                          color: '#f1f5f9',
                          fontSize: 12,
                          textAlign: 'center',
                          outline: 'none',
                        }}
                      />
                    </foreignObject>
                  ) : (
                    <foreignObject x={8} y={node.layerType ? 14 : 4} width={node.width - 16} height={node.height - (node.layerType ? 18 : 8)}>
                      <div style={{
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <div style={{
                          fontSize: 12, fontWeight: 600, color: '#f1f5f9',
                          textAlign: 'center', overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {node.name}
                        </div>
                      </div>
                    </foreignObject>
                  )}
                  {renderAnchors(node)}
                  {/* 右下角调整大小手柄 - only show for single selection */}
                  {isSelected && !isEditing && selectedNodes.size === 1 && (
                    <rect
                      x={node.width - 6}
                      y={node.height - 6}
                      width={12}
                      height={12}
                      fill="#3b82f6"
                      stroke="#fff"
                      strokeWidth={1}
                      rx={2}
                      style={{ cursor: 'se-resize' }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setResizing({ nodeId: node.id, corner: 'se' });
                        setResizeStart({ x: e.clientX, y: e.clientY, width: node.width, height: node.height });
                      }}
                    />
                  )}
                  {/* Group badge - click to select entire group */}
                  {nodeGroup && (
                    <g
                      transform={`translate(${node.width - 8}, -8)`}
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (node.groupId) selectGroup(node.groupId);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <circle
                        r={10}
                        fill={nodeGroup.color}
                        stroke="#1e293b"
                        strokeWidth={2}
                      />
                      <text
                        x={0}
                        y={4}
                        fill="#fff"
                        fontSize={10}
                        fontWeight={600}
                        textAnchor="middle"
                        style={{ pointerEvents: 'none' }}
                      >
                        G
                      </text>
                      <title>Click to select entire group</title>
                    </g>
                  )}
                  {/* Expand/Collapse toggle button for nodes with children */}
                  {nodeHasChildren && (
                    <g
                      transform={`translate(${node.width + 4}, ${node.height / 2})`}
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(node.id);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <circle
                        r={10}
                        fill={expandedNodes.has(node.id) ? getNodeColor(node) : '#1e293b'}
                        stroke={getNodeColor(node)}
                        strokeWidth={2}
                      />
                      <text
                        x={0}
                        y={4}
                        fill={expandedNodes.has(node.id) ? '#fff' : getNodeColor(node)}
                        fontSize={14}
                        fontWeight={600}
                        textAnchor="middle"
                        style={{ pointerEvents: 'none' }}
                      >
                        {expandedNodes.has(node.id) ? '−' : '+'}
                      </text>
                      <title>{expandedNodes.has(node.id) ? '收起子节点' : '展开子节点'} (双击进入)</title>
                    </g>
                  )}
                  {/* Layer type badge - left side */}
                  {node.layerType && (
                    <g transform="translate(-8, -8)">
                      <rect
                        x={-22}
                        y={-8}
                        width={44}
                        height={16}
                        rx={8}
                        fill={getNodeColor(node)}
                        stroke="#1e293b"
                        strokeWidth={1.5}
                      />
                      <text
                        x={0}
                        y={4}
                        fill="#fff"
                        fontSize={9}
                        fontWeight={600}
                        textAnchor="middle"
                        style={{ pointerEvents: 'none' }}
                      >
                        {layerConfig[node.layerType].label}
                      </text>
                      <title>{layerConfig[node.layerType].desc}</title>
                    </g>
                  )}
                  {/* Code layer file path indicator */}
                  {node.layerType === 'code' && node.filePath && (
                    <g
                      transform={`translate(8, ${node.height + 6})`}
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Copy file path to clipboard
                        navigator.clipboard.writeText(node.filePath || '');
                      }}
                    >
                      <text
                        fill="#10b981"
                        fontSize={9}
                        style={{ pointerEvents: 'none' }}
                      >
                        {node.filePath.length > 30 ? '...' + node.filePath.slice(-27) : node.filePath}
                      </text>
                      <title>点击复制路径: {node.filePath}</title>
                    </g>
                  )}
                  {/* Detail button - open detail panel */}
                  {isSelected && selectedNodes.size === 1 && (
                    <g
                      transform={`translate(${nodeGroup ? node.width - 28 : node.width - 8}, -8)`}
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetailPanel(node.id);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <circle
                        r={10}
                        fill="#3b82f6"
                        stroke="#1e293b"
                        strokeWidth={2}
                      />
                      <text
                        x={0}
                        y={4}
                        fill="#fff"
                        fontSize={11}
                        fontWeight={600}
                        textAnchor="middle"
                        style={{ pointerEvents: 'none' }}
                      >
                        i
                      </text>
                      <title>查看详情 / 添加子节点</title>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Box selection rectangle */}
            {selectionBox && (
              <rect
                x={Math.min(selectionBox.startX, selectionBox.endX)}
                y={Math.min(selectionBox.startY, selectionBox.endY)}
                width={Math.abs(selectionBox.endX - selectionBox.startX)}
                height={Math.abs(selectionBox.endY - selectionBox.startY)}
                fill="rgba(59, 130, 246, 0.1)"
                stroke="#3b82f6"
                strokeWidth={1}
                strokeDasharray="4 2"
                pointerEvents="none"
              />
            )}

            {/* 空状态 */}
            {nodes.length === 0 && (
              <g transform="translate(200, 120)">
                <rect x={-140} y={-60} width={280} height={120} rx={12}
                  fill="rgba(30,41,59,0.8)" stroke="rgba(71,85,105,0.5)" strokeWidth={1} strokeDasharray="4 2" />
                <text x={0} y={-15} fill="#94a3b8" fontSize={13} textAnchor="middle">白板是空的</text>
                <text x={0} y={10} fill="#64748b" fontSize={11} textAnchor="middle">拖拽上方形状到这里开始</text>
                <text x={0} y={35} fill="#64748b" fontSize={11} textAnchor="middle">从锚点拖出连线</text>
              </g>
            )}
          </g>
        </svg>
      </div>

      {/* Multi-select operations toolbar */}
      {selectedNodes.size > 1 && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex flex-col gap-3 px-4 py-3 bg-slate-900/95 backdrop-blur-xl border border-indigo-500/30 rounded-xl shadow-2xl z-10">
          {/* Selection info */}
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-slate-300">
              已选中 {selectedNodes.size} 个节点
            </span>
            <button
              onClick={() => setSelectedNodes(new Set())}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              取消选择
            </button>
          </div>

          {/* Color picker */}
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-300 w-12">颜色:</span>
            <div className="flex items-center gap-1">
              {defaultColors.map(color => (
                <button
                  key={color}
                  onClick={() => updateSelectedNodesColor(color)}
                  className="w-5 h-5 rounded-full border-2 border-transparent hover:border-white hover:scale-110 transition-all"
                  style={{ backgroundColor: color }}
                  title={`设置颜色 ${color}`}
                />
              ))}
            </div>
          </div>

          {/* Alignment tools */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-300 w-12">对齐:</span>
            <div className="flex items-center gap-0.5 p-0.5 bg-slate-700/50 rounded-lg">
              <button
                onClick={alignLeft}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-600 rounded"
                title="左对齐"
              >
                <AlignLeft className="w-4 h-4" />
              </button>
              <button
                onClick={alignCenterH}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-600 rounded"
                title="水平居中"
              >
                <AlignCenter className="w-4 h-4" />
              </button>
              <button
                onClick={alignRight}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-600 rounded"
                title="右对齐"
              >
                <AlignRight className="w-4 h-4" />
              </button>
              <div className="w-px h-5 bg-slate-600 mx-1" />
              <button
                onClick={alignTop}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-600 rounded"
                title="顶部对齐"
              >
                <AlignStartVertical className="w-4 h-4" />
              </button>
              <button
                onClick={alignCenterV}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-600 rounded"
                title="垂直居中"
              >
                <AlignCenterVertical className="w-4 h-4" />
              </button>
              <button
                onClick={alignBottom}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-600 rounded"
                title="底部对齐"
              >
                <AlignEndVertical className="w-4 h-4" />
              </button>
            </div>
            {selectedNodes.size >= 3 && (
              <>
                <div className="w-px h-5 bg-slate-600 mx-1" />
                <div className="flex items-center gap-0.5 p-0.5 bg-slate-700/50 rounded-lg">
                  <button
                    onClick={distributeHorizontally}
                    className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-600 rounded"
                    title="水平等间距分布"
                  >
                    <AlignHorizontalSpaceBetween className="w-4 h-4" />
                  </button>
                  <button
                    onClick={distributeVertically}
                    className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-600 rounded"
                    title="垂直等间距分布"
                  >
                    <AlignVerticalSpaceBetween className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Group actions */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-300 w-12">分组:</span>
            {(() => {
              const sameGroupId = getSelectedNodesGroupId();
              if (sameGroupId) {
                // All selected nodes are in the same group - show dissolve option
                const group = groups.get(sameGroupId);
                return (
                  <button
                    onClick={() => dissolveGroup(sameGroupId)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-orange-400 bg-slate-700/50 hover:bg-orange-500/20 rounded-lg transition-all"
                    title="解散当前组"
                  >
                    <Ungroup className="w-3.5 h-3.5" />
                    解散组
                    {group && (
                      <span
                        className="w-3 h-3 rounded-full ml-1"
                        style={{ backgroundColor: group.color }}
                      />
                    )}
                  </button>
                );
              } else {
                // Not all in same group - show create group option
                return (
                  <button
                    onClick={createGroup}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-purple-400 bg-slate-700/50 hover:bg-purple-500/20 rounded-lg transition-all"
                    title="将选中节点创建为一组"
                  >
                    <Group className="w-3.5 h-3.5" />
                    创建组
                  </button>
                );
              }
            })()}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const selectedNodesList = nodes.filter(n => selectedNodes.has(n.id));
                const selectedEdges = edges.filter(e =>
                  selectedNodes.has(e.from) && selectedNodes.has(e.to)
                );
                setClipboard({ nodes: selectedNodesList.map(n => ({ ...n })), edges: selectedEdges.map(e => ({ ...e })) });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-300 bg-slate-700/50 hover:bg-slate-600 rounded-lg transition-all"
              title="复制 (Cmd+C)"
            >
              <Copy className="w-3.5 h-3.5" />
              复制
            </button>
            <button
              onClick={deleteSelectedNodes}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400 bg-slate-700/50 hover:bg-red-500/20 rounded-lg transition-all"
              title="删除 (Delete)"
            >
              <Trash2 className="w-3.5 h-3.5" />
              删除
            </button>
          </div>
        </div>
      )}

      {/* 选中线条时的编辑面板 */}
      {selectedEdge && (
        <div
          className="absolute bottom-20 left-1/2 -translate-x-1/2 flex flex-col gap-2 px-4 py-3 bg-slate-900/95 backdrop-blur-xl border border-indigo-500/30 rounded-xl shadow-2xl z-10"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* 箭头方向 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-300 w-16">箭头:</span>
            {(Object.keys(lineTypeConfig) as LineType[]).map(lt => {
              const edge = edges.find(e => e.id === selectedEdge);
              const edgeLineType = edge?.lineType || 'arrow-end';
              const isActive = edgeLineType === lt;
              return (
                <button
                  key={lt}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    updateEdgeLineType(lt);
                  }}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                    isActive
                      ? 'bg-blue-500 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700'
                  }`}
                  title={lineTypeConfig[lt].label}
                >
                  {lineTypeConfig[lt].icon}
                </button>
              );
            })}
          </div>
          {/* 线条样式 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-300 w-16">样式:</span>
            {(Object.keys(lineStyleConfig) as LineStyle[]).map(ls => {
              const edge = edges.find(e => e.id === selectedEdge);
              const edgeLineStyle = edge?.lineStyle || 'solid';
              const isActive = edgeLineStyle === ls;
              return (
                <button
                  key={ls}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    updateEdgeLineStyle(ls);
                  }}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                    isActive
                      ? 'bg-blue-500 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700'
                  }`}
                  title={lineStyleConfig[ls].label}
                >
                  {lineStyleConfig[ls].label}
                </button>
              );
            })}
            <div className="w-px h-6 bg-slate-600 mx-1" />
            {/* 线条颜色选择器 */}
            <div className="flex items-center gap-1">
              {[...defaultColors, '#64748b'].map(color => {
                const edge = edges.find(e => e.id === selectedEdge);
                const edgeColor = edge?.color || '#64748b';
                const isActive = edgeColor === color;
                return (
                  <button
                    key={color}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      updateEdgeColor(color);
                    }}
                    className={`w-5 h-5 rounded-full border-2 transition-all ${
                      isActive ? 'border-white scale-110' : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                    title={`线条颜色 ${color}`}
                  />
                );
              })}
            </div>
            <div className="w-px h-6 bg-slate-600 mx-1" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                deleteEdge(selectedEdge);
              }}
              className="px-3 py-1.5 text-sm text-red-400 hover:text-white hover:bg-red-500 rounded-lg transition-all"
            >
              删除
            </button>
          </div>
        </div>
      )}


      {/* MiniMap */}
        {visibleNodes.length > 0 && (
          <MiniMap
            nodes={visibleNodes.map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, color: n.color }))}
            edges={visibleEdges.map(e => ({ from: e.from, to: e.to }))}
            viewBox={getViewBox()}
            canvasSize={{ width: 2000, height: 1500 }}
            onPanTo={handlePanTo}
          />
        )}

        {/* 悬浮 Tooltip - 轻量级预览卡片 */}
        {hoveredNode && tooltipPos && !dragging && !connecting && (() => {
          const node = nodes.find(n => n.id === hoveredNode);
          if (!node || !node.description) return null; // 只有有描述的节点才显示 Tooltip

          return (
            <div
              className="fixed z-50 pointer-events-none"
              style={{
                left: tooltipPos.x,
                top: tooltipPos.y,
                transform: 'translateY(-50%)',
                maxWidth: 280,
              }}
            >
              <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-700/50 rounded-lg shadow-xl p-3">
                {/* 小三角 */}
                <div
                  className="absolute left-0 top-1/2 -translate-x-full -translate-y-1/2"
                  style={{
                    width: 0,
                    height: 0,
                    borderTop: '6px solid transparent',
                    borderBottom: '6px solid transparent',
                    borderRight: '6px solid rgba(51, 65, 85, 0.8)',
                  }}
                />
                {/* 节点名称 */}
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: getNodeColor(node) }}
                  />
                  <span className="text-sm font-medium text-slate-200 truncate">
                    {node.name}
                  </span>
                  {node.layerType && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: `${getNodeColor(node)}30`,
                        color: getNodeColor(node),
                      }}
                    >
                      {layerConfig[node.layerType].label}
                    </span>
                  )}
                </div>
                {/* 描述内容 */}
                <div className="text-xs text-slate-400 leading-relaxed line-clamp-3">
                  {node.description}
                </div>
                {/* 子节点数量提示 */}
                {hasChildren(node.id) && (
                  <div className="mt-2 text-xs text-slate-500">
                    包含 {nodes.filter(n => n.parentId === node.id).length} 个子节点
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        </div>{/* 关闭画布 div */}

        {/* 底部详情区域 - 显示选中节点的逻辑信息 */}
        {selectedNodes.size === 1 && (() => {
          const selectedNode = nodes.find(n => n.id === [...selectedNodes][0]);
          if (!selectedNode) return null;
          const parentNode = selectedNode.parentId ? nodes.find(n => n.id === selectedNode.parentId) : null;
          const childNodes = nodes.filter(n => n.parentId === selectedNode.id);
          const outEdges = edges.filter(e => e.from === selectedNode.id);
          const inEdges = edges.filter(e => e.to === selectedNode.id);
          const depth = getNodeDepth(selectedNode.id);

          return (
            <div className="flex-shrink-0 border-t border-indigo-500/30 bg-slate-900/80 px-5 py-8 relative z-40">
              <div className="max-w-6xl mx-auto">
                {/* 标题行 */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: getNodeColor(selectedNode) }} />
                  <h3 className="text-base font-semibold text-white">{selectedNode.name}</h3>
                  {selectedNode.layerType && (
                    <span className="px-2 py-0.5 text-xs rounded" style={{ backgroundColor: `${getNodeColor(selectedNode)}30`, color: getNodeColor(selectedNode) }}>
                      {layerConfig[selectedNode.layerType].label}
                    </span>
                  )}
                  {parentNode && (
                    <span className="text-xs text-slate-500 cursor-pointer hover:text-slate-300" onClick={() => setSelectedNodes(new Set([parentNode.id]))}>
                      ← {parentNode.name}
                    </span>
                  )}
                </div>

                {/* 逻辑信息区 */}
                <div className="grid grid-cols-3 gap-4">
                  {/* 左侧：结构统计 */}
                  <div className="space-y-2">
                    <div className="text-xs text-slate-500 font-medium">结构</div>
                    <div className="flex flex-wrap gap-2">
                      <span className="px-2 py-1 bg-slate-800 rounded text-xs text-slate-300">
                        深度 {depth}
                      </span>
                      {childNodes.length > 0 && (
                        <span className="px-2 py-1 bg-blue-900/50 rounded text-xs text-blue-300 cursor-pointer hover:bg-blue-800/50" onClick={() => drillDown(selectedNode.id)}>
                          {childNodes.length} 子节点
                        </span>
                      )}
                      {(outEdges.length > 0 || inEdges.length > 0) && (
                        <span className="px-2 py-1 bg-purple-900/50 rounded text-xs text-purple-300">
                          {outEdges.length}出 / {inEdges.length}入
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 中间：连接关系 */}
                  <div className="space-y-2">
                    <div className="text-xs text-slate-500 font-medium">依赖关系</div>
                    {outEdges.length > 0 || inEdges.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {outEdges.slice(0, 3).map(e => {
                          const target = nodes.find(n => n.id === e.to);
                          return target && (
                            <span
                              key={e.id}
                              className="px-2 py-1 bg-slate-800 rounded text-xs text-slate-300 cursor-pointer hover:bg-slate-700"
                              onClick={() => setSelectedNodes(new Set([target.id]))}
                            >
                              → {target.name}
                            </span>
                          );
                        })}
                        {inEdges.slice(0, 3).map(e => {
                          const source = nodes.find(n => n.id === e.from);
                          return source && (
                            <span
                              key={e.id}
                              className="px-2 py-1 bg-slate-800 rounded text-xs text-slate-300 cursor-pointer hover:bg-slate-700"
                              onClick={() => setSelectedNodes(new Set([source.id]))}
                            >
                              ← {source.name}
                            </span>
                          );
                        })}
                        {(outEdges.length + inEdges.length > 6) && (
                          <span className="px-2 py-1 text-xs text-slate-500">
                            +{outEdges.length + inEdges.length - 6} 更多
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500 italic">无连接</span>
                    )}
                  </div>

                  {/* 右侧：描述/路径 */}
                  <div className="space-y-2">
                    {selectedNode.layerType === 'code' && selectedNode.filePath ? (
                      <>
                        <div className="text-xs text-slate-500 font-medium">文件</div>
                        <div
                          className="flex items-center gap-2 px-2 py-1 bg-slate-800 rounded text-green-400 cursor-pointer hover:bg-slate-700 w-fit"
                          onClick={() => navigator.clipboard.writeText(selectedNode.filePath || '')}
                          title="点击复制"
                        >
                          <FileText size={12} />
                          <span className="font-mono text-xs truncate max-w-[200px]">{selectedNode.filePath}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-xs text-slate-500 font-medium">描述</div>
                        <div className="text-xs text-slate-300 line-clamp-2">
                          {selectedNode.description || <span className="text-slate-500 italic">无</span>}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      </div>{/* 关闭画布区域容器 div */}
        </div>{/* 关闭画布和工具栏的垂直布局 div */}

      {/* 右侧详情栏 - 悬停或单选时显示 */}
      {!showDetailPanel && (() => {
        const activeNode = hoveredNode ? nodes.find(n => n.id === hoveredNode) :
                           selectedNodes.size === 1 ? nodes.find(n => n.id === [...selectedNodes][0]) : null;
        if (!activeNode) return null;
        const childNodes = nodes.filter(n => n.parentId === activeNode.id);
        const childCount = childNodes.length;
        const isExpanded = expandedNodes.has(activeNode.id);
        const parentNode = activeNode.parentId ? nodes.find(n => n.id === activeNode.parentId) : null;
        const nodePath = getNodePath(activeNode.id);
        const connectedEdges = edges.filter(e => e.from === activeNode.id || e.to === activeNode.id);

        return (
          <div className="w-60 flex-shrink-0 h-full max-h-full border-l border-indigo-500/20 flex flex-col overflow-hidden relative z-20" style={{ background: 'linear-gradient(180deg, #1e2a5e 0%, #1e1b4b 100%)' }}>
            <div className="flex-1 overflow-y-auto p-4">
              {/* 标题行 - 简洁版 */}
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-700/50">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: getNodeColor(activeNode) }} />
                <span className="text-sm font-medium text-white truncate">{activeNode.name}</span>
                {activeNode.layerType && (
                  <span className="text-xs text-slate-400 ml-auto">{layerConfig[activeNode.layerType].label}</span>
                )}
              </div>

              {/* 面包屑路径 */}
              {nodePath.length > 1 && (
                <div className="mb-4">
                  <div className="text-xs text-slate-500 mb-1">路径</div>
                  <div className="flex items-center gap-1 text-xs text-slate-400 flex-wrap">
                    {nodePath.slice(0, -1).map((pathNode, i) => (
                      <React.Fragment key={pathNode.id}>
                        <span
                          className="hover:text-slate-200 cursor-pointer"
                          onClick={() => setSelectedNodes(new Set([pathNode.id]))}
                        >
                          {pathNode.name}
                        </span>
                        <ChevronRight size={10} />
                      </React.Fragment>
                    ))}
                    <span className="text-slate-200">{activeNode.name}</span>
                  </div>
                </div>
              )}

              {/* 子节点列表 */}
              {childCount > 0 && (
                <div className="mb-4">
                  <div className="text-sm text-slate-500 mb-2 font-medium">
                    子节点 ({childCount}) {isExpanded && <span className="text-green-400">已展开</span>}
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {childNodes.slice(0, 8).map(child => (
                      <div
                        key={child.id}
                        className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 rounded-lg cursor-pointer hover:bg-slate-700/50"
                        onClick={() => setSelectedNodes(new Set([child.id]))}
                      >
                        {child.layerType && (
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: getNodeColor(child) }}
                          />
                        )}
                        <span className="text-sm text-slate-300 truncate">{child.name}</span>
                        {nodes.some(n => n.parentId === child.id) && (
                          <span className="text-xs text-slate-500 ml-auto">+{nodes.filter(n => n.parentId === child.id).length}</span>
                        )}
                      </div>
                    ))}
                    {childCount > 8 && (
                      <div className="text-xs text-slate-500 text-center py-1">
                        还有 {childCount - 8} 个...
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 连接关系 */}
              {connectedEdges.length > 0 && (
                <div className="mb-4">
                  <div className="text-sm text-slate-500 mb-2 font-medium">连接关系</div>
                  <div className="text-xs text-slate-400 space-y-1">
                    {connectedEdges.slice(0, 5).map(edge => {
                      const isFrom = edge.from === activeNode.id;
                      const otherNode = nodes.find(n => n.id === (isFrom ? edge.to : edge.from));
                      if (!otherNode) return null;
                      return (
                        <div key={edge.id} className="flex items-center gap-2">
                          <span className="text-slate-500">{isFrom ? '→' : '←'}</span>
                          <span
                            className="text-slate-400 hover:text-slate-200 cursor-pointer"
                            onClick={() => setSelectedNodes(new Set([otherNode.id]))}
                          >
                            {otherNode.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 底部操作 */}
            {childCount > 0 && (
              <div className="p-5 border-t border-slate-700 space-y-3">
                <button
                  onClick={() => toggleExpand(activeNode.id)}
                  className={`w-full py-3 text-white text-sm font-medium rounded-lg transition-colors ${
                    isExpanded
                      ? 'bg-orange-500 hover:bg-orange-600'
                      : 'bg-green-500 hover:bg-green-600'
                  }`}
                >
                  {isExpanded ? '收起子节点 ↑' : '展开子节点 ↓'}
                </button>
                <button
                  onClick={() => drillDown(activeNode.id)}
                  className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  进入查看详情 →
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Detail Panel - Right Side (flex 布局，不用 absolute) */}
      {showDetailPanel && detailNodeId && (() => {
        const node = nodes.find(n => n.id === detailNodeId);
        if (!node) return null;
        const children = getChildNodes(detailNodeId);
        return (
          <div className="w-80 flex-shrink-0 h-full max-h-full border-l border-indigo-500/30 flex flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg, #1e2a5e 0%, #1e1b4b 100%)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-indigo-500/30">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: getNodeColor(node) }} />
                <span className="font-medium text-slate-200">{node.name}</span>
              </div>
              <button
                onClick={closeDetailPanel}
                className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-700"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Layer Type Selector */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">层级类型</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['feature', 'code'] as LayerType[]).map(lt => (
                    <button
                      key={lt}
                      onClick={() => {
                        setNodes(prev => prev.map(n => n.id === detailNodeId ? { ...n, layerType: lt } : n));
                        setIsDirty(true);
                      }}
                      className={`px-2 py-1.5 text-xs rounded-lg border transition-all ${
                        node.layerType === lt
                          ? 'border-transparent text-white'
                          : 'border-slate-600 text-slate-400 hover:border-slate-500'
                      }`}
                      style={node.layerType === lt ? { backgroundColor: layerConfig[lt].color } : {}}
                    >
                      {layerConfig[lt].label}
                    </button>
                  ))}
                </div>
                {node.layerType && (
                  <p className="text-xs text-slate-500 mt-1.5">{layerConfig[node.layerType].desc}</p>
                )}
              </div>

              {/* File Path - only for Code layer */}
              {node.layerType === 'code' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">文件路径</label>
                  <input
                    type="text"
                    value={node.filePath || ''}
                    onChange={(e) => {
                      setNodes(prev => prev.map(n => n.id === detailNodeId ? { ...n, filePath: e.target.value } : n));
                      setIsDirty(true);
                    }}
                    placeholder="src/pages/Whiteboard.tsx:100"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-green-500"
                  />
                </div>
              )}

              {/* Description */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">描述 / 备注</label>
                <textarea
                  value={node.description || ''}
                  onChange={(e) => updateNodeDescription(detailNodeId, e.target.value)}
                  placeholder="添加描述..."
                  className="w-full h-24 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Children */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-slate-400">子节点 ({children.length})</label>
                  <button
                    onClick={() => addChildNode(detailNodeId)}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-blue-400 hover:text-blue-300 hover:bg-slate-700 rounded"
                  >
                    <Plus size={14} />
                    添加
                  </button>
                </div>
                <div className="space-y-1">
                  {children.length === 0 ? (
                    <div className="text-sm text-slate-500 py-3 text-center border border-dashed border-slate-600 rounded-lg">
                      暂无子节点
                    </div>
                  ) : (
                    children.map(child => (
                      <div
                        key={child.id}
                        className="flex items-center gap-2 px-3 py-2 bg-slate-900 rounded-lg cursor-pointer hover:bg-slate-700 group"
                        onClick={() => {
                          setSelectedNodes(new Set([child.id]));
                          openDetailPanel(child.id);
                        }}
                      >
                        <div className="w-2 h-2 rounded" style={{ backgroundColor: child.color || '#3b82f6' }} />
                        <span className="flex-1 text-sm text-slate-300 truncate">{child.name}</span>
                        <ChevronRight size={14} className="text-slate-500 group-hover:text-slate-300" />
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Parent (if has) */}
              {node.parentId && (() => {
                const parent = nodes.find(n => n.id === node.parentId);
                if (!parent) return null;
                return (
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">父节点</label>
                    <div
                      className="flex items-center gap-2 px-3 py-2 bg-slate-900 rounded-lg cursor-pointer hover:bg-slate-700"
                      onClick={() => {
                        setSelectedNodes(new Set([parent.id]));
                        openDetailPanel(parent.id);
                      }}
                    >
                      <div className="w-2 h-2 rounded" style={{ backgroundColor: parent.color || '#3b82f6' }} />
                      <span className="text-sm text-slate-300">{parent.name}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Node Info */}
              <div className="pt-2 border-t border-slate-700">
                <label className="block text-xs text-slate-400 mb-1.5">节点信息</label>
                <div className="text-xs text-slate-500 space-y-1">
                  <div>ID: {node.id}</div>
                  <div>位置: ({Math.round(node.x)}, {Math.round(node.y)})</div>
                  <div>大小: {node.width} × {node.height}</div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* KeyboardHelp Modal */}
      <KeyboardHelp isOpen={showKeyboardHelp} onClose={() => setShowKeyboardHelp(false)} />
    </div>
  );
}
