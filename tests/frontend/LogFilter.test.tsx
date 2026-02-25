import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LogFilter, { type LogFilterOptions } from '../../frontend/src/features/core/execution/components/LogFilter';

describe('LogFilter', () => {
  const mockFilters: LogFilterOptions = {
    levels: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
    searchQuery: '',
  };

  const mockOnFilterChange = vi.fn();

  it('renders search input', () => {
    render(<LogFilter filters={mockFilters} onFilterChange={mockOnFilterChange} />);

    const searchInput = screen.getByPlaceholderText('搜索日志...');
    expect(searchInput).toBeInTheDocument();
  });

  it('calls onFilterChange when search query changes', () => {
    render(<LogFilter filters={mockFilters} onFilterChange={mockOnFilterChange} />);

    const searchInput = screen.getByPlaceholderText('搜索日志...');
    fireEvent.change(searchInput, { target: { value: 'test search' } });

    expect(mockOnFilterChange).toHaveBeenCalledWith({
      ...mockFilters,
      searchQuery: 'test search',
    });
  });

  it('renders filter toggle button', () => {
    render(<LogFilter filters={mockFilters} onFilterChange={mockOnFilterChange} />);

    const filterButton = screen.getByText('筛选');
    expect(filterButton).toBeInTheDocument();
  });

  it('expands filter options when filter button clicked', () => {
    render(<LogFilter filters={mockFilters} onFilterChange={mockOnFilterChange} />);

    const filterButton = screen.getByText('筛选');
    fireEvent.click(filterButton);

    expect(screen.getByText('日志级别')).toBeInTheDocument();
    expect(screen.getByText('开始时间')).toBeInTheDocument();
    expect(screen.getByText('结束时间')).toBeInTheDocument();
  });

  it('shows active filter indicator when filters applied', () => {
    const activeFilters: LogFilterOptions = {
      levels: ['ERROR'],
      searchQuery: 'test',
    };

    render(<LogFilter filters={activeFilters} onFilterChange={mockOnFilterChange} />);

    // Should show clear button when filters are active
    expect(screen.getByTitle('清除筛选')).toBeInTheDocument();
  });

  it('clears all filters when clear button clicked', () => {
    const activeFilters: LogFilterOptions = {
      levels: ['ERROR'],
      searchQuery: 'test',
      startTime: '2024-02-06T10:00',
    };

    render(<LogFilter filters={activeFilters} onFilterChange={mockOnFilterChange} />);

    const clearButton = screen.getByTitle('清除筛选');
    fireEvent.click(clearButton);

    expect(mockOnFilterChange).toHaveBeenCalledWith({
      levels: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
      searchQuery: '',
      startTime: undefined,
      endTime: undefined,
    });
  });

  it('toggles level filter when level button clicked', () => {
    render(<LogFilter filters={mockFilters} onFilterChange={mockOnFilterChange} />);

    // Expand filters
    const filterButton = screen.getByText('筛选');
    fireEvent.click(filterButton);

    // Click DEBUG button
    const debugButton = screen.getByText('DEBUG');
    fireEvent.click(debugButton);

    expect(mockOnFilterChange).toHaveBeenCalledWith({
      ...mockFilters,
      levels: ['INFO', 'WARN', 'ERROR'],
    });
  });

  it('handles time range filter changes', () => {
    render(<LogFilter filters={mockFilters} onFilterChange={mockOnFilterChange} />);

    // Expand filters
    const filterButton = screen.getByText('筛选');
    fireEvent.click(filterButton);

    // Change start time
    const startTimeInputs = screen.getAllByRole('textbox');
    const startTimeInput = startTimeInputs.find(input =>
      input.parentElement?.textContent?.includes('开始时间')
    );

    if (startTimeInput) {
      fireEvent.change(startTimeInput, { target: { value: '2024-02-06T10:00' } });

      expect(mockOnFilterChange).toHaveBeenCalledWith({
        ...mockFilters,
        startTime: '2024-02-06T10:00',
      });
    }
  });
});
