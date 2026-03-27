import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../../../..');

describe('DocChatPage', () => {
  it('has doc-chat route reference', () => {
    const content = readFileSync(
      join(ROOT, 'apps/api/features/knowledge/pages/DocChatPage.tsx'),
      'utf8'
    );
    expect(content).toContain('doc-chat');
  });

  it('has model selector with haiku/sonnet/opus', () => {
    const content = readFileSync(
      join(ROOT, 'apps/api/features/knowledge/pages/DocChatPage.tsx'),
      'utf8'
    );
    expect(content).toContain('haiku');
    expect(content).toContain('sonnet');
    expect(content).toContain('opus');
  });

  it('knowledge index registers doc-chat route', () => {
    const content = readFileSync(
      join(ROOT, 'apps/api/features/knowledge/index.ts'),
      'utf8'
    );
    expect(content).toContain('/knowledge/doc-chat/:id');
    expect(content).toContain('DocChatPage');
  });

  it('design-docs backend has /chat endpoint', () => {
    const content = readFileSync(
      join(ROOT, 'packages/brain/src/routes/design-docs.js'),
      'utf8'
    );
    expect(content).toContain("'/:id/chat'");
    expect(content).toContain('callLLM');
  });
});
