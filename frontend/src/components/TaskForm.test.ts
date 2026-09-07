import { shouldBlockEnterSubmit } from './TaskForm';

describe('shouldBlockEnterSubmit', () => {
  it('blocks Enter from a normal input (e.g. datetime picker)', () => {
    expect(shouldBlockEnterSubmit('INPUT')).toBe(true);
  });

  it('allows Enter in a textarea (newline)', () => {
    expect(shouldBlockEnterSubmit('TEXTAREA')).toBe(false);
  });

  it('allows Enter on a focused button (submit/cancel)', () => {
    expect(shouldBlockEnterSubmit('BUTTON')).toBe(false);
  });
});
