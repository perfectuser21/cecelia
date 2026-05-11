import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';

const SMOKE = 'packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh';

describe('Workstream 1 — smoke harness + happy path (Steps 1-3) [BEHAVIOR via ARTIFACT shape]', () => {
  it('smoke 文件存在且可执行', () => {
    expect(existsSync(SMOKE)).toBe(true);
    const mode = statSync(SMOKE).mode;
    expect(mode & 0o111).toBeTruthy();
  });

  it('smoke 顶部含 #!/usr/bin/env bash + set -euo pipefail', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/^#!\/usr\/bin\/env bash/m);
    expect(c).toMatch(/^set -euo pipefail/m);
  });

  it('smoke 含 brain/pg 不可用时的 SKIP 退路（PRD 边界）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/SKIP:.*(docker|brain|pg|postgres|not available|不可用)/);
  });

  it('smoke 使用 test-w29- 隔离前缀便于幂等清理', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('test-w29-');
  });

  it('smoke 调 POST /api/brain/tick 触发 dispatcher', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/\/api\/brain\/tick/);
  });

  it('smoke 调 GET /api/brain/dispatch/recent 验 endpoint shape（B6）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/\/api\/brain\/dispatch\/recent/);
  });

  it('happy path 含 dispatch_events 时间窗口断言（防造假）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/dispatch_events[\s\S]*INTERVAL[\s'"]+[0-9]+[\s'"]*(minute|second)/);
  });

  it('打印 [B1] PASS 标记（reportNode 写回）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('[B1] PASS — reportNode 写回 tasks.status=completed');
  });

  it('打印 [B3-IN] PASS 标记（slot in_progress +1）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('[B3-IN] PASS — slot in_progress +1');
  });

  it('打印 [B6-TABLE] PASS 标记（dispatch_events +N 行）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/\[B6-TABLE\] PASS — dispatch_events \+/);
  });

  it('打印 [B6-EP] PASS 标记（/dispatch/recent shape）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('[B6-EP] PASS — /dispatch/recent shape={events,limit,total} no_banned_keys=ok');
  });

  it('打印 [B6-KEYS] PASS 标记（/dispatch/recent jq -e keys 严等）— Round 3 R11 漂移防御', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/\[B6-KEYS\] PASS — \/dispatch\/recent jq -e/);
  });

  it('打印 [B6-BANNED] PASS 标记（6 个禁用字段反向不存在）— Round 3 R11 漂移防御', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/\[B6-BANNED\] PASS — \/dispatch\/recent banned_keys=∅/);
  });

  it('打印 [B6-ERR] PASS 标记（error path 非法 query 4xx）— Round 3 error path category', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/\[B6-ERR\] PASS — \/dispatch\/recent error path/);
  });

  it('含 jq -e keys==[...] 严等断言', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/jq\s+-e\s+.keys\s*==\s*\[/);
  });

  it('含 ≥ 4 个禁用字段反向 has() 检查', () => {
    const c = readFileSync(SMOKE, 'utf8');
    const banned = ['data', 'results', 'payload', 'count', 'records', 'history'];
    const hitCount = banned.filter((k) => new RegExp(`has\\("${k}"\\)`).test(c)).length;
    expect(hitCount).toBeGreaterThanOrEqual(4);
  });

  it('含 error path 段（非法 query + 期望 4xx 状态码）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toMatch(/(limit=foo|limit=-1|\/recentXYZ|\/dispatch\/recent[^ ]*=[^0-9])/);
    expect(c).toMatch(/(http_code|status.*[45][0-9][0-9])/);
  });

  it('打印 [B6-ENUM] PASS 标记（event_type 枚举）', () => {
    const c = readFileSync(SMOKE, 'utf8');
    expect(c).toContain('[B6-ENUM] PASS — event_type ∈ {dispatched,failed_dispatch}');
  });
});
