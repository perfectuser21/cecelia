import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const smokePath = 'packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh';

function smokeSource() {
  return fs.readFileSync(smokePath, 'utf8');
}

describe('headless-smoke no-dispatch contract [BEHAVIOR]', () => {
  it('合法 headless/codex POST 校验必须保留', () => {
    const src = smokeSource();

    expect(src).toContain('"title":"headless-smoke"');
    expect(src).toContain('"executor":"codex"');
    expect(src).toContain('"orchestrator":"skill-relay"');
    expect(src).toContain('"mode":"headless"');
    expect(src).toMatch(/\[\s*"\$CODE2"\s*=\s*"201"\s*\]\s*\|\|\s*\[\s*"\$CODE2"\s*=\s*"200"\s*\]/);
  });

  it('valid headless smoke task 创建后必须被取消或创建为非 queued', () => {
    const src = smokeSource();
    const headlessCase = src.slice(src.indexOf('# 3. POST tasks(mode=headless)'));

    expect(headlessCase).toMatch(/jq\s+-[a-z]*r[a-z]*\s+['"]\.id|python3[\s\S]*get\(['"]id['"]\)/);

    const cancelsCreatedTask =
      /PATCH\s+["']?\$BRAIN\/api\/brain\/tasks\/\$\{?[A-Z_]*ID\}?/.test(headlessCase) &&
      /"status"\s*:\s*"cancelled"/.test(headlessCase);
    const createsNonQueued =
      /"status"\s*:\s*"pending_postdeploy"/.test(headlessCase);
    const verifiesNonQueued =
      /curl[\s\S]*\/api\/brain\/tasks\/\$\{?[A-Z_]*ID\}?/.test(headlessCase) &&
      /!=\s*["']queued["']|!\=\s*queued|not\s+queued/.test(headlessCase);

    expect(cancelsCreatedTask || createsNonQueued).toBe(true);
    expect(verifiesNonQueued).toBe(true);
  });

  it('headless smoke 脚本必须捕获脚本创建的 task id 并输出 HEADLESS_SMOKE_TASK_ID', () => {
    const src = smokeSource();
    const headlessCase = src.slice(src.indexOf('# 3. POST tasks(mode=headless)'));

    expect(headlessCase).not.toMatch(/curl[\s\S]{0,240}-o\s+\/dev\/null[\s\S]{0,240}"title":"headless-smoke"/);
    expect(headlessCase).toMatch(/RESP|HEADLESS|TASK_ID|ID/);
    expect(headlessCase).toMatch(/HEADLESS_SMOKE_TASK_ID/);
    expect(headlessCase).toMatch(/jq\s+-[a-z]*r[a-z]*\s+['"]\.id|python3[\s\S]*get\(['"]id['"]\)/);
  });

  it('非法 mode 白名单校验必须保留', () => {
    const src = smokeSource();

    expect(src).toContain('"mode":"turbo"');
    expect(src).toMatch(/\[\s*"\$CODE3"\s*=\s*"400"\s*\]/);
    expect(src).toMatch(/mode=invalid|非法 mode|invalid-mode/);
  });
});
