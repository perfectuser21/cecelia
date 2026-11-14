import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { validatePrd, prdToJson, trdToJson } from '../templates.js';

describe('文档解析边界', () => {
  it('一级标题只读取同一行，不能吞掉下一节标题', () => {
    expect(prdToJson('#\n## 背景\n内容').title).toBe('');
    expect(trdToJson('#\r\n## 技术背景\r\n内容').title).toBe('');
  });

  it('保留正常中英文标题、CRLF及成功标准后续章节边界', () => {
    expect(prdToJson('#\tPRD - 登录\r\n## 背景\r\n内容').title).toBe('登录');
    expect(trdToJson('# TRD - Authentication\n').title).toBe('Authentication');
    const result = validatePrd('## 需求来源\n用户\n## 功能描述\n' + '登录功能描述'.repeat(12)
      + '\n## 成功标准\n- 返回成功结果\n## 涉及文件\n- 不应当作验收条目');
    expect(result.valid).toBe(true);
    expect(result.warnings.some(warning => warning.includes('不应当作验收条目'))).toBe(false);
  });

  it('文件末尾的成功标准仍进行真实质量校验', () => {
    const result = validatePrd('## 需求来源\n用户\n## 功能描述\n' + '登录功能描述'.repeat(12)
      + '\n## 成功标准\n- 无动作条目');
    expect(result.warnings).toContain('Acceptance criterion lacks action verb: "- 无动作条目"');
  });

  it('重复未闭合的成功标准在有界子进程内完成解析', () => {
    const moduleUrl = new URL('../templates.js', import.meta.url).href;
    const program = `import {validatePrd} from ${JSON.stringify(moduleUrl)};
      import {readFileSync} from 'node:fs';
      const result = validatePrd(readFileSync(0, 'utf8'));
      process.stdout.write(JSON.stringify({valid: result.valid, errors: result.errors}));`;
    const content = '## 需求来源\n用户\n## 功能描述\n说明\n' + '## 成功标准'.repeat(40_000);
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
      input: content, encoding: 'utf8', timeout: 3_000, maxBuffer: 1024 * 1024,
    });
    expect(child.error?.code).not.toBe('ETIMEDOUT');
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ valid: true, errors: [] });
  });
});
