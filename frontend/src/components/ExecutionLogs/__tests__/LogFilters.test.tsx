import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LogFilters } from '../LogFilters';
import type { LogFilters as LogFiltersType } from '../../../types/execution-logs';

describe('LogFilters', () => {
  it('renders all filter fields', () => {
    const filters: LogFiltersType = {};
    const onFiltersChange = vi.fn();
    const onReset = vi.fn();

    render(
      <LogFilters
        filters={filters}
        onFiltersChange={onFiltersChange}
        onReset={onReset}
      />
    );

    expect(screen.getByPlaceholderText('输入任务 ID')).toBeInTheDocument();
    expect(screen.getByText('全部状态')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入关键词搜索日志...')).toBeInTheDocument();
  });

  it('calls onFiltersChange when runId input changes', () => {
    const filters: LogFiltersType = {};
    const onFiltersChange = vi.fn();
    const onReset = vi.fn();

    render(
      <LogFilters
        filters={filters}
        onFiltersChange={onFiltersChange}
        onReset={onReset}
      />
    );

    const runIdInput = screen.getByPlaceholderText('输入任务 ID');
    fireEvent.change(runIdInput, { target: { value: 'test-run-123' } });

    expect(onFiltersChange).toHaveBeenCalledWith({
      runId: 'test-run-123'
    });
  });

  it('calls onFiltersChange when status select changes', () => {
    const filters: LogFiltersType = {};
    const onFiltersChange = vi.fn();
    const onReset = vi.fn();

    render(
      <LogFilters
        filters={filters}
        onFiltersChange={onFiltersChange}
        onReset={onReset}
      />
    );

    const statusSelect = screen.getByDisplayValue('全部状态');
    fireEvent.change(statusSelect, { target: { value: 'running' } });

    expect(onFiltersChange).toHaveBeenCalledWith({
      status: 'running'
    });
  });

  it('calls onFiltersChange when searchText input changes', () => {
    const filters: LogFiltersType = {};
    const onFiltersChange = vi.fn();
    const onReset = vi.fn();

    render(
      <LogFilters
        filters={filters}
        onFiltersChange={onFiltersChange}
        onReset={onReset}
      />
    );

    const searchInput = screen.getByPlaceholderText('输入关键词搜索日志...');
    fireEvent.change(searchInput, { target: { value: 'ERROR' } });

    expect(onFiltersChange).toHaveBeenCalledWith({
      searchText: 'ERROR'
    });
  });

  it('shows reset button when filters are active', () => {
    const filters: LogFiltersType = { runId: 'test-123' };
    const onFiltersChange = vi.fn();
    const onReset = vi.fn();

    render(
      <LogFilters
        filters={filters}
        onFiltersChange={onFiltersChange}
        onReset={onReset}
      />
    );

    const resetButton = screen.getByText('清空');
    expect(resetButton).toBeInTheDocument();
  });

  it('calls onReset when reset button is clicked', () => {
    const filters: LogFiltersType = { runId: 'test-123' };
    const onFiltersChange = vi.fn();
    const onReset = vi.fn();

    render(
      <LogFilters
        filters={filters}
        onFiltersChange={onFiltersChange}
        onReset={onReset}
      />
    );

    const resetButton = screen.getByText('清空');
    fireEvent.click(resetButton);

    expect(onReset).toHaveBeenCalled();
  });
});
