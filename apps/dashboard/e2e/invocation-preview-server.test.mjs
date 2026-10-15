import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInvocationPreview } from './invocation-preview-server.mjs';
test('受控preview拒绝外部Origin、跨租户头和非白名单写入，不向浏览器泄露token', async () => {
  const forwarded = [];
  const server = createInvocationPreview({ brainOrigin:'http://127.0.0.1:5999', tenantId:'preview-test', operatorId:'preview-operator', token:'server-only-secret', staticRoot:'/missing', fetcher:async (url, init) => { forwarded.push({url, init}); return new Response(JSON.stringify({status:'ready'}), {status:200}); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const denied = await fetch(origin+'/api/brain/invocations', {method:'POST',headers:{origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});
    assert.equal(denied.status,403);
    assert.equal((await fetch(origin+'/api/brain/tasks', {method:'POST',headers:{origin},body:'{}'})).status,404);
    assert.equal((await fetch(origin+'/api/brain/invocations/resolve',{method:'POST',headers:{origin,'x-tenant-id':'other'},body:'{}'})).status,403);
    const ok = await fetch(origin+'/api/brain/invocations/resolve',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:'{}'});
    assert.equal(ok.status,200); assert.equal((await ok.text()).includes('server-only-secret'),false);
    assert.equal(forwarded.length,1); assert.equal(forwarded[0].init.headers['x-tenant-id'],'preview-test');
    assert.equal(forwarded[0].init.headers['x-internal-token'],'server-only-secret');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('仅loopback后端且显式tenant/operator/token可启动', () => {
  assert.throws(() => createInvocationPreview({brainOrigin:'https://production.example',tenantId:'a',operatorId:'b',token:'x'}));
  assert.throws(() => createInvocationPreview({brainOrigin:'http://127.0.0.1:5999'}));
});

test('真实HTTP传输固定服务端目的地址，客户端query不能改变上游主机', async () => {
  const seen = [];
  const upstream = createServer((req,res) => { seen.push({url:req.url,host:req.headers.host,tenant:req.headers['x-tenant-id']});res.writeHead(200,{'Content-Type':'application/json'}).end('{"readiness":"blocked"}'); });
  await new Promise(resolve => upstream.listen(0,'127.0.0.1',resolve));
  const upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
  const preview = createInvocationPreview({brainOrigin:upstreamOrigin,tenantId:'scratch',operatorId:'operator',token:'fixture-secret'});
  await new Promise(resolve => preview.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${preview.address().port}`;
  try {
    const response = await fetch(origin+'/api/brain/invocations/resolve?next=http%3A%2F%2Fevil.example',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{readiness:'blocked'});
    assert.deepEqual(seen,[{url:'/api/brain/invocations/resolve?next=http%3A%2F%2Fevil.example',host:new URL(upstreamOrigin).host,tenant:'scratch'}]);
  } finally { await new Promise(resolve => preview.close(resolve));await new Promise(resolve => upstream.close(resolve)); }
});
