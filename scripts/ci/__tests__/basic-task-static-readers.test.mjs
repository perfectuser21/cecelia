import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {parse} from 'acorn';
const root=fileURLToPath(new URL('../../../',import.meta.url));
function walk(node,visit){if(!node||typeof node!=='object')return;visit(node);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(x=>walk(x,visit));else if(value&&typeof value==='object')walk(value,visit);}
function ast(file){return parse(readFileSync(file,'utf8'),{ecmaVersion:'latest',sourceType:'module'});}
const entry=join(root,'packages/brain/src/routes/tasks.js'),tree=ast(entry),imports=new Map(),reachable=new Set([entry]);
for(const node of tree.body)if(node.type==='ImportDeclaration'&&/^\.\/tasks-.*\.js$/.test(node.source.value))for(const s of node.specifiers)imports.set(s.local.name,resolve(root,'packages/brain/src/routes',node.source.value));
walk(tree,node=>{if(node.type==='CallExpression'&&imports.has(node.callee.name)&&node.arguments[0]?.name==='router')reachable.add(imports.get(node.callee.name));});
const scripts=['callback-postprocess-smoke.sh','ledger-hygiene-m7-window-smoke.sh','harness-lifecycle-gates-smoke.sh','handoff-kinds-smoke.sh','task-result-backfill-smoke.sh','task-terminal-relay-hub-smoke.sh','relay-baton-smoke.sh','task-governance-guards-smoke.sh'];
for(const name of scripts)test(`${name} static task reader targets the actually registered handler module`,()=>{
 const source=readFileSync(join(root,'packages/brain/scripts/smoke',name),'utf8');
 const targets=[...new Set(source.match(/(?:packages\/brain\/)?src\/routes\/tasks(?:-[a-z-]+)?\.js/g)||[])];
 assert.equal(targets.length,1,'one authoritative task module; no old/new fallback');
 const file=join(root,targets[0].startsWith('packages/')?targets[0]:'packages/brain/'+targets[0]);
 assert.ok(reachable.has(file),'reader target must be connected by the current router entry');
 const governance=name==='task-governance-guards-smoke.sh';let found=false;
 walk(ast(file),node=>{if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.object.name==='router'&&node.callee.property.name===(governance?'post':'patch')&&node.arguments[0]?.value===(governance?'/tasks/:id/block':'/tasks/:task_id'))found=true;});
 assert.equal(found,true,'the referenced file must actually register the declared handler, not merely import it');
});
