#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {auditSkillGitSource} from '../src/lib/skill-git-provenance.js';
const args=process.argv.slice(2),inputIndex=args.indexOf('--input'),outputIndex=args.indexOf('--output');
if(inputIndex<0||outputIndex<0||!args[inputIndex+1]||!args[outputIndex+1]) {
  console.error('需要 --input <注册表快照.json> --output <新的核验结果.json>');process.exit(2);
}
try {
  if(path.resolve(args[inputIndex+1])===path.resolve(args[outputIndex+1]))throw Error('input_output_conflict');
  const data=JSON.parse(fs.readFileSync(args[inputIndex+1],'utf8'));
  const records=Array.isArray(data)?data:data.skills;
  if(!Array.isArray(records)||records.length>2000)throw Error('invalid_snapshot');
  const rows=records.filter(x=>x&&x.presence==='present'&&x.status!=='deprecated');
  const results=rows.map(row=>({...auditSkillGitSource({skill_id:row.id,source_path:row.source_path}),
    verification_scope:'local_git_installation',remote_revision_verified:false}));
  fs.writeFileSync(args[outputIndex+1],JSON.stringify(results,null,2)+'\n',{mode:0o600,flag:'wx'});
  const states={},reasons={};for(const x of results){states[x.status]=(states[x.status]||0)+1;if(x.reason)reasons[x.reason]=(reasons[x.reason]||0)+1;}
  console.log(JSON.stringify({total:results.length,states,reasons,production_migration_applied:false}));
}catch {console.error('来源核验失败；未读取凭据或修改数据库');process.exitCode=1;}
