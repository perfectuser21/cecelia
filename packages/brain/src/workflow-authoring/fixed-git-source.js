import { createHash } from 'node:crypto';
import { validateImplementationBindings } from '../lib/implementation-bindings.js';

const REPOS = new Set(['perfectuser21/cecelia', 'perfectuser21/zenithjoy-workspace']);
const SHA = /^[a-f0-9]{40}$/;
const MAX_FILE = 1024 * 1024;
const CENTRAL_REPO = 'perfectuser21/zenithjoy-skills';
const DIGEST = /^[a-f0-9]{64}$/;
const fail = message => { throw Object.assign(new Error(`冻结来源：${message}`), { code:'definition_source_invalid',status:422 }); };

export function validateGitSource({ repo, path, revision } = {}, { central = false } = {}) {
  if (!(REPOS.has(repo) || (central && repo === CENTRAL_REPO)) || !SHA.test(revision || '') || typeof path !== 'string'
    || path.length > 1000 || !/^[A-Za-z0-9_./-]+$/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..')) fail('必须是允许仓库的固定commit及规范相对路径');
}

/** token 只发往固定 GitHub API；commit/tree/blob 身份均回读，禁止重定向。 */
async function readGitFile(source, { fetchFn=globalThis.fetch, resolveToken=async()=>(await import('../harness-credentials.js')).resolveGitHubToken(),signal,deadline=Date.now()+60000 } = {}, central=false) {
  validateGitSource(source,{central});
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
  return bytes;
}

export async function readFixedGitFile(source, options={}) {
  return (await readGitFile(source,options)).toString('utf8');
}

/** 声明身份留在绑定中，解析身份仅来自业务固定提交的锁和中央固定提交的目录。 */
export async function readFixedImplementationBinding(binding, options={}) {
  const read=async (location,central=false)=>{
    validateGitSource(location,{central});
    let bytes;
    if(options.readFile || (!central && options.readBusinessFile)){
      try{bytes=await (options.readFile||options.readBusinessFile)(location);}catch{fail('固定来源文件不可读');}
    }else bytes=await readGitFile(location,options,central);
    if(!Buffer.isBuffer(bytes)&&typeof bytes!=='string')fail('固定来源不是文本');
    const value=Buffer.from(bytes);
    if(!value.length||value.length>MAX_FILE)fail('固定来源文件大小非法');
    options.onReadBytes?.(value.length);
    return value;
  };
    const declared={repo:binding.repo,path:binding.path,revision:binding.revision};
    validateGitSource(declared);
    if(binding.kind!=='skill'||binding.repo!== 'perfectuser21/zenithjoy-workspace'){
      const bytes=await read(declared);return {content:bytes.toString('utf8'),bytes};
    }
    const lockSource={repo:binding.repo,path:'.skills-source.json',revision:binding.revision};
    let lock,catalog;
    const lockBytes=await read(lockSource);
    try{lock=JSON.parse(lockBytes.toString('utf8'));}catch{fail('Skill来源锁非法');}
    if(lock?.version!==1||lock.repository!==CENTRAL_REPO||!SHA.test(lock.revision||'')
      ||!DIGEST.test(lock.loader_sha256||'')||typeof lock.profile!=='string'
      ||!lock.profile||lock.profile.length>100)fail('Skill来源锁非法');
    const catalogSource={repo:CENTRAL_REPO,path:'distribution/catalog.json',revision:lock.revision};
    const catalogBytes=await read(catalogSource,true);
    try{catalog=JSON.parse(catalogBytes.toString('utf8'));}catch{fail('中央Skill目录非法');}
    const files=catalog?.profiles?.[lock.profile]?.files;
    if(catalog?.version!==1||!Array.isArray(files)||files.length>10000)fail('中央Skill目录profile非法');
    const entries=files.filter(row=>row?.path===binding.path);
    if(entries.length!==1||!DIGEST.test(entries[0].sha256||''))fail('Skill不在目录或摘要缺失');
    const resolved={repo:CENTRAL_REPO,path:entries[0].source,revision:lock.revision};
    const bytes=await read(resolved,true);
    if(createHash('sha256').update(bytes).digest('hex')!==entries[0].sha256)fail('中央Skill摘要不匹配');
    return {content:bytes.toString('utf8'),bytes,resolved_source:resolved};
}

export async function validateFixedImplementationBindings(contract, source, options={}) {
  const resolutions=new Map();
  const readBinding=async binding=>{
    const result=await readFixedImplementationBinding(binding,options);
    if(result.resolved_source)resolutions.set(JSON.stringify([binding.repo,binding.revision,binding.path]),result.resolved_source);
    return result.content;
  };
  const verified=await validateImplementationBindings(contract,readBinding,source);
  return verified.map(binding=>{
    const resolved=resolutions.get(JSON.stringify([binding.repo,binding.revision,binding.path]));
    return resolved?{...binding,resolved_source:resolved}:binding;
  });
}
