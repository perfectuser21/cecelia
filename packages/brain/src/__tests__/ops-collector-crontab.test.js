/**
 * 排程台账第四来源：us-vps 宿主 crontab。
 *
 * 为什么要收：ops_schedule_entries 已有 gha/github 20 条、openclaw/mmv 41 条、
 * launchd/local 1 条，唯独 us-vps 宿主 crontab 的 19 条业务活（Notion 派单轮询、
 * opc-* 五个 Notion 同步、磁盘/网关守卫、库备份）**完全不在台账里**，
 * Notion 上零留痕。团队要能看见全部排程，这是缺的那一块。
 *
 * 三类行必须分清（真表 2026-09-21 实证）：
 *  ① 活的：`<每30分> cd /opt/openclaw && ... opc-objects-sync.py`
 *  ② **被注释掉的活**：`#[retired-0921] 45 20 * * * docker restart openclaw-gateway`
 *     —— 收，标 last_state=disabled。沿用 openclaw 腿的原则：
 *     看不见的禁用等于悄悄少干活。
 *  ③ 纯说明注释：`# OPC 经营对象 飞书->Notion upsert（每30分）` —— 不是活，跳过。
 */
import { describe, it, expect } from 'vitest';
import { parseCrontab } from '../ops-collector.js';

const REAL_SAMPLE = [
  '# OPC 经营对象 飞书->Notion upsert（每30分）— 2026-09-11 从 hk-vps 迁入',
  '*/30 * * * * cd /opt/openclaw && set -a && . /root/.opc-notion.env && set +a && /usr/bin/python3 /opt/openclaw/opc-objects-sync.py >> /var/log/opc-objects.log 2>&1',
  '#[retired-0921] 45 20 * * * docker restart openclaw-gateway >/dev/null 2>&1 # openclaw-restart',
  '*/3 * * * * cd /opt/openclaw && /usr/bin/python3 /opt/openclaw/notion-qiumi-delegate.py >> /var/log/d.log 2>&1 # notion-qiumi-delegate',
  '',
  'MAILTO=""',
  '*/5 * * * * /root/bin/disk-gateway-guard.sh',
  '@daily /root/bin/backup.sh',
].join('\n');

describe('parseCrontab', () => {
  it('活的行收进来，schedule_desc 带 UTC 口径', () => {
    const rows = parseCrontab(REAL_SAMPLE);
    const sync = rows.find((r) => r.label.includes('opc-objects-sync'));
    expect(sync, `没解析出 opc-objects-sync，实得标签：${rows.map((r) => r.label).join(' | ')}`).toBeTruthy();
    expect(sync.kind).toBe('crontab');
    expect(sync.schedule_desc).toContain('*/30 * * * *');
    expect(sync.schedule_desc).toContain('UTC');
    expect(sync.last_state).toBe(null);
  });

  it('行尾 `# 名字` 优先当标签（人给的名字比推断的好）', () => {
    const rows = parseCrontab(REAL_SAMPLE);
    expect(rows.map((r) => r.label)).toContain('notion-qiumi-delegate');
  });

  it('被注释掉的活也收，标 disabled——看不见的禁用等于悄悄少干活', () => {
    const rows = parseCrontab(REAL_SAMPLE);
    const retired = rows.find((r) => r.label === 'openclaw-restart');
    expect(retired, '被 #[retired-0921] 注释掉的活没被收进来').toBeTruthy();
    expect(retired.last_state).toBe('disabled');
    expect(retired.schedule_desc).toContain('45 20 * * *');
  });

  it('纯说明注释不是活，不许混进台账', () => {
    const rows = parseCrontab(REAL_SAMPLE);
    expect(rows.some((r) => r.label.includes('飞书->Notion upsert'))).toBe(false);
    expect(rows.some((r) => String(r.schedule_desc).includes('从 hk-vps 迁入'))).toBe(false);
  });

  it('空行与 VAR=value 环境行跳过', () => {
    const rows = parseCrontab(REAL_SAMPLE);
    expect(rows.some((r) => r.label.includes('MAILTO'))).toBe(false);
  });

  it('@daily 之类宏也认', () => {
    const rows = parseCrontab(REAL_SAMPLE);
    const daily = rows.find((r) => r.schedule_desc.includes('@daily'));
    expect(daily, '@daily 宏没被识别').toBeTruthy();
    expect(daily.label).toContain('backup.sh');
  });

  it('同一脚本多条不同排期 → 标签必须互不相同（label 是 upsert 主键的一部分）', () => {
    const multi = [
      '10 22 * * * /usr/bin/python3 /opt/openclaw/opc-kr-current.py',
      '35 3,9 * * * /usr/bin/python3 /opt/openclaw/opc-kr-current.py',
      '30 16 * * * /usr/bin/python3 /opt/openclaw/opc-kr-current.py',
    ].join('\n');
    const rows = parseCrontab(multi);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.label)).size, '三条同脚本不同排期的标签撞了，会互相覆盖只剩一条').toBe(3);
  });

  it('标签必须由排期决定，不许靠出现顺序——换行序后同一条活的标签不能变', () => {
    // 只断言"唯一"不够：撞名加序号的兜底也能让标签唯一，但那是按出现顺序给的。
    // crontab 行一换位置，`opc-kr-current.py #2` 就挂到另一条排期上，
    // (source, host_alias, label) 这个 upsert 键随之漂移，台账每轮反复建行删行。
    const lines = [
      '10 22 * * * /usr/bin/python3 /opt/openclaw/opc-kr-current.py',
      '35 3,9 * * * /usr/bin/python3 /opt/openclaw/opc-kr-current.py',
      '30 16 * * * /usr/bin/python3 /opt/openclaw/opc-kr-current.py',
    ];
    const pair = (src) => Object.fromEntries(
      parseCrontab(src.join('\n')).map((r) => [r.schedule_desc, r.label]),
    );
    expect(
      pair([...lines].reverse()),
      '把 crontab 行倒序后，排期↔标签的对应关系变了——标签依赖出现顺序，不是由排期决定',
    ).toEqual(pair(lines));
  });

  it('next_run_utc 一律 null——不算就不猜（同 parseGhaCron 的口径）', () => {
    for (const r of parseCrontab(REAL_SAMPLE)) {
      expect(r.next_run_utc ?? null).toBe(null);
    }
  });

  it('空表抛错，不当真空——否则一次取数失败会把整份台账标 inactive', () => {
    expect(() => parseCrontab('')).toThrow(/0 条|空/);
    expect(() => parseCrontab('# 全是注释\n\nMAILTO=""')).toThrow(/0 条|空/);
  });
});
