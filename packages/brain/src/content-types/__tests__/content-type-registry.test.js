import { describe, expect, it } from 'vitest';

import {
  getContentType,
  getContentTypeFromYaml,
} from '../content-type-registry.js';

describe('content-type-registry 路径边界', () => {
  it.each([
    '../package',
    '/etc/passwd',
    'foo/bar',
    '',
  ])('拒绝把内容类型名称解释为文件系统路径：%s', async (typeName) => {
    await expect(getContentType(typeName)).rejects.toThrow('content_type_name_invalid');
  });

  it.each([
    '../package',
    '/etc/passwd',
    'foo/bar',
    '',
  ])('YAML 读取边界直接拒绝路径输入：%s', (typeName) => {
    expect(() => getContentTypeFromYaml(typeName)).toThrow('content_type_name_invalid');
  });
});
