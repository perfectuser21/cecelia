import { ValidationError } from './map-nodes-edges.js';
import { redact } from '../redact.js';

export { ValidationError };

// 白名单：服务名 → 日志文件路径。硬编码，不接受任意路径参数（禁止调用方传路径穿越）。
//
// 路径来源核实（不是猜测）：
// - packages/brain/deploy/com.cecelia.brain.plist 的 StandardOutPath 就是这个路径
//   （LaunchDaemon 直接 node server.js 时的落盘位置）。
// - packages/brain/deploy/cecelia-watchdog.sh 里 watchdog 重启 Brain 时也 append 到
//   同一个 LOG_DIR/brain.log。
// - scripts/ops/janitor.sh 步骤 1（"Brain/Bridge LaunchDaemon 日志截断"）用
//   LOGS_DIR="$CECELIA_REPO/logs" 定期截断这个文件，说明它是当前活跃、持续被写入的
//   真实文件，不是废弃路径。
// - 生产 Brain 现在跑在 docker-compose 的 cecelia-node-brain 容器里
//   （logging.driver=json-file，容器内 stdout 走 docker 自己的日志），但
//   docker-compose.yml 把整个仓库 `/Users/administrator/perfect21/cecelia` 原路径
//   rw bind-mount 进容器，容器内代码若相对仓库根写 `logs/`，落盘位置与宿主机
//   LaunchDaemon 场景是同一个绝对路径——两种部署形态殊途同归，都落在这里。
//   `/var/log/cecelia/brain.log` 在整个仓库里没有任何脚本/配置引用，是错的，已改掉。
export const SERVICE_LOG_WHITELIST = {
  'cecelia-brain': '/Users/administrator/perfect21/cecelia/logs/brain.log',
};

// 只接受"读取最后 N 行"里的 N 是一个有意义的正整数；非法输入（NaN/Infinity/负数/小数/
// 非 number 类型）一律 fail-safe 回落到默认值 50，而不是把脏值透传给下游文件读取实现
// （readLogFn 的真实版本 Task 11 才接线，这里先兜住，不能指望调用方守规矩）。
function normalizeLines(lines) {
  if (typeof lines !== 'number' || !Number.isFinite(lines) || lines <= 0) {
    return 50;
  }
  return Math.min(Math.floor(lines), 200);
}

export async function getServiceLogs(readLogFn, { service, lines } = {}) {
  if (!Object.prototype.hasOwnProperty.call(SERVICE_LOG_WHITELIST, service)) {
    throw new ValidationError(`service 必须是白名单内的值：${Object.keys(SERVICE_LOG_WHITELIST).join(', ')}`);
  }
  const safeLines = normalizeLines(lines);
  const rawLines = await readLogFn(SERVICE_LOG_WHITELIST[service], safeLines);
  return { lines: rawLines.map(redact) };
}
