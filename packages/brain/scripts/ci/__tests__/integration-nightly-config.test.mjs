/**
 * integration-nightly-config.test.mjs
 * TDD 守卫：刀B integration-nightly 配置完整性
 *
 * 守 4 类不变量：
 *   1. 脚本存在且含 FIRE_TEST 支持 + 7 关键路由/回调断言
 *   2. workflow YAML 存在且含正确调度时间（UTC 20:30）
 *   3. workflow 含 fire_test workflow_dispatch input
 *   4. workflow 含 integration job + Issue 开/关 job
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, accessSync, constants } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
// __tests__ → ci → scripts → brain → packages → repo root
const ROOT = join(__dir, '..', '..', '..', '..', '..');

const readFile = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const SCRIPT_PATH = 'packages/brain/scripts/integration/integration-nightly.sh';
const WORKFLOW_PATH = '.github/workflows/integration-nightly.yml';

describe('刀B integration-nightly 配置守卫', () => {
  describe('不变量1: integration-nightly.sh 脚本', () => {
    it('脚本文件存在', () => {
      expect(() => readFile(SCRIPT_PATH)).not.toThrow();
    });

    it('脚本包含 FIRE_TEST 故意失败逻辑', () => {
      const sh = readFile(SCRIPT_PATH);
      expect(sh).toMatch(/FIRE_TEST/);
      expect(sh).toMatch(/exit 1/);
    });

    it('脚本测试 Brain 健康检查（tick/status）', () => {
      const sh = readFile(SCRIPT_PATH);
      expect(sh).toMatch(/tick\/status/);
    });

    it('脚本测试关键路由 POST /tasks', () => {
      const sh = readFile(SCRIPT_PATH);
      expect(sh).toMatch(/POST.*\$\{API\}\/tasks|\/tasks.*POST/s);
      expect(sh).toMatch(/task_type/);
    });

    it('脚本测试路由端点 POST /route-task', () => {
      const sh = readFile(SCRIPT_PATH);
      expect(sh).toMatch(/route-task/);
    });

    it('脚本测试回调贯通 PATCH /tasks/:id', () => {
      const sh = readFile(SCRIPT_PATH);
      expect(sh).toMatch(/PATCH/);
      expect(sh).toMatch(/status.*completed|completed.*status/);
    });

    it('脚本测试 executor_kind 字段存在性（migration 329）', () => {
      const sh = readFile(SCRIPT_PATH);
      expect(sh).toMatch(/executor_kind/);
    });

    it('脚本汇总 PASS/FAIL 并在 FAIL>0 时 exit 1', () => {
      const sh = readFile(SCRIPT_PATH);
      expect(sh).toMatch(/PASS.*FAIL|FAIL.*PASS/);
      expect(sh).toMatch(/\$FAIL.*-gt.*0|FAIL.*0.*exit 1/s);
    });
  });

  describe('不变量2: integration-nightly.yml workflow 调度', () => {
    it('workflow 文件存在', () => {
      expect(() => readFile(WORKFLOW_PATH)).not.toThrow();
    });

    it('workflow 含 schedule 定义', () => {
      const yml = readFile(WORKFLOW_PATH);
      expect(yml).toMatch(/schedule:/);
      expect(yml).toMatch(/cron:/);
    });

    it('workflow 调度时间为 UTC 20:30（北京 04:30，等 刀A 完成）', () => {
      const yml = readFile(WORKFLOW_PATH);
      // cron: '30 20 * * *'
      expect(yml).toMatch(/30\s+20\s+\*/);
    });

    it('workflow 含 workflow_dispatch', () => {
      const yml = readFile(WORKFLOW_PATH);
      expect(yml).toMatch(/workflow_dispatch/);
    });
  });

  describe('不变量3: workflow fire_test input', () => {
    it('workflow_dispatch 含 fire_test input', () => {
      const yml = readFile(WORKFLOW_PATH);
      expect(yml).toMatch(/fire_test/);
    });

    it('workflow 将 fire_test 传给脚本（FIRE_TEST env）', () => {
      const yml = readFile(WORKFLOW_PATH);
      expect(yml).toMatch(/FIRE_TEST/);
    });
  });

  describe('不变量4: workflow jobs 结构', () => {
    it('workflow 含 integration job（Brain + Postgres）', () => {
      const yml = readFile(WORKFLOW_PATH);
      expect(yml).toMatch(/integration:/);
      expect(yml).toMatch(/postgres/);
    });

    it('workflow 含 postgres pgvector 服务', () => {
      const yml = readFile(WORKFLOW_PATH);
      expect(yml).toMatch(/pgvector/);
    });

    it('workflow integration job 运行 integration-nightly.sh', () => {
      const yml = readFile(WORKFLOW_PATH);
      expect(yml).toMatch(/integration-nightly\.sh/);
    });

    it('workflow 失败时开 [integration-red] Issue', () => {
      const yml = readFile(WORKFLOW_PATH);
      expect(yml).toMatch(/integration-red/);
      expect(yml).toMatch(/gh issue create/);
    });

    it('workflow 成功时关 [integration-red] Issue', () => {
      const yml = readFile(WORKFLOW_PATH);
      expect(yml).toMatch(/gh issue close/);
    });

    it('workflow 含 issues: write 权限', () => {
      const yml = readFile(WORKFLOW_PATH);
      expect(yml).toMatch(/issues:\s*write/);
    });

    it('workflow 失败时不取消并发（cancel-in-progress: false）', () => {
      const yml = readFile(WORKFLOW_PATH);
      expect(yml).toMatch(/cancel-in-progress:\s*false/);
    });
  });
});
