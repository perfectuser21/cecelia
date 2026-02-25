import React, { useMemo, useCallback, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  ConnectionMode,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { PRPlan } from '../api/pr-plans.api.ts';
import { isPRPlanBlocked } from '../api/pr-plans.api.ts';

interface Props {
  prPlans: PRPlan[];
  onNodeClick?: (prPlanId: string) => void;
}

export default function PRPlanDependencyGraph({ prPlans, onNodeClick }: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Convert PR Plans to React Flow nodes
  const initialNodes: Node[] = useMemo(() => {
    if (!prPlans || prPlans.length === 0) return [];

    // Layout: horizontal flow, group by sequence
    const nodeSpacing = 250;
    const sequenceSpacing = 200;

    return prPlans.map((prPlan, index) => {
      const isBlocked = isPRPlanBlocked(prPlan, prPlans);
      const isSelected = selectedNodeId === prPlan.id;

      // Node position based on sequence
      const x = prPlan.sequence * sequenceSpacing;
      const y = index * nodeSpacing / prPlans.length;

      // Node style based on status
      let borderColor = '#94a3b8'; // slate-400 - Planning
      let bgColor = '#f8fafc'; // slate-50
      let darkBgColor = '#1e293b'; // slate-800

      if (isBlocked) {
        borderColor = '#f59e0b'; // amber-500 - Blocked
        bgColor = '#fffbeb'; // amber-50
        darkBgColor = '#78350f'; // amber-900
      } else if (prPlan.status === 'completed') {
        borderColor = '#10b981'; // emerald-500
        bgColor = '#ecfdf5'; // emerald-50
        darkBgColor = '#064e3b'; // emerald-900
      } else if (prPlan.status === 'in_progress') {
        borderColor = '#3b82f6'; // blue-500
        bgColor = '#eff6ff'; // blue-50
        darkBgColor = '#1e3a8a'; // blue-900
      }

      const borderStyle = isBlocked ? 'dashed' : 'solid';
      const borderWidth = isSelected ? '3px' : '2px';

      return {
        id: prPlan.id,
        type: 'default',
        data: {
          label: (
            <div className="text-center p-2">
              <div className="font-semibold text-sm mb-1 dark:text-white">
                #{prPlan.sequence} {prPlan.title}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400">
                {prPlan.complexity}
              </div>
              {prPlan.tasks_count !== undefined && (
                <div className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                  {prPlan.tasks_completed || 0}/{prPlan.tasks_count} tasks
                </div>
              )}
            </div>
          ),
        },
        position: { x, y },
        style: {
          border: `${borderWidth} ${borderStyle} ${borderColor}`,
          borderRadius: '8px',
          padding: '4px',
          background: `light-dark(${bgColor}, ${darkBgColor})`,
          width: 180,
          boxShadow: isSelected ? '0 4px 12px rgba(0,0,0,0.2)' : '0 1px 3px rgba(0,0,0,0.1)',
          transition: 'all 0.3s ease',
          animation: prPlan.status === 'in_progress' ? 'pulse 2s infinite' : 'none',
        },
      };
    });
  }, [prPlans, selectedNodeId]);

  // Convert dependencies to React Flow edges
  const initialEdges: Edge[] = useMemo(() => {
    if (!prPlans || prPlans.length === 0) return [];

    const edges: Edge[] = [];

    prPlans.forEach((prPlan) => {
      if (prPlan.depends_on && prPlan.depends_on.length > 0) {
        prPlan.depends_on.forEach((depId) => {
          edges.push({
            id: `${depId}-${prPlan.id}`,
            source: depId,
            target: prPlan.id,
            type: 'smoothstep',
            animated: prPlan.status === 'in_progress',
            style: {
              stroke: selectedNodeId && (selectedNodeId === depId || selectedNodeId === prPlan.id)
                ? '#3b82f6' // blue-500
                : '#94a3b8', // slate-400
              strokeWidth: selectedNodeId && (selectedNodeId === depId || selectedNodeId === prPlan.id) ? 3 : 2,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: selectedNodeId && (selectedNodeId === depId || selectedNodeId === prPlan.id)
                ? '#3b82f6'
                : '#94a3b8',
            },
          });
        });
      }
    });

    return edges;
  }, [prPlans, selectedNodeId]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  // Handle node click - highlight node and dependency chain
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedNodeId(node.id === selectedNodeId ? null : node.id);
      onNodeClick?.(node.id);
    },
    [selectedNodeId, onNodeClick]
  );

  if (!prPlans || prPlans.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">
        No PR Plans to visualize
      </div>
    );
  }

  return (
    <div className="w-full h-[500px] border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        connectionMode={ConnectionMode.Strict}
        fitView
        attributionPosition="bottom-left"
      >
        <Background color="#94a3b8" gap={16} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const prPlan = prPlans.find(p => p.id === node.id);
            if (!prPlan) return '#94a3b8';

            if (isPRPlanBlocked(prPlan, prPlans)) return '#f59e0b'; // amber
            if (prPlan.status === 'completed') return '#10b981'; // emerald
            if (prPlan.status === 'in_progress') return '#3b82f6'; // blue
            return '#94a3b8'; // slate
          }}
          maskColor="rgb(15, 23, 42, 0.6)"
        />
      </ReactFlow>

      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-white dark:bg-slate-800 p-3 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 text-xs">
        <div className="font-semibold mb-2 dark:text-white">Status</div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-4 h-4 border-2 border-emerald-500 rounded"></div>
          <span className="dark:text-slate-300">Completed</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-4 h-4 border-2 border-blue-500 rounded"></div>
          <span className="dark:text-slate-300">In Progress</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-4 h-4 border-2 border-slate-400 rounded"></div>
          <span className="dark:text-slate-300">Planning</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-amber-500 border-dashed rounded"></div>
          <span className="dark:text-slate-300">Blocked</span>
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }
      `}</style>
    </div>
  );
}
