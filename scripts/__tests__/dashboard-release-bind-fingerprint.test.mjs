import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';

for(const expected of ['candidate-sha', 'different-sha']) test(`本机产物指纹校验独立于退役香港端：${expected}`, async () => {
  const paths=[];
  const server=createServer((req,res)=>{
    paths.push(req.url);
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({git_sha:'candidate-sha'}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    const result=await new Promise(resolveResult=>{
      const child=spawn('bash',['scripts/check-deploy-fingerprint.sh'],{cwd:resolve(import.meta.dirname,'../..'),
        env:{...process.env,HOME:'/nonexistent-dashboard-test-home',BARK_TOKEN:'',LOCAL_FRONTEND_URL:origin,HK_FRONTEND_URL:origin+'/retired',CECELIA_SKIP_HK:'',EXPECTED_GIT_SHA:expected}});
      let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
      child.on('close',code=>resolveResult({code,output}));
    });
    assert.equal(result.code, expected==='candidate-sha'?0:1,result.output);
    assert.deepEqual(paths,['/build-info.json']);
  } finally {await new Promise(r=>server.close(r));}
});

for(const [label, body] of [['缺失', ''], ['HTML回退', '<html>old-deployment</html>']]) {
  for(const expected of ['candidate-sha', '']) test(`build-info${label}且expected=${expected || '未指定'}时不能混淆身份与可达性`, async () => {
    const paths=[];
    const server=createServer((req,res)=>{
      paths.push(req.url);
      res.setHeader('Content-Type','text/html');
      res.end(req.url==='/build-info.json'?body:'<html>old-deployment</html>');
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try {
      const result=await new Promise(resolveResult=>{
        const child=spawn('bash',['scripts/check-deploy-fingerprint.sh'],{cwd:resolve(import.meta.dirname,'../..'),
          env:{...process.env,HOME:'/nonexistent-dashboard-test-home',BARK_TOKEN:'',LOCAL_FRONTEND_URL:`http://127.0.0.1:${server.address().port}`,EXPECTED_GIT_SHA:expected}});
        let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
        child.on('close',code=>resolveResult({code,output}));
      });
      assert.equal(result.code,expected?1:0,result.output);
      assert.deepEqual(paths,expected?['/build-info.json']:['/build-info.json','/']);
    } finally {await new Promise(r=>server.close(r));}
  });
}
