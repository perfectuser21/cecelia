/** 交接只保存官方原ZIP与定位描述；不生成任何legacy scope文件。 */
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,writeFileSync,renameSync,rmSync,readFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {stepSha256 as hash} from '../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {inspectCiAdmission} from './ci-admission-envelope.mjs';
import {unpackCiAdmissionArchive} from './ci-admission-archive.mjs';
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
export function ciAdmissionDescriptor(result){
 const ci=result.ciAdmission,view=inspectCiAdmission(ci?.capability),r=result.resolution;
 need(r?.baseline_kind==='ci_admission_only'&&r.effective_base_revision===view.source_revision
  &&r.base_ci_admission_sha256===view.envelope_sha256,'CI_ADMISSION_HANDOFF_IDENTITY');
 const bytes=ci.archive,artifact=ci.artifact;
 need(Buffer.isBuffer(bytes)&&bytes.length===artifact?.size_in_bytes&&`sha256:${createHash('sha256').update(bytes).digest('hex')}`===artifact.digest,'CI_ADMISSION_HANDOFF_ARCHIVE');
 need(unpackCiAdmissionArchive(bytes).envelope.ci_envelope_sha256===view.envelope_sha256,'CI_ADMISSION_HANDOFF_ARCHIVE');
 const body={ci_handoff_format:'cecelia.ci-admission-handoff/v1',purpose:'ci_admission_only',repo:r.repo,source_revision:view.source_revision,
  control_revision:view.control_revision,head_revision:r.head_revision,original_pr_base_revision:r.original_pr_base_revision,
  tooling_revision:r.tooling_revision,envelope_sha256:view.envelope_sha256,artifact};
 return {...body,handoff_sha256:hash(body)};
}
export function writeCiAdmissionInputs({inputDir,result}){
 const descriptor=ciAdmissionDescriptor(result),requested=resolve(inputDir);
 mkdirSync(requested,{recursive:true});need(lstatSync(requested).isDirectory()&&!lstatSync(requested).isSymbolicLink(),'CI_ADMISSION_HANDOFF_PATH');
 const parent=realpathSync(requested);
 const directory=join(parent,'ci-admission');
 try{mkdirSync(directory,{mode:0o700});}catch(error){if(error.code==='EEXIST')need(false,'CI_ADMISSION_HANDOFF_EXISTS');throw error;}
 try{
  writeFileSync(join(directory,'artifact.zip'),result.ciAdmission.archive,{mode:0o600,flag:'wx'});
  writeFileSync(join(directory,'handoff.pending'),JSON.stringify(descriptor)+'\n',{mode:0o600,flag:'wx'});
  renameSync(join(directory,'handoff.pending'),join(directory,'handoff.json'));return directory;
 }catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
}
export function readCiAdmissionInputs(inputDir){
 const requested=resolve(inputDir),stat=lstatSync(requested);
 need(stat.isDirectory()&&!stat.isSymbolicLink(),'CI_ADMISSION_HANDOFF_PATH');const directory=realpathSync(requested);
 const read=(file,max)=>{const path=join(directory,file),s=lstatSync(path);need(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=max,'CI_ADMISSION_HANDOFF_FILE');return readFileSync(path);};
 let descriptor;try{descriptor=JSON.parse(read('handoff.json',65536));}catch(error){if(error.code?.startsWith('CI_ADMISSION_'))throw error;need(false,'CI_ADMISSION_HANDOFF_JSON');}
 const {handoff_sha256,...body}=descriptor;
 need(body.ci_handoff_format==='cecelia.ci-admission-handoff/v1'&&body.purpose==='ci_admission_only'&&hash(body)===handoff_sha256,'CI_ADMISSION_HANDOFF_DIGEST');
 const archive=read('artifact.zip',16*1024*1024);
 need(archive.length===descriptor.artifact?.size_in_bytes&&`sha256:${createHash('sha256').update(archive).digest('hex')}`===descriptor.artifact.digest,'CI_ADMISSION_HANDOFF_ARCHIVE');
 return {descriptor,archive};
}
