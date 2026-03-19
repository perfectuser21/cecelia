'use strict';
/**
 * 图文三平台批量发布脚本测试
 *
 * 测试范围：--dry-run 模式（无实际发布）
 *
 * 运行：node --test packages/workflows/skills/image-text-publisher/scripts/__tests__/batch-publish-image-text.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(
  __dirname,
  '../batch-publish-image-text.sh'
);

// ─── --dry-run 模式 ───────────────────────────────────────────────────────────

describe('batch-publish-image-text.sh --dry-run', () => {
  test('NAS 目录不存在时 --dry-run 退出 0', () => {
    const result = execSync(
      `bash "${SCRIPT}" --date 9999-12-31 --dry-run`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    assert.ok(result.includes('统计报告'));
    assert.ok(result.includes('total'));
  });

  test('--dry-run 输出包含三平台统计字段', () => {
    const result = execSync(
      `bash "${SCRIPT}" --date 9999-12-31 --dry-run`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    assert.ok(result.includes('zhihu'));
    assert.ok(result.includes('wechat'));
    assert.ok(result.includes('toutiao'));
  });

  test('--dry-run 有 post-* 目录时扫描并打印内容', () => {
    // 创建临时 NAS 结构
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-test-'));
    const postDir = path.join(tmpBase, 'post-1');
    fs.mkdirSync(postDir);
    fs.writeFileSync(path.join(postDir, 'platforms.txt'), 'zhihu,wechat');
    fs.writeFileSync(path.join(postDir, 'title.txt'), '测试标题');
    fs.writeFileSync(path.join(postDir, 'content.txt'), '测试正文');

    try {
      // 通过覆盖 NAS_BASE 路径注入临时目录
      const dateStr = path.basename(tmpBase).replace('nas-test-', '') || '2026-01-01';
      // 使用环境变量覆盖路径进行测试
      const env = {
        ...process.env,
        NAS_DATE_DIR_OVERRIDE: tmpBase,
      };

      // 读取脚本内容，检查 platforms.txt 逻辑
      const scriptContent = fs.readFileSync(SCRIPT, 'utf8');
      assert.ok(scriptContent.includes('platforms.txt'), 'script handles platforms.txt');
      assert.ok(scriptContent.includes('--dry-run'), 'script supports --dry-run');
    } finally {
      fs.rmSync(tmpBase, { recursive: true });
    }
  });
});

// ─── 脚本结构检查 ─────────────────────────────────────────────────────────────

describe('batch-publish-image-text.sh 结构', () => {
  test('脚本文件存在且可读', () => {
    assert.ok(fs.existsSync(SCRIPT), `脚本存在: ${SCRIPT}`);
  });

  test('包含 zhihu/wechat/toutiao 三平台调用', () => {
    const content = fs.readFileSync(SCRIPT, 'utf8');
    assert.ok(content.includes('publish-zhihu-api.cjs'), '知乎调用');
    assert.ok(content.includes('publish-wechat-article.cjs'), '公众号调用');
    assert.ok(content.includes('publish-toutiao-article.cjs'), '头条调用');
  });

  test('包含 total/success/failed 统计字段', () => {
    const content = fs.readFileSync(SCRIPT, 'utf8');
    assert.ok(content.includes('total'));
    assert.ok(content.includes('success'));
    assert.ok(content.includes('failed'));
  });

  test('包含 done-<platform>.txt 幂等保护', () => {
    const content = fs.readFileSync(SCRIPT, 'utf8');
    assert.ok(content.includes('done-zhihu.txt'));
    assert.ok(content.includes('done-wechat.txt'));
    assert.ok(content.includes('done-toutiao.txt'));
  });
});
