import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const RUNNER = path.resolve(__dirname, '../runners/codex/playwright-runner.sh');

describe('playwright-runner.sh', () => {
  describe('文件存在与权限', () => {
    it('runner 文件存在', () => {
      expect(fs.existsSync(RUNNER)).toBe(true);
    });

    it('runner 文件可执行', () => {
      const stat = fs.statSync(RUNNER);
      // 检查 owner 可执行位
      expect(stat.mode & 0o100).toBeTruthy();
    });
  });

  describe('参数校验', () => {
    it('无参数时显示用法并退出非零', () => {
      let threw = false;
      try {
        execSync(`bash ${RUNNER}`, { encoding: 'utf-8', stdio: 'pipe' });
      } catch (e: unknown) {
        threw = true;
        const err = e as { stderr: string; status: number };
        expect(err.status).not.toBe(0);
      }
      expect(threw).toBe(true);
    });
  });

  describe('内容校验', () => {
    it('包含 CDP 端点配置', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      expect(content).toContain('100.97.242.124');
    });

    it('包含 connectOverCDP 引用', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      expect(content).toContain('connectOverCDP');
    });

    it('脚本存储路径为 .cjs 格式', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      expect(content).toContain('.cjs');
    });

    it('包含 task-id 参数处理', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      expect(content).toContain('task-id');
    });

    it('支持 --dry-run 模式', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      expect(content).toContain('dry-run');
    });
  });
});
