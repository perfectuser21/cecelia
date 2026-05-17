/**
 * append-learnings.cjs 测试
 *
 * 测试 LEARNINGS 自动写回功能
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/devgate/append-learnings.cjs');

describe('append-learnings.cjs 基础功能', () => {
  const testDir = '/tmp/test-append-learnings';

  beforeAll(() => {
    // 创建测试目录
    execSync(`rm -rf ${testDir} && mkdir -p ${testDir}/docs`);

    // 创建模拟的 LEARNINGS.md
    fs.writeFileSync(
      path.join(testDir, 'docs/LEARNINGS.md'),
      `# Engine 开发经验记录

> 记录开发经验

---

## [2026-01-16] 初始版本开发

### 踩的坑

1. **版本号不同步**
`
    );

    // 创建模拟的 devgate-metrics.json
    fs.writeFileSync(
      path.join(testDir, 'devgate-metrics.json'),
      JSON.stringify(
        {
          window: {
            since: '2026-01-01',
            until: '2026-02-01',
          },
          prs: {
            p0: 2,
            p1: 3,
            total_p0p1: 5,
            total: 8,
          },
          rci_coverage: {
            updated: 5,
            total: 5,
            pct: 100,
            offenders: [],
          },
          rci_growth: {
            new_ids_count: 2,
            new_ids: ['H4-001', 'H4-002'],
          },
          dod: {
            items: 15,
            manual_tests: 2,
            p0_manual_tests: 0,
          },
        },
        null,
        2
      )
    );

    // 创建模拟的 regression-contract.yaml
    fs.writeFileSync(
      path.join(testDir, 'regression-contract.yaml'),
      `version: "1.0.0"

hooks:
  - id: H4-001
    name: "DevGate Metrics 指标计算"
    scope: hook
    priority: P1

  - id: H4-002
    name: "快照 Meta 格式增强"
    scope: hook
    priority: P1
`
    );
  });

  afterAll(() => {
    execSync(`rm -rf ${testDir}`);
  });

  it('--help 显示帮助信息', () => {
    const output = execSync(`node ${SCRIPT} --help`, {
      encoding: 'utf-8',
    });
    expect(output).toContain('LEARNINGS 自动写回');
    expect(output).toContain('--metrics');
    expect(output).toContain('--dry-run');
  });

  it('--dry-run 只输出不写入', () => {
    const output = execSync(
      `node ${SCRIPT} --metrics ${testDir}/devgate-metrics.json --learnings ${testDir}/docs/LEARNINGS.md --contract ${testDir}/regression-contract.yaml --dry-run`,
      { encoding: 'utf-8' }
    );
    expect(output).toContain('dry-run 模式');
    expect(output).toContain('[2026-01] DevGate 月度报告');

    // 确认文件未被修改
    const content = fs.readFileSync(path.join(testDir, 'docs/LEARNINGS.md'), 'utf-8');
    expect(content).not.toContain('[2026-01] DevGate 月度报告');
  });

  it('正常写入报告到 LEARNINGS.md', () => {
    execSync(
      `node ${SCRIPT} --metrics ${testDir}/devgate-metrics.json --learnings ${testDir}/docs/LEARNINGS.md --contract ${testDir}/regression-contract.yaml`,
      { encoding: 'utf-8' }
    );

    const content = fs.readFileSync(path.join(testDir, 'docs/LEARNINGS.md'), 'utf-8');
    expect(content).toContain('[2026-01] DevGate 月度报告');
    expect(content).toContain('P0 PRs | 2');
    expect(content).toContain('P1 PRs | 3');
    expect(content).toContain('RCI 覆盖率 | 100%');
  });

  it('幂等：同月不重复追加', () => {
    // 第一次写入已经完成
    const contentBefore = fs.readFileSync(path.join(testDir, 'docs/LEARNINGS.md'), 'utf-8');
    const countBefore = (contentBefore.match(/\[2026-01\] DevGate 月度报告/g) || []).length;

    // 第二次运行
    const output = execSync(
      `node ${SCRIPT} --metrics ${testDir}/devgate-metrics.json --learnings ${testDir}/docs/LEARNINGS.md --contract ${testDir}/regression-contract.yaml`,
      { encoding: 'utf-8' }
    );

    expect(output).toContain('跳过');

    const contentAfter = fs.readFileSync(path.join(testDir, 'docs/LEARNINGS.md'), 'utf-8');
    const countAfter = (contentAfter.match(/\[2026-01\] DevGate 月度报告/g) || []).length;

    expect(countAfter).toBe(countBefore);
  });

  it('--force 强制写入（忽略幂等）', () => {
    const contentBefore = fs.readFileSync(path.join(testDir, 'docs/LEARNINGS.md'), 'utf-8');
    const countBefore = (contentBefore.match(/\[2026-01\] DevGate 月度报告/g) || []).length;

    execSync(
      `node ${SCRIPT} --metrics ${testDir}/devgate-metrics.json --learnings ${testDir}/docs/LEARNINGS.md --contract ${testDir}/regression-contract.yaml --force`,
      { encoding: 'utf-8' }
    );

    const contentAfter = fs.readFileSync(path.join(testDir, 'docs/LEARNINGS.md'), 'utf-8');
    const countAfter = (contentAfter.match(/\[2026-01\] DevGate 月度报告/g) || []).length;

    expect(countAfter).toBe(countBefore + 1);
  });
});

describe('append-learnings.cjs RCI 名称解析', () => {
  const testDir = '/tmp/test-append-learnings-rci';

  beforeAll(() => {
    execSync(`rm -rf ${testDir} && mkdir -p ${testDir}/docs`);

    fs.writeFileSync(
      path.join(testDir, 'docs/LEARNINGS.md'),
      '# LEARNINGS\n'
    );

    fs.writeFileSync(
      path.join(testDir, 'devgate-metrics.json'),
      JSON.stringify({
        window: { since: '2026-02-01', until: '2026-03-01' },
        prs: { p0: 1, p1: 1, total_p0p1: 2, total: 2 },
        rci_coverage: { updated: 2, total: 2, pct: 100, offenders: [] },
        rci_growth: { new_ids_count: 3, new_ids: ['H4-001', 'C7-001', 'X9-999'] },
        dod: { items: 5, manual_tests: 0, p0_manual_tests: 0 },
      })
    );

    fs.writeFileSync(
      path.join(testDir, 'regression-contract.yaml'),
      `version: "1.0.0"

hooks:
  - id: H4-001
    name: "DevGate Metrics 指标计算"
    scope: hook

ci:
  - id: C7-001
    name: "Nightly DevGate Metrics 收集"
    scope: ci
`
    );
  });

  afterAll(() => {
    execSync(`rm -rf ${testDir}`);
  });

  it('RCI 名称正确解析', () => {
    execSync(
      `node ${SCRIPT} --metrics ${testDir}/devgate-metrics.json --learnings ${testDir}/docs/LEARNINGS.md --contract ${testDir}/regression-contract.yaml`,
      { encoding: 'utf-8' }
    );

    const content = fs.readFileSync(path.join(testDir, 'docs/LEARNINGS.md'), 'utf-8');

    expect(content).toContain('H4-001: DevGate Metrics 指标计算');
    expect(content).toContain('C7-001: Nightly DevGate Metrics 收集');
    expect(content).toContain('X9-999: (未知)'); // 不存在的 ID
  });
});

describe('append-learnings.cjs Top Offenders', () => {
  const testDir = '/tmp/test-append-learnings-offenders';

  beforeAll(() => {
    execSync(`rm -rf ${testDir} && mkdir -p ${testDir}/docs`);

    fs.writeFileSync(
      path.join(testDir, 'docs/LEARNINGS.md'),
      '# LEARNINGS\n'
    );

    fs.writeFileSync(
      path.join(testDir, 'devgate-metrics.json'),
      JSON.stringify({
        window: { since: '2026-03-01', until: '2026-04-01' },
        prs: { p0: 2, p1: 1, total_p0p1: 3, total: 3 },
        rci_coverage: {
          updated: 1,
          total: 3,
          pct: 33,
          offenders: [
            { pr: '208', priority: 'P0', sha: 'abc123' },
            { pr: '209', priority: 'P1', sha: 'def456' },
          ],
        },
        rci_growth: { new_ids_count: 0, new_ids: [] },
        dod: { items: 10, manual_tests: 1, p0_manual_tests: 0 },
      })
    );

    fs.writeFileSync(
      path.join(testDir, 'regression-contract.yaml'),
      'version: "1.0.0"\n'
    );
  });

  afterAll(() => {
    execSync(`rm -rf ${testDir}`);
  });

  it('Top Offenders 正确显示', () => {
    execSync(
      `node ${SCRIPT} --metrics ${testDir}/devgate-metrics.json --learnings ${testDir}/docs/LEARNINGS.md --contract ${testDir}/regression-contract.yaml`,
      { encoding: 'utf-8' }
    );

    const content = fs.readFileSync(path.join(testDir, 'docs/LEARNINGS.md'), 'utf-8');

    expect(content).toContain('PR #208 (P0) - 未更新 RCI');
    expect(content).toContain('PR #209 (P1) - 未更新 RCI');
    expect(content).toContain('RCI 覆盖率 | 33%');
  });
});

describe('append-learnings.cjs 错误处理', () => {
  it('指标文件不存在时报错', () => {
    expect(() => {
      execSync(`node ${SCRIPT} --metrics /nonexistent/metrics.json`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }).toThrow();
  });
});
