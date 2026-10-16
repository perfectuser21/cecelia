import { createHash } from 'node:crypto';
import { resolveGitHubToken } from '../harness-credentials.js';

const REPOS = new Set(['perfectuser21/cecelia', 'perfectuser21/zenithjoy-workspace']);
const SHA = /^[a-f0-9]{40}$/;
const MAX_FILE = 1024 * 1024;
const fail = message => { throw Object.assign(new Error(`冻结来源：${message}`), { code:'definition_source_invalid',status:422 }); };

export function validateGitSource({ repo, path, revision } = {}) {
  if (!REPOS.has(repo) || !SHA.test(revision || '') || typeof path !== 'string'
    || path.length > 1000 || !/^[A-Za-z0-9_./-]+$/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..')) fail('必须是允许仓库的固定commit及规范相对路径');
}

/** token 只发往固定 GitHub API；commit/tree/blob 身份均回读，禁止重定向。 */
export async function readFixedGitFile(source, { fetchFn=globalThis.fetch, resolveToken=resolveGitHubToken,signal,deadline=Date.now()+60000 } = {}) {
  validateGitSource(source);
  const check=()=>{if(signal?.aborted||Date.now()>=deadline)throw Object.assign(Error('固定来源读取已取消或超时'),{code:'readiness_deadline_exceeded',status:503});};
  check();
  const {repo,path,revision}=source,token=await resolveToken();
  async function get(kind,sha) {
    check();
    if (!SHA.test(sha || '')) fail('Git对象身份不合法');
    const response=await fetchFn(`https://api.github.com/repos/${repo}/git/${kind}/${sha}${kind==='trees'?'?recursive=1':''}`, {
      redirect:'error',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`},
      signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(Math.max(1,Math.min(15000,deadline-Date.now())))]),
    });
    if (!response.ok) fail('GitHub对象不可读');
    // 原生 fetch 逐块限流，避免不可信超大 JSON 在解析前占满内存。
    if (response.body?.getReader) {
      const reader=response.body.getReader(),chunks=[];let size=0;
      for (;;) {
        const {done,value}=await reader.read();check();if(done)break;
        size+=value.length;if(size>16*MAX_FILE){await reader.cancel();fail('GitHub响应超过上限');}chunks.push(Buffer.from(value));
      }
      try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('GitHub响应不是JSON');}
    }
    const document=await response.json();check();return document;
  }
  const commit=await get('commits',revision);
  if(commit.sha!==revision||!SHA.test(commit.tree?.sha||''))fail('commit不匹配');
  const tree=await get('trees',commit.tree.sha);
  if(tree.sha!==commit.tree.sha||tree.truncated||!Array.isArray(tree.tree))fail('tree不完整');
  const entries=tree.tree.filter(entry=>entry.path===path);
  if(entries.length!==1||entries[0].type!=='blob'||!['100644','100755'].includes(entries[0].mode))fail('文件缺失或不是常规文件');
  if(entries[0].size>MAX_FILE)fail('文件超过上限');
  const blob=await get('blobs',entries[0].sha);
  if(blob.sha!==entries[0].sha||blob.encoding!=='base64'||!Number.isSafeInteger(blob.size)||blob.size<1||blob.size>MAX_FILE
    ||typeof blob.content!=='string'||blob.content.length>2*MAX_FILE)fail('blob格式或大小非法');
  const bytes=Buffer.from(blob.content,'base64');
  if(bytes.length!==blob.size||createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex')!==blob.sha)fail('文件字节hash不匹配');
  return bytes.toString('utf8');
}
