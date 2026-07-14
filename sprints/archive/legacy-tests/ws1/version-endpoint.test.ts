import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// TDD Red 阶段：GET /api/brain/version 端点尚未实现
// 运行时 Brain 在 localhost:5221，端点不存在时返回 404
// Generator 实现路由后，所有 test 变 Green

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

async function getVersion(queryString = '') {
  const url = queryString
    ? `${BRAIN_URL}/api/brain/version?${queryString}`
    : `${BRAIN_URL}/api/brain/version`;
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// 读取 package.json 实际版本（value oracle）
const pkgPath = resolve(__dirname, '../../../packages/brain/package.json');
const expectedVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version;

// 读取 EXPECTED_SCHEMA_VERSION（value oracle）
const selfcheckPath = resolve(__dirname, '../../../packages/brain/src/selfcheck.js');
const selfcheckContent = readFileSync(selfcheckPath, 'utf8');
const schemaMatch = selfcheckContent.match(/EXPECTED_SCHEMA_VERSION = '([^']+)'/);
const expectedSchemaVersion = schemaMatch?.[1];

describe('Workstream 1 — GET /api/brain/version [BEHAVIOR]', () => {
  it('HTTP 200', async () => {
    const { status } = await getVersion();
    expect(status).toBe(200);
  });

  it('version 字段类型为 string', async () => {
    const { body } = await getVersion();
    expect(typeof body?.version).toBe('string');
  });

  it('schema_version 字段类型为 string', async () => {
    const { body } = await getVersion();
    expect(typeof body?.schema_version).toBe('string');
  });

  it('keys 完全等于 ["schema_version","version"]，无多余字段', async () => {
    const { body } = await getVersion();
    const keys = Object.keys(body ?? {}).sort();
    expect(keys).toEqual(['schema_version', 'version']);
  });

  it('禁用字段（ver/v/pkg_version/db_version/build/tag/release）不出现', async () => {
    const { body } = await getVersion();
    const banned = ['ver', 'v', 'pkg_version', 'db_version', 'build', 'tag', 'release'];
    for (const field of banned) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it('version 值与 package.json 实际值一致（值来源 oracle）', async () => {
    const { body } = await getVersion();
    expect(body?.version).toBe(expectedVersion);
  });

  it('version 符合 semver 格式 x.y.z', async () => {
    const { body } = await getVersion();
    expect(body?.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('schema_version 值与 selfcheck.js EXPECTED_SCHEMA_VERSION 一致（值来源 oracle）', async () => {
    const { body } = await getVersion();
    expect(body?.schema_version).toBe(expectedSchemaVersion);
  });

  it('多余 query 参数被忽略，仍返回 HTTP 200', async () => {
    const { status } = await getVersion('foo=bar&baz=qux');
    expect(status).toBe(200);
  });
});
