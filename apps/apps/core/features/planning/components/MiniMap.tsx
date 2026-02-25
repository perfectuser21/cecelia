import React, { useCallback, useRef, useState, useEffect } from 'react';

interface MiniMapNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

interface MiniMapEdge {
  from: string;
  to: string;
}

interface MiniMapProps {
  nodes: MiniMapNode[];
  edges: MiniMapEdge[];
  viewBox: { x: number; y: number; width: number; height: number };
  canvasSize: { width: number; height: number };
  onPanTo: (x: number, y: number) => void;
}

const MINIMAP_WIDTH = 150;
const MINIMAP_HEIGHT = 100;
const PADDING = 10;

export default function MiniMap({ nodes, edges, viewBox, canvasSize, onPanTo }: MiniMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Calculate bounds of all nodes
  const getBounds = useCallback(() => {
    // 过滤出有效节点
    const validNodes = nodes.filter(n => typeof n.x === 'number' && typeof n.y === 'number');
    if (validNodes.length === 0) {
      return {
        minX: 0,
        minY: 0,
        maxX: canvasSize.width,
        maxY: canvasSize.height,
      };
    }

    const minX = Math.min(...validNodes.map(n => n.x), viewBox.x);
    const minY = Math.min(...validNodes.map(n => n.y), viewBox.y);
    const maxX = Math.max(...validNodes.map(n => n.x + (n.width || 150)), viewBox.x + viewBox.width);
    const maxY = Math.max(...validNodes.map(n => n.y + (n.height || 50)), viewBox.y + viewBox.height);

    return { minX, minY, maxX, maxY };
  }, [nodes, viewBox, canvasSize]);

  // Calculate scale to fit content in minimap
  const getScale = useCallback(() => {
    const bounds = getBounds();
    const contentWidth = bounds.maxX - bounds.minX + PADDING * 2;
    const contentHeight = bounds.maxY - bounds.minY + PADDING * 2;

    const scaleX = (MINIMAP_WIDTH - PADDING * 2) / contentWidth;
    const scaleY = (MINIMAP_HEIGHT - PADDING * 2) / contentHeight;

    return Math.min(scaleX, scaleY, 1); // Don't scale up if content is small
  }, [getBounds]);

  // Convert minimap coordinates to canvas coordinates
  const minimapToCanvas = useCallback((minimapX: number, minimapY: number) => {
    const bounds = getBounds();
    const scale = getScale();

    const offsetX = (MINIMAP_WIDTH - (bounds.maxX - bounds.minX + PADDING * 2) * scale) / 2;
    const offsetY = (MINIMAP_HEIGHT - (bounds.maxY - bounds.minY + PADDING * 2) * scale) / 2;

    const canvasX = (minimapX - offsetX - PADDING * scale) / scale + bounds.minX;
    const canvasY = (minimapY - offsetY - PADDING * scale) / scale + bounds.minY;

    return { x: canvasX, y: canvasY };
  }, [getBounds, getScale]);

  // Convert canvas coordinates to minimap coordinates
  const canvasToMinimap = useCallback((canvasX: number, canvasY: number) => {
    const bounds = getBounds();
    const scale = getScale();

    const offsetX = (MINIMAP_WIDTH - (bounds.maxX - bounds.minX + PADDING * 2) * scale) / 2;
    const offsetY = (MINIMAP_HEIGHT - (bounds.maxY - bounds.minY + PADDING * 2) * scale) / 2;

    const minimapX = (canvasX - bounds.minX) * scale + offsetX + PADDING * scale;
    const minimapY = (canvasY - bounds.minY) * scale + offsetY + PADDING * scale;

    return { x: minimapX, y: minimapY };
  }, [getBounds, getScale]);

  // Handle click on minimap - jump to that position
  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const minimapX = e.clientX - rect.left;
    const minimapY = e.clientY - rect.top;

    const canvasPos = minimapToCanvas(minimapX, minimapY);

    // Center the view on clicked position
    onPanTo(canvasPos.x - viewBox.width / 2, canvasPos.y - viewBox.height / 2);
  }, [minimapToCanvas, onPanTo, viewBox.width, viewBox.height]);

  // Handle drag on viewport rectangle
  const handleViewportMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const minimapX = e.clientX - rect.left;
    const minimapY = e.clientY - rect.top;

    const canvasPos = minimapToCanvas(minimapX, minimapY);

    // Center the view on drag position
    onPanTo(canvasPos.x - viewBox.width / 2, canvasPos.y - viewBox.height / 2);
  }, [isDragging, minimapToCanvas, onPanTo, viewBox.width, viewBox.height]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Handle mouse leave - stop dragging
  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add global mouse up listener when dragging
  useEffect(() => {
    if (isDragging) {
      const handleGlobalMouseUp = () => setIsDragging(false);
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [isDragging]);

  // Get node center for edge rendering
  const getNodeCenter = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node || typeof node.x !== 'number' || typeof node.y !== 'number') return null;
    return {
      x: node.x + (node.width || 150) / 2,
      y: node.y + (node.height || 50) / 2,
    };
  }, [nodes]);

  const scale = getScale();
  const bounds = getBounds();

  // Calculate viewport rectangle in minimap coordinates
  const viewportMinimap = {
    x: canvasToMinimap(viewBox.x, viewBox.y).x,
    y: canvasToMinimap(viewBox.x, viewBox.y).y,
    width: viewBox.width * scale,
    height: viewBox.height * scale,
  };

  return (
    <div className="absolute bottom-28 left-3 w-[150px] h-[100px] bg-slate-800/90 border border-slate-600 rounded-lg overflow-hidden shadow-lg backdrop-blur-sm z-10">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: isDragging ? 'grabbing' : 'pointer' }}
      >
        {/* Background */}
        <rect width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT} fill="transparent" />

        {/* Edges */}
        {edges.map((edge, index) => {
          const fromCenter = getNodeCenter(edge.from);
          const toCenter = getNodeCenter(edge.to);
          if (!fromCenter || !toCenter) return null;

          const from = canvasToMinimap(fromCenter.x, fromCenter.y);
          const to = canvasToMinimap(toCenter.x, toCenter.y);

          return (
            <line
              key={`edge-${index}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#64748b"
              strokeWidth={0.5}
              pointerEvents="none"
            />
          );
        })}

        {/* Nodes */}
        {nodes.filter(n => typeof n.x === 'number' && typeof n.y === 'number').map(node => {
          const pos = canvasToMinimap(node.x, node.y);
          const nodeWidth = Math.max((node.width || 150) * scale, 4);
          const nodeHeight = Math.max((node.height || 50) * scale, 3);

          return (
            <rect
              key={node.id}
              x={pos.x}
              y={pos.y}
              width={nodeWidth}
              height={nodeHeight}
              rx={1}
              fill={node.color || '#3b82f6'}
              opacity={0.8}
              pointerEvents="none"
            />
          );
        })}

        {/* Viewport rectangle */}
        <rect
          x={viewportMinimap.x}
          y={viewportMinimap.y}
          width={viewportMinimap.width}
          height={viewportMinimap.height}
          fill="rgba(59, 130, 246, 0.1)"
          stroke="#3b82f6"
          strokeWidth={1.5}
          strokeDasharray="4 2"
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          onMouseDown={handleViewportMouseDown}
        />

        {/* Drag handle indicator in center of viewport */}
        {viewportMinimap.width > 20 && viewportMinimap.height > 15 && (
          <circle
            cx={viewportMinimap.x + viewportMinimap.width / 2}
            cy={viewportMinimap.y + viewportMinimap.height / 2}
            r={3}
            fill="#3b82f6"
            pointerEvents="none"
          />
        )}
      </svg>

      {/* Label */}
      <div className="absolute top-1 left-2 text-[10px] text-slate-500 font-medium pointer-events-none">
        Mini Map
      </div>
    </div>
  );
}
