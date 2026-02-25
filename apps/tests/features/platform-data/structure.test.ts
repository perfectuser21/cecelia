/**
 * Platform Data Feature - 目录结构验证测试
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const FEATURE_ROOT = path.join(__dirname, '../../../apps/features/platform-data');

describe('Platform Data Feature - 目录结构', () => {
  it('Feature 根目录存在', () => {
    expect(fs.existsSync(FEATURE_ROOT)).toBe(true);
  });

  it('Feature README.md 存在', () => {
    const readme = path.join(FEATURE_ROOT, 'README.md');
    expect(fs.existsSync(readme)).toBe(true);
  });

  describe('skill/ 目录', () => {
    it('skill/ 目录存在', () => {
      const skillDir = path.join(FEATURE_ROOT, 'skill');
      expect(fs.existsSync(skillDir)).toBe(true);
    });

    it('SKILL.md 存在', () => {
      const skillMd = path.join(FEATURE_ROOT, 'skill/SKILL.md');
      expect(fs.existsSync(skillMd)).toBe(true);
    });

    it('command.sh 存在且可执行', () => {
      const commandSh = path.join(FEATURE_ROOT, 'skill/command.sh');
      expect(fs.existsSync(commandSh)).toBe(true);

      const stats = fs.statSync(commandSh);
      // 检查是否有执行权限 (owner)
      expect((stats.mode & 0o100) !== 0).toBe(true);
    });

    it('subcommands/ 目录存在', () => {
      const subcommandsDir = path.join(FEATURE_ROOT, 'skill/subcommands');
      expect(fs.existsSync(subcommandsDir)).toBe(true);
    });

    it('scrape.sh 存在', () => {
      const scrapeSh = path.join(FEATURE_ROOT, 'skill/subcommands/scrape.sh');
      expect(fs.existsSync(scrapeSh)).toBe(true);
    });

    it('analyze.sh 存在', () => {
      const analyzeSh = path.join(FEATURE_ROOT, 'skill/subcommands/analyze.sh');
      expect(fs.existsSync(analyzeSh)).toBe(true);
    });

    it('publish.sh 存在', () => {
      const publishSh = path.join(FEATURE_ROOT, 'skill/subcommands/publish.sh');
      expect(fs.existsSync(publishSh)).toBe(true);
    });
  });

  describe('workflows/ 目录', () => {
    it('workflows/ 目录存在', () => {
      const workflowsDir = path.join(FEATURE_ROOT, 'workflows');
      expect(fs.existsSync(workflowsDir)).toBe(true);
    });

    describe('scraper workflow', () => {
      const scraperDir = path.join(FEATURE_ROOT, 'workflows/scraper');

      it('scraper/ 目录存在', () => {
        expect(fs.existsSync(scraperDir)).toBe(true);
      });

      it('scraper/README.md 存在', () => {
        const readme = path.join(scraperDir, 'README.md');
        expect(fs.existsSync(readme)).toBe(true);
      });

      it('scraper/scripts/ 目录存在', () => {
        const scriptsDir = path.join(scraperDir, 'scripts');
        expect(fs.existsSync(scriptsDir)).toBe(true);
      });

      const platforms = ['douyin', 'kuaishou', 'xiaohongshu', 'channels', 'toutiao', 'weibo', 'zhihu', 'wechat'];

      platforms.forEach(platform => {
        it(`scraper-${platform} 脚本存在`, () => {
          const scripts = fs.readdirSync(path.join(scraperDir, 'scripts'));
          const hasScript = scripts.some(file => file.startsWith(`scraper-${platform}`));
          expect(hasScript).toBe(true);
        });
      });
    });

    describe('analyzer workflow', () => {
      const analyzerDir = path.join(FEATURE_ROOT, 'workflows/analyzer');

      it('analyzer/ 目录存在', () => {
        expect(fs.existsSync(analyzerDir)).toBe(true);
      });

      it('analyzer/README.md 存在', () => {
        const readme = path.join(analyzerDir, 'README.md');
        expect(fs.existsSync(readme)).toBe(true);
      });

      it('analyzer/scripts/ 目录存在', () => {
        const scriptsDir = path.join(analyzerDir, 'scripts');
        expect(fs.existsSync(scriptsDir)).toBe(true);
      });
    });

    describe('publisher workflow', () => {
      const publisherDir = path.join(FEATURE_ROOT, 'workflows/publisher');

      it('publisher/ 目录存在', () => {
        expect(fs.existsSync(publisherDir)).toBe(true);
      });

      it('publisher/README.md 存在', () => {
        const readme = path.join(publisherDir, 'README.md');
        expect(fs.existsSync(readme)).toBe(true);
      });

      it('publisher/scripts/ 目录存在', () => {
        const scriptsDir = path.join(publisherDir, 'scripts');
        expect(fs.existsSync(scriptsDir)).toBe(true);
      });
    });
  });

  describe('shared/ 目录', () => {
    it('shared/ 目录存在', () => {
      const sharedDir = path.join(FEATURE_ROOT, 'shared');
      expect(fs.existsSync(sharedDir)).toBe(true);
    });

    it('shared/types/ 目录存在', () => {
      const typesDir = path.join(FEATURE_ROOT, 'shared/types');
      expect(fs.existsSync(typesDir)).toBe(true);
    });

    it('shared/utils/ 目录存在', () => {
      const utilsDir = path.join(FEATURE_ROOT, 'shared/utils');
      expect(fs.existsSync(utilsDir)).toBe(true);
    });

    it('shared/config/ 目录存在', () => {
      const configDir = path.join(FEATURE_ROOT, 'shared/config');
      expect(fs.existsSync(configDir)).toBe(true);
    });
  });
});
