/**
 * P0 救急修复回归测试
 *
 * 覆盖 4 个救急修复：
 *  1. cecelia-run.sh setsid 重定向 stdin 到 /dev/null（Bridge 0 字节根因）
 *  2. task-router SKILL_WHITELIST 包含 harness_evaluate
 *  3. pre-flight-check SYSTEM_TASK_TYPES 包含 harness_evaluate
 *  4. server.js 启动前端口冲突清理（EADDRINUSE）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_ROOT = join(__dirname, '..', '..');

describe('Brain P0 救急修复', () => {
  describe('Fix 1: cecelia-run.sh setsid stdin 重定向', () => {
    const runScript = readFileSync(
      join(BRAIN_ROOT, 'scripts', 'cecelia-run.sh'),
      'utf8'
    );

    it('plan 模式 setsid 调用必须把 stdin 重定向到 /dev/null', () => {
      // 匹配 plan 模式那一行：含 --permission-mode plan + </dev/null + &
      const planLineMatch = runScript.match(
        /setsid bash -c[^\n]*--permission-mode plan[^\n]*<\/dev\/null \&/
      );
      expect(planLineMatch, 'plan 模式必须 </dev/null & 结尾').not.toBeNull();
    });

    it('dangerously-skip-permissions 模式 setsid 调用必须把 stdin 重定向到 /dev/null', () => {
      const dangerLineMatch = runScript.match(
        /setsid bash -c[^\n]*--dangerously-skip-permissions[^\n]*<\/dev\/null \&/
      );
      expect(dangerLineMatch, 'skip-permissions 模式必须 </dev/null & 结尾').not.toBeNull();
    });

    it('不应再有未重定向 stdin 的 setsid bash -c "..." & 形态', () => {
      // 反向检查：所有 setsid bash -c 行都必须以 </dev/null & 结尾
      const allSetsidLines = runScript.split('\n').filter(line =>
        /setsid bash -c "/.test(line) && line.trim().endsWith('&')
      );
      for (const line of allSetsidLines) {
        expect(line, `行未重定向 stdin: ${line.trim().slice(0, 120)}`).toMatch(/<\/dev\/null \&$/);
      }
    });
  });

  describe('Fix 2: task-router SKILL_WHITELIST 含 harness_evaluate', () => {
    it("SKILL_WHITELIST['harness_evaluate'] === '/harness-evaluator'", async () => {
      const mod = await import('../task-router.js');
      expect(mod.SKILL_WHITELIST).toBeDefined();
      expect(mod.SKILL_WHITELIST['harness_evaluate']).toBe('/harness-evaluator');
    });
  });

  describe('Fix 3: pre-flight-check SYSTEM_TASK_TYPES 含 harness_evaluate', () => {
    it('harness_evaluate 任务无 description 时 pre-flight 应通过', async () => {
      const { preFlightCheck } = await import('../pre-flight-check.js');
      const task = {
        id: 'p0-fix-test',
        title: 'harness evaluate sample',
        task_type: 'harness_evaluate',
        // 故意不给 description / prd_content / payload
        priority: 'P1',
      };
      const result = await preFlightCheck(task);
      expect(result.passed, `pre-flight 必须通过, issues=${JSON.stringify(result.issues)}`).toBe(true);
    });
  });

  describe('Fix 4: server.js 启动前端口冲突清理', () => {
    const serverSrc = readFileSync(
      join(BRAIN_ROOT, 'server.js'),
      'utf8'
    );

    it('必须 import execSync', () => {
      expect(serverSrc).toMatch(/import\s*\{[^}]*execSync[^}]*\}\s*from\s*['"]child_process['"]/);
    });

    it('必须在 server.listen 之前用 lsof + kill 清理端口', () => {
      // 找 listen 之前是否含 lsof -ti 调用
      const listenIdx = serverSrc.indexOf('server.listen(PORT');
      expect(listenIdx).toBeGreaterThan(-1);
      const before = serverSrc.slice(0, listenIdx);
      expect(before).toMatch(/lsof -ti :\$\{PORT\}/);
      expect(before).toMatch(/xargs kill -9/);
    });
  });
});
