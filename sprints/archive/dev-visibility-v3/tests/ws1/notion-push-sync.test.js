import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SYNC_FILE = 'packages/brain/src/notion-push-sync.js';
const MIGRATIONS_DIR = 'packages/brain/migrations';

describe('WS1 — notion-push-sync 两函数 + migration [BEHAVIOR]', () => {
  it('pushDecisions 函数存在于 notion-push-sync.js', () => {
    const c = readFileSync(SYNC_FILE, 'utf8');
    expect(c).toContain('async function pushDecisions');
  });

  it('pushInitiativeContracts 函数存在于 notion-push-sync.js', () => {
    const c = readFileSync(SYNC_FILE, 'utf8');
    expect(c).toContain('async function pushInitiativeContracts');
  });

  it('pushDecisions 含 notion_synced_at IS NULL 过滤 + NOW() 更新', () => {
    const c = readFileSync(SYNC_FILE, 'utf8');
    expect(c).toContain('notion_synced_at IS NULL');
    expect(c.includes('notion_synced_at=NOW()') || c.includes('notion_synced_at = NOW()')).toBe(true);
  });

  it('runNotionPushSync 调用 pushDecisions 和 pushInitiativeContracts', () => {
    const c = readFileSync(SYNC_FILE, 'utf8');
    const fnStart = c.indexOf('export async function runNotionPushSync');
    expect(fnStart).toBeGreaterThan(-1);
    const body = c.slice(fnStart);
    expect(body).toContain('pushDecisions(');
    expect(body).toContain('pushInitiativeContracts(');
  });

  it('migration 文件同时含 decisions 和 initiative_contracts 的 notion_synced_at 列', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
    const found = files.some(f => {
      const c = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      return (
        c.includes('decisions') &&
        c.includes('notion_synced_at') &&
        c.includes('initiative_contracts')
      );
    });
    expect(found).toBe(true);
  });
});
