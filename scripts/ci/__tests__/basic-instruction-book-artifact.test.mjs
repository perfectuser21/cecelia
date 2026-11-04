import test from 'node:test';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import express from 'express';
import request from 'supertest';
import ignore from 'ignore';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const docker=readFileSync(join(repo,'packages/brain/Dockerfile'),'utf8');
const ignored=ignore().add(readFileSync(join(repo,'.dockerignore'),'utf8'));

test('现行Docker COPY/ENV声明的owned独立布局读取同一源码docs，未知根不回落',async t=>{
  // RED先锁实际缺失打包事实；不让缺少新模块的import错误冒充产品红。
  const copy=docker.match(/^COPY (docs\/instruction-book\/) (\.\/docs\/instruction-book\/)$/m);
  assert.ok(copy,'现行runtime必须COPY同源instruction-book');
  const declared=docker.match(/^ENV INSTRUCTION_BOOK_DOCS_ROOT=(\/app\/docs\/instruction-book)$/m);
  assert.ok(declared,'runtime必须显式指定制品内固定docs根');
  const selfcheck=docker.match(/^RUN node --input-type=module -e "([^"]*readInstructionBook[^"]*)"$/m);
  assert.ok(selfcheck,'实际Docker构建必须执行同一纯reader自检');
  const owned=mkdtempSync(join(tmpdir(),'book-artifact-'));
  const previous=process.env.INSTRUCTION_BOOK_DOCS_ROOT;
  try {
    const appRoot=join(owned,'app');
    mkdirSync(join(appRoot,'src/routes'),{recursive:true});
    writeFileSync(join(appRoot,'package.json'),'{"type":"module"}');
    copyFileSync(join(repo,'packages/brain/src/routes/instruction-book.js'),join(appRoot,'src/routes/instruction-book.js'));
    const stageDocs=join(appRoot,copy[2]);
    const expected={skills:[],features:[]};
    for(const category of Object.keys(expected)){
      mkdirSync(join(stageDocs,category),{recursive:true});
      const source=join(repo,copy[1],category);
      for(const file of readdirSync(source).filter(x=>x.endsWith('.md'))){
        const relative=copy[1]+category+'/'+file;
        assert.equal(ignored.ignores(relative),false,relative+'必须进入构建上下文');
        copyFileSync(join(source,file),join(stageDocs,category,file));
        expected[category].push(file);
        assert.deepEqual(readFileSync(join(stageDocs,category,file)),readFileSync(join(source,file)));
      }
    }
    assert.equal(ignored.ignores('docs/current/UNRELATED.md'),true,'不能为一本说明书放开其它历史文档');
    assert.equal(ignored.ignores('README.md'),true);
    // COPY brain/src→/app/src，显式ENV /app映射为本人临时制品根；模块真实读取阶段文件。
    process.env.INSTRUCTION_BOOK_DOCS_ROOT=join(owned,declared[1]);
    const runBuildCheck=()=>spawnSync(process.execPath,['--input-type=module','-e',selfcheck[1]],{cwd:appRoot,env:process.env,encoding:'utf8'});
    const built=runBuildCheck();assert.equal(built.status,0,built.stderr);
    const {registerInstructionBookRoute}=await import(pathToFileURL(join(appRoot,'src/routes/instruction-book.js')));
    const router=express.Router();registerInstructionBookRoute(router);
    const app=express().use('/api/brain',router);
    const server=await new Promise(resolve=>{const ownedServer=app.listen(0,'127.0.0.1',()=>resolve(ownedServer));});
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const response=await request(server).get('/api/brain/docs/instruction-book');
    assert.equal(response.status,200);
    for(const category of Object.keys(expected))assert.equal(response.body[category].length,expected[category].length);
    assert.ok(response.body.features.find(x=>x.id==='feature:social-trending-api').sections.what);
    process.env.INSTRUCTION_BOOK_DOCS_ROOT=join(appRoot,'missing-docs');
    assert.notEqual(runBuildCheck().status,0,'真实Docker RUN在错误显式ENV根时必须失败');
    assert.equal((await request(server).get('/api/brain/docs/instruction-book')).status,503);
    process.env.INSTRUCTION_BOOK_DOCS_ROOT=stageDocs;
    rmSync(join(stageDocs,'features'),{recursive:true});
    const brokenBuild=runBuildCheck();assert.notEqual(brokenBuild.status,0,'真实Docker RUN在缺失COPY布局时必须失败');
    const missing=await request(server).get('/api/brain/docs/instruction-book');
    assert.equal(missing.status,503);assert.deepEqual(missing.body,{error:'instruction_book_unavailable'});
  } finally {
    if(previous===undefined)delete process.env.INSTRUCTION_BOOK_DOCS_ROOT;else process.env.INSTRUCTION_BOOK_DOCS_ROOT=previous;
    rmSync(owned,{recursive:true,force:true});
  }
});
