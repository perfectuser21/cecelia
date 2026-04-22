import { describe, it, expect } from 'vitest';
import {
  getIsoHandler,
  getTimezoneHandler,
  getUnixHandler,
  default as timeRouter,
} from '../../../packages/brain/src/routes/time-endpoints.js';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$/;
const OFFSET_RE = /^[+-]\d{2}:\d{2}$/;
// IANA 严格正则：只允许 UTC / GMT 或 `<Region>/<City>[/<SubCity>]`，
// 其中 Region 必须命中官方白名单。拒绝 `X`、`Foo`、`Abc123` 等通过宽松正则
// 的伪 IANA 字符串（对应 mutation 9）。
const IANA_RE = /^(UTC|GMT|(Asia|America|Europe|Africa|Australia|Pacific|Atlantic|Indian|Antarctica|Etc)\/[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z][A-Za-z0-9_+\-]*)?)$/;

function mockRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    body: null as any,
    headers,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) {
      this.body = payload;
      this.headers['content-type'] = 'application/json; charset=utf-8';
      return this;
    },
    set(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
  };
  return res;
}

function mockReq(query: Record<string, string> = {}) {
  return { query, headers: {}, method: 'GET' } as any;
}

describe('Workstream 1 — GET /api/brain/time/iso [BEHAVIOR]', () => {
  it('returns 200 with ISO 8601 string ending with Z or ±HH:MM and millisecond precision', () => {
    const res = mockRes();
    getIsoHandler(mockReq(), res);
    expect(res.statusCode).toBe(200);
    expect(typeof res.body?.iso).toBe('string');
    expect(res.body.iso).toMatch(ISO_RE);
  });

  it('ignores unknown query parameters and still returns 200 with valid iso', () => {
    const res = mockRes();
    getIsoHandler(mockReq({ foo: 'bar', unknown: '1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.iso).toMatch(ISO_RE);
  });

  it('timestamp is within 5 seconds of test execution time', () => {
    const before = Date.now();
    const res = mockRes();
    getIsoHandler(mockReq(), res);
    const after = Date.now();
    const t = Date.parse(res.body.iso);
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThanOrEqual(before - 5000);
    expect(t).toBeLessThanOrEqual(after + 5000);
  });
});

describe('Workstream 1 — GET /api/brain/time/timezone [BEHAVIOR]', () => {
  it('returns 200 with timezone, offset, iso fields all matching expected formats', () => {
    const res = mockRes();
    getTimezoneHandler(mockReq(), res);
    expect(res.statusCode).toBe(200);
    expect(typeof res.body?.timezone).toBe('string');
    expect(typeof res.body?.offset).toBe('string');
    expect(typeof res.body?.iso).toBe('string');
    expect(res.body.timezone).toMatch(IANA_RE);
    expect(res.body.offset).toMatch(OFFSET_RE);
    expect(res.body.iso).toMatch(ISO_RE);
  });

  it('offset string strictly matches ±HH:MM regex (rejects HHMM, ±H:MM, etc.)', () => {
    const res = mockRes();
    getTimezoneHandler(mockReq(), res);
    const offset = res.body.offset;
    expect(offset).toMatch(/^[+-]\d{2}:\d{2}$/);
    expect(offset).not.toMatch(/^[+-]\d{4}$/);
    expect(offset).not.toMatch(/^[+-]\d:\d{2}$/);
  });

  it('falls back to UTC and +00:00 when Intl.DateTimeFormat resolves to undefined', () => {
    const origIntl = (globalThis as any).Intl;
    const origTZ = process.env.TZ;
    try {
      (globalThis as any).Intl = {
        DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: undefined }) }),
      };
      delete process.env.TZ;
      const res = mockRes();
      getTimezoneHandler(mockReq(), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.timezone).toBe('UTC');
      expect(res.body.offset).toBe('+00:00');
    } finally {
      (globalThis as any).Intl = origIntl;
      if (origTZ === undefined) delete process.env.TZ; else process.env.TZ = origTZ;
    }
  });

  it('reads IANA timezone from Intl.DateTimeFormat (not hardcoded UTC) when resolvedOptions provides one', () => {
    // 反制 mutation 8：handler 直接硬编码 return { timezone: 'UTC', offset: '+00:00' }。
    // 该 mutation 会让 fallback 测试通过，但此处 Intl 返回 Pacific/Auckland 应被透传。
    const origIntl = (globalThis as any).Intl;
    const origTZ = process.env.TZ;
    try {
      (globalThis as any).Intl = {
        DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'Pacific/Auckland' }) }),
      };
      delete process.env.TZ;
      const res = mockRes();
      getTimezoneHandler(mockReq(), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.timezone).toBe('Pacific/Auckland');
    } finally {
      (globalThis as any).Intl = origIntl;
      if (origTZ === undefined) delete process.env.TZ; else process.env.TZ = origTZ;
    }
  });
});

describe('Workstream 1 — GET /api/brain/time/unix [BEHAVIOR]', () => {
  it('returns 200 with body.unix as a 10-digit positive integer (seconds, not milliseconds)', () => {
    const res = mockRes();
    getUnixHandler(mockReq(), res);
    expect(res.statusCode).toBe(200);
    expect(Number.isInteger(res.body?.unix)).toBe(true);
    expect(res.body.unix).toBeGreaterThan(0);
    expect(String(res.body.unix).length).toBe(10);
  });

  it('value is within 5 seconds of test execution Math.floor(Date.now()/1000)', () => {
    const before = Math.floor(Date.now() / 1000);
    const res = mockRes();
    getUnixHandler(mockReq(), res);
    const after = Math.floor(Date.now() / 1000);
    expect(res.body.unix).toBeGreaterThanOrEqual(before - 5);
    expect(res.body.unix).toBeLessThanOrEqual(after + 5);
  });

  it('returns Number type for unix field, not a string', () => {
    const res = mockRes();
    getUnixHandler(mockReq(), res);
    expect(typeof res.body?.unix).toBe('number');
    expect(typeof res.body.unix === 'string').toBe(false);
  });
});

describe('Workstream 1 — Response Content-Type [BEHAVIOR]', () => {
  it('GET /iso responds with application/json Content-Type header', () => {
    const res = mockRes();
    getIsoHandler(mockReq(), res);
    expect(res.headers['content-type']).toBeDefined();
    expect(res.headers['content-type']).toMatch(/application\/json/i);
  });

  it('GET /timezone responds with application/json Content-Type header', () => {
    const res = mockRes();
    getTimezoneHandler(mockReq(), res);
    expect(res.headers['content-type']).toBeDefined();
    expect(res.headers['content-type']).toMatch(/application\/json/i);
  });

  it('GET /unix responds with application/json Content-Type header', () => {
    const res = mockRes();
    getUnixHandler(mockReq(), res);
    expect(res.headers['content-type']).toBeDefined();
    expect(res.headers['content-type']).toMatch(/application\/json/i);
  });
});

describe('Workstream 1 — Router registration [BEHAVIOR]', () => {
  it('default exported router exposes 3 GET routes: /iso /timezone /unix', () => {
    const stack = (timeRouter as any)?.stack ?? [];
    const routes = stack
      .map((layer: any) => layer?.route)
      .filter(Boolean)
      .map((r: any) => ({
        path: r.path,
        methods: Object.keys(r.methods || {}).filter((m) => r.methods[m]),
      }));
    const paths = routes.map((r: any) => r.path).sort();
    expect(paths).toEqual(['/iso', '/timezone', '/unix']);
    for (const r of routes) {
      expect(r.methods).toContain('get');
    }
  });
});
