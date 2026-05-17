import { describe, it, expect } from 'vitest';
import { preparePromptAndCidfile } from '../spawn-pre.js';

function makeFsMock(existingPaths = new Set()) {
  const writes = [];
  const mkdirs = [];
  const unlinks = [];
  return {
    writes, mkdirs, unlinks,
    fsDeps: {
      writeFileSync: (p, c) => writes.push({ path: p, content: c }),
      mkdirSync: (p) => mkdirs.push(p),
      existsSync: (p) => existingPaths.has(p),
      unlinkSync: (p) => unlinks.push(p),
    },
  };
}

describe('preparePromptAndCidfile()', () => {
  it('writes prompt file + returns paths', () => {
    const m = makeFsMock();
    const r = preparePromptAndCidfile(
      { task: { id: 't1' }, prompt: 'hello' },
      { promptDir: '/tmp/x', fsDeps: m.fsDeps },
    );
    expect(r.promptPath).toBe('/tmp/x/t1.prompt.txt');
    expect(r.cidfilePath).toBe('/tmp/x/t1.cid');
    expect(m.writes).toEqual([{ path: '/tmp/x/t1.prompt.txt', content: 'hello' }]);
  });

  it('creates promptDir when not exists', () => {
    const m = makeFsMock();
    preparePromptAndCidfile({ task: { id: 't2' }, prompt: 'x' }, { promptDir: '/tmp/new', fsDeps: m.fsDeps });
    expect(m.mkdirs).toEqual(['/tmp/new']);
  });

  it('cleans up stale cidfile if exists', () => {
    const m = makeFsMock(new Set(['/tmp/x', '/tmp/x/t3.cid']));
    preparePromptAndCidfile({ task: { id: 't3' }, prompt: 'x' }, { promptDir: '/tmp/x', fsDeps: m.fsDeps });
    expect(m.unlinks).toEqual(['/tmp/x/t3.cid']);
  });

  it('throws when task.id missing', () => {
    expect(() => preparePromptAndCidfile({ task: {}, prompt: 'x' }, {})).toThrow(/task\.id/);
  });

  it('throws when prompt missing', () => {
    expect(() => preparePromptAndCidfile({ task: { id: 't4' } }, {})).toThrow(/prompt/);
  });
});
