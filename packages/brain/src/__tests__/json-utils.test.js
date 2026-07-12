import { describe, it, expect } from 'vitest';
import { extractJsonObject } from '../json-utils.js';

describe('extractJsonObject', () => {
  it('纯 JSON 对象直接解析', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  it('裹在文字里的 JSON 提取首个对象', () => {
    expect(extractJsonObject('前言\n{"route":"okr"}\n后记')).toEqual({ route: 'okr' });
  });
  it('顶层数组不算对象 → null', () => {
    expect(extractJsonObject('[1,2]')).toBeNull();
  });
  it('不可解析 → null', () => {
    expect(extractJsonObject('not json')).toBeNull();
  });
});
