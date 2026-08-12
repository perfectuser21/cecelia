// alerting.js — mcp-readonly 服务的运维告警（Task 14）。
//
// Bark 发送逻辑抄自 packages/brain/src/notifier.js 的 sendBark()：同样的
// `https://api.day.app/${BARK_TOKEN}/${title}/${body}` URL 格式、同样从
// BARK_TOKEN 环境变量取 key、同样"没配 token 就直接跳过、不报错"、同样
// 8s 超时 + 非 200 code 只记日志不抛异常。mcp-readonly 是独立于 Brain 的小
// 服务，没有 Brain 那套 receipt/dedupe 基础设施（PG receipts 表、dedupe.js），
// 这里不搬那部分——本服务的四类告警都已经在 AlertTracker 里做了阈值内的
// 状态重置（触发后清零），不需要再叠一层跨请求去重。
//
// token 是否要 hash 存储：Task 6 审查把 packages/mcp-readonly/src/rate-limit.js
// 的限流分桶 key 从明文 token 改成了 sha256 hash（commit a3d9385d09，理由是
// "防 debug 日志泄露明文 token"）。AlertTracker.authFailures / rateLimited 这
// 两个 Map 是同一种"按 token 分桶计数"结构，同样可能在排障时被整体 dump 到
// 日志或让人读取内存快照——跟 rate-limit.js 当初的风险场景等同，所以这里
// 沿用同样的处理：Map key 一律存 sha256(token) 而不是明文，Bark 消息文本里
// 也只带 token 末 4 位（帮助人工定位是哪个 token，不构成明文泄露）。
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIVE_MIN = 5 * 60 * 1000;
const TEN_MIN = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function last4(token) {
  return token.slice(-4);
}

export class AlertTracker {
  constructor({ sendBark, now = () => Date.now() }) {
    this.sendBark = sendBark;
    this.now = now;
    this.authFailures = new Map(); // hash(token) -> timestamps[]
    this.dbFailureCount = 0;
    this.restarts = [];
    this.rateLimited = new Map(); // hash(token) -> timestamps[]
  }

  _prune(arr, windowMs) {
    const cutoff = this.now() - windowMs;
    return arr.filter((t) => t > cutoff);
  }

  async recordAuthFailure(token) {
    const key = hashToken(token);
    const list = this._prune(this.authFailures.get(key) || [], FIVE_MIN);
    list.push(this.now());
    this.authFailures.set(key, list);
    if (list.length >= 10) {
      await this.sendBark(
        `鉴权失败：5分钟内 token ...${last4(token)} 失败 ${list.length} 次，疑似暴力破解`
      );
      this.authFailures.set(key, []);
    }
  }

  async recordDbFailure() {
    this.dbFailureCount += 1;
    if (this.dbFailureCount >= 3) {
      await this.sendBark(`DB连接失败：连续 ${this.dbFailureCount} 次，疑似下线`);
      this.dbFailureCount = 0;
    }
  }

  recordDbSuccess() {
    this.dbFailureCount = 0;
  }

  async recordRestart() {
    this.restarts = this._prune(this.restarts, ONE_HOUR);
    this.restarts.push(this.now());
    if (this.restarts.length > 3) {
      await this.sendBark(`重启风暴：1小时内重启 ${this.restarts.length} 次，疑似 crash loop`);
      this.restarts = [];
    }
  }

  async recordRateLimited(token) {
    const key = hashToken(token);
    const list = this._prune(this.rateLimited.get(key) || [], TEN_MIN);
    list.push(this.now());
    this.rateLimited.set(key, list);
    if (list.length > 5) {
      await this.sendBark(
        `限流触发：10分钟内 token ...${last4(token)} 触发限流 ${list.length} 次，疑似token泄露`
      );
      this.rateLimited.set(key, []);
    }
  }

