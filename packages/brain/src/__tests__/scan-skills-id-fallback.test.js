import {describe, it, expect, vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {runInNewContext} from 'node:vm';

const source = new URL('../../../../scripts/scan/scan-skills.js', import.meta.url);

function fixture(run) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-scan-contract-'));
  const pool = vi.fn(() => ({query:vi.fn(() => { throw Error('DB forbidden'); }),end:vi.fn()}));
  const reads = vi.fn((...args) => fs.readFileSync(...args));
  try {
    const module = {exports:{}};
    const require = name => {
      if (name === 'fs') return {...fs, readFileSync:reads};
      if (name === 'path') return path;
      if (name === 'pg') return {Pool:pool};
      throw Error(`unexpected dependency ${name}`);
    };
    runInNewContext(fs.readFileSync(source, 'utf8'), {
      require, module, exports:module.exports, process:{env:{HOME:home}},
      console:{log:vi.fn(),error:vi.fn()},
    }, {filename:source.pathname});
    expect(pool).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled();
    expect(module.exports.scanSkillDir).toBeTypeOf('function');
    run(module.exports.scanSkillDir, home);
  } finally { fs.rmSync(home, {recursive:true,force:true}); }
}

function skill(home, directory, content) {
  fs.mkdirSync(path.join(home, directory));
  fs.writeFileSync(path.join(home, directory, 'SKILL.md'), content);
}

describe('真实scanSkillDir文件解析合同，不复制正则', () => {
  it('name优先、id回退、两者缺失回退目录名', () => fixture((scan, home) => {
    skill(home, 'a', '---\nname: preferred\nid: ignored\ndescription: useful\n---');
    skill(home, 'b', '---\nid: id-fallback\n---');
    skill(home, 'directory-fallback', '---\ndescription: no name\n---');
    expect(scan(home).map(x => x.name)).toEqual(['preferred','id-fallback','directory-fallback']);
    expect(scan(home)[0]).toMatchObject({description:'useful',location:path.join(home,'a','SKILL.md')});
  }));
  it('无目录、普通文件、无SKILL.md目录不生成登记项', () => fixture((scan, home) => {
    fs.writeFileSync(path.join(home,'plain-file'),'ignored');
    fs.mkdirSync(path.join(home,'empty-directory'));
    expect(scan(home)).toEqual([]);
    expect(scan(path.join(home,'missing'))).toEqual([]);
  }));
});
