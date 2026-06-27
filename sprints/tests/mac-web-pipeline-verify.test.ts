import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('Slice4 mac_web pipeline 透传验证 [BEHAVIOR]', () => {
  // 逻辑断言：无需 Brain 在线，读源码验证 fix 已就位
  it('runSubTaskNode 源码包含 target_environment 透传（Slice4 fix）', () => {
    const src = readFileSync(
      'packages/brain/src/workflows/harness-initiative.graph.js',
      'utf8',
    );
    const fnMatch = src.match(/export async function runSubTaskNode[\s\S]*?\n\}/);
    expect(fnMatch).toBeTruthy();
    expect(
      /target_environment:\s*state\.task\??\.payload\??\.target_environment/.test(fnMatch![0]),
    ).toBe(true);
  });

  it('harness-task.graph.js 含 mac_web → executeOnHost 路由分支', () => {
    const src = readFileSync('packages/brain/src/workflows/harness-task.graph.js', 'utf8');
    expect(src).toContain("targetEnv === 'mac_web'");
    expect(src).toContain('executeOnHost');
  });

  it('host-executor.js writeFileSync host.prompt — executeOnHost 调用的可观测副作用', () => {
    const src = readFileSync('packages/brain/src/spawn/host-executor.js', 'utf8');
    expect(src).toContain('host.prompt');
    expect(src).toContain('HOST_PROMPT_DIR');
    expect(src).toContain('writeFileSync');
  });

  // 接缝断言（RED phase）：E2E 验证报告尚未生成 → FAIL
  // ws1 运行 final-e2e 脚本后写入 sprints/e2e-verify-report.json → GREEN
  it('E2E 验证报告已生成且 status=PASS（需 ws1 执行 final-e2e 后才绿）', () => {
    const reportPath = 'sprints/e2e-verify-report.json';
    // RED: 报告文件不存在时此测试失败
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(report.status).toBe('PASS');
    expect(report.slice4_fix_verified).toBe(true);
    expect(report.host_escape_verified).toBe(true);
    expect(report.no_deadlock_verified).toBe(true);
  });
});
