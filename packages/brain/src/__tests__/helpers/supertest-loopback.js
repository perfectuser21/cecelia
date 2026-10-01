/** Supertest 的默认 IPv4 URL 必须跟随测试服务器实际绑定的地址族。 */
export function installSupertestLoopback(Test) {
  const installed = Symbol.for('cecelia.supertest.address-family');
  if (Test.prototype[installed]) return;
  const original = Test.prototype.serverAddress;
  Test.prototype.serverAddress = function (app, path) {
    // 保留库的自动起服及 _server 所有权，结束请求后仍由库关闭服务。
    const url = original.call(this, app, path);
    return app.address()?.family === 'IPv6' ? url.replace('//127.0.0.1:', '//[::1]:') : url;
  };
  Object.defineProperty(Test.prototype, installed, { value: true });
}
