import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeContext';

function ThemeControl() {
  const { theme, actualTheme, setTheme } = useTheme();
  return <><output>{theme}/{actualTheme}</output><button onClick={() => setTheme('light')}>切换主题</button></>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it('隐私存储拒绝读取时仍挂载默认暗色主题', () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
  try {
    render(<ThemeProvider><ThemeControl /></ThemeProvider>);
    expect(screen.getByText('dark/dark')).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
  } finally { read.mockRestore(); }
});

it('主题写入被拒绝时仍更新当前界面且不抛出事件异常', () => {
  localStorage.setItem('theme', 'dark');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
  render(<ThemeProvider><ThemeControl /></ThemeProvider>);
  fireEvent.click(screen.getByRole('button', { name: '切换主题' }));
  expect(screen.getByText('light/light')).toBeInTheDocument();
  expect(document.documentElement).not.toHaveClass('dark');
});
