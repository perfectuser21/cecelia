import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import BusinessInputs from './BusinessInputs';
afterEach(cleanup);
it('必填布尔输入接受明确的false，不将JSON字段必填误解成必须选是', () => {
  render(<form data-testid="business-form"><BusinessInputs schema={{type:'object',properties:{enabled:{type:'boolean',title:'启用'}},required:['enabled']}} value={{enabled:false}} onChange={() => {}} /></form>);
  expect((screen.getByTestId('business-form') as HTMLFormElement).checkValidity()).toBe(true);
});
