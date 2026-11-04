/** 只移除当前Git索引中的顶层流程资料；不遍历分支、产物库或其他worktree。 */
import {execFileSync} from 'node:child_process';
import {appendFileSync,existsSync,lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {SOURCE_RELATIONS_PATH,removeDeletedArtifactRelations} from './implementation-auxiliary-evidence.mjs';

const git=(args,options={})=>execFileSync('git',['--literal-pathspecs',...args],{encoding:'utf8',stdio:['pipe','pipe','pipe'],...options});
// 旧/新Markdown命名与两类精确状态文件；前缀同名目录及其他扩展名不属于流程资料。
const artifact=/^(?:\.(?:prd|task|dod)-[^/]+\.md|\.(?:dev-mode|dev-seal)\.[^/]+|\.enriched-prd-[^/]+\.md|(?:DoD|PRD|TASK_CARD)\.cp-[^/]+\.md)$/;
const files=git(['ls-files','-z']).split('\0').filter(path=>path&&artifact.test(path));
if(!files.length){
 appendFileSync(process.env.GITHUB_OUTPUT,'changed=false\ncount=0\n');
 console.log('✅ 无顶层流程残留文件');
}else{
 // 先验证来源登记，再动索引；畸形登记不能留下半份清理结果。
 let before,after,stat;
 try{stat=lstatSync(SOURCE_RELATIONS_PATH);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(stat){
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('Source relations must be a regular file');
  before=readFileSync(SOURCE_RELATIONS_PATH,'utf8');after=removeDeletedArtifactRelations(before,files);
 }
 git(['rm','-q','--pathspec-from-file=-','--pathspec-file-nul'],{input:files.join('\0')+'\0'});
 const staged=new Set(git(['diff','--cached','--name-only','--diff-filter=D','-z']).split('\0').filter(Boolean));
 if(files.some(path=>!staged.has(path)||existsSync(path)))throw Error('Cleanup deletion is not staged');
 if(after!==undefined&&after!==before){
  writeFileSync(SOURCE_RELATIONS_PATH,after);git(['add','--',SOURCE_RELATIONS_PATH]);
 }
 appendFileSync(process.env.GITHUB_OUTPUT,`changed=true\ncount=${files.length}\n`);
 console.log(`已核验清理并暂存 ${files.length} 个顶层流程文件；尚待普通PR审查`);
}
