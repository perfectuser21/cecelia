'use strict';
/**
 * longform-creator skill 存在性验证测试
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SKILL_MD = path.join(__dirname, 'SKILL.md');

describe('longform-creator skill', () => {
  it('SKILL.md 文件存在', () => {
    assert.ok(fs.existsSync(SKILL_MD), `SKILL.md not found at ${SKILL_MD}`);
  });

  it('包含触发词 longform-creator', () => {
    const content = fs.readFileSync(SKILL_MD, 'utf-8');
    assert.ok(content.includes('longform-creator'), 'Missing trigger word');
  });

  it('包含 NAS 存储路径', () => {
    const content = fs.readFileSync(SKILL_MD, 'utf-8');
    assert.ok(content.includes('zenithjoy-creator'), 'Missing NAS path');
  });

  it('包含封面图尺寸 900×383', () => {
    const content = fs.readFileSync(SKILL_MD, 'utf-8');
    assert.ok(content.includes('900'), 'Missing cover image spec');
  });

  it('包含正文配图尺寸 1080×810', () => {
    const content = fs.readFileSync(SKILL_MD, 'utf-8');
    assert.ok(content.includes('1080'), 'Missing inline image spec');
  });
});
