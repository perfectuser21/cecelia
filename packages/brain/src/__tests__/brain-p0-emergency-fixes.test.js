/**
 * P0 救急修复回归测试
 *
 * 保留启动输入和端口恢复的通用保护：
 *  1. cecelia-run.sh setsid 重定向 stdin 到 /dev/null（Bridge 0 字节根因）
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

  describe('Fix 4: server.js 启动端口健康等待（升级版，替代旧的 lsof + kill -9）', () => {
    // 原 P0 fix 用 execSync('lsof -ti … | xargs kill -9') 粗暴杀端口占用者，
    // 但 kill 后 socket 未释放（TCP_TIME_WAIT）立刻 listen 仍会撞 EADDRINUSE。
    // 升级为 startup-port-guard：waitForPortFree + listenWithRetry。
    // 详见 cp-04211122-brain-startup-hardening。
    const serverSrc = readFileSync(
      join(BRAIN_ROOT, 'server.js'),
      'utf8'
    );

    it('必须 import startup-port-guard 模块', () => {
      expect(serverSrc).toMatch(
        /from\s*['"]\.\/src\/startup-port-guard\.js['"]/
      );
      expect(serverSrc).toMatch(/waitForPortFree/);
      expect(serverSrc).toMatch(/listenWithRetry/);
    });

    it('必须在 listen 之前调用 waitForPortFree（launchd-restart race 保护）', () => {
      const listenIdx = serverSrc.indexOf('listenWithRetry(server');
      expect(listenIdx, '未找到 listenWithRetry(server 调用').toBeGreaterThan(-1);
      const before = serverSrc.slice(0, listenIdx);
      expect(before).toMatch(/await\s+waitForPortFree\(/);
    });

    it('不应再依赖 lsof + kill -9（已被更稳的 guard 替代）', () => {
      // 反向守护：如果有人回退到 kill -9 大招就失败
      expect(serverSrc).not.toMatch(/lsof -ti :\$\{PORT\}/);
      expect(serverSrc).not.toMatch(/xargs kill -9/);
    });
  });
});
