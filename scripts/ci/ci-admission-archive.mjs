/** 固定两文件专用ZIP；任何legacy文件名、路径、重复键或特殊文件均拒绝。 */
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export function unpackCiAdmissionArchive(bytes){
 const root=mkdtempSync(join(tmpdir(),'ci-admission-zip-'));
 try{
  if(!Buffer.isBuffer(bytes)||bytes.length>16*1024*1024)throw Error('size');
  const path=join(root,'artifact.zip');writeFileSync(path,bytes,{mode:0o600});
  const result=execFileSync('python3',['-I','-c',`import zipfile,sys,json,stat
def pairs(rows):
 d={}
 for k,v in rows:
  assert k not in d
  d[k]=v
 return d
with zipfile.ZipFile(sys.argv[1]) as z:
 entries=z.infolist()
 assert sorted(x.filename for x in entries)==['assertions.json','ci-admission.json']
 assert sum(x.file_size for x in entries)<=16*1024*1024
 for x in entries:
  assert not x.is_dir() and not x.flag_bits&1 and stat.S_IFMT(x.external_attr>>16) in (0,stat.S_IFREG)
  assert x.compress_type in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED)
 def load(name):return json.loads(z.read(name).decode('utf-8'),object_pairs_hook=pairs)
 print(json.dumps({'envelope':load('ci-admission.json'),'assertions':load('assertions.json')}))`,path],{encoding:'utf8',timeout:10000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
  return JSON.parse(result);
 }catch{throw Object.assign(Error('CI_ADMISSION_ARCHIVE_INVALID'),{code:'CI_ADMISSION_ARCHIVE_INVALID'});}
 finally{rmSync(root,{recursive:true,force:true});}
}
