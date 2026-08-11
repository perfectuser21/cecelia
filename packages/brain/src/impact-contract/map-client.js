/** MJ5 Universal Mapper /map/radius 客户端。任何不可用或合同异常都必须 fail-closed。 */

import { canonicalAssertionCommandText } from '../lib/gp-assertion-command.js';
import { assertionDigest } from '../lib/journey-assertion-receipt.js';

const DEFAULT_ENDPOINT = process.env.CECELIA_MAP_RADIUS_URL
  || 'http://localhost:5221/api/brain/map/radius';
const DEFAULT_TIMEOUT_MS = 10_000;

class ImpactMapError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'ImpactMapError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

function assertMapperContract(value, {
  repo,
  baseRevision,
  headRevision: _headRevision,
  manifestDigest,
  projectionDigest,
} = {}) {
  const expectedRevision = baseRevision;
  const freshnessStatus = value?.freshness?.status;
  const validNodes = Array.isArray(value?.affected_nodes)
    && value.affected_nodes.every((node) => (
      node
      && typeof node === 'object'
      && typeof (node.capability_id ?? node.id) === 'string'
      && (node.capability_id ?? node.id).trim().length > 0
      && typeof node.owner === 'string'
      && node.owner.trim().length > 0
    ));
  const validAssertions = Array.isArray(value?.required_assertions)
    && value.required_assertions.every((assertion) => (
      assertion
      && typeof assertion === 'object'
      && typeof assertion.assertion_id === 'string'
      && assertion.assertion_id.trim().length > 0
      && typeof assertion.command === 'string'
      && assertion.command.trim().length > 0
      && Array.isArray(assertion.covers_capability_ids)
      && assertion.covers_capability_ids.length > 0
      && assertion.covers_capability_ids.every((id) => typeof id === 'string' && id.trim())
      && /^[0-9a-f]{64}$/.test(assertion.assertion_digest ?? '')
      && /^[0-9a-f-]{36}$/i.test(assertion.journey_step_link_id ?? '')
      && Number.isInteger(assertion.assertion_revision)
      && assertion.assertion_revision > 0
      && (assertion.source_bindings === undefined || (
        Array.isArray(assertion.source_bindings)
        && assertion.source_bindings.length > 0
        && new Set(assertion.source_bindings.map(item => item?.journey_step_link_id)).size
          === assertion.source_bindings.length
        && assertion.source_bindings.every(item => (
          /^[0-9a-f-]{36}$/i.test(item?.journey_step_link_id ?? '')
          && Number.isInteger(item?.assertion_revision)
          && item.assertion_revision > 0
          && item.assertion_digest === assertion.assertion_digest
        ))
        && assertion.source_bindings[0].journey_step_link_id === assertion.journey_step_link_id
        && assertion.source_bindings[0].assertion_revision === assertion.assertion_revision
      ))
      && (() => {
        try {
          return assertion.command === canonicalAssertionCommandText(assertion.assertion_id)
            && assertion.assertion_digest === assertionDigest(assertion.assertion_id);
        } catch {
          return false;
        }
      })()
    ));
  const valid = value
    && typeof value === 'object'
    && typeof value.manifest_digest === 'string'
    && /^[0-9a-f]{64}$/.test(value.manifest_digest)
    && typeof value.projection_digest === 'string'
    && /^[0-9a-f]{64}$/.test(value.projection_digest)
    && (!manifestDigest || value.manifest_digest === manifestDigest)
    && (!projectionDigest || value.projection_digest === projectionDigest)
    && value.fact_revisions
    && typeof value.fact_revisions === 'object'
    && !Array.isArray(value.fact_revisions)
    && typeof repo === 'string'
    && typeof expectedRevision === 'string'
    && value.freshness
    && ['fresh', 'stale', 'unknown'].includes(freshnessStatus)
    && (freshnessStatus !== 'fresh' || value.fact_revisions[repo] === expectedRevision)
    && validNodes
    && validAssertions;

  if (!valid) {
    throw new ImpactMapError('mapper_contract_invalid', 'Mapper 响应不符合 /map/radius 合同');
  }
}

/**
 * queryImpactRadius({ repo, baseRevision, headRevision, changedFiles }) — 查询影响半径。
 *
 * 调用 POST /api/brain/map/radius；不可达或响应合同异常时抛出结构化错误。
 * 返回标准格式：freshness.status='fresh', revision 对齐
 *
 * @param {{
 *   repo?: string,
 *   baseRevision?: string,
 *   headRevision?: string,
 *   changedFiles?: string[],
 *   capabilityIds?: string[],
 * }} params
 * @returns {Promise<{
 *   manifest_digest: string,
 *   projection_digest: string,
 *   fact_revisions: object,
 *   freshness: { status: 'fresh'|'stale'|'unknown', reason_code: string|null },
 *   affected_nodes: any[],
 *   required_assertions: any[],
 * }>}
 */
export async function queryImpactRadius(
  {
    repo, baseRevision, headRevision, changedFiles = [], capabilityIds = [],
    manifestDigest, projectionDigest,
  } = {},
  { fetchImpl = globalThis.fetch, endpoint = DEFAULT_ENDPOINT, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new ImpactMapError('mapper_unavailable', '运行环境没有可用的 fetch');
  }

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.CECELIA_INTERNAL_TOKEN
          ? { authorization: `Bearer ${process.env.CECELIA_INTERNAL_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        repo,
        base_revision: baseRevision,
        head_revision: headRevision,
        changed_files: changedFiles,
        capability_ids: capabilityIds,
        manifest_digest: manifestDigest,
        projection_digest: projectionDigest,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof ImpactMapError) throw error;
    throw new ImpactMapError('mapper_unavailable', `Mapper 请求失败: ${error.message}`);
  }

  if (!response.ok) {
    throw new ImpactMapError(
      'mapper_unavailable',
      `Mapper 返回 HTTP ${response.status}`,
      response.status,
    );
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new ImpactMapError('mapper_contract_invalid', `Mapper 响应不是合法 JSON: ${error.message}`);
  }
  assertMapperContract(body, {
    repo, baseRevision, headRevision, manifestDigest, projectionDigest,
  });
  return body;
}

export const callMapper = queryImpactRadius;
