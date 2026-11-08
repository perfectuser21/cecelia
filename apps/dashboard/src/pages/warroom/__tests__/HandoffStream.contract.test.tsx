import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import express from 'express';
import request from 'supertest';

const boundary = vi.hoisted(() => ({ query: vi.fn(), write: vi.fn() }));
vi.mock('../../../../../../packages/brain/src/db.js', () => ({ default: { query: boundary.query } }));
vi.mock('../../../../../../packages/brain/src/work-routing-store.js', () => ({ createRoutedTask: boundary.write }));
vi.mock('../../../../../../packages/brain/src/lib/commander-improvement.js', () => ({ improvementRepair: boundary.write, readCommanderDiagnosis: boundary.write }));
vi.mock('../../../../../../packages/brain/src/handoff.js', () => ({ buildHandoff: boundary.write, saveHandoff: boundary.write }));
vi.mock('../../../../../../packages/brain/src/lib/project-brief-apply.js', () => ({ applyHandoffBriefDelta: boundary.write }));
vi.mock('../WarRoomPage', () => ({ relativeTime: () => '刚刚', verdictMeta: () => null, absoluteShanghai: () => '' }));

import { prepareHandoffForWrite } from '../../../../../../packages/brain/src/lib/relay-baton.js';
import router from '../../../../../../packages/brain/src/routes/handoffs.js';
import { HandoffStream, handoffRows } from '../WarRoomPanels';

async function readHandoffResponse() {
  const server = express().use('/api/brain/handoffs', router).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    return await request(server).get('/api/brain/handoffs?limit=8');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  boundary.write.mockImplementation(() => { throw Error('禁止业务写入'); });
});
afterEach(() => {
  cleanup();
  expect(boundary.write).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('真实交接生产者到HTTP响应再到接力史组件', () => {
  it.each(['resume_headed', 'dispatch_headless', 'decision', 'note'])('显示 %s 的下一步标题', async kind => {
    const title = `下一步标题：${kind}`;
    const handoff = prepareHandoffForWrite({ payload: { headed_manual: true } }, {
      schema_version: 1, next_steps: [{ kind, title }],
    }).handoff;
    expect(handoff.next_steps).toEqual([{ kind, title }]);
    boundary.query.mockResolvedValueOnce({ rows: [{ id: 'owned', title: '真实合同交接单', handoff }] });
    const response = await readHandoffResponse();
    expect(response.status).toBe(200);
    expect(boundary.query).toHaveBeenCalledTimes(1);
    expect(response.body.handoffs[0].next_steps).toEqual(handoff.next_steps);
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => response.body });
    vi.stubGlobal('fetch', fetch);
    render(<HandoffStream />);
    expect(await screen.findByTitle(title)).toHaveTextContent(title);
    expect(fetch).toHaveBeenCalledWith('/api/brain/handoffs?limit=8');
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });

  it('历史字符串保持显示，非法对象不显示伪造的对象字符串', () => {
    const nextSteps = ['旧字符串下一步', null, {}, { title: {} }, { title: '' }];
    expect(handoffRows({ handoffs: nextSteps.map(step => ({ next_steps: [step] })) })
      .map(row => row.next_step)).toEqual(['旧字符串下一步', '', '', '', '']);
  });
});
