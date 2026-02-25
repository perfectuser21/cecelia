/**
 * Whiteboard Layout Utilities
 * 提供多种自动布局算法
 */

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutOptions {
  startX?: number;
  startY?: number;
  nodeSpacingH?: number; // 水平间距
  nodeSpacingV?: number; // 垂直间距
  iterations?: number;   // 力导向迭代次数
}

const DEFAULT_OPTIONS: Required<LayoutOptions> = {
  startX: 100,
  startY: 100,
  nodeSpacingH: 200,
  nodeSpacingV: 150,
  iterations: 100,
};

/**
 * 树形布局 (Tree Layout)
 * 从左到右的层级布局，适合有明确层级关系的图
 */
export function treeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options?: LayoutOptions
): LayoutNode[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (nodes.length === 0) return [];

  // 构建邻接表
  const children = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  nodes.forEach(node => {
    children.set(node.id, []);
    inDegree.set(node.id, 0);
  });

  edges.forEach(edge => {
    const childList = children.get(edge.from);
    if (childList) {
      childList.push(edge.to);
    }
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  });

  // 找到根节点（没有入边的节点）
  const roots = nodes.filter(node => inDegree.get(node.id) === 0);

  // 如果没有根节点，使用第一个节点作为根
  if (roots.length === 0 && nodes.length > 0) {
    roots.push(nodes[0]);
  }

  // BFS 确定每个节点的层级
  const levels = new Map<string, number>();
  const visited = new Set<string>();
  const queue: { id: string; level: number }[] = [];

  roots.forEach(root => {
    queue.push({ id: root.id, level: 0 });
    visited.add(root.id);
    levels.set(root.id, 0);
  });

  while (queue.length > 0) {
    const { id, level } = queue.shift()!;
    const nodeChildren = children.get(id) || [];

    nodeChildren.forEach(childId => {
      if (!visited.has(childId)) {
        visited.add(childId);
        levels.set(childId, level + 1);
        queue.push({ id: childId, level: level + 1 });
      }
    });
  }

  // 处理未访问的节点（孤立节点或环中的节点）
  nodes.forEach(node => {
    if (!visited.has(node.id)) {
      const maxLevel = Math.max(...Array.from(levels.values()), -1);
      levels.set(node.id, maxLevel + 1);
    }
  });

  // 按层级分组
  const levelGroups = new Map<number, LayoutNode[]>();
  nodes.forEach(node => {
    const level = levels.get(node.id) || 0;
    if (!levelGroups.has(level)) {
      levelGroups.set(level, []);
    }
    levelGroups.get(level)!.push(node);
  });

  // 计算每层最大高度用于垂直居中
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // 布局每层节点
  const result: LayoutNode[] = [];

  levelGroups.forEach((levelNodes, level) => {
    const totalHeight = levelNodes.reduce((sum, node) => {
      const n = nodeMap.get(node.id)!;
      return sum + n.height;
    }, 0) + (levelNodes.length - 1) * opts.nodeSpacingV;

    let currentY = opts.startY - totalHeight / 2;

    levelNodes.forEach(node => {
      const n = nodeMap.get(node.id)!;
      result.push({
        ...n,
        x: opts.startX + level * opts.nodeSpacingH,
        y: currentY + totalHeight / 2,
      });
      currentY += n.height + opts.nodeSpacingV;
    });
  });

  // 重新计算Y坐标使每层居中
  const finalResult: LayoutNode[] = [];
  levelGroups.forEach((levelNodes, level) => {
    const count = levelNodes.length;
    levelNodes.forEach((node, index) => {
      const n = nodeMap.get(node.id)!;
      const offsetY = (index - (count - 1) / 2) * opts.nodeSpacingV;
      finalResult.push({
        ...n,
        x: opts.startX + level * opts.nodeSpacingH,
        y: opts.startY + offsetY,
      });
    });
  });

  return finalResult;
}

/**
 * 力导向布局 (Force-Directed Layout)
 * 节点相互排斥，连线相互吸引，自动分散开
 */
