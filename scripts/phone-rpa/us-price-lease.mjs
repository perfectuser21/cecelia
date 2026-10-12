/** 业务操作必须确认租约；丢失后只允许精确 owner 的清理。任务 c5f6e683。 */
export async function markPhoneLeaseLost(owner, run) {
  if (!/^price[0-9a-f]{64}$/i.test(owner)) throw new Error('invalid price owner');
  const script = 'import sys,json,re,pathlib; o=json.load(sys.stdin); assert re.fullmatch(r"price[0-9a-f]{64}",o,re.I); p=pathlib.Path("/Users/jinnuoshengyuan/Library/Caches/us-price-native-staging/agent-runs")/o; p.mkdir(parents=True,exist_ok=True); (p/"lease-lost").write_text("lease_lost"); print(json.dumps({"owner":o,"stopped":True}))';
  const result = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'xian-m4', 'python3', '-c', `'${script}'`], JSON.stringify(owner));
  if (result.code !== 0) throw new Error('lease cleanup: 远端停止标记失败');
  const receipt = JSON.parse(result.stdout);
  if (receipt.owner !== owner || receipt.stopped !== true) throw new Error('lease cleanup: 停止标记回读不符');
  return receipt;
}

export function createLeaseGuard({ taskId, owner, request, onLost, leaseSeconds = 900, heartbeatMs = 180000, now = Date.now }) {
  let lost = false, closed = false, pending, cleanup, cleanupError;
  let confirmedAt = now();
  const loss = () => Object.assign(new Error('lease_lost: 停止新业务，保留原 owner 收尾'), { code: 'lease_lost' });
  function assertOwned() { if (lost) throw loss(); }
  function lose() {
    if (lost) return;
    lost = true;
    // 立即挂上 rejection handler；定时器不会产生未处理拒绝，close/settle 仍把失败交给调用者。
    cleanup = Promise.resolve().then(() => onLost?.()).catch(error => { cleanupError = error; });
  }
  async function check() {
    assertOwned();
    if (closed) throw new Error('lease_guard_closed');
    if (!pending) {
      pending = (async () => {
        try {
          const result = await request(`/tasks/${taskId}/heartbeat`, 'POST', { claimer: owner, lease_seconds: leaseSeconds });
          if (result?.ok !== true) throw Object.assign(new Error('lease_lost: invalid heartbeat'), { code: 'lease_lost' });
          confirmedAt = now();
        } catch (error) {
          if (error.status === 409 || error.code === 'lease_lost' || /\b409\b|lease_lost/.test(error.message)
              || now() - confirmedAt >= leaseSeconds * 1000) lose();
          assertOwned();
          throw error;
        }
      })().finally(() => { pending = null; });
    }
    await pending;
    assertOwned();
  }
  const timer = setInterval(() => { check().catch(() => {}); }, heartbeatMs);
  timer.unref?.();
  async function settle() { await cleanup; if (cleanupError) throw cleanupError; }
  return {
    get lost() { return lost; },
    check, assertOwned, settle,
    async run(operation) { await check(); const value = await operation(); assertOwned(); return value; },
    async close() { closed = true; clearInterval(timer); await pending?.catch(() => {}); await settle(); },
  };
}
