import { describe, expect, it } from 'vitest';

import { getContentType } from '../content-type-registry.js';

describe('content-type-registry 路径边界', () => {
  it.each([
    '../package',
    '/etc/passwd',
    'foo/bar',
    '',
  ])('拒绝把内容类型名称解释为文件系统路径：%s', async (typeName) => {
    await expect(getContentType(typeName)).rejects.toThrow('content_type_name_invalid');
  });
});
