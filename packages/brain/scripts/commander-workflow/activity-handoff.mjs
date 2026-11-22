import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import Ajv from 'ajv';
import {canonical,digest} from '../../src/orchestrator/commander-decision.js';
import {durableWrite} from '../../src/orchestrator/activity-supervisor.js';
import {prepareCheckerEvidence,readCheckerEvidence} from './checker-evidence.mjs';
import {hostToolsAreQuiescent} from './skill-tools-mcp.mjs';

const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
const MAX_EVIDENCE_REFERENCES=512;
const requireHandoff=(ok,reason)=>{if(!ok)throw Error(reason);};

function requireItemEvidence(itemScope,{outputs,evidence}){
  if(itemScope===undefined)return;
  requireHandoff(isRecord(itemScope)&&typeof itemScope.collection==='string'&&typeof itemScope.id_field==='string'
    &&Object.hasOwn(outputs,itemScope.collection),'delivery_item_scope_invalid');
  const items=outputs[itemScope.collection];
  requireHandoff(Array.isArray(items),'delivery_item_collection_invalid');
  const expected=new Set(['run']);
  for(const item of items){
    const id=isRecord(item)&&Object.hasOwn(item,itemScope.id_field)?item[itemScope.id_field]:undefined;
    requireHandoff(typeof id==='string'&&id.length>0&&id.length<=128&&!expected.has(id),'delivery_item_id_invalid');
    requireHandoff(Object.hasOwn(evidence,id),'delivery_item_evidence_missing:'+id);
    expected.add(id);
  }
  for(const scope of Object.keys(evidence))requireHandoff(expected.has(scope),'delivery_item_evidence_unexpected:'+scope);
}

function syncDirectory(directory){
  const file=fs.openSync(directory,'r');
  try{fs.fsyncSync(file);}finally{fs.closeSync(file);}
}

