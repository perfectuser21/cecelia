import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlaceholderPage from './PlaceholderPage';

describe('PlaceholderPage', () => {
  it('renders title', () => {
    render(<PlaceholderPage title="Under Construction" />);
    expect(screen.getByText('Under Construction')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <PlaceholderPage
        title="Coming Soon"
        description="This feature is being developed"
      />
    );
    expect(screen.getByText('This feature is being developed')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    render(<PlaceholderPage title="Empty Page" />);
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });

  it('renders default icon when not specified', () => {
    render(<PlaceholderPage title="Test Page" />);
    expect(screen.getByText('🚧')).toBeInTheDocument();
  });

  it('renders custom icon when provided', () => {
    render(<PlaceholderPage title="Test Page" icon="🎉" />);
    expect(screen.getByText('🎉')).toBeInTheDocument();
    expect(screen.queryByText('🚧')).not.toBeInTheDocument();
  });

  it('applies correct styles to title', () => {
    render(<PlaceholderPage title="Styled Title" />);
    const title = screen.getByText('Styled Title');
    expect(title.tagName).toBe('H1');
    expect(title.style.fontSize).toBe('24px');
    expect(title.style.fontWeight).toBe('600');
  });

  it('applies correct styles to description', () => {
    render(
      <PlaceholderPage
        title="Page"
        description="This is the description"
      />
    );
    const description = screen.getByText('This is the description');
    expect(description.tagName).toBe('P');
    expect(description.style.color).toBe('rgb(100, 116, 139)'); // #64748b in rgb
    expect(description.style.fontSize).toBe('14px');
  });

  it('centers content with correct padding', () => {
    const { container } = render(<PlaceholderPage title="Centered" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.padding).toBe('48px 24px');
    expect(wrapper.style.textAlign).toBe('center');
  });

  it('renders emoji icons correctly', () => {
    const emojis = ['🚀', '⚡', '🔥', '💡', '🎨'];
    emojis.forEach(emoji => {
      const { unmount } = render(<PlaceholderPage title="Test" icon={emoji} />);
      expect(screen.getByText(emoji)).toBeInTheDocument();
      unmount();
    });
  });

  it('handles long titles gracefully', () => {
    const longTitle = 'This is a very long title that should still render correctly without breaking the layout';
    render(<PlaceholderPage title={longTitle} />);
    expect(screen.getByText(longTitle)).toBeInTheDocument();
  });

  it('handles long descriptions gracefully', () => {
    const longDescription = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
    render(<PlaceholderPage title="Title" description={longDescription} />);
    expect(screen.getByText(longDescription)).toBeInTheDocument();
  });
});