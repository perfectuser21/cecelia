import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFixedGitFile } from './fixed-git-source.js';
const revision = 'a'.repeat(40), repo = 'perfectuser21/zenithjoy-workspace';
describe('固定 GitHub 文件安全读取',()=>{
  function git(content='{"中文":"换行\\n"}') {
    const bytes=Buffer.from(content),sha=createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex');
    const tree='b'.repeat(40),calls=[];
    const fetchFn=vi.fn(async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.includes('/commits/')?{sha:revision,tree:{sha:tree}}:url.includes('/trees/')?{sha:tree,tree:[{path:'contract.json',sha,type:'blob',mode:'100644'}]}:{sha,size:bytes.length,encoding:'base64',content:bytes.toString('base64')}};});
    return {fetchFn,calls,content};
  }
  it('只访问allowlist固定API，校验blob内容hash并保留原文字节',async()=>{
    const f=git();expect(await readFixedGitFile({repo,path:'contract.json',revision},{fetchFn:f.fetchFn,resolveToken:async()=> 'test-token'})).toBe(f.content);
    expect(f.calls).toHaveLength(3);expect(f.calls.every(c=>c.url.startsWith(`https://api.github.com/repos/${repo}/git/`)&&c.options.redirect==='error')).toBe(true);
  });
  it('篡改blob或非固定Git引用均拒绝',async()=>{
    const f=git(),original=f.fetchFn;
    await expect(readFixedGitFile({repo,path:'contract.json',revision},{resolveToken:async()=> 'test-token',fetchFn:async(u,o)=>{
      const r=await original(u,o);return {ok:true,json:async()=>({...await r.json(),...(u.includes('/blobs/')?{content:Buffer.from('bad').toString('base64')}:{})})};
    }})).rejects.toThrow(/来源/);
    const fetchFn=vi.fn();await expect(readFixedGitFile({repo:'evil/repo',path:'contract.json',revision},{fetchFn})).rejects.toThrow();expect(fetchFn).not.toHaveBeenCalled();
  });
});
