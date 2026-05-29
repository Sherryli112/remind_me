import { calcWindowHeight, CARD_WIDTH } from './height';

describe('calcWindowHeight', () => {
  it('0 reminders returns fallback card height', () => {
    expect(calcWindowHeight(0, false, 'medium', 900)).toBe(138);
  });

  it('1 reminder — no arrow space', () => {
    expect(calcWindowHeight(1, false, 'medium', 900)).toBe(138); // 130+8
  });

  it('1 reminder small size', () => {
    expect(calcWindowHeight(1, false, 'small', 900)).toBe(113); // 105+8
  });

  it('2 reminders collapsed — adds arrow space', () => {
    expect(calcWindowHeight(2, false, 'medium', 900)).toBe(158); // 20+130+8
  });

  it('2 reminders expanded — 1 full + 1 collapsed card', () => {
    // 130 + 1*(36+6) + 8 = 180
    expect(calcWindowHeight(2, true, 'medium', 900)).toBe(180);
  });

  it('3 reminders expanded', () => {
    // 130 + 2*(36+6) + 8 = 222
    expect(calcWindowHeight(3, true, 'medium', 900)).toBe(222);
  });

  it('caps at screenAvailableHeight', () => {
    expect(calcWindowHeight(20, true, 'medium', 200)).toBe(200);
  });

  it('CARD_WIDTH exports correct values', () => {
    expect(CARD_WIDTH.small).toBe(220);
    expect(CARD_WIDTH.medium).toBe(265);
    expect(CARD_WIDTH.large).toBe(310);
  });
});
