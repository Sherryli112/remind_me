import { localInputToIso } from './dateInput';

describe('localInputToIso', () => {
  it('空字串代表不限制，回傳 null', () => {
    expect(localInputToIso('')).toBeNull();
  });

  it('沒有時區的本地時間會依執行環境的時區轉成 UTC ISO 字串', () => {
    const input = '2026-06-01T18:30';
    expect(localInputToIso(input)).toBe(new Date(2026, 5, 1, 18, 30).toISOString());
  });

  it('已經帶時區的字串保持同一個時間點', () => {
    expect(localInputToIso('2026-06-01T10:30:00.000Z')).toBe('2026-06-01T10:30:00.000Z');
    expect(localInputToIso('2026-06-01T18:30:00+08:00')).toBe('2026-06-01T10:30:00.000Z');
  });

  it('無法解析的字串原樣送出，交給後端驗證', () => {
    expect(localInputToIso('not-a-date')).toBe('not-a-date');
  });
});
