import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  LoadingState,
  ErrorState,
  EmptyState,
  DataStateWrapper,
  SkeletonCard,
  SkeletonRow
} from './LoadingState';

describe('LoadingState', () => {
  it('renders loading spinner', () => {
    const { container } = render(<LoadingState />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('displays custom message when provided', () => {
    render(<LoadingState message="Loading data..." />);
    expect(screen.getByText('Loading data...')).toBeInTheDocument();
  });

  it('applies different sizes correctly', () => {
    const { rerender, container } = render(<LoadingState size="sm" />);
    let spinner = container.querySelector('.animate-spin');
    expect(spinner?.className).toContain('w-6');
    expect(spinner?.className).toContain('h-6');

    rerender(<LoadingState size="md" />);
    spinner = container.querySelector('.animate-spin');
    expect(spinner?.className).toContain('w-8');
    expect(spinner?.className).toContain('h-8');

    rerender(<LoadingState size="lg" />);
    spinner = container.querySelector('.animate-spin');
    expect(spinner?.className).toContain('w-12');
    expect(spinner?.className).toContain('h-12');
  });

  it('applies custom height class', () => {
    const { container } = render(<LoadingState height="h-96" />);
    const wrapper = container.firstChild;
    expect(wrapper?.className).toContain('h-96');
  });
});

describe('ErrorState', () => {
  it('displays error message', () => {
    render(<ErrorState message="Something went wrong!" />);
    expect(screen.getByText('Something went wrong!')).toBeInTheDocument();
  });

  it('shows retry button when onRetry is provided', () => {
    const handleRetry = vi.fn();
    render(<ErrorState message="Error occurred" onRetry={handleRetry} />);

    const retryButton = screen.getByText('重试');
    expect(retryButton).toBeInTheDocument();
  });

  it('calls onRetry when retry button is clicked', () => {
    const handleRetry = vi.fn();
    render(<ErrorState message="Error occurred" onRetry={handleRetry} />);

    const retryButton = screen.getByText('重试');
    fireEvent.click(retryButton);

    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it('uses custom retry button text', () => {
    const handleRetry = vi.fn();
    render(
      <ErrorState
        message="Error occurred"
        onRetry={handleRetry}
        retryText="Try Again"
      />
    );

    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('applies custom height class', () => {
    const { container } = render(<ErrorState message="Error" height="h-32" />);
    const wrapper = container.firstChild;
    expect(wrapper?.className).toContain('h-32');
  });
});

describe('EmptyState', () => {
  it('displays title', () => {
    render(<EmptyState title="No data available" />);
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('displays description when provided', () => {
    render(
      <EmptyState
        title="No results"
        description="Try adjusting your filters"
      />
    );
    expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument();
  });

  it('renders custom icon when provided', () => {
    render(
      <EmptyState
        title="Empty"
        icon={<div data-testid="custom-icon">📭</div>}
      />
    );
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('shows action button when provided', () => {
    const handleAction = vi.fn();
    render(
      <EmptyState
        title="No items"
        action={{ label: 'Add Item', onClick: handleAction }}
      />
    );

    const actionButton = screen.getByText('Add Item');
    expect(actionButton).toBeInTheDocument();
  });

  it('calls action onClick when button is clicked', () => {
    const handleAction = vi.fn();
    render(
      <EmptyState
        title="No items"
        action={{ label: 'Add Item', onClick: handleAction }}
      />
    );

    const actionButton = screen.getByText('Add Item');
    fireEvent.click(actionButton);

    expect(handleAction).toHaveBeenCalledTimes(1);
  });
});

describe('DataStateWrapper', () => {
  it('shows loading state when loading is true', () => {
    const { container } = render(
      <DataStateWrapper loading={true} error={null} data={null}>
        {(data) => <div>Data: {data}</div>}
      </DataStateWrapper>
    );

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows error state when error is present', () => {
    render(
      <DataStateWrapper loading={false} error="Failed to load" data={null}>
        {(data) => <div>Data: {data}</div>}
      </DataStateWrapper>
    );

    expect(screen.getByText('Failed to load')).toBeInTheDocument();
  });

  it('shows empty state when data is null', () => {
    render(
      <DataStateWrapper loading={false} error={null} data={null}>
        {(data) => <div>Data: {data}</div>}
      </DataStateWrapper>
    );

    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });

  it('shows empty state for empty array', () => {
    render(
      <DataStateWrapper loading={false} error={null} data={[]}>
        {(data) => <div>Data: {data}</div>}
      </DataStateWrapper>
    );

    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });

  it('renders children when data is available', () => {
    const testData = { id: 1, name: 'Test Item' };
    render(
      <DataStateWrapper loading={false} error={null} data={testData}>
        {(data) => <div>Item: {data.name}</div>}
      </DataStateWrapper>
    );

    expect(screen.getByText('Item: Test Item')).toBeInTheDocument();
  });

  it('uses custom empty message', () => {
    render(
      <DataStateWrapper
        loading={false}
        error={null}
        data={null}
        emptyMessage="No items found"
      >
        {(data) => <div>Data: {data}</div>}
      </DataStateWrapper>
    );

    expect(screen.getByText('No items found')).toBeInTheDocument();
  });
});

describe('SkeletonCard', () => {
  it('renders skeleton card with animation', () => {
    const { container } = render(<SkeletonCard />);
    const skeleton = container.querySelector('.animate-pulse');
    expect(skeleton).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<SkeletonCard className="custom-skeleton" />);
    const card = container.firstChild;
    expect(card?.className).toContain('custom-skeleton');
  });

  it('has proper structure for card skeleton', () => {
    const { container } = render(<SkeletonCard />);

    // Check for icon placeholder
    expect(container.querySelector('.w-12.h-12.bg-slate-200')).toBeInTheDocument();

    // Check for text placeholders
    expect(container.querySelector('.h-3.bg-slate-200')).toBeInTheDocument();
    expect(container.querySelector('.h-6.bg-slate-200')).toBeInTheDocument();
  });
});

describe('SkeletonRow', () => {
  it('renders skeleton row with animation', () => {
    const { container } = render(<SkeletonRow />);
    const skeleton = container.querySelector('.animate-pulse');
    expect(skeleton).toBeInTheDocument();
  });

  it('has proper structure for row skeleton', () => {
    const { container } = render(<SkeletonRow />);

    // Check for icon placeholder
    expect(container.querySelector('.w-8.h-8.bg-slate-200')).toBeInTheDocument();

    // Check for text placeholders
    expect(container.querySelector('.h-4.bg-slate-200')).toBeInTheDocument();
    expect(container.querySelector('.h-3.bg-slate-200')).toBeInTheDocument();
  });
});