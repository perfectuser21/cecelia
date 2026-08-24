// 纯函数 view-model：把 live map 的 nodes/edges 折算成 mind-elixir 三层脑图结构。
//
// 三层可视节点：价值流（value_stream）→ 能力（capability）→ 特性（feature）。
// - 根 = 全部 value_stream 节点。
// - 能力 = 价值流经 `contains` 边直接包含的 capability 节点（不含 hands_off_to 等其他边）。
// - 特性 = 能力经 `contains` 边可达的 feature 节点，中间的 backbone 层被折叠（穿透继续沿
//   contains 前进），assertion / artifact / proves / anchored_by 等既不跟随也不暴露。
//
// 该函数只依赖 key/type/name/from/to/type 字段，与页面消费的 MapResponse 兼容，也与冻结
// 测试 sprints/08241956-kernel-9daed395/tests/map-mindmap.test.ts 的 fixture 同构。

export interface MapNodeInput {
  key: string;
  type: string;
  name: string;
}

export interface MapEdgeInput {
  from: string;
  to: string;
  type: string;
}

export type MindmapNodeType = 'value_stream' | 'capability' | 'feature';

export interface MindmapNode {
  key: string;
  type: MindmapNodeType;
  name: string;
  children: MindmapNode[];
}

export function buildMindmapTree(
  nodes: readonly MapNodeInput[],
  edges: readonly MapEdgeInput[],
): MindmapNode[] {
  const nodeByKey = new Map<string, MapNodeInput>();
  for (const node of nodes) nodeByKey.set(node.key, node);

  const containsTargets = (fromKey: string): string[] => edges
    .filter((edge) => edge.type === 'contains' && edge.from === fromKey)
    .map((edge) => edge.to);

  // 从能力出发沿 contains 边收集特性，穿透（折叠）backbone 中间层。
  const featuresUnder = (capabilityKey: string): MindmapNode[] => {
    const features: MindmapNode[] = [];
    const seen = new Set<string>();
    const queue = [...containsTargets(capabilityKey)];
    while (queue.length > 0) {
      const key = queue.shift() as string;
      if (seen.has(key)) continue;
      seen.add(key);
      const node = nodeByKey.get(key);
      if (!node) continue;
      if (node.type === 'feature') {
        features.push({ key: node.key, type: 'feature', name: node.name, children: [] });
      } else if (node.type === 'backbone') {
        // 折叠：backbone 不作为可视节点，继续沿它的 contains 边下探。
        queue.push(...containsTargets(key));
      }
      // 其余类型（assertion/artifact 等）既不暴露也不跟随。
    }
    return features;
  };

  const capabilitiesUnder = (streamKey: string): MindmapNode[] => containsTargets(streamKey)
    .map((key) => nodeByKey.get(key))
    .filter((node): node is MapNodeInput => Boolean(node) && node!.type === 'capability')
    .map((node) => ({
      key: node.key,
      type: 'capability' as const,
      name: node.name,
      children: featuresUnder(node.key),
    }));

  return nodes
    .filter((node) => node.type === 'value_stream')
    .map((node) => ({
      key: node.key,
      type: 'value_stream' as const,
      name: node.name,
      children: capabilitiesUnder(node.key),
    }));
}

// mind-elixir 需要 `{ nodeData: { id, topic, children } }` 形状。把三层脑图挂到 scope 根下。
// 仅在真实浏览器（evaluator mac_web E2E）挂载时用到，jsdom/happy-dom 下被 MapPage 的
// feature-detect guard 跳过。
export interface MindElixirNodeData {
  id: string;
  topic: string;
  children?: MindElixirNodeData[];
}

export function toMindElixirData(scopeKey: string, tree: readonly MindmapNode[]): { nodeData: MindElixirNodeData } {
  const toNode = (node: MindmapNode): MindElixirNodeData => ({
    id: node.key,
    topic: node.name,
    children: node.children.map(toNode),
  });
  return {
    nodeData: {
      id: scopeKey || 'root',
      topic: scopeKey || 'map',
      children: tree.map(toNode),
    },
  };
}
