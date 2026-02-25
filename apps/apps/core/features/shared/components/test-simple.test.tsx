import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

describe('Simple Test', () => {
  it('renders a simple div', () => {
    const { container } = render(React.createElement('div', null, 'Hello'));
    expect(container.textContent).toBe('Hello');
  });
});