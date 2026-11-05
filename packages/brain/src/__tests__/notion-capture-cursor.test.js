import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ db: vi.fn(), process: vi.fn(), unexpectedFetch: vi.fn(), realPush: null }));
vi.mock('../db.js', () => ({ default: {
  query: (...args) => { boundary.db(...args); throw Error('cursor test forbids canonical DB'); },
  connect: (...args) => { boundary.db(...args); throw Error('cursor test forbids canonical DB'); },
} }));
vi.mock('node:child_process', async original => ({ ...await original(), ...Object.fromEntries(
  ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync'].map(name => [name, (...args) => {
    boundary.process(name, ...args); throw Error('cursor test forbids host process');
  }]),
)}));
vi.mock('child_process', async original => ({ ...await original(), ...Object.fromEntries(
  ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync'].map(name => [name, (...args) => {
    boundary.process(name, ...args); throw Error('cursor test forbids host process');
  }]),
)}));
// Normal calls delegate to the real persistence consumer, except explicit throw injection.
vi.mock('../capture-inbox.js', async original => {
  const actual = await original(); boundary.realPush = actual.pushCapture;
  return { ...actual, pushCapture: vi.fn(actual.pushCapture) };
});
import { pushCapture } from '../capture-inbox.js';
import { runNotionCaptureIngest, __resetNotionCaptureIngestForTest } from '../notion-capture-ingest.js';
const START = Date.parse('2026-11-05T00:00:00.000Z'), FIVE_MINUTES = 5 * 60 * 1000, DAY = 24 * 60 * 60 * 1000;
const iso = milliseconds => new Date(milliseconds).toISOString();
const page = (id, edited = START - 60 * 60 * 1000) => ({
  id, last_edited_time: iso(edited), properties: { Name: { title: [{ plain_text: id }] } },
});
let pages, captures, atoms, requests, failInsertOnce, fatalOnce, pool;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(START);
  __resetNotionCaptureIngestForTest(); pushCapture.mockImplementation(boundary.realPush);
  vi.stubEnv('NOTION_INBOX_TOKEN', 'owned-notion-token'); vi.stubEnv('NOTION_INBOX_DB_ID', 'owned-inbox');
  pages = []; captures = new Map(); atoms = new Set(); requests = []; failInsertOnce = null; fatalOnce = false;
  // SQL protocol fixture only: no claim of PostgreSQL uniqueness/transaction verification.
  pool = { query: vi.fn(async (sql, params) => {
    if (String(sql).includes('INSERT INTO captures')) {
      const key = params[8];
      if (key === failInsertOnce) { failInsertOnce = null; throw Error('owned capture write unavailable'); }
      const inserted = !captures.has(key);
      if (inserted) captures.set(key, { id: `capture-${captures.size + 1}`, content: params[0] });
      else captures.get(key).content = params[0];
      return { rows: [{ id: captures.get(key).id, inserted }] };
    }
    if (String(sql).includes('INSERT INTO capture_atoms')) {
      const key = `${params[0]}:${params[2]}`, inserted = !atoms.has(key); atoms.add(key);
      return { rows: inserted ? [{ id: `atom-${atoms.size}` }] : [] };
    }
    throw Error('unexpected owned SQL');
  }) };
  vi.stubGlobal('fetch', async (url, options) => {
    if (url !== 'https://api.notion.com/v1/databases/owned-inbox/query') {
      boundary.unexpectedFetch(url, options); throw Error('cursor test forbids other network');
    }
    expect(options.headers.Authorization).toBe('Bearer owned-notion-token');
    const body = JSON.parse(options.body); requests.push(body);
    if (fatalOnce) { fatalOnce = false; return { ok: false, status: 401, json: async () => ({ message: 'owned unavailable' }) }; }
    // Actual filter/cursor controls visibility of unchanged pages, one page per response.
    const after = body.filter?.last_edited_time.after;
    const eligible = pages.filter(p => (!after || p.last_edited_time > after) && Date.parse(p.last_edited_time) <= Date.now());
    const offset = Number(body.start_cursor ?? 0);
    return { ok: true, json: async () => ({ results: eligible.slice(offset, offset + 1),
      has_more: offset + 1 < eligible.length, next_cursor: offset + 1 < eligible.length ? String(offset + 1) : null }) };
  });
});
afterEach(() => {
  expect(boundary.db).not.toHaveBeenCalled(); expect(boundary.process).not.toHaveBeenCalled();
  expect(boundary.unexpectedFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers();
});
const nextRun = async offset => { vi.setSystemTime(START + offset); return runNotionCaptureIngest(pool); };
const firstPageFilters = () => requests.filter(r => !r.start_cursor).map(r => r.filter.last_edited_time.after);
it.each(['null', 'throw'])('replays an unchanged failed page after %s and dedupes successful pages through real pushCapture', async failure => {
  pages = [page('good'), page('bad')];
  if (failure === 'null') failInsertOnce = 'notion:inbox:bad';
  else pushCapture.mockImplementationOnce(boundary.realPush).mockRejectedValueOnce(Error('owned push failed'));
  const first = await runNotionCaptureIngest(pool), second = await nextRun(FIVE_MINUTES);
  expect(first).toMatchObject({ pages: 2, pushed: 1, skipped: 0, errors: 1 });
  expect(second).toMatchObject({ pages: 2, pushed: 1, skipped: 1, errors: 0 });
  expect(firstPageFilters()).toEqual([iso(START - DAY), iso(START - DAY)]);
  expect(pushCapture.mock.calls.map(([, args]) => args.dedupeKey)).toEqual([
    'notion:inbox:good', 'notion:inbox:bad', 'notion:inbox:good', 'notion:inbox:bad',
  ]);
  expect([...captures.keys()]).toEqual(['notion:inbox:good', 'notion:inbox:bad']); expect(atoms.size).toBe(2);
  expect(await nextRun(2 * FIVE_MINUTES)).toMatchObject({ pages: 0, pushed: 0, errors: 0 });
  expect(firstPageFilters().at(-1)).toBe(iso(START + FIVE_MINUTES)); expect(pushCapture).toHaveBeenCalledTimes(4);
  const fetches = requests.length;
  expect(await runNotionCaptureIngest(pool)).toEqual({ skipped: true }); expect(requests).toHaveLength(fetches);
});
it('pins the cold-start lookback so a failed page cannot age out before retry', async () => {
  pages = [page('edge', START - DAY + 60 * 1000)]; failInsertOnce = 'notion:inbox:edge';
  const first = await runNotionCaptureIngest(pool), second = await nextRun(FIVE_MINUTES);
  expect(first.errors).toBe(1); expect(second).toMatchObject({ pages: 1, pushed: 1, errors: 0 });
  expect(firstPageFilters()).toEqual([iso(START - DAY), iso(START - DAY)]); expect(captures.has('notion:inbox:edge')).toBe(true);
});
it('keeps the same initial anchor after a whole Notion request fails', async () => {
  pages = [page('edge', START - DAY + 60 * 1000)]; fatalOnce = true;
  expect((await runNotionCaptureIngest(pool)).fatal).toContain('401');
  expect(await nextRun(FIVE_MINUTES)).toMatchObject({ pages: 1, pushed: 1, errors: 0 });
  expect(firstPageFilters()).toEqual([iso(START - DAY), iso(START - DAY)]);
});
it('retains the last successful checkpoint on a later failed batch, then advances on recovery', async () => {
  pages = [page('old')]; expect((await runNotionCaptureIngest(pool)).pushed).toBe(1);
  pages.push(page('new', START + 60 * 1000)); failInsertOnce = 'notion:inbox:new';
  const failed = await nextRun(FIVE_MINUTES), recovered = await nextRun(2 * FIVE_MINUTES);
  expect(failed.errors).toBe(1); expect(recovered).toMatchObject({ pages: 1, pushed: 1, errors: 0 });
  expect(firstPageFilters()).toEqual([iso(START - DAY), iso(START), iso(START)]);
  expect(await nextRun(3 * FIVE_MINUTES)).toMatchObject({ pages: 0, errors: 0 });
  expect(firstPageFilters().at(-1)).toBe(iso(START + 2 * FIVE_MINUTES));
});
it('treats a real dedupeHit as successful ingestion so it does not pin the checkpoint forever', async () => {
  pages = [page('known')]; captures.set('notion:inbox:known', { id: 'existing', content: 'known' });
  expect(await runNotionCaptureIngest(pool)).toMatchObject({ pushed: 0, skipped: 1, errors: 0 });
  expect(await nextRun(FIVE_MINUTES)).toMatchObject({ pages: 0, errors: 0 });
  expect(firstPageFilters()).toEqual([iso(START - DAY), iso(START)]);
});
