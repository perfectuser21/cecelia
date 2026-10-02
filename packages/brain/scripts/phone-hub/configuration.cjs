'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {targetValidFull}=require('./capabilities.cjs');
const SOURCE_FILES=Object.freeze(['service.cjs','execution.cjs','capabilities.cjs','maintenance.cjs','configuration.cjs','runtime.cjs','control.py','maintenance.py',
 '../phone-ssh/journal.py','../phone-ssh/process_identity.py','../phone-ssh/drain_marker.py','../phone-ssh/transport.cjs','../phone-ssh/protocol.cjs','../phone-ssh/runner.py','../phone-ssh/http_physical.py','../phone-ssh/admission.py','../phone-ssh/activation.py']);
const CONFIG='/etc/cecelia/phone-hub/config.json',TOKEN='/etc/cecelia/phone-hub/token';
function trustedBytes(file,privateFile=false){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o022)||(privateFile&&(s.mode&0o777)!==0o600)||s.size>65536)throw Error('phone_manifest_untrusted');return fs.readFileSync(fd);}
 finally{fs.closeSync(fd);}
}
const hash=value=>createHash('sha256').update(value).digest('hex');
function sourceHashes(root){return Object.fromEntries(SOURCE_FILES.map(name=>[name,hash(trustedBytes(path.join(root,name)))]));}
function definitionValid(value){
 let url;try{url=new URL(value.http_endpoint);}catch{return false;}
 return typeof value.hub_id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.hub_id)&&url.protocol==='http:'&&url.port==='3459'&&url.pathname==='/'&&!url.search&&!url.hash&&!url.username&&!url.password&&
  Array.isArray(value.targets)&&value.targets.length>0&&value.targets.length<=16&&value.targets.every(targetValidFull)&&new Set(value.targets.map(t=>t.machine_id)).size===value.targets.length;
}
function buildManifest(sourceRoot,definition){
 if(!definitionValid(definition)||Object.keys(definition).sort().join(',')!=='http_endpoint,hub_id,targets')throw Error('phone_manifest_invalid');
 return {schema:1,...definition,source_hashes:sourceHashes(sourceRoot)};
}
function loadConfiguration({configPath=CONFIG,tokenPath=TOKEN,sourceRoot=__dirname}={}){
 const configBytes=trustedBytes(configPath,true),manifest=JSON.parse(configBytes);
 if(!manifest||Object.keys(manifest).sort().join(',')!=='http_endpoint,hub_id,schema,source_hashes,targets'||manifest.schema!==1||!definitionValid(manifest))throw Error('phone_manifest_invalid');
 const actual=sourceHashes(sourceRoot);
 if(!manifest.source_hashes||Object.keys(manifest.source_hashes).length!==SOURCE_FILES.length||SOURCE_FILES.some(name=>actual[name]!==manifest.source_hashes[name]))throw Error('phone_manifest_build_mismatch');
 const token=trustedBytes(tokenPath,true).toString('utf8').trim();if(Buffer.byteLength(token)<32||Buffer.byteLength(token)>256||/\s/.test(token))throw Error('phone_token_unconfigured');
 return {manifest,token,build_digest:hash(JSON.stringify(actual)),config_digest:hash(configBytes)};
}
module.exports={SOURCE_FILES,CONFIG,TOKEN,buildManifest,loadConfiguration};
