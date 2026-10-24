// write-guard HTTP 外壳。跑在 Commander 账本所在的主机（hk-vps），
// 让跨机器的 worker（XIAN-M4-PHONE 等）能拿到写入令牌。
//
// 只是外壳：判定全部交给 guard-core，与 CLI 共用同一份逻辑。
//
// 安全模型（与原本的文件版等价，不是放宽）：
//   原来 = 谁能读到 Commander 账本文件谁就能签发（靠文件系统权限）
//   现在 = 谁在 tailnet 内 且 拿得出本次 run 的 lease_id 谁就能签发
// lease_id 由 Commander 每次 run 现签、只发给当班 worker，核心里本来就在校验它
// （不匹配即 Commander lease mismatch）。再叠加 Tailscale 只允许 tailnet 访问，
// 因此没有引入新的攻击面。**绝不要把这个服务暴露到公网。**

import http from 'node:http';
import { authorizeWrite, DEFAULT_STATE_DIR } from './guard-core.js';

/** 请求体上限：授权请求只有十几个短字段，超过即恶意或错误 */
const MAX_BODY_BYTES = 64 * 1024;

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        // 停止累积（不把超大 body 读进内存），但**不在这里断连**——
        // 直接 destroy 会让客户端收到 ECONNRESET 而看不到 413，无从判断是被拒还是网络抖动。
        // 交给调用方先把 413 发出去再销毁。
        req.pause();
        reject(Object.assign(new Error('payload too large'), { code: 'TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createGuardServer({ stateDir = DEFAULT_STATE_DIR, logger = console } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/health') {
      return send(res, 200, { ok: true, service: 'workflow-guard', state_dir: stateDir });
    }
    if (url.pathname !== '/authorize') return send(res, 404, { ok: false, error: 'Not found' });
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Use POST' });

    let raw;
    try {
      raw = await readBody(req);
    } catch (error) {
      if (error.code === 'TOO_LARGE') {
        send(res, 413, { ok: false, error: 'Payload too large' });
        req.destroy();   // 响应已写出，此时才丢弃剩余上行数据
        return;
      }
      return send(res, 400, { ok: false, error: 'Cannot read request body' });
    }

    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return send(res, 400, { ok: false, error: 'Invalid JSON body' });
    }

    let result;
    try {
      result = authorizeWrite({ ...input, state_dir: stateDir });
    } catch (error) {
      // core 承诺不抛；真抛了说明是意料外的 bug，这时才是 500
      logger.error?.('[workflow-guard] unexpected failure:', error.message);
      return send(res, 500, { ok: false, error: 'Guard internal error' });
    }

    // 拒绝是业务判定不是服务故障，一律 403 —— 包括"账本读不到"，
    // 因为对调用方而言那等同于"你无权/身份不对"，不该让它误以为服务挂了而重试风暴。
    if (!result.ok) {
      logger.warn?.(`[workflow-guard] denied ${input?.run_id}/${input?.stage_id}: ${result.error}`);
      return send(res, 403, result);
    }
    return send(res, 200, result);
  });
}

/** 直接运行即启动（systemd 用）。GUARD_PORT / GUARD_HOST / GUARD_STATE_DIR 可覆盖。 */
export function startFromEnv(env = process.env) {
  const port = Number(env.GUARD_PORT || 8477);
  const host = env.GUARD_HOST || '0.0.0.0';
  const stateDir = env.GUARD_STATE_DIR || DEFAULT_STATE_DIR;
  const server = createGuardServer({ stateDir });
  server.listen(port, host, () => {
    console.log(`[workflow-guard] listening on ${host}:${port}, state_dir=${stateDir}`);
  });
  return server;
}
