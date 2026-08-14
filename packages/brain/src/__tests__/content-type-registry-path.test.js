import { describe, expect, it } from 'vitest';

import { getContentType } from '../content-types/content-type-registry.js';

describe('content type registry path boundary', () => {
  it('拒绝把内容类型名称解释为文件系统路径', async () => {
    await expect(getContentType('../package')).rejects.toThrow('content_type_name_invalid');
  });
});
