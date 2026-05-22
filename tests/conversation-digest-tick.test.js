/**
 * BEHAVIOR test: tick.js 集成 conversation-digest
 * 验证 tick.js 正确引用了 conversation-digest.js 并调用 runConversationDigest
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TICK_PATH = path.resolve(__dirname, '../packages/brain/src/tick.js');
const DIGEST_PATH = path.resolve(__dirname, '../packages/brain/src/conversation-digest.js');

describe('conversation-digest tick integration', () => {
  it('tick.js 引用了 conversation-digest.js', () => {
    const content = fs.readFileSync(TICK_PATH, 'utf8');
    expect(content).toContain('conversation-digest');
  });

  it('tick.js 调用了 runConversationDigest', () => {
    const content = fs.readFileSync(TICK_PATH, 'utf8');
    expect(content).toContain('runConversationDigest');
  });

  it('conversation-digest.js 导出 scanLogDirectory', () => {
    const content = fs.readFileSync(DIGEST_PATH, 'utf8');
    expect(content).toContain('export async function scanLogDirectory');
  });

  it('conversation-digest.js 导出 analyzeWithCortex', () => {
    const content = fs.readFileSync(DIGEST_PATH, 'utf8');
    expect(content).toContain('export async function analyzeWithCortex');
  });

  it('conversation-digest.js 导出 persistDigest', () => {
    const content = fs.readFileSync(DIGEST_PATH, 'utf8');
    expect(content).toContain('export async function persistDigest');
  });
});
