import {mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const fail=code=>{throw Error(code);};
const scope='foundation-release-readiness',repo='perfectuser21/cecelia';
/** 只读取正式登记的固定版本；完整定义和回归资格继续由现有pilot验证器判定。 */
export async function fetchFoundationSnapshot({revision,base='http://100.79.41.61:5221',token=process.env.CECELIA_INTERNAL_TOKEN}){
 let origin;try{origin=new URL(base);}catch{fail('FOUNDATION_RELEASE_CONFIG_INVALID');}
 if(!/^[a-f0-9]{40}$/.test(revision??'')||typeof token!=='string'||!token.trim()
   ||origin.protocol!=='http:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'
   ||!['127.0.0.1','localhost','100.79.41.61'].includes(origin.hostname)
   ||origin.hostname==='100.79.41.61'&&origin.port!=='5221')fail('FOUNDATION_RELEASE_CONFIG_INVALID');
 const url=new URL('/api/brain/implementation-ci/snapshot',origin);
 url.search=new URLSearchParams({scope,repo,revision}).toString();
 const response=await fetch(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(60000),headers:{'X-Internal-Token':token}});
 if(!response.ok){await response.body?.cancel();fail('FOUNDATION_RELEASE_HTTP_'+response.status);}
 const chunks=[];let bytes=0;
 for await(const chunk of response.body){bytes+=chunk.length;if(bytes>8*1024*1024)fail('FOUNDATION_RELEASE_SNAPSHOT_OVERSIZED');chunks.push(chunk);}
 let snapshot;try{snapshot=JSON.parse(Buffer.concat(chunks).toString('utf8')).snapshot;}catch{fail('FOUNDATION_RELEASE_SNAPSHOT_INVALID');}
 if(snapshot?.scope!==scope||snapshot.repo!==repo||snapshot.revision!==revision||snapshot.status!=='verified'
   ||!Array.isArray(snapshot.gaps)||snapshot.gaps.length)fail('FOUNDATION_RELEASE_SNAPSHOT_UNVERIFIED');
 return snapshot;
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==4)fail('FOUNDATION_RELEASE_ARGUMENT_INVALID');
  const snapshot=await fetchFoundationSnapshot({revision:process.argv[2]});
  const output=resolve(process.argv[3]);mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify({snapshot},null,2)+'\n',{mode:0o600});
 }catch(error){process.stderr.write((/^FOUNDATION_RELEASE_[A-Z0-9_]+$/.test(error.message)?error.message:'FOUNDATION_RELEASE_FETCH_FAILED')+'\n');process.exitCode=1;}
}
