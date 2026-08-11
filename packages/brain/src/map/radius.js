import pool from '../db.js';
import { getActiveManifest } from './manifest-store.js';
import { getActiveProjection } from './projector.js';
import { getFactHealthSummary } from './state-resolver.js';
import {
  buildAdjacency,
  classifyFeatureAnchors,
  normalizePath,
  reachable,
} from '../lib/graph-query.js';
import { classifyJourneyCellAssertion } from '../lib/journey-cell-assertion.js';
import { assertionDigest } from '../lib/journey-assertion-receipt.js';

const GIT_SHA = /^[0-9a-f]{40}$/i;

export class MapRadiusError extends Error {
  constructor(code, message, httpStatus = 500) {
    super(message);
    this.name = 'MapRadiusError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function scopeFromRepo(repo) {
  return String(repo).trim().replace(/\.git$/i, '').split('/').filter(Boolean).at(-1);
}

function normalizeAnchor(value) {
  return normalizePath(String(value ?? '')
    .replace(/^(?:script|test):/, '')
    .split('#')[0]);
}

function commandForAssertionRef(assertionRef) {
  const ref = String(assertionRef ?? '').trim();
  const classification = classifyJourneyCellAssertion({ assertion_ref: ref });
  if (!classification.runnable) return null;
  if (ref.startsWith('manual:')) return ref.slice('manual:'.length).trim() || null;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(ref)) return `npx vitest run ${ref}`;
  if (/(^|\/)test_[^/]+\.py$/.test(ref)) return `python3 -m pytest ${ref}`;
  if (/\/smoke\/[^/]+\.sh$/.test(ref)) return `bash ${ref}`;
  return null;
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

function requiredAssertions(rows, capabilityIds) {
  const seen = new Set();
  const assertions = [];
  let ambiguous = false;
  for (const row of rows) {
    if (!capabilityIds.has(row.capability_code)) continue;
    const assertionId = String(row.assertion_ref ?? '').trim();
    const command = commandForAssertionRef(assertionId);
    if (!command) continue;
    if (seen.has(assertionId)) {
      ambiguous = true;
      continue;
    }
    seen.add(assertionId);
    assertions.push({
      assertion_id: assertionId,
      command,
      covers_capability_ids: [row.capability_code],
      journey_step_link_id: row.id,
      assertion_revision: Number(row.assertion_revision),
      assertion_digest: assertionDigest(assertionId),
      owner: row.capability_code,
    });
  }
  assertions.sort((a, b) => a.assertion_id.localeCompare(b.assertion_id));
  return { assertions, ambiguous };
}

/**
 * Build the revision-locked Impact Gate projection for changed files.
 * A changed file without a mechanical journey anchor makes the answer unknown.
 */
export async function resolveImpactRadius(input = {}, {
  db = pool,
  activeManifest = getActiveManifest,
  activeProjection = getActiveProjection,
  factHealth = getFactHealthSummary,
} = {}) {
  const repo = String(input.repo ?? '').trim();
  const scopeKey = String(input.scope ?? input.scope_key ?? scopeFromRepo(repo) ?? '').trim();
  const expectedRevision = input.head_revision ?? input.base_revision;
  const changedFiles = Array.isArray(input.changed_files)
    ? [...new Set(input.changed_files.map(normalizePath).filter(Boolean))]
    : null;
  if (!repo || !scopeKey || !GIT_SHA.test(expectedRevision ?? '') || !changedFiles) {
    throw new MapRadiusError(
      'map_radius_input_invalid',
      'repo、base_revision/head_revision 与 changed_files 数组必填',
      400,
    );
  }

  const [manifest, projection, health] = await Promise.all([
    activeManifest(scopeKey),
    activeProjection(scopeKey),
    factHealth(scopeKey, scopeKey),
  ]);
  if (!manifest) {
    throw new MapRadiusError('map_manifest_missing', `scope '${scopeKey}' 没有 active manifest`, 404);
  }
  if (!projection) {
    throw new MapRadiusError('map_projection_missing', `scope '${scopeKey}' 没有 active projection`, 404);
  }

  const actualRevision = projectionRevision(projection, repo, scopeKey);
  let freshness = baseFreshness({
    factHealth: health,
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
  if (changedFiles.length === 0) {
    return {
      ...envelope,
      freshness: {
        ...freshness,
        checked_at: new Date().toISOString(),
        mapper_revision: actualRevision,
      },
      affected_nodes: [],
      required_assertions: [],
      unclaimed_files: [],
    };
  }

  const [{ rows: edgeRows }, { rows: featureRows }] = await Promise.all([
    db.query(
      'SELECT src_path, dst_path, edge_type FROM graph_edges WHERE repo = $1',
      [scopeKey],
    ),
    db.query(
      `SELECT jf.id, jf.name, jf.unit_test_path, jf.workflow_ref, jf.guard_ref,
              j.capability_code, j.name AS capability_name
         FROM journey_features AS jf
         JOIN journeys AS j ON j.id = jf.journey_id
        WHERE jf.status <> 'deprecated'
          AND j.capability_code IS NOT NULL
          AND j.parent_journey_id IS NOT NULL`,
    ),
  ]);
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
  const unclaimedFiles = [];
  for (const file of changedFiles) {
    const reached = reachable(adjacency, [file], { dir: 'rev', maxDepth: 10 });
    const matched = classified.filter((feature) => feature.anchors.some(
      (anchor) => anchor.matched_node && reached.has(anchor.matched_node),
    ));
    if (matched.length === 0) unclaimedFiles.push(file);
    for (const feature of matched) {
      capabilities.set(feature.source.capability_code, {
        capability_id: feature.source.capability_code,
        capability_name: feature.source.capability_name,
        owner: feature.source.capability_code,
        impact_level: 'indirect',
      });
    }
  }

  const capabilityIds = new Set(capabilities.keys());
  let assertions = [];
  let ambiguousAssertions = false;
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
    ({ assertions, ambiguous: ambiguousAssertions } = requiredAssertions(rows, capabilityIds));
  }

  if (unclaimedFiles.length > 0) {
    freshness = { status: 'unknown', reason_code: 'impact_anchor_missing' };
  } else if (ambiguousAssertions) {
    freshness = { status: 'unknown', reason_code: 'assertion_identity_ambiguous' };
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
