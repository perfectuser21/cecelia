import { ValidationError } from './map-nodes-edges.js';
import { redact } from '../redact.js';

export { ValidationError };

// 白名单：服务名 → docker 容器名。硬编码，不接受任意容器名/路径参数（禁止调用方逃逸）。
//
// 语义纠偏（曾经猜成"服务名→日志文件路径"，是错的，已改）：
// 生产 Brain 现在跑在 docker-compose.yml 的 `node-brain` 服务里
// （`container_name: cecelia-node-brain`，`logging.driver: json-file`），容器 stdout/stderr
// 全部走 docker 自己的日志驱动，从不落到宿主机 `/Users/administrator/perfect21/cecelia/logs/
// brain.log` 这个文件——那个文件是旧版 host LaunchDaemon 直跑 `node server.js` 形态
// （`packages/brain/deploy/com.cecelia.brain.plist`）留下的产物，实测这台机器上该文件
// 最后一次更新是 3 个月前（5 月），`launchctl list` 也确认现在没有 `com.cecelia.brain`
// 在跑。如果继续按"文件路径"语义接线 Task 11 的 readLogFn，会安静地返回一份三个月前的
// 僵尸日志、调用方完全看不出数据是假的——这比直接报错更危险，所以必须改成容器名语义。
//
// 真实 readLogFn 实现（Task 11 接线）应该执行 `docker logs <container> --tail <lines>`，
// 不是 fs.readFile 读文件。本文件本身不 spawn docker，只负责白名单校验 + 脱敏，把校验过的
// 容器名交给调用方注入的 readLogFn。
export const SERVICE_LOG_WHITELIST = {
  'cecelia-brain': 'cecelia-node-brain',
};

// 只接受"读取最后 N 行"里的 N 是一个有意义的正整数；非 number / NaN / Infinity / 非正数
// 一律 fail-safe 回落到默认值 50。合法正数会被向下取整成整数（比如 3.7 → 3，不是回落
// 默认值——下游 `docker logs --tail` 需要的是整数行数，取整即可满足语义，没必要为小数
// 输入报错或回落默认值），再 clamp 到最大 200，防止调用方要求过大的 tail 拖垮容器日志读取
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
  // readLogFn 的真实实现（Task 11）预期签名类似
  // `(containerName, tailLines) => docker logs <containerName> --tail <tailLines>` 的输出按行拆分。
  const rawLines = await readLogFn(SERVICE_LOG_WHITELIST[service], safeLines);
  return { lines: rawLines.map(redact) };
}
