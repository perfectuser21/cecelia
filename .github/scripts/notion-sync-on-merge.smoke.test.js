/**
 * Smoke test: notion-sync-on-merge.js
 * Run: npx vitest run .github/scripts/notion-sync-on-merge.smoke.test.js
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseTrailers } from './notion-sync-on-merge.js';

describe('parseTrailers', () => {
  it('returns empty object when body is empty', () => {
    expect(parseTrailers('')).toEqual({});
    expect(parseTrailers(null)).toEqual({});
  });

  it('parses Notion-Sprint trailer', () => {
    const body = 'Fix something\n\nNotion-Sprint: abc-123';
    expect(parseTrailers(body)).toEqual({ 'Notion-Sprint': 'abc-123' });
  });

  it('parses Notion-Components trailer', () => {
    const body = 'Fix\n\nNotion-Components: id1, id2, id3';
    expect(parseTrailers(body)).toEqual({ 'Notion-Components': 'id1, id2, id3' });
  });

  it('parses both trailers from real PR body format', () => {
    const body = [
      'PR description here',
      '',
      'Notion-Sprint: sprint-page-id',
      'Notion-Components: comp-a, comp-b',
    ].join('\n');
    expect(parseTrailers(body)).toEqual({
      'Notion-Sprint': 'sprint-page-id',
      'Notion-Components': 'comp-a, comp-b',
    });
  });

  it('ignores lines without Notion- prefix', () => {
    const body = 'Fixes: #42\nRelated: something\nNotion-Sprint: s1';
    expect(parseTrailers(body)).toEqual({ 'Notion-Sprint': 's1' });
  });

  it('trims whitespace from value', () => {
    const body = 'Notion-Sprint:   padded-id  ';
    expect(parseTrailers(body)).toEqual({ 'Notion-Sprint': 'padded-id' });
  });
});

describe('skip conditions', () => {
  it('no Notion trailers → both keys absent', () => {
    const trailers = parseTrailers('Just a regular PR description\n\nFixes: #10');
    expect('Notion-Sprint' in trailers).toBe(false);
    expect('Notion-Components' in trailers).toBe(false);
  });

  it('Notion-Components split produces correct id array', () => {
    const raw = 'comp-a, comp-b,  comp-c ';
    const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
    expect(ids).toEqual(['comp-a', 'comp-b', 'comp-c']);
  });
});
