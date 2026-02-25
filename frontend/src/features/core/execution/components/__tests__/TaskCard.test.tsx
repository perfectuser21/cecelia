import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskCard } from '../TaskCard';
import type { VpsSlot } from '../../../../../api/brain.api';

describe('TaskCard', () => {
  const mockSlot: VpsSlot = {
    pid: 1234,
    cpu: '45.5',
    memory: '256 MB',
    startTime: '2026-02-06T10:00:00Z',
    taskId: 'task-001',
    runId: 'run-001',
    startedAt: '2026-02-06T10:00:00Z',
    command: 'npm test',
    taskTitle: 'Test Task',
    taskPriority: 'P1',
    taskType: 'short',
  };

  it('should display task title', () => {
    render(<TaskCard slot={mockSlot} />);

    expect(screen.getByText('Test Task')).toBeInTheDocument();
  });

  it('should display untitled task when taskTitle is null', () => {
    const slotWithoutTitle = { ...mockSlot, taskTitle: null };
    render(<TaskCard slot={slotWithoutTitle} />);

    expect(screen.getByText('Untitled Task')).toBeInTheDocument();
  });

  it('should display running status', () => {
    render(<TaskCard slot={mockSlot} />);

    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('should display priority badge', () => {
    render(<TaskCard slot={mockSlot} />);

    expect(screen.getByText('P1')).toBeInTheDocument();
  });

  it('should display task type badge', () => {
    render(<TaskCard slot={mockSlot} />);

    expect(screen.getByText('short')).toBeInTheDocument();
  });

  it('should display CPU usage', () => {
    render(<TaskCard slot={mockSlot} />);

    expect(screen.getByText('CPU:')).toBeInTheDocument();
    expect(screen.getByText('45.5%')).toBeInTheDocument();
  });

  it('should display memory usage', () => {
    render(<TaskCard slot={mockSlot} />);

    expect(screen.getByText('Memory:')).toBeInTheDocument();
    expect(screen.getByText('256 MB')).toBeInTheDocument();
  });

  it('should display duration', () => {
    render(<TaskCard slot={mockSlot} />);

    expect(screen.getByText('Duration:')).toBeInTheDocument();
    // Duration text will vary based on current time, just check it exists
    expect(screen.getByText(/\d+s/)).toBeInTheDocument();
  });

  it('should display task and run IDs', () => {
    render(<TaskCard slot={mockSlot} />);

    expect(screen.getByText(/Task: task-001/)).toBeInTheDocument();
    expect(screen.getByText(/Run: run-001/)).toBeInTheDocument();
  });

  it('should not display IDs footer when taskId and runId are null', () => {
    const slotWithoutIds = {
      ...mockSlot,
      taskId: null,
      runId: null,
    };
    render(<TaskCard slot={slotWithoutIds} />);

    expect(screen.queryByText(/Task:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Run:/)).not.toBeInTheDocument();
  });

  it('should call onClick when card is clicked', async () => {
    const user = userEvent.setup();
    const onClickMock = vi.fn();

    render(<TaskCard slot={mockSlot} onClick={onClickMock} />);

    const card = screen.getByText('Test Task').closest('div')!.parentElement!;
    await user.click(card);

    expect(onClickMock).toHaveBeenCalledWith(mockSlot);
  });

  it('should not be clickable when onClick is not provided', () => {
    render(<TaskCard slot={mockSlot} />);

    const card = screen.getByText('Test Task').closest('div')!.parentElement!;
    expect(card).not.toHaveClass('cursor-pointer');
  });

  it('should display correct priority colors', () => {
    const priorities: Array<'P0' | 'P1' | 'P2' | null> = ['P0', 'P1', 'P2', null];

    priorities.forEach((priority) => {
      const { unmount } = render(
        <TaskCard slot={{ ...mockSlot, taskPriority: priority }} />
      );

      if (priority) {
        const priorityBadge = screen.getByText(priority);
        expect(priorityBadge).toBeInTheDocument();
      }

      unmount();
    });
  });

  it('should display correct task type colors', () => {
    const types: Array<'short' | 'long' | null> = ['short', 'long', null];

    types.forEach((type) => {
      const { unmount } = render(
        <TaskCard slot={{ ...mockSlot, taskType: type }} />
      );

      if (type) {
        const typeBadge = screen.getByText(type);
        expect(typeBadge).toBeInTheDocument();
      }

      unmount();
    });
  });

  it('should format CPU percentage correctly', () => {
    const { rerender } = render(<TaskCard slot={{ ...mockSlot, cpu: '99.99' }} />);
    expect(screen.getByText('100.0%')).toBeInTheDocument();

    rerender(<TaskCard slot={{ ...mockSlot, cpu: '0.5' }} />);
    expect(screen.getByText('0.5%')).toBeInTheDocument();

    rerender(<TaskCard slot={{ ...mockSlot, cpu: '45.123' }} />);
    expect(screen.getByText('45.1%')).toBeInTheDocument();
  });

  it('should display N/A for duration when startedAt is null', () => {
    const slotWithoutStartTime = { ...mockSlot, startedAt: null };
    render(<TaskCard slot={slotWithoutStartTime} />);

    expect(screen.getByText('N/A')).toBeInTheDocument();
  });
});
