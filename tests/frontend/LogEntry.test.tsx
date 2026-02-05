import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LogEntry, { type LogEntryData } from '../../frontend/src/features/core/execution/components/LogEntry';

describe('LogEntry', () => {
  const mockLog: LogEntryData = {
    timestamp: '2024-02-06T10:00:00Z',
    level: 'INFO',
    source: 'test-service',
    message: 'Test log message',
  };

  it('renders log entry with all information', () => {
    render(<LogEntry log={mockLog} />);

    expect(screen.getByText('test-service')).toBeInTheDocument();
    expect(screen.getByText('Test log message')).toBeInTheDocument();
    expect(screen.getByText('INFO')).toBeInTheDocument();
  });

  it('renders DEBUG level with correct styling', () => {
    const debugLog = { ...mockLog, level: 'DEBUG' as const };
    const { container } = render(<LogEntry log={debugLog} />);

    expect(screen.getByText('DEBUG')).toBeInTheDocument();
    expect(container.querySelector('.text-gray-500')).toBeTruthy();
  });

  it('renders WARN level with correct styling', () => {
    const warnLog = { ...mockLog, level: 'WARN' as const };
    const { container } = render(<LogEntry log={warnLog} />);

    expect(screen.getByText('WARN')).toBeInTheDocument();
    expect(container.querySelector('.text-yellow-600')).toBeTruthy();
  });

  it('renders ERROR level with correct styling', () => {
    const errorLog = { ...mockLog, level: 'ERROR' as const };
    const { container } = render(<LogEntry log={errorLog} />);

    expect(screen.getByText('ERROR')).toBeInTheDocument();
    expect(container.querySelector('.text-red-600')).toBeTruthy();
  });

  it('handles invalid timestamp gracefully', () => {
    const invalidLog = { ...mockLog, timestamp: 'invalid-timestamp' };
    render(<LogEntry log={invalidLog} />);

    // Should still render the log entry without crashing
    expect(screen.getByText('Test log message')).toBeInTheDocument();
  });

  it('handles long messages with proper wrapping', () => {
    const longLog = {
      ...mockLog,
      message: 'This is a very long log message that should wrap properly and not break the layout when displayed in the log viewer component',
    };
    const { container } = render(<LogEntry log={longLog} />);

    const messageElement = container.querySelector('.break-words');
    expect(messageElement).toBeTruthy();
  });
});
