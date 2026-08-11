import pool from '../db.js';
import { getManifestById } from './manifest-store.js';
import { getProjectionForRevision } from './projector.js';
import { getFactHealthSummary } from './state-resolver.js';
import {
  buildAdjacency,
  classifyFeatureAnchors,
  normalizePath,
  reachable,
} from '../lib/graph-query.js';
import { classifyJourneyCellAssertion } from '../lib/journey-cell-assertion.js';
import { assertionDigest } from '../lib/journey-assertion-receipt.js';
import { canonicalAssertionCommandText } from '../lib/gp-assertion-command.js';

const GIT_SHA = /^[0-9a-f]{40}$/i;
const MAX_CHANGED_FILES = 1000;
const MAX_PATH_LENGTH = 1024;
const MAX_TOTAL_PATH_BYTES = 128 * 1024;
const MAX_CAPABILITY_IDS = 256;

export class MapRadiusError extends Error {
  constructor(code, message, httpStatus = 500) {
    super(message);
    this.name = 'MapRadiusError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function normalizeRepoIdentity(value) {
  const raw = String(value ?? '').trim().replace(/\.git$/i, '');
  if (!raw) return null;
  if (raw.includes('://')) {
    try {
      const url = new URL(raw);
      const path = url.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
      return url.hostname.toLowerCase() === 'github.com'
        ? path
        : `${url.hostname.toLowerCase()}/${path}`;
    } catch { return null; }
  }
  const githubPath = raw.match(/^github\.com[/:](.+)$/i)?.[1];
  const normalized = (githubPath ?? raw).replace(/^\/+|\/+$/g, '').toLowerCase();
  return /^[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)?$/.test(normalized) ? normalized : null;
}

export function scopeForRepo(repo, bindings = process.env.CECELIA_MAP_REPO_SCOPES) {
  const canonicalRepo = normalizeRepoIdentity(repo);
  if (!canonicalRepo || typeof bindings !== 'string') return null;
  for (const item of bindings.split(',')) {
    const separator = item.lastIndexOf('=');
    if (separator <= 0) continue;
    const boundRepo = normalizeRepoIdentity(item.slice(0, separator));
    const scope = item.slice(separator + 1).trim();
    if (boundRepo === canonicalRepo && /^[a-z0-9_-]+$/.test(scope)) return scope;
  }
  return null;
}

function normalizeAnchor(value) {
  return normalizePath(String(value ?? '')
    .replace(/^(?:script|test):/, '')
    .split('#')[0]);
}

function projectionRevision(projection, repo, scopeKey) {
  const revisions = projection?.fact_revisions;
  if (!revisions || typeof revisions !== 'object' || Array.isArray(revisions)) return null;
  return revisions[repo] ?? revisions[scopeKey] ?? null;
}

function baseFreshness({ factHealth, actualRevision, expectedRevision }) {
  if (factHealth?.overall !== 'fresh') {
    return { status: 'stale', reason_code: 'fact_snapshot_stale' };
  }
  if (!actualRevision) {
    return { status: 'stale', reason_code: 'projection_revision_missing' };
  }
  if (actualRevision !== expectedRevision) {
    return { status: 'stale', reason_code: 'projection_revision_mismatch' };
  }
  return { status: 'fresh', reason_code: null };
}

function pathOwnedCapabilities(file, projectionCapabilities) {
  const candidates = [];
  for (const node of projectionCapabilities) {
    const attributes = node.attributes && typeof node.attributes === 'object'
      ? node.attributes : {};
    const exactPaths = Array.isArray(attributes.exact_paths) ? attributes.exact_paths : [];
    const prefixes = Array.isArray(attributes.path_prefixes) ? attributes.path_prefixes : [];
    if (exactPaths.includes(file)) candidates.push({ node, score: MAX_PATH_LENGTH + 1 });
    for (const prefix of prefixes) {
      if (typeof prefix === 'string' && prefix && file.startsWith(prefix)) {
        candidates.push({ node, score: prefix.length });
      }
    }
  }
  const best = Math.max(0, ...candidates.map(item => item.score));
  return candidates.filter(item => item.score === best).map(item => item.node);
}

function requiredAssertions(rows, capabilityIds) {
  const byAssertionId = new Map();
  let ambiguous = false;
  let unsafe = false;
  for (const row of rows) {
    if (!capabilityIds.has(row.capability_code)) continue;
    const assertionId = String(row.assertion_ref ?? '').trim();
    const classification = classifyJourneyCellAssertion({ assertion_ref: assertionId });
    if (!classification.runnable) continue;
    let command;
    try {
      command = canonicalAssertionCommandText(assertionId);
    } catch {
      unsafe = true;
      continue;
    }
    let assertion = byAssertionId.get(assertionId);
    if (!assertion) {
      assertion = {
        assertion_id: assertionId,
        command,
        covers_capability_ids: new Set(),
        source_bindings: new Map(),
        owner: row.capability_code,
      };
      byAssertionId.set(assertionId, assertion);
    }
    assertion.covers_capability_ids.add(row.capability_code);
    const binding = {
      journey_step_link_id: row.id,
      assertion_revision: Number(row.assertion_revision),
      assertion_digest: assertionDigest(assertionId),
    };
    const prior = assertion.source_bindings.get(row.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(binding)) ambiguous = true;
    assertion.source_bindings.set(row.id, binding);
  }
  const assertions = [...byAssertionId.values()].map((item) => {
    const sourceBindings = [...item.source_bindings.values()].sort(
      (a, b) => a.journey_step_link_id.localeCompare(b.journey_step_link_id),
    );
    const primary = sourceBindings[0];
    return {
      assertion_id: item.assertion_id,
      command: item.command,
      covers_capability_ids: [...item.covers_capability_ids].sort(),
      ...primary,
      source_bindings: sourceBindings,
      owner: item.owner,
    };
  });
  assertions.sort((a, b) => a.assertion_id.localeCompare(b.assertion_id));
  return { assertions, ambiguous, unsafe };
}

/**
 * Build the revision-locked Impact Gate projection for changed files.
 * A changed file without a mechanical journey anchor makes the answer unknown.
 */
export async function resolveImpactRadius(input = {}, {
  db = pool,
  projectionForRevision = getProjectionForRevision,
  manifestForProjection = getManifestById,
  factHealth = getFactHealthSummary,
  repoScope = scopeForRepo,
  capabilityNodes = async (runId) => (await db.query(
    `SELECT node_key, name, attributes
       FROM map_projection_nodes
      WHERE run_id = $1 AND node_type = 'capability'`,
    [runId],
  )).rows,
} = {}) {
  const repo = normalizeRepoIdentity(input.repo);
  const requestedScope = String(input.scope ?? input.scope_key ?? '').trim() || null;
  const scopeKey = repoScope(repo);
  const expectedRevision = input.base_revision;
  const rawChangedFiles = input.changed_files;
  const rawCapabilityIds = input.capability_ids;
  const expectedManifestDigest = input.manifest_digest ?? null;
  const expectedProjectionDigest = input.projection_digest ?? null;
  if ((Array.isArray(rawChangedFiles) && rawChangedFiles.length > MAX_CHANGED_FILES)
    || (Array.isArray(rawCapabilityIds) && rawCapabilityIds.length > MAX_CAPABILITY_IDS)) {
    throw new MapRadiusError(
      'map_radius_complexity_exceeded',
      '影响半径请求超过文件或 Capability 数量上限',
      400,
    );
  }
  const changedFiles = Array.isArray(rawChangedFiles)
    ? [...new Set(rawChangedFiles.map(normalizePath).filter(Boolean))]
    : null;
  const requestedCapabilityIds = rawCapabilityIds === undefined
    ? []
    : (Array.isArray(rawCapabilityIds)
      ? [...new Set(rawCapabilityIds.map(value => String(value).trim()).filter(Boolean))]
      : null);
  if (!repo || !GIT_SHA.test(expectedRevision ?? '') || !changedFiles) {
    throw new MapRadiusError(
      'map_radius_input_invalid',
      'repo、base_revision 与 changed_files 数组必填',
      400,
    );
  }
  if (!scopeKey || (requestedScope && requestedScope !== scopeKey)) {
    throw new MapRadiusError(
      'map_repo_scope_unbound',
      `repo '${repo}' 没有匹配请求 scope 的权威绑定`,
      409,
    );
  }
  if ((expectedManifestDigest && !/^[0-9a-f]{64}$/.test(expectedManifestDigest))
    || (expectedProjectionDigest && !/^[0-9a-f]{64}$/.test(expectedProjectionDigest))) {
    throw new MapRadiusError('map_radius_input_invalid', 'projection/manifest digest 格式非法', 400);
  }
  const totalPathBytes = changedFiles.reduce(
    (total, path) => total + Buffer.byteLength(path, 'utf8'), 0,
  );
  if (!requestedCapabilityIds
    || changedFiles.length > MAX_CHANGED_FILES
    || changedFiles.some(path => path.length > MAX_PATH_LENGTH)
    || totalPathBytes > MAX_TOTAL_PATH_BYTES
    || requestedCapabilityIds.length > MAX_CAPABILITY_IDS
    || requestedCapabilityIds.some(id => id.length > 128)) {
    throw new MapRadiusError(
      'map_radius_complexity_exceeded',
      '影响半径请求超过文件、路径或 Capability 复杂度上限',
      400,
    );
  }

  const [projection, health] = await Promise.all([
    projectionForRevision(scopeKey, expectedRevision, {
      manifestDigest: expectedManifestDigest,
      projectionDigest: expectedProjectionDigest,
    }),
    factHealth(scopeKey, scopeKey),
  ]);
  if (!projection) {
    throw new MapRadiusError(
      'map_projection_missing',
      `scope '${scopeKey}' 没有 revision '${expectedRevision}' 的 projection`,
      404,
    );
  }
  const manifest = await manifestForProjection(projection.manifest_version_id);
  if (!manifest) {
    throw new MapRadiusError('map_manifest_missing', 'projection 对应的 manifest 不存在', 404);
  }

  const actualRevision = projectionRevision(projection, repo, scopeKey);
  let freshness = baseFreshness({
    factHealth: projection.status === 'active' ? health : { overall: 'fresh' },
    actualRevision,
    expectedRevision,
  });
  if (projection.manifest_digest !== manifest.digest) {
    freshness = { status: 'stale', reason_code: 'manifest_projection_mismatch' };
  }
  const envelope = {
    scope_key: scopeKey,
    manifest_version: manifest.version,
    manifest_digest: manifest.digest,
    projection_digest: projection.projection_digest,
    fact_revisions: actualRevision ? { [repo]: actualRevision } : {},
    generated_at: new Date().toISOString(),
  };
  const projectionCapabilities = await capabilityNodes(projection.id);
  const activeCapabilityIds = projectionCapabilities.map(row => row.node_key);
  const [
    { rows: graphSnapshotRows }, { rows: featureRows },
  ] = await Promise.all([
    db.query(
      `SELECT snapshot.source_revision AS snapshot_revision,
              edge.src_path, edge.dst_path, edge.edge_type
         FROM graph_snapshot_versions AS snapshot
         LEFT JOIN graph_edge_snapshots AS edge
           ON edge.repo = snapshot.repo
          AND edge.source_revision = $2
        WHERE snapshot.repo = $1 AND snapshot.source_revision = $2`,
      [scopeKey, actualRevision],
    ),
    db.query(
      `SELECT jf.id, jf.name, jf.unit_test_path, jf.workflow_ref, jf.guard_ref,
              j.capability_code, j.name AS capability_name
         FROM journey_features AS jf
         JOIN journeys AS j ON j.id = jf.journey_id
        WHERE jf.status <> 'deprecated'
          AND j.capability_code IS NOT NULL
          AND j.parent_journey_id IS NOT NULL
          AND j.capability_code = ANY($1::text[])`,
      [activeCapabilityIds],
    ),
  ]);
  const graphSnapshotRevision = graphSnapshotRows[0]?.snapshot_revision;
  const edgeRows = graphSnapshotRows.filter(row => row.src_path && row.dst_path);
  if (freshness.status === 'fresh' && graphSnapshotRevision !== actualRevision) {
    freshness = { status: 'unknown', reason_code: 'graph_projection_revision_mismatch' };
  }
  const adjacency = buildAdjacency(edgeRows);
  const nodeSet = new Set([...adjacency.fwd.keys(), ...adjacency.rev.keys()]);
  const normalizedFeatures = featureRows.map((row) => ({
    ...row,
    unit_test_path: normalizeAnchor(row.unit_test_path),
    workflow_ref: normalizeAnchor(row.workflow_ref),
    guard_ref: normalizeAnchor(row.guard_ref),
  }));
  const classified = classifyFeatureAnchors(normalizedFeatures, nodeSet)
    .map((item, index) => ({ ...item, source: featureRows[index] }));
  const capabilities = new Map();
  const activeCapabilities = new Map(projectionCapabilities.map(row => [row.node_key, row]));
  const missingCapability = requestedCapabilityIds.find(id => !activeCapabilities.has(id));
  for (const id of requestedCapabilityIds) {
    const node = activeCapabilities.get(id);
    if (!node) continue;
    capabilities.set(id, {
      capability_id: id,
      capability_name: node.name,
      owner: id,
      impact_level: 'direct',
    });
  }
  const unclaimedFiles = [];
  for (const file of changedFiles) {
    const reached = reachable(adjacency, [file], { dir: 'rev', maxDepth: 10 });
    const matched = classified.filter((feature) => feature.anchors.some(
      (anchor) => anchor.matched_node && reached.has(anchor.matched_node),
    ));
    const owned = pathOwnedCapabilities(file, projectionCapabilities);
    if (matched.length === 0 && owned.length === 0) unclaimedFiles.push(file);
    for (const feature of matched) {
      capabilities.set(feature.source.capability_code, {
        capability_id: feature.source.capability_code,
        capability_name: feature.source.capability_name,
        owner: feature.source.capability_code,
        impact_level: 'indirect',
      });
    }
    for (const node of owned) {
      const existing = capabilities.get(node.node_key);
      capabilities.set(node.node_key, {
        capability_id: node.node_key,
        capability_name: node.name,
        owner: node.node_key,
        impact_level: existing?.impact_level === 'direct' ? 'direct' : 'indirect',
      });
    }
  }

  const capabilityIds = new Set(capabilities.keys());
  let assertions = [];
  let ambiguousAssertions = false;
  let unsafeAssertions = false;
  if (capabilityIds.size > 0) {
    const { rows } = await db.query(
      `SELECT link.id, link.assertion_ref, link.assertion_revision,
              journey.capability_code
         FROM journey_step_links AS link
         JOIN journeys AS journey ON journey.id = link.journey_id
        WHERE journey.capability_code = ANY($1::text[])
          AND link.assertion_ref IS NOT NULL
        ORDER BY journey.capability_code, link.id`,
      [[...capabilityIds]],
    );
    ({
      assertions,
      ambiguous: ambiguousAssertions,
      unsafe: unsafeAssertions,
    } = requiredAssertions(rows, capabilityIds));
  }

  if (freshness.status !== 'fresh') {
    // 保留更靠近事实快照边界的失败原因，避免被下游派生错误覆盖。
  } else if (missingCapability) {
    freshness = { status: 'unknown', reason_code: 'capability_not_in_active_projection' };
  } else if (unclaimedFiles.length > 0) {
    freshness = { status: 'unknown', reason_code: 'impact_anchor_missing' };
  } else if (unsafeAssertions) {
    freshness = { status: 'unknown', reason_code: 'unsafe_assertion_ref' };
  } else if (ambiguousAssertions) {
    freshness = { status: 'unknown', reason_code: 'assertion_identity_ambiguous' };
  } else {
    const assertedCapabilityIds = new Set(assertions.flatMap(
      assertion => assertion.covers_capability_ids ?? [],
    ));
    if ([...capabilityIds].some(id => !assertedCapabilityIds.has(id))) {
      freshness = { status: 'unknown', reason_code: 'capability_assertion_coverage_missing' };
    }
  }
  return {
    ...envelope,
    freshness: {
      ...freshness,
      checked_at: new Date().toISOString(),
      mapper_revision: actualRevision,
    },
    changed_files: changedFiles,
    affected_nodes: [...capabilities.values()].sort(
      (a, b) => a.capability_id.localeCompare(b.capability_id),
    ),
    required_assertions: assertions,
    unclaimed_files: unclaimedFiles,
  };
}
