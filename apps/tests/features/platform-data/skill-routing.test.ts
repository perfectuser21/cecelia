/**
 * Platform Data Feature - Skill 路由测试
 */

import { describe, it, expect } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

const COMMAND_SH = path.join(__dirname, '../../../apps/features/platform-data/skill/command.sh');

describe('Platform Data Feature - Skill 路由', () => {
  describe('command.sh 基本功能', () => {
    it('command.sh 可执行', async () => {
      const { stdout } = await execAsync(`bash ${COMMAND_SH} help`);
      expect(stdout).toContain('Platform Data Management');
    });

    it('无参数时显示帮助', async () => {
      const { stdout } = await execAsync(`bash ${COMMAND_SH}`);
      expect(stdout).toContain('Platform Data Management');
      expect(stdout).toContain('scrape');
      expect(stdout).toContain('analyze');
      expect(stdout).toContain('publish');
    });

    it('--help 显示帮助', async () => {
      const { stdout } = await execAsync(`bash ${COMMAND_SH} --help`);
      expect(stdout).toContain('Platform Data Management');
    });

    it('help 子命令显示帮助', async () => {
      const { stdout } = await execAsync(`bash ${COMMAND_SH} help`);
      expect(stdout).toContain('Platform Data Management');
    });
  });

  describe('子命令路由', () => {
    it('scrape 子命令存在', async () => {
      // scrape 无参数时应该显示用法
      try {
        await execAsync(`bash ${COMMAND_SH} scrape help`);
      } catch (error: any) {
        // 即使失败，也说明路由到了 scrape.sh
        expect(error.stdout || error.stderr).toContain('Usage');
      }
    });

    it('analyze 子命令存在', async () => {
      try {
        await execAsync(`bash ${COMMAND_SH} analyze --help`);
      } catch (error: any) {
        expect(error.stdout || error.stderr).toContain('Usage');
      }
    });

    it('publish 子命令存在', async () => {
      try {
        await execAsync(`bash ${COMMAND_SH} publish --help`);
      } catch (error: any) {
        expect(error.stdout || error.stderr).toContain('Usage');
      }
    });

    it('未知子命令报错', async () => {
      try {
        await execAsync(`bash ${COMMAND_SH} unknown-command`);
        expect.fail('应该抛出错误');
      } catch (error: any) {
        expect(error.stdout || error.stderr).toContain('未知子命令');
      }
    });
  });

  describe('scrape 子命令参数', () => {
    it('scrape help 显示平台列表', async () => {
      const { stdout } = await execAsync(`bash ${COMMAND_SH} scrape help`);
      expect(stdout).toContain('douyin');
      expect(stdout).toContain('kuaishou');
      expect(stdout).toContain('xiaohongshu');
      expect(stdout).toContain('channels');
      expect(stdout).toContain('toutiao');
      expect(stdout).toContain('weibo');
      expect(stdout).toContain('zhihu');
      expect(stdout).toContain('wechat');
    });

    it('scrape 无平台参数显示帮助', async () => {
      const { stdout } = await execAsync(`bash ${COMMAND_SH} scrape`);
      expect(stdout).toContain('Usage');
      expect(stdout).toContain('Platforms');
    });
  });

  describe('analyze 子命令参数', () => {
    it('analyze --help 显示选项', async () => {
      const { stdout } = await execAsync(`bash ${COMMAND_SH} analyze --help`);
      expect(stdout).toContain('Usage');
      expect(stdout).toContain('Options');
    });
  });

  describe('publish 子命令参数', () => {
    it('publish --help 显示选项', async () => {
      const { stdout } = await execAsync(`bash ${COMMAND_SH} publish --help`);
      expect(stdout).toContain('Usage');
      expect(stdout).toContain('Options');
    });
  });
});
