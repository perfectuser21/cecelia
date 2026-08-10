/**
 * map-client.js — MJ5 Mapper stub client（FR-3 Structure Gate）
 *
 * 提供与 Mapper 服务（/api/brain/map/radius）交互的接口。
 * 当前为 MJ5 stub，返回固定的合法响应。
 *
 * MJ5 STUB: replace with real Mapper call after MJ5 contract passes
 *
 * sprint: 08110022-relay-d96c9fa0 ws3
 */

/**
 * queryImpactRadius({ repo, baseRevision, headRevision, changedFiles }) — 查询影响半径。
 *
 * MJ5 STUB: real implementation will call POST /api/brain/map/radius
 * 返回标准格式：freshness.status='fresh', revision 对齐
 *
 * @param {{
 *   repo?: string,
 *   baseRevision?: string,
 *   headRevision?: string,
 *   changedFiles?: string[],
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
export async function queryImpactRadius({ repo, baseRevision, _headRevision, _changedFiles } = {}) {
  // MJ5 STUB: replace with real Mapper call after MJ5 contract passes
  // 真实实现将调用 POST /api/brain/map/radius，返回真实影响半径数据
  return {
    manifest_digest: 'stub_manifest_digest',
    projection_digest: 'stub_projection_digest',
    fact_revisions: { [repo || 'stub_repo']: baseRevision || 'stub_revision' },
    freshness: { status: 'fresh', reason_code: null },
    affected_nodes: [],
    required_assertions: [],
  };
}

export const callMapper = queryImpactRadius;
