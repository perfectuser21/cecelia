import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import TabbedPage, { TabConfig } from './TabbedPage';
import { Home, Settings, User } from 'lucide-react';
import { Suspense } from 'react';

// Mock react-router-dom hooks
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: vi.fn(),
    useLocation: vi.fn(),
  };
});

// Create test components
const TestComponent1 = () => <div>Component 1</div>;
const TestComponent2 = () => <div>Component 2</div>;
const TestComponent3 = () => <div>Component 3</div>;

describe('TabbedPage', () => {
  const mockNavigate = vi.fn();
  const mockLocation = { pathname: '/base/tab1' };

  const tabs: TabConfig[] = [
    {
      id: 'tab1',
      label: 'Home',
      icon: Home,
      path: '/base/tab1',
      component: () => Promise.resolve({ default: TestComponent1 }),
    },
    {
      id: 'tab2',
      label: 'Settings',
      icon: Settings,
      path: '/base/tab2',
      component: () => Promise.resolve({ default: TestComponent2 }),
    },
    {
      id: 'tab3',
      label: 'Profile',
      icon: User,
      path: '/base/tab3',
      component: () => Promise.resolve({ default: TestComponent3 }),
    },
  ];

  beforeEach(() => {
    vi.mocked(useNavigate).mockReturnValue(mockNavigate);
    vi.mocked(useLocation).mockReturnValue(mockLocation as any);
    mockNavigate.mockClear();
  });

  it('renders all tabs', () => {
    render(
      <MemoryRouter>
        <TabbedPage tabs={tabs} basePath="/base" />
      </MemoryRouter>
    );

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
  });

  it('highlights active tab based on current path', () => {
    render(
      <MemoryRouter>
        <TabbedPage tabs={tabs} basePath="/base" />
      </MemoryRouter>
    );

    const homeTab = screen.getByText('Home').closest('button');
    expect(homeTab?.className).toContain('bg-slate-700');
    expect(homeTab?.className).toContain('text-white');

    const settingsTab = screen.getByText('Settings').closest('button');
    expect(settingsTab?.className).toContain('text-slate-400');
  });

  it('navigates to tab path when clicked', () => {
    render(
      <MemoryRouter>
        <TabbedPage tabs={tabs} basePath="/base" />
      </MemoryRouter>
    );

    const settingsTab = screen.getByText('Settings').closest('button');
    fireEvent.click(settingsTab!);

    expect(mockNavigate).toHaveBeenCalledWith('/base/tab2');
  });

  it('renders tab icons', () => {
    const { container } = render(
      <MemoryRouter>
        <TabbedPage tabs={tabs} basePath="/base" />
      </MemoryRouter>
    );

    // Check for icon elements (Lucide icons render as svg)
    const icons = container.querySelectorAll('svg');
    expect(icons.length).toBeGreaterThanOrEqual(3);
  });

  it('matches nested paths correctly', () => {
    vi.mocked(useLocation).mockReturnValue({ pathname: '/base/tab2/nested' } as any);

    render(
      <MemoryRouter>
        <TabbedPage tabs={tabs} basePath="/base" />
      </MemoryRouter>
    );

    const settingsTab = screen.getByText('Settings').closest('button');
    expect(settingsTab?.className).toContain('bg-slate-700');
  });

  it('defaults to first tab when no match found', () => {
    vi.mocked(useLocation).mockReturnValue({ pathname: '/unknown' } as any);

    render(
      <MemoryRouter>
        <TabbedPage tabs={tabs} basePath="/base" />
      </MemoryRouter>
    );

    const homeTab = screen.getByText('Home').closest('button');
    expect(homeTab?.className).toContain('bg-slate-700');
  });

  it('shows loading state while component loads', async () => {
    const slowComponent = () =>
      new Promise<{ default: React.ComponentType<any> }>((resolve) =>
        setTimeout(() => resolve({ default: TestComponent1 }), 100)
      );

    const slowTabs: TabConfig[] = [
      {
        id: 'tab1',
        label: 'Home',
        icon: Home,
        path: '/base/tab1',
        component: slowComponent,
      },
    ];

    render(
      <MemoryRouter>
        <TabbedPage tabs={slowTabs} basePath="/base" />
      </MemoryRouter>
    );

    // Should show loading initially
    expect(screen.getByText('Loading...')).toBeInTheDocument();

    // Wait for component to load
    await waitFor(
      () => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      },
      { timeout: 200 }
    );
  });

  it('applies hover styles to inactive tabs', () => {
    render(
      <MemoryRouter>
        <TabbedPage tabs={tabs} basePath="/base" />
      </MemoryRouter>
    );

    const settingsTab = screen.getByText('Settings').closest('button');
    expect(settingsTab?.className).toContain('hover:text-slate-200');
    expect(settingsTab?.className).toContain('hover:bg-slate-700/50');
  });

  it('handles empty tabs array gracefully', () => {
    render(
      <MemoryRouter>
        <TabbedPage tabs={[]} basePath="/base" />
      </MemoryRouter>
    );

    // Should not crash and render container
    const container = document.querySelector('.min-h-screen');
    expect(container).toBeInTheDocument();
  });
});