export function forceDirectedLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options?: LayoutOptions
): LayoutNode[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    return [{ ...nodes[0], x: opts.startX, y: opts.startY }];
  }

  // 初始化位置（使用当前位置或随机分布）
  const positions = new Map<string, { x: number; y: number }>();
  const velocities = new Map<string, { vx: number; vy: number }>();

  nodes.forEach((node, index) => {
    // 如果节点已有位置，使用当前位置；否则随机分布
    const hasPosition = node.x !== 0 || node.y !== 0;
    positions.set(node.id, {
      x: hasPosition ? node.x : opts.startX + Math.random() * 300 - 150,
      y: hasPosition ? node.y : opts.startY + Math.random() * 300 - 150,
    });
    velocities.set(node.id, { vx: 0, vy: 0 });
  });

  // 构建边的索引
  const edgeSet = new Set(edges.map(e => `${e.from}-${e.to}`));
  const isConnected = (a: string, b: string) =>
    edgeSet.has(`${a}-${b}`) || edgeSet.has(`${b}-${a}`);

  // 力导向参数
  const repulsionStrength = 5000;
  const attractionStrength = 0.01;
  const damping = 0.9;
  const minDistance = 50;

  // 迭代计算
  for (let iter = 0; iter < opts.iterations; iter++) {
    const forces = new Map<string, { fx: number; fy: number }>();
    nodes.forEach(node => forces.set(node.id, { fx: 0, fy: 0 }));

    // 计算节点间排斥力
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];
        const posA = positions.get(nodeA.id)!;
        const posB = positions.get(nodeB.id)!;

        const dx = posB.x - posA.x;
        const dy = posB.y - posA.y;
        const distance = Math.max(Math.sqrt(dx * dx + dy * dy), minDistance);

        // 排斥力与距离平方成反比
        const force = repulsionStrength / (distance * distance);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;

        const forceA = forces.get(nodeA.id)!;
        const forceB = forces.get(nodeB.id)!;

        forceA.fx -= fx;
        forceA.fy -= fy;
        forceB.fx += fx;
        forceB.fy += fy;
      }
    }

    // 计算连线吸引力
    edges.forEach(edge => {
      const posFrom = positions.get(edge.from);
      const posTo = positions.get(edge.to);

      if (!posFrom || !posTo) return;

      const dx = posTo.x - posFrom.x;
      const dy = posTo.y - posFrom.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < minDistance) return;

      // 吸引力与距离成正比
      const force = distance * attractionStrength;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;

      const forceFrom = forces.get(edge.from);
      const forceTo = forces.get(edge.to);

      if (forceFrom) {
        forceFrom.fx += fx;
        forceFrom.fy += fy;
      }
      if (forceTo) {
        forceTo.fx -= fx;
        forceTo.fy -= fy;
      }
    });

    // 应用力并更新位置
    nodes.forEach(node => {
      const pos = positions.get(node.id)!;
      const vel = velocities.get(node.id)!;
      const force = forces.get(node.id)!;

      // 更新速度
      vel.vx = (vel.vx + force.fx) * damping;
      vel.vy = (vel.vy + force.fy) * damping;

      // 限制最大速度
      const maxVelocity = 50;
      const speed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy);
      if (speed > maxVelocity) {
        vel.vx = (vel.vx / speed) * maxVelocity;
        vel.vy = (vel.vy / speed) * maxVelocity;
      }

      // 更新位置
      pos.x += vel.vx;
      pos.y += vel.vy;
    });
  }

  // 返回结果，将位置归一化到起始点附近
  const allPositions = Array.from(positions.values());
  const centerX = allPositions.reduce((sum, p) => sum + p.x, 0) / allPositions.length;
  const centerY = allPositions.reduce((sum, p) => sum + p.y, 0) / allPositions.length;

  const offsetX = opts.startX - centerX;
  const offsetY = opts.startY - centerY;

  return nodes.map(node => {
    const pos = positions.get(node.id)!;
    return {
      ...node,
      x: Math.round(pos.x + offsetX),
      y: Math.round(pos.y + offsetY),
    };
  });
}

/**
 * 网格布局 (Grid Layout)
 * 将节点均匀排列成网格
 */
export function gridLayout(
  nodes: LayoutNode[],
  options?: LayoutOptions
): LayoutNode[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (nodes.length === 0) return [];

  // 计算网格列数
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const rows = Math.ceil(nodes.length / cols);

  // 计算每个单元格的最大尺寸
  const maxWidth = Math.max(...nodes.map(n => n.width));
  const maxHeight = Math.max(...nodes.map(n => n.height));

  const cellWidth = maxWidth + opts.nodeSpacingH;
  const cellHeight = maxHeight + opts.nodeSpacingV;

  return nodes.map((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);

    return {
      ...node,
      x: opts.startX + col * cellWidth,
      y: opts.startY + row * cellHeight,
    };
  });
}

/**
 * 圆形布局 (Circular Layout)
 * 将节点排列成圆形
 */
export function circularLayout(
  nodes: LayoutNode[],
  options?: LayoutOptions
): LayoutNode[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    return [{ ...nodes[0], x: opts.startX, y: opts.startY }];
  }

  // 计算半径，确保节点不重叠
  const maxNodeSize = Math.max(
    ...nodes.map(n => Math.max(n.width, n.height))
  );

  // 最小半径基于节点数量和节点大小
  const minRadius = (nodes.length * (maxNodeSize + opts.nodeSpacingH)) / (2 * Math.PI);
  const radius = Math.max(minRadius, 200);

  const angleStep = (2 * Math.PI) / nodes.length;

  return nodes.map((node, index) => {
    // 从顶部开始，顺时针排列
    const angle = -Math.PI / 2 + index * angleStep;

    return {
      ...node,
      x: Math.round(opts.startX + radius * Math.cos(angle)),
      y: Math.round(opts.startY + radius * Math.sin(angle)),
    };
  });
}

/**
 * 辅助函数：将布局结果应用到节点
 */
export function applyLayout<T extends LayoutNode>(
  originalNodes: T[],
  layoutResult: LayoutNode[]
): T[] {
  const positionMap = new Map(
    layoutResult.map(n => [n.id, { x: n.x, y: n.y }])
  );

  return originalNodes.map(node => {
    const pos = positionMap.get(node.id);
    if (pos) {
      return { ...node, x: pos.x, y: pos.y };
    }
    return node;
  });
}

/**
 * 辅助函数：计算布局的边界框
 */
export function getLayoutBounds(nodes: LayoutNode[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  const minX = Math.min(...nodes.map(n => n.x));
  const minY = Math.min(...nodes.map(n => n.y));
  const maxX = Math.max(...nodes.map(n => n.x + n.width));
  const maxY = Math.max(...nodes.map(n => n.y + n.height));

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * 辅助函数：居中布局
 */
export function centerLayout(
  nodes: LayoutNode[],
  centerX: number,
  centerY: number
): LayoutNode[] {
  const bounds = getLayoutBounds(nodes);
  const currentCenterX = bounds.minX + bounds.width / 2;
  const currentCenterY = bounds.minY + bounds.height / 2;

  const offsetX = centerX - currentCenterX;
  const offsetY = centerY - currentCenterY;

  return nodes.map(node => ({
    ...node,
    x: node.x + offsetX,
    y: node.y + offsetY,
  }));
}
