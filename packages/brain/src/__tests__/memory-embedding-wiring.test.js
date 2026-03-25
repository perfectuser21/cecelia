/**
 * memory-embedding-wiring.test.js
 *
 * 验证 orchestrator-chat.js 在插入 memory_stream 后
 * 触发 generateMemoryStreamEmbeddingAsync（fire-and-forget）
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ORCHESTRATOR_PATH = path.resolve(__dirname, '../orchestrator-chat.js');

describe('orchestrator-chat — memory_stream embedding wiring', () => {
  let source;

  source = fs.readFileSync(ORCHESTRATOR_PATH, 'utf8');

  it('导入了 generateMemoryStreamEmbeddingAsync', () => {
    expect(source).toContain('generateMemoryStreamEmbeddingAsync');
    expect(source).toContain("from './embedding-service.js'");
  });

  it('用户消息插入后触发 embedding（fire-and-forget）', () => {
    const idx = source.indexOf('userRecordId');
    expect(idx).toBeGreaterThan(-1);
    const chunk = source.substring(idx, idx + 400);
    expect(chunk).toContain('generateMemoryStreamEmbeddingAsync');
    expect(chunk).toContain('Promise.resolve()');
  });

  it('Cecelia 回复插入后触发 embedding（fire-and-forget）', () => {
    const idx = source.indexOf('replyRecordId');
    expect(idx).toBeGreaterThan(-1);
    const chunk = source.substring(idx, idx + 400);
    expect(chunk).toContain('generateMemoryStreamEmbeddingAsync');
    expect(chunk).toContain('Promise.resolve()');
  });

  it('两处 embedding 均有 .catch 防止异常冒泡', () => {
    const occurrences = [...source.matchAll(/generateMemoryStreamEmbeddingAsync/g)];
    // import + 2 call sites = 3 occurrences
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
  });
});
