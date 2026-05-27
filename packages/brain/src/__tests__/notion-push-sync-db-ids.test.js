/**
 * [FAILING] notion-push-sync DB ID 和字段结构回归测试
 *
 * 根因：WS1 PR #3140 写入了占位符 DB ID，导致 decisions 和
 * initiative_contracts 推送 Notion 全部 404。
 *
 * 本测试确保：
 * 1. DECISIONS_DB 和 INITIATIVE_CONTRACTS_DB 都指向真实 AI Notes DB
 * 2. pushDecisions 构造的 properties 只含 AI Notes schema 支持的字段
 * 3. pushInitiativeContracts 同上
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../notion-push-sync.js'), 'utf8');

const AI_NOTES_DB = '185c40c2-ba63-828c-973f-81a9c4582cd6';

// AI Notes DB 只有三个 property：Title(title), Type(select), Date(date)
// 不存在的 property key：Status, Category, Reason, Version, PRD, Name
// 注意：'Decision' 是 Type 的值，不是 property key，不在此列表
const FORBIDDEN_FIELDS = ['Status', 'Category', 'Reason', 'Version', 'PRD'];

describe('notion-push-sync DB ID 修正', () => {
  it('DECISIONS_DB 等于真实 AI Notes DB ID', () => {
    expect(SRC).toContain(`'${AI_NOTES_DB}'`);
    expect(SRC).not.toContain("'1b2c40c2-ba63-8101-ae1e-d1e2f3a4b5c6'");
  });

  it('INITIATIVE_CONTRACTS_DB 等于真实 AI Notes DB ID', () => {
    // 两个常量都应指向同一个 AI Notes DB
    const matches = [...SRC.matchAll(new RegExp(AI_NOTES_DB.replace(/-/g, '-'), 'g'))];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(SRC).not.toContain("'2c3d40c2-ba63-8102-bf2f-e2f3a4b5c6d7'");
  });

  it('pushDecisions 不使用 AI Notes 不支持的字段', () => {
    // 提取 pushDecisions 函数体
    const fnStart = SRC.indexOf('async function pushDecisions');
    const fnEnd = SRC.indexOf('\nasync function ', fnStart + 1);
    const fnBody = SRC.slice(fnStart, fnEnd);

    for (const field of FORBIDDEN_FIELDS) {
      expect(fnBody, `pushDecisions 不应含字段 "${field}"`).not.toContain(`'${field}'`);
    }
  });

  it('pushInitiativeContracts 不使用 AI Notes 不支持的字段', () => {
    const fnStart = SRC.indexOf('async function pushInitiativeContracts');
    const fnEnd = SRC.indexOf('\nasync function ', fnStart + 1);
    const fnBody = SRC.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);

    for (const field of FORBIDDEN_FIELDS) {
      expect(fnBody, `pushInitiativeContracts 不应含字段 "${field}"`).not.toContain(`'${field}'`);
    }
  });

  it('pushDecisions 设置 Type = Decision', () => {
    const fnStart = SRC.indexOf('async function pushDecisions');
    const fnEnd = SRC.indexOf('\nasync function ', fnStart + 1);
    const fnBody = SRC.slice(fnStart, fnEnd);
    expect(fnBody).toContain('Decision');
    expect(fnBody).toContain('Type');
  });

  it('pushInitiativeContracts 设置 Type = Contract', () => {
    const fnStart = SRC.indexOf('async function pushInitiativeContracts');
    const fnEnd = SRC.indexOf('\nasync function ', fnStart + 1);
    const fnBody = SRC.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);
    expect(fnBody).toContain('Contract');
    expect(fnBody).toContain('Type');
  });
});
