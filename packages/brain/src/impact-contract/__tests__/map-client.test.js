import { describe, expect, it, vi } from 'vitest';
import { queryImpactRadius } from '../map-client.js';

const request = {
  repo: 'perfectuser21/cecelia',
  baseRevision: 'a'.repeat(40),
  headRevision: 'b'.repeat(40),
  changedFiles: ['packages/brain/src/example.js'],
};

function freshResponse() {
  return {
    manifest_digest: '1'.repeat(64),
    projection_digest: '2'.repeat(64),
    fact_revisions: { 'perfectuser21/cecelia': request.headRevision },
    freshness: { status: 'fresh', reason_code: null },
    affected_nodes: [],
    required_assertions: [],
  };
}

describe('map-client', () => {
  it('把 revision 与 changed files 发送到 MJ5 radius 合同', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => freshResponse(),
    }));

    const result = await queryImpactRadius(request, {
      fetchImpl,
      endpoint: 'http://mapper.test/api/brain/map/radius',
      timeoutMs: 50,
    });

    expect(result.projection_digest).toBe('2'.repeat(64));
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://mapper.test/api/brain/map/radius');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      repo: request.repo,
      base_revision: request.baseRevision,
      head_revision: request.headRevision,
      changed_files: request.changedFiles,
    });
    expect(init.signal).toBeDefined();
  });

  it('Mapper HTTP 失败时抛出 mapper_unavailable，不能伪造 fresh 空影响', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not_found' }),
    }));

    await expect(queryImpactRadius(request, { fetchImpl }))
      .rejects.toMatchObject({ code: 'mapper_unavailable', status: 404 });
  });

  it('Mapper 响应缺少 digest/freshness 时 fail-closed', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ affected_nodes: [], required_assertions: [] }),
    }));

    await expect(queryImpactRadius(request, { fetchImpl }))
      .rejects.toMatchObject({ code: 'mapper_contract_invalid' });
  });

  it('短 digest 或缺少请求 repo revision 时 fail-closed', async () => {
    for (const body of [
      { ...freshResponse(), projection_digest: 'short' },
      { ...freshResponse(), fact_revisions: {} },
    ]) {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => body,
      }));
      await expect(queryImpactRadius(request, { fetchImpl }))
        .rejects.toMatchObject({ code: 'mapper_contract_invalid' });
    }
  });

  it('畸形影响节点或断言不能被解释为空影响', async () => {
    for (const body of [
      { ...freshResponse(), affected_nodes: [{}] },
      { ...freshResponse(), required_assertions: [{}] },
    ]) {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => body,
      }));
      await expect(queryImpactRadius(request, { fetchImpl }))
        .rejects.toMatchObject({ code: 'mapper_contract_invalid' });
    }
  });
});
