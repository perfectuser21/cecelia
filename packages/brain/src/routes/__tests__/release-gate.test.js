import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import router from '../release-gate.js';
const app = express();
app.use('/release-gate', router);
describe('发布准入只读路由', () => {
  it.each(['post', 'put', 'patch', 'delete'])('%s拒绝写入并声明GET', async method => {
    const response = await request(app)[method]('/release-gate/nonexistent-frontier3');
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('GET');
  });
  it('不存在RTM返回明确未知，不假称PASS', async () => {
    const response = await request(app).get('/release-gate/nonexistent-frontier3');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ path_id: 'nonexistent-frontier3', verdict: 'NO_RTM', gaps: [] });
  });
});
