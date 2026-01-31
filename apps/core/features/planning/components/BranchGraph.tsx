/**
 * BranchGraph - SVG visualization of git branch structure
 * Shows main/develop branches with merge relationships
 */

import { useMemo } from 'react';
import type { CommitsData } from '../api/github.api';

interface BranchGraphProps {
  data: CommitsData | null;
  loading?: boolean;
}

const COLORS = {
  main: '#10b981', // emerald
  develop: '#3b82f6', // blue
  merge: '#8b5cf6', // purple
  node: '#ffffff',
  text: '#64748b',
};

const LAYOUT = {
  width: 600,
  height: 300,
  padding: 40,
  nodeRadius: 6,
  lineHeight: 60,
  nodeSpacing: 50,
};

export default function BranchGraph({ data, loading }: BranchGraphProps) {
  const graphData = useMemo(() => {
    if (!data) return null;

    const mainCommits = data.main.slice(0, 10);
    const developCommits = data.develop.slice(0, 10);
    const mergeSet = new Set(data.mergePoints);

    // Calculate node positions
    const mainNodes = mainCommits.map((commit, i) => ({
      ...commit,
      x: LAYOUT.padding + i * LAYOUT.nodeSpacing,
      y: LAYOUT.padding + LAYOUT.lineHeight,
      branch: 'main' as const,
      isMerge: mergeSet.has(commit.sha),
    }));

    const developNodes = developCommits.map((commit, i) => ({
      ...commit,
      x: LAYOUT.padding + i * LAYOUT.nodeSpacing,
      y: LAYOUT.padding + LAYOUT.lineHeight * 2,
      branch: 'develop' as const,
      isMerge: mergeSet.has(commit.sha),
    }));

    // Find merge connections (develop commits that appear in main)
    const mergeLines: Array<{ from: typeof developNodes[0]; to: typeof mainNodes[0] }> = [];
    developNodes.forEach((devNode) => {
      if (devNode.isMerge) {
        const mainNode = mainNodes.find((m) => m.sha === devNode.sha);
        if (mainNode) {
          mergeLines.push({ from: devNode, to: mainNode });
        }
      }
    });

    const graphWidth = Math.max(
      LAYOUT.padding * 2 + Math.max(mainCommits.length, developCommits.length) * LAYOUT.nodeSpacing,
      LAYOUT.width
    );

    return { mainNodes, developNodes, mergeLines, graphWidth };
  }, [data]);

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-[200px] bg-slate-100 dark:bg-slate-700/50 rounded-lg" />
      </div>
    );
  }

  if (!graphData || !data) {
    return (
      <div className="h-[200px] flex items-center justify-center text-slate-400 dark:text-slate-500">
        <p>暂无分支数据</p>
      </div>
    );
  }

  const { mainNodes, developNodes, mergeLines, graphWidth } = graphData;

  return (
    <div className="overflow-x-auto">
      <svg
        width={graphWidth}
        height={LAYOUT.height}
        className="min-w-full"
        viewBox={`0 0 ${graphWidth} ${LAYOUT.height}`}
      >
        {/* Branch labels */}
        <text
          x={12}
          y={LAYOUT.padding + LAYOUT.lineHeight}
          fill={COLORS.main}
          fontSize={12}
          fontWeight={600}
          dominantBaseline="middle"
        >
          main
        </text>
        <text
          x={12}
          y={LAYOUT.padding + LAYOUT.lineHeight * 2}
          fill={COLORS.develop}
          fontSize={12}
          fontWeight={600}
          dominantBaseline="middle"
        >
          develop
        </text>

        {/* Main branch line */}
        {mainNodes.length > 1 && (
          <line
            x1={mainNodes[0].x}
            y1={mainNodes[0].y}
            x2={mainNodes[mainNodes.length - 1].x}
            y2={mainNodes[mainNodes.length - 1].y}
            stroke={COLORS.main}
            strokeWidth={3}
            strokeLinecap="round"
          />
        )}

        {/* Develop branch line */}
        {developNodes.length > 1 && (
          <line
            x1={developNodes[0].x}
            y1={developNodes[0].y}
            x2={developNodes[developNodes.length - 1].x}
            y2={developNodes[developNodes.length - 1].y}
            stroke={COLORS.develop}
            strokeWidth={3}
            strokeLinecap="round"
          />
        )}

        {/* Merge lines */}
        {mergeLines.map((line, i) => (
          <path
            key={i}
            d={`M ${line.from.x} ${line.from.y} Q ${line.from.x} ${(line.from.y + line.to.y) / 2} ${line.to.x} ${line.to.y}`}
            fill="none"
            stroke={COLORS.merge}
            strokeWidth={2}
            strokeDasharray="4 2"
            opacity={0.6}
          />
        ))}

        {/* Main branch nodes */}
        {mainNodes.map((node, i) => (
          <g key={`main-${i}`} className="cursor-pointer">
            <title>{`${node.sha}: ${node.message}`}</title>
            <circle
              cx={node.x}
              cy={node.y}
              r={LAYOUT.nodeRadius}
              fill={node.isMerge ? COLORS.merge : COLORS.main}
              stroke={COLORS.node}
              strokeWidth={2}
            />
            {/* Show SHA for first and merge commits */}
            {(i === 0 || node.isMerge) && (
              <text
                x={node.x}
                y={node.y - 14}
                fill={COLORS.text}
                fontSize={9}
                textAnchor="middle"
                className="font-mono"
              >
                {node.sha}
              </text>
            )}
          </g>
        ))}

        {/* Develop branch nodes */}
        {developNodes.map((node, i) => (
          <g key={`develop-${i}`} className="cursor-pointer">
            <title>{`${node.sha}: ${node.message}`}</title>
            <circle
              cx={node.x}
              cy={node.y}
              r={LAYOUT.nodeRadius}
              fill={node.isMerge ? COLORS.merge : COLORS.develop}
              stroke={COLORS.node}
              strokeWidth={2}
            />
            {/* Show SHA for first commit */}
            {i === 0 && (
              <text
                x={node.x}
                y={node.y + 18}
                fill={COLORS.text}
                fontSize={9}
                textAnchor="middle"
                className="font-mono"
              >
                {node.sha}
              </text>
            )}
          </g>
        ))}

        {/* Legend */}
        <g transform={`translate(${graphWidth - 150}, 20)`}>
          <circle cx={0} cy={0} r={4} fill={COLORS.main} />
          <text x={10} y={4} fontSize={10} fill={COLORS.text}>main</text>

          <circle cx={0} cy={16} r={4} fill={COLORS.develop} />
          <text x={10} y={20} fontSize={10} fill={COLORS.text}>develop</text>

          <circle cx={0} cy={32} r={4} fill={COLORS.merge} />
          <text x={10} y={36} fontSize={10} fill={COLORS.text}>merge</text>
        </g>
      </svg>
    </div>
  );
}
