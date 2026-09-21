// model-accounts-usage-probe.test.js — 探针纯函数单测（归一化 + gRPC-web/protobuf 解帧）
//
// 探针在 mmv 宿主上跑真网络，CI 不碰真凭据；这里只锁三家响应 → collector parser 形状的映射，
// 以及 Grok 帧解析在成功 / 非成功 trailers 下的行为。
import { describe, it, expect } from 'vitest';
import {
  normalizeWhamUsage,
  normalizeAnthropicUsage,
  normalizeGrokUsage,
  readVarint,
  decodeProtoFields,
  stripGrpcWebFrames,
  expandHome,
} from '../model-accounts-usage-probe.js';
import { parseChatgptWhamUsage, parseAnthropicUsage, parseGrokUsage } from '../ops-model-accounts-collector.js';

function varint(n) {
  const bytes = [];
  let v = n;
  do {
    let b = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) b |= 0x80;
    bytes.push(b);
  } while (v > 0);
  return Buffer.from(bytes);
}
function lenDelim(field, payload) {
  return Buffer.concat([varint(field * 8 + 2), varint(payload.length), payload]);
}
function varintField(field, value) {
  return Buffer.concat([varint(field * 8), varint(value)]);
}
function grpcFrame(flag, payload) {
  const head = Buffer.alloc(5);
  head[0] = flag;
  head.writeUInt32BE(payload.length, 1);
  return Buffer.concat([head, payload]);
}

describe('normalizeWhamUsage（2026-09-19 实测 wham 形状）', () => {
  it('7 天主窗归 seven_day，5 小时窗归 five_hour，reset_at 秒级 epoch → ISO', () => {
    const raw = {
      plan_type: 'pro',
      rate_limit: {
        primary_window: { used_percent: 1, limit_window_seconds: 604800, reset_after_seconds: 601586, reset_at: 1790410481 },
        secondary_window: { used_percent: 42, limit_window_seconds: 18000, reset_after_seconds: 100, reset_at: 1790000000 },
      },
    };
    const n = normalizeWhamUsage(raw);
    expect(n.plan_type).toBe('pro');
    expect(n.seven_day).toEqual({ usage_percent: 1, reset_time: new Date(1790410481 * 1000).toISOString() });
    expect(n.five_hour).toEqual({ usage_percent: 42, reset_time: new Date(1790000000 * 1000).toISOString() });
    // collector parser 直接可吃
    const parsed = parseChatgptWhamUsage(n);
    // schema 于 0921 扩了三键（task eb301e5a）：判据要靠 seven_day_reset_at 做
    // soon-reset 豁免。wham 的 primary_window 本来就带 reset_at，所以 codex
    // 账号也一并拿到了 7d 重置时刻——此前这个值被丢掉了。
    expect(parsed).toEqual({
      five_hour_pct: 42,
      seven_day_pct: 1,
      reset_at: new Date(1790000000 * 1000).toISOString(),
      seven_day_reset_at: new Date(1790410481 * 1000).toISOString(),
      seven_day_sonnet_pct: null,   // wham 无分层，诚实留空
      seven_day_opus_pct: null,
    });
  });

  it('secondary_window 为 null 时对应窗 null，parser 诚实留空不编造 0', () => {
    const n = normalizeWhamUsage({ rate_limit: { primary_window: { used_percent: 3, limit_window_seconds: 604800, reset_at: 1790410481 }, secondary_window: null } });
    expect(n.five_hour).toBeNull();
    expect(parseChatgptWhamUsage(n)).toEqual({
      five_hour_pct: null, seven_day_pct: 3, reset_at: null,
      seven_day_reset_at: new Date(1790410481 * 1000).toISOString(),
      seven_day_sonnet_pct: null, seven_day_opus_pct: null,
    });
  });

  it('reset_at 缺失时用 reset_after_seconds 推算；结构缺失不抛', () => {
    const now = 1_000_000_000_000;
    const n = normalizeWhamUsage({ rate_limit: { primary_window: { used_percent: 9, limit_window_seconds: 18000, reset_after_seconds: 60 } } }, now);
    expect(n.five_hour.reset_time).toBe(new Date(now + 60_000).toISOString());
    expect(normalizeWhamUsage(null)).toEqual({ plan_type: null, five_hour: null, seven_day: null });
  });
});

