import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseResult, safeHttpUrl, statusLabel, taskTitle } from '@features/core/workbench/task-desk/results';
import TaskResult from '@features/core/workbench/task-desk/TaskResult';
const id = 'a73a7e69-5b08-460f-a290-8f8371403ac8';
afterEach(cleanup);
describe('真实结果解析', () => {
  it('汇集五个直接字符串来源、裁边去重、不虚构嵌套对象文字', () => {
    expect(parseResult({ id, summary: ' 完成审查 ', result: { summary: '完成审查', receipt: { text: '发现一项风险' } }, payload: { findings: { summary: '不得推测' }, last_run_result: { result_summary: '回归已验证' } } }).summaries).toEqual(['完成审查', '发现一项风险', '回归已验证']);
    expect(parseResult({ id, payload: { findings: '现场发现' } }).summaries).toEqual(['现场发现']);
  });
  it('标题优先intake，状态忠于真身且识别无PR完成', () => {
    expect(taskTitle({ id, title: '内部hash', payload: { intake: { title: '用户目标' } } })).toBe('用户目标');
    expect(statusLabel('completed_no_pr')).toBe('已完成');
    expect(statusLabel('canceled')).toBe('已取消');
    expect(statusLabel('cancelled')).toBe('已取消');
    expect(statusLabel('in_progress')).toBe('执行中');
  });
  it('handoff三组独立展示，未知结构折叠原样，链接仅限http(s)', () => {
    render(<TaskResult id={id} task={{ id, status: 'completed', pr_url: 'https://github.com/org/repo/pull/7', result: { handoff: { done: ['审查完成'], not_done: '尚未发布', next_steps: [{ kind: 'decision', text: '确认发布' }], artifacts: { pr_urls: ['javascript:alert(1)', 'https://github.com/org/repo/pull/7'], paths: ['/tmp/report.txt'] } } } }} error={null} loading={false} />);
    expect(screen.getByText('已完成事项')).toBeInTheDocument();
    expect(screen.getByText('未完成事项')).toBeInTheDocument();
    expect(screen.getByText('下一步')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('/tmp/report.txt')).toBeInTheDocument();
    expect(screen.getByText('查看结构化内容')).toBeInTheDocument();
    expect(screen.queryByText('状态已完成，尚无结果证据')).not.toBeInTheDocument();
  });
  it.each(['javascript:alert(1)', 'data:text/html,hello', '//example.com', '/tmp/file', 'file:///tmp/a'])('危险或路径%s只显示文本', value => { expect(safeHttpUrl(value)).toBe(false); });
  it('失败原因显示退出码0，阻塞详情和stderr保留原文', () => {
    expect(parseResult({ id, error_message: '失败', blocked_reason: '等确认', blocked_detail: { message: '缺少范围' }, reason: '工具错误', stderr_tail: '输出错误', exit_code: 0 }).reasons).toEqual(['失败', '等确认', '缺少范围', '工具错误', '输出错误', '退出码：0']);
  });
  it('读取真实blocked_detail中的reason、stderr_tail和exit_code', () => {
    expect(parseResult({ id, blocked_detail: { reason: '命令失败', stderr_tail: '缺失依赖', exit_code: 127 } }).reasons).toEqual(['命令失败', '缺失依赖', '退出码：127']);
  });
  it.each(['blocked', 'failed'])('%s无原因时说明未提供具体原因', status => {
    render(<TaskResult id={id} task={{ id, status }} error={null} loading={false} />);
    expect(screen.getByText('尚未提供具体原因')).toBeInTheDocument();
  });
  it('只有下一步与未完成事项不当作完成证据', () => {
    render(<TaskResult id={id} task={{ id, status: 'completed', result: { handoff: { not_done: ['尚未验收'], next_steps: ['继续调研'] } } }} error={null} loading={false} />);
    expect(screen.getByText('状态已完成，尚无结果证据')).toBeInTheDocument();
  });
  it('系统自动补记的完成标题不计作执行产出证据', () => {
    const result = parseResult({ id, result: { handoff: { synthesized: true, done: ['完成：调研测试策略'] } } });
    expect(result.summaries).toEqual([]);
    expect(result.artifactValues).toEqual([]);
    expect(result.hasEvidence).toBe(false);
  });
  it.each(['completed', 'completed_no_pr'])('%s合成交接明确标记系统补记且保留无证据提示', status => {
    render(<TaskResult id={id} task={{ id, status, result: { handoff: { synthesized: true, done: ['完成：调研测试策略'] } } }} error={null} loading={false} />);
    expect(screen.getByText('以下交接信息由系统补记，不作为执行结果证据。')).toBeInTheDocument();
    expect(screen.getByText('完成：调研测试策略')).toBeInTheDocument();
    expect(screen.getByText('状态已完成，尚无结果证据')).toBeInTheDocument();
  });
  it.each([
    { summary: '有证据的调研结论' },
    { pr_url: 'https://github.com/org/repo/pull/9' },
    { payload: { findings: '真实检查发现' } },
  ])('系统补记不影响独立真实摘要或产物作为证据 %j', evidence => {
    const task = { id, status: 'completed', ...evidence, result: { handoff: { synthesized: true, done: ['完成：调研测试策略'] } } };
    expect(parseResult(task).hasEvidence).toBe(true);
    render(<TaskResult id={id} task={task} error={null} loading={false} />);
    expect(screen.queryByText('状态已完成，尚无结果证据')).not.toBeInTheDocument();
  });
  it('执行者的实际交接完成事项仍算结果证据', () => {
    expect(parseResult({ id, result: { handoff: { done: ['验证了3个真实样本'] } } }).hasEvidence).toBe(true);
  });
  it('空交接分组不展示空标题，真实事项保留', () => {
    const result = parseResult({ id, result: { handoff: { done: '已完成审查', not_done: [], next_steps: [] } } });
    expect(result.sections.map(section => section.key)).toEqual(['done']);
  });
  it('空handoff或任意结果对象不冒充完成证据', () => {
    render(<TaskResult id={id} task={{ id, status: 'completed_no_pr', result: { opaque: true, handoff: { done: [], not_done: [], next_steps: [] } } }} error={null} loading={false} />);
    expect(screen.getByText('状态已完成，尚无结果证据')).toBeInTheDocument();
  });
});
