'use strict';
// 来源：固定 Codex 0.158.0 镜像的 generate-json-schema --experimental。
// 本脚本只读取已导出的官方协议；运行时不加载网络 schema 或插件给定 schema。
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const CLIENT=`initialize account/login/start account/logout account/read account/rateLimits/read model/list mcpServerStatus/list modelProvider/capabilities/read config/read configRequirements/read experimentalFeature/list skills/list hooks/list app/list app/read app/installed plugin/list plugin/read plugin/installed thread/start thread/resume thread/fork thread/read thread/list thread/loaded/list thread/turns/list thread/items/list thread/name/set thread/metadata/update thread/archive thread/unarchive thread/unsubscribe thread/compact/start thread/goal/get thread/goal/set thread/goal/clear thread/inject_items turn/start turn/steer turn/interrupt review/start command/exec command/exec/write command/exec/terminate command/exec/resize fs/readFile fs/writeFile fs/readDirectory fs/createDirectory fs/getMetadata fs/copy fs/remove`.split(' ');
function strip(schema){
 if(!schema||typeof schema!=='object')return schema;
 return Object.fromEntries(Object.entries(schema).filter(([k])=>!['description','title','default','$schema'].includes(k)).map(([k,v])=>{
  if(['properties','definitions'].includes(k))return [k,Object.fromEntries(Object.entries(v).map(([name,child])=>[name,strip(child)]))];
  if(['anyOf','oneOf','allOf'].includes(k))return [k,v.map(strip)];
  if(['items','additionalProperties'].includes(k))return [k,strip(v)];
  return [k,v];
 }));
}
function generate(directory){
 const hashes={},sets={};
 for(const [kind,file,allowed] of [['client','ClientRequest.json',CLIENT],['server','ServerRequest.json'],['notification','ServerNotification.json']]){
  const raw=fs.readFileSync(path.join(directory,file),'utf8');hashes[file]=createHash('sha256').update(raw).digest('hex');const source=JSON.parse(raw),methods={};
  for(const entry of source.oneOf){const name=entry.properties.method.enum[0];if(!allowed||allowed.includes(name))methods[name]=strip(entry.properties.params??{});}
  if(allowed?.some(name=>!methods[name]))throw Error('appserver_contract_method_missing');
  const definitions={};const visit=value=>{if(!value||typeof value!=='object')return;if(value.$ref){const name=value.$ref.split('/').at(-1);if(!Object.hasOwn(definitions,name)){definitions[name]=strip(source.definitions[name]);visit(definitions[name]);}}for(const child of Object.values(value))visit(child);};visit(methods);
  sets[kind]={methods,definitions};
 }
 const responses={};for(const filename of ['ChatgptAuthTokensRefreshResponse.json','DynamicToolCallResponse.json'])responses[filename.replace('.json','')]=strip(JSON.parse(fs.readFileSync(path.join(directory,filename),'utf8')));
 const output={version:'0.158.0',experimental:true,hashes,...sets,responses};
 return JSON.stringify(output,null,0)+'\n';
}
if(require.main===module){const [dir,out]=process.argv.slice(2);if(!dir||!out)throw Error('schema_directory_and_output_required');fs.writeFileSync(out,generate(dir));}
module.exports={generate};
