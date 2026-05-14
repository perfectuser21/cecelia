import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

const B38_TEST_FILE = 'packages/brain/src/workflows/__tests__/harness-initiative-b38.test.js';

describe('WS1 Contract — harness-initiative-b38.test.js @langchain/langgraph mock [BEHAVIOR]', () => {
  it('harness-initiative-b38.test.js 顶部含 vi.mock(@langchain/langgraph) 块', () => {
    const content = readFileSync(B38_TEST_FILE, 'utf8');
    expect(content).toContain("vi.mock('@langchain/langgraph'");
  });

  it('mock 块包含 StateGraph 导出', () => {
    const content = readFileSync(B38_TEST_FILE, 'utf8');
    const mockBlock = content.slice(
      content.indexOf("vi.mock('@langchain/langgraph'"),
      content.indexOf("vi.mock('@langchain/langgraph'") + 400
    );
    expect(mockBlock).toContain('StateGraph');
  });

  it('mock 块包含 Annotation 导出', () => {
    const content = readFileSync(B38_TEST_FILE, 'utf8');
    const mockBlock = content.slice(
      content.indexOf("vi.mock('@langchain/langgraph'"),
      content.indexOf("vi.mock('@langchain/langgraph'") + 400
    );
    expect(mockBlock).toContain('Annotation');
  });
});
