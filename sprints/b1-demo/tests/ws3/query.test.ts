import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const QUERY_PATH = resolve(process.cwd(), 'sprints/b1-demo/query.md');

function readQuery(): string {
  return readFileSync(QUERY_PATH, 'utf8');
}

function extractBashBlocks(content: string): string[] {
  const re = /```bash\s*\n([\s\S]*?)\n```/g;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) blocks.push(m[1]);
  return blocks;
}

function extractSection(content: string, heading: string): string | null {
  const re = new RegExp('^##\\s+' + heading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\s*$', 'm');
  const idx = content.search(re);
  if (idx < 0) return null;
  const tail = content.slice(idx);
  const nextHeading = tail.slice(1).search(/^##\s+/m);
  return nextHeading >= 0 ? tail.slice(0, nextHeading + 1) : tail;
}

describe('Workstream 3 — query.md [BEHAVIOR]', () => {
  it('contains at least one bash code block', () => {
    const content = readQuery();
    const blocks = extractBashBlocks(content);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
  });

  it('references b1-demo inside a bash example', () => {
    const content = readQuery();
    const blocks = extractBashBlocks(content);
    const withModuleRef = blocks.filter(b => b.includes('b1-demo'));
    expect(withModuleRef.length).toBeGreaterThanOrEqual(1);
  });

  it('declares ## Query and ## Expected Output sections', () => {
    const content = readQuery();
    expect(extractSection(content, 'Query')).not.toBeNull();
    expect(extractSection(content, 'Expected Output')).not.toBeNull();
  });

  it('provides non-empty Expected Output sample', () => {
    const content = readQuery();
    const section = extractSection(content, 'Expected Output');
    expect(section).not.toBeNull();
    const re = /```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n```/;
    const sampleMatch = section!.match(re);
    expect(sampleMatch).not.toBeNull();
    expect(sampleMatch![1].trim().length).toBeGreaterThan(0);
  });
});
