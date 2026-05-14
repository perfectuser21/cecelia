import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

const TEST_FILES = ['b35', 'b36', 'b37'] as const;

describe('WS2 Contract — b35/b36/b37 同步添加 @langchain/langgraph mock [BEHAVIOR]', () => {
  for (const suffix of TEST_FILES) {
    const path = `packages/brain/src/workflows/__tests__/harness-initiative-${suffix}.test.js`;

    it(`harness-initiative-${suffix}.test.js 含 vi.mock('@langchain/langgraph') 块`, () => {
      const content = readFileSync(path, 'utf8');
      expect(content).toContain("vi.mock('@langchain/langgraph'");
    });
  }
});