export function archiveActivityHandoff({delivery,identity,proposal,config,cwd,directory,deadlineMs,denied=[]}){
  const schema=delivery.schema;
  requireHandoff(isRecord(schema)&&schema.type==='object'&&Buffer.byteLength(JSON.stringify(schema))<=32768,'delivery_schema_invalid');
  // The existing execution envelope may already carry the declared evidence map.
  // When handoff is present, validate that field directly, including explicit null.
  const submittedEvidence=Object.hasOwn(proposal,'handoff')?proposal.handoff:proposal.evidence;
  const payload={outputs:proposal.outputs,evidence:submittedEvidence};
  requireHandoff(isRecord(payload.outputs)&&isRecord(payload.evidence),'delivery_outputs_or_evidence_missing');
  const validate=new Ajv({strict:true,allErrors:false}).compile(schema);
  const assertDeliverySchema=()=>{
    if(validate(payload))return;
    const error=validate.errors[0];
    throw Error('delivery_schema_mismatch:'+error.instancePath+':'+(error.params.missingProperty??error.keyword));
  };
  assertDeliverySchema();
  const bindingHash=digest({identity,delivery,payload});
  const supplied=Object.entries(payload.evidence).flatMap(([scope,group])=>{
    requireHandoff(isRecord(group),'delivery_evidence_scope_invalid');
    return Object.entries(group).map(([role,source])=>({scope,role,source}));
  });
  requireHandoff(supplied.length<=MAX_EVIDENCE_REFERENCES,'delivery_evidence_count_exceeded');
  // 裸文件名只标识原件，无法在本轮授权证据根读回。仅在剩余交件
  // 仍满足冻结契约时记录该标识，且至少保留一份可归档的证据。
  const unqualified=({source})=>typeof source==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/.test(source);
  const unresolved=supplied.filter(unqualified);
  const entries=supplied.filter(entry=>!unqualified(entry));
  if(unresolved.length){
    requireHandoff(entries.length>0,'delivery_evidence_unqualified');
    const evidence=Object.create(null);
    for(const {scope,role,source} of entries){
      evidence[scope]??=Object.create(null);
      evidence[scope][role]=source;
    }
    payload.evidence=evidence;
    assertDeliverySchema();
  }
  requireItemEvidence(delivery.item_scope,payload);
  const actionDirectory=fs.realpathSync(directory);
  const final=path.join(actionDirectory,'handoff'), manifestPath=path.join(final,'manifest.json');
  if(fs.existsSync(final)){
    requireHandoff(fs.realpathSync(final)===final&&fs.realpathSync(manifestPath)===manifestPath,'delivery_archive_invalid');
    const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    requireHandoff(manifest.binding_sha256===bindingHash&&digest(manifest.outputs)===digest(payload.outputs)
      &&digest(manifest.identity)===digest(identity)
      &&digest(manifest.unresolved_evidence??[])===digest(unresolved),'delivery_replay_conflict');
    for(const {scope,role,source} of entries){
      const ref=manifest.evidence?.[scope]?.[role];
      requireHandoff(ref?.source===source&&/^[a-f0-9]{64}$/.test(ref.sha256)&&ref.file==='files/'+ref.sha256,'delivery_replay_conflict');
      const file=path.join(final,ref.file);
      requireHandoff(fs.realpathSync(file)===file&&checksum(fs.readFileSync(file))===ref.sha256,'delivery_archive_drift');
    }
    return manifest;
  }

  const cwdRoot=fs.realpathSync(cwd);
  const receiptRoot=path.relative(cwdRoot,path.join(actionDirectory,'host-tools'));
  const receiptPrefix=receiptRoot+path.sep;
  const brokerReceipts=entries.filter(({source})=>typeof source==='string'&&source.startsWith(receiptPrefix));
  let roots=config?.roots;
  if(brokerReceipts.length){
    // Accept the broker's terminal JSON envelope. Its raw process streams and
    // other control files stay outside the Checker evidence roots.
    requireHandoff(!path.isAbsolute(receiptRoot)&&!receiptRoot.split(path.sep).includes('..')
      &&brokerReceipts.every(({source})=>/^[a-zA-Z0-9_-]{1,100}\.json$/.test(source.slice(receiptPrefix.length)))
      &&hostToolsAreQuiescent(actionDirectory,identity,deadlineMs),'delivery_host_receipt_unverified');
    requireHandoff(Array.isArray(roots),'checker_evidence_config_invalid');
    roots=[...new Set([...roots,receiptRoot])];
  }

  const temporary=fs.mkdtempSync(path.join(actionDirectory,'.handoff-'));
  try{
    fs.mkdirSync(path.join(temporary,'files'),{mode:0o700});
    const request={nonce:randomUUID(),identity,bindingHash};
    const reader=prepareCheckerEvidence({config:{roots},cwd,request,
      directory:path.join(temporary,'reads'),deadlineMs,denied});
    const fetched=new Map();
    const evidence=Object.create(null);
    let totalBytes=0;
    for(const {scope,role,source} of entries){
      if(!fetched.has(source)){
        const {receipt,bytes}=readCheckerEvidence(reader,{path:source},{includeBytes:true});
        requireHandoff(receipt.status==='available'&&bytes,'delivery_evidence_unavailable:'+scope+':'+role);
        totalBytes+=bytes.length;
        requireHandoff(totalBytes<=32*1024*1024,'delivery_evidence_bytes_exceeded');
        const file='files/'+receipt.sha256;
        const target=path.join(temporary,file);
        if(!fs.existsSync(target)){
          const output=fs.openSync(target,'wx',0o600);
          try{fs.writeFileSync(output,bytes);fs.fsyncSync(output);}finally{fs.closeSync(output);}
        }
        fetched.set(source,{source,file,sha256:receipt.sha256});
      }
      evidence[scope]??=Object.create(null);
      evidence[scope][role]=fetched.get(source);
    }
    const manifest=canonical({format:'activity-handoff/v1',identity,binding_sha256:bindingHash,outputs:payload.outputs,evidence,
      ...(unresolved.length?{unresolved_evidence:unresolved}:{})});
    fs.rmSync(reader.directory,{recursive:true});
    syncDirectory(path.join(temporary,'files'));
    durableWrite(path.join(temporary,'manifest.json'),manifest);
    fs.renameSync(temporary,final);
    syncDirectory(actionDirectory);
    return manifest;
  }finally{
    if(fs.existsSync(temporary))fs.rmSync(temporary,{recursive:true,force:true});
  }
}
