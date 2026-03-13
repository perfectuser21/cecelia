import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const RUNNER = path.resolve(__dirname, '../runners/codex/runner.sh');

describe('runner.sh v2.0.0', () => {
  describe('参数校验', () => {
    it('无参数时显示用法并退出非零', () => {
      let threw = false;
      try {
        execSync(`bash ${RUNNER}`, { encoding: 'utf-8', stdio: 'pipe' });
      } catch (e: unknown) {
        threw = true;
        const err = e as { stderr: string; status: number };
        expect(err.stderr).toContain('用法');
        expect(err.status).not.toBe(0);
      }
      expect(threw).toBe(true);
    });

    it('未知参数时退出非零', () => {
      let threw = false;
      try {
        execSync(`bash ${RUNNER} --unknown-arg foo`, { encoding: 'utf-8', stdio: 'pipe' });
      } catch (e: unknown) {
        threw = true;
        const err = e as { status: number };
        expect(err.status).not.toBe(0);
      }
      expect(threw).toBe(true);
    });
  });

  describe('dry-run 模式', () => {
    it('--dry-run 打印完整工作流 prompt 并退出', () => {
      // 使用不存在的分支和假 task-id 进行 dry-run 测试
      // dry-run 不调用 codex-bin，也不查询 GitHub，但会调用 devloop_check
      // 由于 gh 命令可能返回空，devloop_check 会返回 blocked（PR 未创建）
      // 所以 dry-run 会打印 prompt 并退出（而不是无限循环）
      const result = execSync(
        `bash ${RUNNER} --branch cp-test-dry-run-$(date +%s) --task-id test-123 --dry-run`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );
      expect(result).toContain('Codex Runner v2.0.0');
      expect(result).toContain('DRY-RUN');
    });

    it('dry-run 输出包含 CODEX_HOME', () => {
      const result = execSync(
        `CODEX_HOME=/tmp/test-codex bash ${RUNNER} --branch cp-test-dry-$(date +%s) --dry-run`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );
      expect(result).toContain('CODEX_HOME: /tmp/test-codex');
    });
  });

  describe('兼容性修复验证', () => {
    it('不包含 --cwd 参数（已修复）', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      // runner.sh 不应该向 codex-bin 传递 --cwd 参数
      // 注释中可能提到 --cwd，但实际 exec 调用中不应该有
      const execLines = content
        .split('\n')
        .filter(line => line.includes('codex-bin') && line.includes('exec') && !line.startsWith('#'));
      for (const line of execLines) {
        expect(line).not.toContain('--cwd');
      }
    });

    it('使用 danger-full-access 而非 full-access', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      expect(content).toContain('danger-full-access');
      // 确保没有错误的 full-access 值（standalone，不带 danger- 前缀）
      const hasBadSandbox = content
        .split('\n')
        .some(line => !line.startsWith('#') && /--sandbox\s+full-access/.test(line));
      expect(hasBadSandbox).toBe(false);
    });

    it('支持 CODEX_HOME 环境变量', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      expect(content).toContain('CODEX_HOME');
      expect(content).toContain('export CODEX_HOME');
    });
  });

  describe('prompt 构建策略', () => {
    it('包含 build_comprehensive_prompt 函数', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      expect(content).toContain('build_comprehensive_prompt');
    });

    it('包含 build_resume_prompt 函数（恢复 prompt）', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      expect(content).toContain('build_resume_prompt');
    });

    it('第一轮使用 comprehensive prompt，后续使用 resume prompt', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      expect(content).toContain('RETRY_COUNT -eq 1');
      expect(content).toContain('build_comprehensive_prompt');
      expect(content).toContain('build_resume_prompt');
    });
  });

  describe('版本号', () => {
    it('版本号为 v2.0.0', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      expect(content).toContain('v2.0.0');
    });
  });
});
