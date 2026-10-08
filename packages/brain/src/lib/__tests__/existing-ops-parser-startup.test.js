import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

// Real isolated module resolution: production YAML exists, Acorn is absent.
function withoutParser(script) {
  const root = mkdtempSync(join(tmpdir(), 'cecelia-ops-no-parser-'));
  const require = createRequire(import.meta.url);
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    mkdirSync(join(root, 'node_modules'));
    symlinkSync(dirname(require.resolve('js-yaml/package.json')), join(root, 'node_modules/js-yaml'));
    writeFileSync(join(root, 'existing-ops-source.js'), readFileSync(new URL('../existing-ops-source.js', import.meta.url)));
    return spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8', timeout: 10000 });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('consumer adapter startup without optional production parser', () => {
  it('imports source identity for normal service startup without loading Acorn', () => {
    const child = withoutParser("const m=await import('./existing-ops-source.js'); if(m.EXISTING_OPS_IDENTITIES.length!==2) process.exit(2)");
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
  });
  it('source extraction is explicitly unavailable and never reads or verifies candidate bytes', () => {
    const child = withoutParser(`
      const m=await import('./existing-ops-source.js'); let reads=0;
      try { await m.buildExistingOpsSources({scope:m.EXISTING_OPS_SCOPE,repo:m.EXISTING_OPS_REPO,
        revision:'a'.repeat(40),paths:[],readSource:async()=>{reads++;return 'candidate'}}); process.exit(3); }
      catch(e) { if(e.code!=='OPS_SOURCE_PARSER_UNAVAILABLE'||e.status!==503||reads!==0) process.exit(4); }
    `);
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
  });
  it('invalid admission remains invalid before attempting parser resolution', () => {
    const child = withoutParser(`
      const m=await import('./existing-ops-source.js');
      try { await m.buildExistingOpsSources({scope:'foreign',repo:m.EXISTING_OPS_REPO,
        revision:'a'.repeat(40),paths:[],readSource:async()=>''}); process.exit(3); }
      catch(e) { if(e.message!=='OPS_SOURCE_INPUT_INVALID') process.exit(4); }
    `);
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
  });
});
