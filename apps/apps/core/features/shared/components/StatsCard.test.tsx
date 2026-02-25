import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatsCard, GlassCard, GradientStatCard } from './StatsCard';
import { Activity, User, Settings } from 'lucide-react';

describe('StatsCard', () => {
  it('renders with basic props', () => {
    render(
      <StatsCard
        label="Active Users"
        value={42}
        icon={User}
      />
    );

    expect(screen.getByText('Active Users')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders string values correctly', () => {
    render(
      <StatsCard
        label="Status"
        value="Online"
        icon={Activity}
      />
    );

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('displays trend indicator when provided', () => {
    render(
      <StatsCard
        label="Performance"
        value={95}
        icon={Activity}
        trend={{ value: '+5%', direction: 'up' }}
      />
    );

    expect(screen.getByText('↑')).toBeInTheDocument();
    expect(screen.getByText('+5%')).toBeInTheDocument();
  });

  it('applies correct trend colors for different directions', () => {
    const { rerender } = render(
      <StatsCard
        label="Metric"
        value={100}
        icon={Activity}
        trend={{ value: '+10%', direction: 'up' }}
      />
    );

    let trendElement = screen.getByText('+10%');
    expect(trendElement.className).toContain('text-green-600');

    rerender(
      <StatsCard
        label="Metric"
        value={100}
        icon={Activity}
        trend={{ value: '-5%', direction: 'down' }}
      />
    );

    trendElement = screen.getByText('-5%');
    expect(trendElement.className).toContain('text-red-600');

    rerender(
      <StatsCard
        label="Metric"
        value={100}
        icon={Activity}
        trend={{ value: '0%', direction: 'neutral' }}
      />
    );

    trendElement = screen.getByText('0%');
    expect(trendElement.className).toContain('text-gray-500');
  });

  it('handles click events when onClick is provided', () => {
    const handleClick = vi.fn();

    render(
      <StatsCard
        label="Clickable"
        value={10}
        icon={Settings}
        onClick={handleClick}
      />
    );

    const card = screen.getByText('Clickable').closest('div[class*="bg-white"]');
    fireEvent.click(card!);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('applies custom CSS classes', () => {
    render(
      <StatsCard
        label="Custom"
        value={5}
        icon={User}
        className="custom-class"
      />
    );

    const card = screen.getByText('Custom').closest('div[class*="bg-white"]');
    expect(card?.className).toContain('custom-class');
  });

  it('uses custom icon gradient and shadow', () => {
    render(
      <StatsCard
        label="Custom Icon"
        value={20}
        icon={Activity}
        iconGradient="from-purple-500 to-pink-600"
        iconShadow="shadow-purple-500/50"
      />
    );

    const iconContainer = document.querySelector('.bg-gradient-to-br');
    expect(iconContainer?.className).toContain('from-purple-500');
    expect(iconContainer?.className).toContain('to-pink-600');
    expect(iconContainer?.className).toContain('shadow-purple-500/50');
  });
});

describe('GlassCard', () => {
  it('renders children correctly', () => {
    render(
      <GlassCard>
        <div>Test Content</div>
      </GlassCard>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('applies glassmorphism effect classes', () => {
    const { container } = render(
      <GlassCard>
        <div>Glass Effect</div>
      </GlassCard>
    );

    const card = container.firstChild;
    expect(card?.className).toContain('backdrop-blur-xl');
    expect(card?.className).toContain('bg-white');
    expect(card?.className).toContain('dark:bg-slate-800/80');
  });

  it('adds hover effect when hoverable is true', () => {
    const { container } = render(
      <GlassCard hoverable={true}>
        <div>Hoverable</div>
      </GlassCard>
    );

    const card = container.firstChild;
    expect(card?.className).toContain('hover:scale-[1.02]');
    expect(card?.className).toContain('hover:-translate-y-0.5');
  });

  it('applies custom className', () => {
    const { container } = render(
      <GlassCard className="custom-glass-class">
        <div>Custom Glass</div>
      </GlassCard>
    );

    const card = container.firstChild;
    expect(card?.className).toContain('custom-glass-class');
  });
});

describe('GradientStatCard', () => {
  it('renders with gradient background', () => {
    render(
      <GradientStatCard
        label="Revenue"
        value="$10,000"
        icon={Activity}
        gradient="from-blue-500 to-purple-600"
      />
    );

    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('$10,000')).toBeInTheDocument();
  });

  it('applies gradient classes correctly', () => {
    const { container } = render(
      <GradientStatCard
        label="Users"
        value={500}
        icon={User}
        gradient="from-green-400 to-blue-500"
      />
    );

    const card = container.querySelector('.bg-gradient-to-br');
    expect(card?.className).toContain('from-green-400');
    expect(card?.className).toContain('to-blue-500');
  });

  it('formats numeric values properly', () => {
    render(
      <GradientStatCard
        label="Count"
        value={1234567}
        icon={Settings}
        gradient="from-red-500 to-orange-600"
      />
    );

    expect(screen.getByText('1234567')).toBeInTheDocument();
  });
});