describe('normalizeAnthropicUsage', () => {
  it('oauth/usage 形状原样透传，collector parser 读 utilization/resets_at', () => {
    const raw = { five_hour: { utilization: 31, resets_at: '2026-09-19T09:40:00Z' }, seven_day: { utilization: 24 } };
    // 这份 fixture 的 seven_day 没带 resets_at → seven_day_reset_at 为 null（不编造）
    expect(parseAnthropicUsage(normalizeAnthropicUsage(raw))).toEqual({
      five_hour_pct: 31, seven_day_pct: 24, reset_at: '2026-09-19T09:40:00Z',
      seven_day_reset_at: null, seven_day_sonnet_pct: null, seven_day_opus_pct: null,
    });
    expect(normalizeAnthropicUsage(undefined)).toEqual({});
  });
});

describe('gRPC-web / protobuf 解帧', () => {
  it('readVarint 多字节；decodeProtoFields 识别 varint 与 length-delimited', () => {
    expect(readVarint(varint(300))).toEqual([300, 2]);
    const buf = Buffer.concat([varintField(1, 7), lenDelim(2, Buffer.from('hi'))]);
    const fields = decodeProtoFields(buf);
    expect(fields[0]).toMatchObject({ field: 1, wireType: 0, value: 7 });
    expect(fields[1].field).toBe(2);
    expect(fields[1].bytes.toString()).toBe('hi');
  });

  it('stripGrpcWebFrames 拆出 data 帧 + trailers 帧', () => {
    const body = Buffer.concat([grpcFrame(0x00, Buffer.from([1, 2, 3])), grpcFrame(0x80, Buffer.from('grpc-status:0\r\n'))]);
    const frames = stripGrpcWebFrames(body);
    expect(frames.map((f) => f.flag)).toEqual([0x00, 0x80]);
    expect(frames[0].payload).toEqual(Buffer.from([1, 2, 3]));
  });

  it('normalizeGrokUsage：内层 f1 包一层，f5 周期结束 → reset_at；无用量字段 = 0%，无 5h 窗', () => {
    const endSec = 1_790_000_000;
    const inner = Buffer.concat([
      lenDelim(4, varintField(1, endSec - 604800)),
      lenDelim(5, varintField(1, endSec)),
    ]);
    const data = lenDelim(1, inner);
    const body = Buffer.concat([grpcFrame(0x00, data), grpcFrame(0x80, Buffer.from('grpc-status:0\r\n'))]);
    const n = normalizeGrokUsage(body);
    expect(n).toEqual({ five_hour_pct: null, seven_day_pct: 0, reset_at: new Date(endSec * 1000).toISOString() });
    // parser 对 grok 仍是直通（值一个不改），只是 0921 起补齐 schema 的三个新键。
    // grok 探针不产出这些字段 → null（诚实留空，禁编造）。
    expect(parseGrokUsage(n)).toEqual({
      ...n, seven_day_reset_at: null, seven_day_sonnet_pct: null, seven_day_opus_pct: null,
    });
  });

  it('normalizeGrokUsage：trailers 非 grpc-status:0 → 抛错带状态文本（采集器据此归 key_expired）', () => {
    const body = grpcFrame(0x80, Buffer.from('grpc-status:7\r\ngrpc-message:bad-credentials\r\n'));
    expect(() => normalizeGrokUsage(body)).toThrow(/grpc-status:7/);
  });
});

describe('expandHome', () => {
  it('只展开开头的 ~/', () => {
    expect(expandHome('~/.grok/auth.json').startsWith('/')).toBe(true);
    expect(expandHome('/abs/path')).toBe('/abs/path');
  });
});
