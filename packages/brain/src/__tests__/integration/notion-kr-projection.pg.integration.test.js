import { describe, it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { runNotionKrProjection, KR_DB_PROPERTIES } from '../../projection/key-results.js';

describe('独立 KR 投影真实 PostgreSQL', () => {
  it('原始指标独立投影、链接真实入库且第二轮零远程写，事务最终回滚', async () => {
    const pool = new pg.Pool({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'cecelia_test', user: process.env.DB_USER || 'cecelia', password: process.env.DB_PASSWORD });
    const client = await pool.connect();
    const krId = randomUUID(), dbId = randomUUID(), pageId = randomUUID();
    const pages = new Map();
    const requests = [];
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE notion_projection_map SET status='dormant' WHERE brain_table='key_results'`);
      await client.query(`INSERT INTO notion_projection_map(notion_db_id,title,face,brain_table,direction,vessel,status)
        VALUES ($1,'Brain Key Results','mirror','key_results','push','notion-kr-projection','active')`, [dbId]);
      await client.query(`INSERT INTO key_results(id,title,status,progress,current_value,target_value,unit,metadata)
        VALUES ($1,'投影集成验收','active',25,2,8,'条','{"progress_source":"projects_v1"}')`, [krId]);
      // 单事务内可见真实目标行；只限定读集，不替代任何投影 SQL 写入。
      const scoped = { query: (sql, args) => client.query(sql.includes('FROM key_results kr')
        ? sql.replace('ORDER BY kr.updated_at, kr.id', `WHERE kr.id='${krId}' ORDER BY kr.updated_at, kr.id`) : sql, args) };
      const notionReq = async (_token, path, method, body) => {
        requests.push({ path, method, body });
        if (path === `/databases/${dbId}`) return { title: [{ plain_text: 'Brain Key Results' }],
          properties: Object.fromEntries(Object.entries(KR_DB_PROPERTIES).map(([name, spec]) => [name, { type: Object.keys(spec)[0] }])) };
        if (path.endsWith('/query')) return { results: [] };
        if (path === '/pages') { pages.set(pageId, body); return { id: pageId }; }
        throw new Error(`未预期 Notion 请求: ${path}`);
      };
      const now = Date.now();
      expect(await runNotionKrProjection(scoped, { token: 'fake', notionReq, now })).toMatchObject({ created: 1 });
      const link = await client.query(`SELECT external_id,content_hash FROM projection_links WHERE target='notion' AND entity_type='key_results' AND entity_id=$1`, [krId]);
      expect(link.rows).toHaveLength(1);
      expect(link.rows[0].external_id).toBe(pageId);
      expect(link.rows[0].content_hash).toMatch(/^[a-f0-9]{40}$/);
      expect(pages.get(pageId).properties.Current.number).toBe(2);
      expect(pages.get(pageId).properties.Target.number).toBe(8);
      expect(pages.get(pageId).properties.Progress.number).toBe(25);
      requests.length = 0;
      expect(await runNotionKrProjection(scoped, { token: 'fake', notionReq, now: now + 300001 })).toMatchObject({ skipped: 1 });
      expect(requests).toHaveLength(0);
      const unchanged = (await client.query('SELECT progress,current_value,target_value FROM key_results WHERE id=$1', [krId])).rows[0];
      expect([unchanged.progress, Number(unchanged.current_value), Number(unchanged.target_value)]).toEqual([25, 2, 8]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });
});
