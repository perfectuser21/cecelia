import { createHash } from 'node:crypto';

import { digestMapManifest, validateMapManifest } from './map-manifest-schema.js';

export const MAP_PROJECTOR_VERSION = 'map-projector-v1';

export class MapProjectionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MapProjectionError';
    this.code = code;
    this.details = details;
  }
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stableId(scopeKey, kind, type, key) {
  return sha256(canonicalJson([scopeKey, kind, type, key]));
}

export function stableMapNodeId(scopeKey, nodeType, nodeKey) {
  return stableId(scopeKey, 'node', nodeType, nodeKey);
}

export function stableMapEdgeId(scopeKey, edgeType, edgeKey) {
  return stableId(scopeKey, 'edge', edgeType, edgeKey);
}

function manifestRef(collection, key) {
  return [{ source: 'manifest', path: `${collection}.${key}` }];
}

function aliasesOf(item) {
  return Array.isArray(item.aliases) ? [...item.aliases] : [];
}

function normalizeFacts(factRevisions) {
  if (!factRevisions || typeof factRevisions !== 'object' || Array.isArray(factRevisions)) {
    throw new MapProjectionError(
      'MAP_PROJECTION_FACT_REVISIONS_INVALID',
      'factRevisions must be an object',
    );
  }
  return sortJson(factRevisions);
}

function requireManifest(input, manifestDigest) {
  const validation = validateMapManifest(input);
  if (!validation.valid) {
    throw new MapProjectionError(
      'MAP_PROJECTION_MANIFEST_INVALID',
      'Map projection requires a valid manifest',
      validation.errors,
    );
  }
  const actualDigest = digestMapManifest(validation.manifest);
  if (manifestDigest !== actualDigest) {
    throw new MapProjectionError(
      'MAP_PROJECTION_MANIFEST_DIGEST_MISMATCH',
      'Manifest digest does not match the canonical manifest',
      { expected: actualDigest, received: manifestDigest },
    );
  }
  return validation.manifest;
}

function createNode(scopeKey, nodeType, item, collection, attributes) {
  return {
    node_id: stableMapNodeId(scopeKey, nodeType, item.key),
    node_type: nodeType,
    node_key: item.key,
    name: item.name,
    source_refs: manifestRef(collection, item.key),
    attributes: sortJson(attributes),
  };
}

function createEdge(
  scopeKey,
  edgeType,
  edgeKey,
  fromNodeId,
  toNodeId,
  sourceRefs,
  attributes = {},
) {
  return {
    edge_id: stableMapEdgeId(scopeKey, edgeType, edgeKey),
    edge_type: edgeType,
    edge_key: edgeKey,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    source_refs: sourceRefs,
    attributes: sortJson(attributes),
  };
}

function addStructuralNodes(manifest, nodes) {
  const scopeKey = manifest.scope_key;
  for (const stream of manifest.value_streams) {
    nodes.push(createNode(scopeKey, 'value_stream', stream, 'value_streams', {
      aliases: aliasesOf(stream),
      order: stream.order,
      perceiver: stream.perceiver,
    }));
  }
  for (const capability of manifest.capabilities) {
    nodes.push(createNode(scopeKey, 'capability', capability, 'capabilities', {
      aliases: aliasesOf(capability),
      order: capability.order,
      path_prefixes: capability.path_prefixes ?? [],
      exact_paths: capability.exact_paths ?? [],
    }));
  }
  for (const crosscut of manifest.crosscut_pool) {
    nodes.push(createNode(scopeKey, 'crosscut', crosscut, 'crosscut_pool', {
      aliases: aliasesOf(crosscut),
    }));
  }
  if (manifest.shared_prerequisites.applicable) {
    for (const prerequisite of manifest.shared_prerequisites.items) {
      nodes.push(createNode(
        scopeKey,
        'prerequisite',
        prerequisite,
        'shared_prerequisites.items',
        { aliases: aliasesOf(prerequisite) },
      ));
    }
  }
}

function nodeLookup(nodes) {
  return new Map(nodes.map((node) => [node.node_key, node.node_id]));
}

function addContainsEdges(manifest, ids, edges) {
  for (const capability of manifest.capabilities) {
    const edgeKey = `${capability.value_stream_key}:${capability.key}`;
    edges.push(createEdge(
      manifest.scope_key,
      'contains',
      edgeKey,
      ids.get(capability.value_stream_key),
      ids.get(capability.key),
      manifestRef('capabilities', capability.key),
    ));
  }
}