  // 跨进程重启计数持久化。
  //
  // recordRestart() 是纯内存态：AlertTracker 每次进程启动都会被重新 new 一次，
  // 进程一崩溃/重启，内存就清零——"1小时内重启>3次"这种判断天然需要跨越多个
  // 独立进程的生命周期，唯一能在进程边界之间存活的是磁盘。这里选择最简单可靠
  // 的方案：往 logs/ 目录写一个小 JSON 文件，内容是重启时间戳数组；每次进程
  // 启动调用一次本方法：读文件 → 剪掉超过1小时的旧时间戳 → 追加本次启动时间戳
  // → 判断是否超阈值 → 写回文件（触发后清零，跟其它三类告警的"触发后重置"
  // 行为保持一致，避免每次启动都重复告警）。
  //
  // 不用 sqlite/DB 是因为 mcp-readonly 本身连接的是只读库（见 self-check.js），
  // 不应该往生产/共享存储写运维状态；不用进程外部的 PID 文件计数是因为那测的
  // 是"同时活着几个进程"而不是"多久内重启了几次"，语义不对。文件读写失败
  // （文件不存在、内容损坏、目录不存在）一律当作"没有历史记录"处理，不能因为
  // 这个旁路告警机制本身出故障就拖慢或搞挂服务启动。
  //
  // 已知局限：这套机制只能捕捉"跑到了 server.js 启动 IIFE 里这一行代码"的
  // 重启。如果崩溃发生得更早——比如模块加载阶段的语法错误、import 解析失败、
  // 依赖缺失导致进程在 require/import 阶段就直接退出——本方法根本不会被
  // 调用到，这类重启不会被计入。这是"进程内自己记账"这种方案的天然边界，
  // 要覆盖这类更早期的崩溃，需要进程外部、supervisor 级别的兜底（比如按
  // launchd 的 exit code / 重启次数计数），不是本任务范围要解决的问题。
  //
  // 读→剪→写不是原子操作：理论上如果同一时刻有两个进程实例并发调用本方法
  // （两次读到同一份旧内容、各自独立写回，后写的会覆盖先写的），存在计数
  // 竞态。生产环境靠 launchd 的 KeepAlive 单实例语义 + ThrottleInterval=12s
  // （见下方"触发后清零"处注释）天然避免了真正并发的多进程同时跑这段代码，
  // 实际风险很低；如果以后需要更严格的正确性保证，可以升级成 temp 文件写入
  // 再 rename 的原子写模式。
  async recordRestartPersisted(filePath) {
    let timestamps = [];
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        timestamps = parsed;
      }
    } catch {
      // 文件不存在（首次启动）或内容损坏，都当作零历史处理
      timestamps = [];
    }

    timestamps = this._prune(timestamps, ONE_HOUR);
    timestamps.push(this.now());

    // 触发后清零（跟其它三类告警一致）：结合 launchd KeepAlive 的
    // ThrottleInterval=12s（进程崩溃后至少等 12s 才会被拉起下一次），crash
    // loop 场景下大约每 48 秒（4 次重启才会再次凑够阈值）才会收到下一次
    // Bark。这是权衡后的结论——清零是为了不让同一次 crash loop 疯狂刷屏
    // 告警，48 秒的复发间隔在故障还没解决前依然能持续提醒，不是漏想的坑。
    const triggered = timestamps.length > 3;
    const toPersist = triggered ? [] : timestamps;

    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(toPersist), 'utf-8');
    } catch (err) {
      // 写盘失败不应该阻塞服务启动——顶多这次告警状态没记住，下次启动重新算。
      console.error('[mcp-readonly][alerting] 重启计数持久化写入失败:', err.message);
    }

    if (triggered) {
      await this.sendBark(`重启风暴：1小时内重启 ${timestamps.length} 次，疑似 crash loop`);
    }
  }
}

// recordRestartPersisted() 默认使用的持久化文件路径：包根目录下的
// logs/mcp-readonly-restarts.json。logs/ 已经在仓库根 .gitignore 里全局忽略
// （`logs/` 规则），不需要额外补 ignore 规则；这个文件本身是运行时状态，不
// 应该进 git。
export function defaultRestartLogPath() {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  return join(packageRoot, 'logs', 'mcp-readonly-restarts.json');
}

// 真正对外发 Bark 通知，抄自 packages/brain/src/notifier.js 的 sendBark()：
// 同样的 URL 拼法 `https://api.day.app/${BARK_TOKEN}/${title}/${body}`、同样
// 没配 BARK_TOKEN 就静默跳过（不当错误处理，因为很多环境如 CI/本地开发根本
// 不指望真的发通知）、同样对非 200 code 和网络异常只记 console.error 不向上
// 抛出（告警发送本身失败不应该干扰调用方的主流程，比如不能因为 Bark 发送
// 失败就让鉴权中间件 500）。运行时读 env 而不是模块加载时缓存一份常量，
// 方便测试/多环境场景下动态切换。
export async function sendBarkAlert(title, body) {
  const barkToken = process.env.BARK_TOKEN || '';
  if (!barkToken) return false;

  try {
    const url = `https://api.day.app/${barkToken}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const result = await resp.json();
    if (result.code !== 200) {
      console.error('[mcp-readonly][alerting] Bark 推送失败:', result.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[mcp-readonly][alerting] Bark 推送异常:', err.message);
    return false;
  }
}
