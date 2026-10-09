import { describe, it, expect } from 'vitest';
import { diffMissingProps, OPS_DB_PROPS } from '../ops-notion-schema.js';

// 血训（2026-09-06 记过一次，09-08 又踩）：建库脚本只在**新建**时带属性，
// 复用已有库时不补列 → 推送 400 "X is not a property that exists" → 逐行 catch 吞掉 → 静默停更。
// 把"缺列即补"做成幂等函数，以后加列不会再犯。
describe('diffMissingProps — 算出该补哪些列', () => {
  it('只返回缺的列，已有的不动（避免 PATCH 覆盖人已调过的列配置）', () => {
    const existing = { Name: { title: {} }, Source: { select: {} } };
    const wanted = { Name: { title: {} }, Source: { select: {} }, Liveness: { select: {} } };
    expect(diffMissingProps(existing, wanted)).toEqual({ Liveness: { select: {} } });
  });

  it('全都有 → 空对象（调用方据此跳过 PATCH）', () => {
    const p = { A: { select: {} } };
    expect(diffMissingProps(p, { A: { select: {} } })).toEqual({});
  });

  it('库是空的 → 全补', () => {
    const wanted = { A: { select: {} }, B: { checkbox: {} } };
    expect(diffMissingProps({}, wanted)).toEqual(wanted);
    expect(diffMissingProps(null, wanted)).toEqual(wanted);
  });

  it('列名大小写敏感——Notion 就是敏感的，别自作主张归一化', () => {
    expect(diffMissingProps({ liveness: {} }, { Liveness: { select: {} } }))
      .toEqual({ Liveness: { select: {} } });
  });
});

describe('OPS_DB_PROPS — 四库列定义必须覆盖推送与回读实际用到的列', () => {
  it('Workflows 库含活性两列（本次 400 的直接原因）', () => {
    expect(OPS_DB_PROPS.workflows.Liveness).toBeDefined();
    expect(OPS_DB_PROPS.workflows.SilentFor).toBeDefined();
  });

  it('Graph 库含 Repeat/Type/Schedule（schedule 行推送 400 的原因）', () => {
    for (const k of ['Repeat', 'Type', 'Schedule']) {
      expect(OPS_DB_PROPS.graph[k], `graph 库缺 ${k}`).toBeDefined();
    }
  });

  it('三库都含人工列——否则回读读不到东西，双向等于没做', () => {
    for (const db of ['workflows', 'graph', 'skills']) {
      for (const k of ['Owner', 'Note', 'Priority', 'Starred']) {
        expect(OPS_DB_PROPS[db][k], `${db} 库缺人工列 ${k}`).toBeDefined();
      }
    }
  });

  it('Workflows 有 Enabled（停用意图入口）、Skills 有 Stage（档位人工覆盖）', () => {
    expect(OPS_DB_PROPS.workflows.Enabled.checkbox).toBeDefined();
    expect(OPS_DB_PROPS.skills.Stage.select).toBeDefined();
  });

  it('人工列的类型必须与 buildOpsManualReadback 的读法对齐', () => {
    // readback 用 rich_text 读 Owner/Note，select 读 Priority，checkbox 读 Starred/Enabled
    expect(OPS_DB_PROPS.workflows.Owner.rich_text).toBeDefined();
    expect(OPS_DB_PROPS.workflows.Note.rich_text).toBeDefined();
    expect(OPS_DB_PROPS.workflows.Priority.select).toBeDefined();
    expect(OPS_DB_PROPS.workflows.Starred.checkbox).toBeDefined();
  });
});
