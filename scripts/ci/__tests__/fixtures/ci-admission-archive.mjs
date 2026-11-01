import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export function ciArchive(envelope,kind='normal'){
 return execFileSync('python3',['-I','-c',`import io,zipfile,sys,json
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 z.writestr('ci-admission.json',sys.argv[1] if sys.argv[2]!='json-duplicate' else '{"ci_format":"x","ci_format":"y"}')
 z.writestr('assertions.json',json.dumps(json.loads(sys.argv[1]).get('ci_assertions',{})))
 if sys.argv[2]=='extra':z.writestr('../outside','x')
 if sys.argv[2]=='duplicate':z.writestr('ci-admission.json','{}')
 if sys.argv[2]=='symlink':
  i=zipfile.ZipInfo('ci-admission.json');i.external_attr=0o120777<<16;z.writestr(i,'target')
sys.stdout.buffer.write(b.getvalue())`,JSON.stringify(envelope),kind],{maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
}
export function attachCiArchive(f,envelope){
 const bytes=ciArchive(envelope),prefix='repos/perfectuser21/cecelia/actions';
 const artifact={id:77,name:`implementation-ci-admission-baseline-${f.source}`,expired:false,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex'),size_in_bytes:bytes.length,created_at:'2026-11-01T00:02:00Z',workflow_run:{id:22,head_sha:f.control,head_branch:'main',repository_id:99,head_repository_id:99}};
 f.data.set(`${prefix}/artifacts/77`,artifact);f.data.set(`${prefix}/artifacts/77/zip`,bytes);
 return {options:{...f.options,artifactId:77},deps:{api:f.api,download:async path=>Buffer.from(f.data.get(path))},artifact,bytes};
}
