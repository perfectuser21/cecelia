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

describe('DocChatPage v2 — persistent history + analyze', () => {
  const getPage = () =>
    readFileSync(join(ROOT, 'apps/api/features/knowledge/pages/DocChatPage.tsx'), 'utf8');
  const getBrain = () =>
    readFileSync(join(ROOT, 'packages/brain/src/routes/design-docs.js'), 'utf8');

  it('DocChatPage has FileSelector component', () => {
    expect(getPage()).toContain('FileSelector');
  });

  it('DocChatPage saves chat_history to Brain', () => {
    expect(getPage()).toContain('chat_history');
  });

  it('DocChatPage has Analyze button calling /analyze', () => {
    const content = getPage();
    expect(content).toContain('Analyze');
    expect(content).toContain('analyze');
  });

  it('DocChatPage chat messages rendered as plain text (no dangerouslySetInnerHTML in chat section)', () => {
    const content = getPage();
    const chatIdx = content.indexOf('消息列表');
    const chatSection = content.slice(chatIdx, chatIdx + 500);
    expect(chatSection).not.toContain('dangerouslySetInnerHTML');
  });

  it('Brain design-docs has /analyze endpoint', () => {
    expect(getBrain()).toContain("'/:id/analyze'");
    expect(getBrain()).toContain('analyze_watermark');
  });

  it('migration 202 adds chat_history column', () => {
    const migration = readFileSync(
      join(ROOT, 'packages/brain/migrations/202_design_docs_chat_history.sql'),
      'utf8'
    );
    expect(migration).toContain('chat_history');
    expect(migration).toContain('analyze_watermark');
  });
});
