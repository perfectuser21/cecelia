import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), cleanup = [];
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f()});
async function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'preview-browser-test-'));cleanup.push(()=>fs.rmSync(root,{recursive:true,force:true}));
  const hits=[],socketPath=path.join(root,'fixture.sock');
  const server=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{hits.push({host:req.headers.host,path:req.url,body,cookie:req.headers.cookie});res.setHeader('set-cookie',['a=1; Path=/','b=2; Path=/']);res.end('LIVE_RESPONSE')})});
  await new Promise(r=>server.listen(socketPath,r));cleanup.push(()=>new Promise(r=>server.close(r)));
  const stub=path.join(root,'stub-playwright.cjs');fs.writeFileSync(stub,`const calls={contexts:[]};module.exports={calls,chromium:{launch:async options=>{calls.launch=options;calls.launches=(calls.launches||0)+1;return{newContext:async options=>{const c={options,route:async(p,f)=>{c.http=f},routeWebSocket:async(p,f)=>{c.ws=f},on(){},close:async()=>{c.closed=true}};calls.contexts.push(c);return c},close:async()=>{calls.closed=true}}}}};`);
  const {writePreviewBrowserHelper}=await import('../lib/preview-browser.mjs');
  const helperPath=writePreviewBrowserHelper({runtimeDir:root,socketPath,origin:'http://localhost:5300',playwrightModule:stub});
  return{root,socketPath,hits,helperPath,helper:require(helperPath),calls:require(stub).calls};
}
function route(url='http://localhost:5300/page') {const result={};return{result,request:()=>({url:()=>url,method:()=> 'POST',allHeaders:async()=>({cookie:'a=1',host:'evil.invalid'}),postDataBuffer:()=>Buffer.from('payload')}),fulfill:async x=>{result.response=x},abort:async reason=>{result.aborted=reason}}}
describe('只读Playwright helper固定预览传输',()=>{
  it('pipe单进程、全新context/SW阻止，HTTP body/cookie沿固定socket真实转发',async()=>{
    const f=await fixture();const browser=await f.helper.launchPreviewBrowser();
    const a=await browser.newContext(),b=await browser.newContext();expect(a).not.toBe(b);expect(f.calls.launches).toBe(2);expect(a.options).toEqual({serviceWorkers:'block'});
    expect(f.calls.launch).toEqual({headless:true,args:['--single-process','--no-zygote']});
    const r=route();await a.http(r);expect(r.result.response.status).toBe(200);expect(r.result.response.body.toString()).toBe('LIVE_RESPONSE');
    expect(f.hits).toEqual([{host:'localhost:5300',path:'/page',body:'payload',cookie:'a=1'}]);
    expect(r.result.response.headers['set-cookie']).toContain('a=1');
    expect(fs.statSync(f.helperPath).mode&0o777).toBe(0o400);
    await browser.close();expect(f.calls.closed).toBe(true);
  });
  it('没有Playwright依赖时明确不可用，不降级伪浏览器',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'preview-browser-missing-'));cleanup.push(()=>fs.rmSync(root,{recursive:true,force:true}));
    const {writePreviewBrowserHelper}=await import('../lib/preview-browser.mjs');
    const file=writePreviewBrowserHelper({runtimeDir:root,socketPath:path.join(root,'none.sock'),origin:'http://localhost:5300',playwrightModule:null});
    await expect(require(file).launchPreviewBrowser()).rejects.toThrow('preview_browser_unavailable');
  });
  it('不同origin/protocol/凭据URL和WS拒绝，无route.continue回退；不能传launch/context权限参数',async()=>{
    const f=await fixture();await expect(f.helper.launchPreviewBrowser({args:['--proxy-server=unsafe']})).rejects.toThrow(/options/);
    const browser=await f.helper.launchPreviewBrowser();await expect(browser.newContext({storageState:'old'})).rejects.toThrow(/options/);
    const c=await browser.newContext();
    for(const u of ['http://localhost:5221/','http://localhost:5301/','https://example.com/','file:///etc/passwd','http://user@localhost:5300/']){const r=route(u);await c.http(r);expect(r.result.aborted).toBe('blockedbyclient')}
    let closed=false;await c.ws({url:()=> 'ws://localhost:5300/events',close:async()=>{closed=true}});expect(closed).toBe(true);expect(f.hits).toEqual([]);
    expect(browser.diagnostics()).toContainEqual(expect.objectContaining({kind:'websocket_unsupported'}));await browser.close();
  });
});
