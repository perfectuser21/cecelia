import Test from 'supertest/lib/test.js';

/** 请求目标跟随实际监听地址族，保留 Supertest 起服和关闭服务的所有权。 */
export function installSupertestLoopback(TestClass) {
  const marker = Symbol.for('cecelia.supertest.listener-family');
  const original = TestClass.prototype.serverAddress;
  if (original[marker]) return;
  function listenerAddress(app, path) {
    const url = original.call(this, app, path);
    const address = app.address();
    if (!address || typeof address === 'string' || address.family !== 'IPv6') return url;
    const host = address.address === '::' ? '::1' : address.address;
    return url.replace('://127.0.0.1:', `://[${host}]:`);
  }
  Object.defineProperty(listenerAddress, marker, { value: true });
  TestClass.prototype.serverAddress = listenerAddress;
}

installSupertestLoopback(Test);