function addBoundaryEdges(manifest, ids, edges) {
  for (const boundary of manifest.boundaries) {
    edges.push(createEdge(
      manifest.scope_key,
      'hands_off_to',
      boundary.key,
      ids.get(boundary.from),
      ids.get(boundary.to),
      manifestRef('boundaries', boundary.key),
      { statement: boundary.statement },
    ));
  }
}

function addCrosscutEdges(manifest, ids, edges) {
  for (const crosscut of manifest.crosscut_pool) {
    for (const target of crosscut.serves) {
      const edgeKey = `${crosscut.key}:${target}`;
      edges.push(createEdge(
        manifest.scope_key,
        'serves',
        edgeKey,
        ids.get(crosscut.key),
        ids.get(target),
        manifestRef('crosscut_pool', crosscut.key),
      ));
    }
    if (crosscut.owner) {
      const edgeKey = `${crosscut.key}:${crosscut.owner}`;
      edges.push(createEdge(
        manifest.scope_key,
        'owned_by',
        edgeKey,
        ids.get(crosscut.key),
        ids.get(crosscut.owner),
        manifestRef('crosscut_pool', crosscut.key),
      ));
    }
  }
}

function addPrerequisiteEdges(manifest, ids, edges) {
  if (!manifest.shared_prerequisites.applicable) return;
  for (const prerequisite of manifest.shared_prerequisites.items) {
    for (const target of prerequisite.serves) {
      const edgeKey = `${target}:${prerequisite.key}`;
      edges.push(createEdge(
        manifest.scope_key,
        'requires',
        edgeKey,
        ids.get(target),
        ids.get(prerequisite.key),
        manifestRef('shared_prerequisites.items', prerequisite.key),
      ));
    }
  }
}

function mergeAnchorProjection(scopeKey, nodes, edges, anchorProjection) {
  if (!anchorProjection) return;
  if (!Array.isArray(anchorProjection.nodes) || !Array.isArray(anchorProjection.edges)) {
    throw new MapProjectionError(
      'MAP_PROJECTION_ANCHORS_INVALID',
      'anchorProjection must contain nodes and edges arrays',
    );
  }
  const nodeIds = new Set(nodes.map(({ node_id: nodeId }) => nodeId));
  for (const node of anchorProjection.nodes) {
    const expectedId = stableMapNodeId(scopeKey, node.node_type, node.node_key);
    if (node.node_id !== expectedId || nodeIds.has(node.node_id)) {
      throw new MapProjectionError(
        'MAP_PROJECTION_ANCHOR_NODE_INVALID',
        `Anchor node identity is invalid or duplicated: ${node.node_key}`,
      );
    }
    nodes.push(sortJson(node));
    nodeIds.add(node.node_id);
  }
  const edgeIds = new Set(edges.map(({ edge_id: edgeId }) => edgeId));
  for (const edge of anchorProjection.edges) {
    const expectedId = stableMapEdgeId(scopeKey, edge.edge_type, edge.edge_key);
    if (edge.edge_id !== expectedId || edgeIds.has(edge.edge_id)
      || !nodeIds.has(edge.from_node_id) || !nodeIds.has(edge.to_node_id)) {
      throw new MapProjectionError(
        'MAP_PROJECTION_ANCHOR_EDGE_INVALID',
        `Anchor edge identity or endpoint is invalid: ${edge.edge_key}`,
      );
    }
    edges.push(sortJson(edge));
    edgeIds.add(edge.edge_id);
  }
}

export function buildMapProjection({
  manifest: input,
  manifestDigest,
  factRevisions = {},
  anchorProjection = undefined,
}) {
  const manifest = requireManifest(input, manifestDigest);
  const normalizedFacts = normalizeFacts(factRevisions);
  const nodes = [];
  const edges = [];

  addStructuralNodes(manifest, nodes);
  const ids = nodeLookup(nodes);
  addContainsEdges(manifest, ids, edges);
  addBoundaryEdges(manifest, ids, edges);
  addCrosscutEdges(manifest, ids, edges);
  addPrerequisiteEdges(manifest, ids, edges);
  mergeAnchorProjection(manifest.scope_key, nodes, edges, anchorProjection);

  nodes.sort((left, right) => left.node_id.localeCompare(right.node_id));
  edges.sort((left, right) => left.edge_id.localeCompare(right.edge_id));
  const canonicalProjection = {
    scope_key: manifest.scope_key,
    manifest_digest: manifestDigest,
    fact_revisions: normalizedFacts,
    projector_version: MAP_PROJECTOR_VERSION,
    nodes,
    edges,
  };

  return {
    ...canonicalProjection,
    projection_digest: sha256(canonicalJson(canonicalProjection)),
  };
}
