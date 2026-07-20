// test-pairing 代理文件
describe('captures route (pairing stub)', () => {
  it('validates captures.js module exports', async () => {
    const mod = await import('../captures.js');
    expect(mod).toBeDefined();
  });
});
