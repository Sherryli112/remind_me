export const CARD_HEIGHT = { small: 105, medium: 130, large: 160 } as const;
export const CARD_WIDTH  = { small: 220, medium: 265, large: 310 } as const;

const ARROW_SPACE       = 20;   // space for ChevronsUp/Down indicator
const COLLAPSED_CARD_H  = 36;   // collapsed mini-card row height
const GAP               = 6;    // gap between cards
const INNER_PADDING     = 8;    // padding inside window at the edge

/**
 * Returns the required popup-manager window height in logical pixels.
 */
export function calcWindowHeight(
  count: number,
  isExpanded: boolean,
  size: 'small' | 'medium' | 'large',
  screenAvailableHeight: number,
): number {
  const cardH = CARD_HEIGHT[size];

  if (count <= 1) return cardH + INNER_PADDING;

  if (!isExpanded) {
    // collapsed: arrow + single full card
    return ARROW_SPACE + cardH + INNER_PADDING;
  }

  // expanded: 1 full card + (count-1) collapsed cards
  const total = cardH + (count - 1) * (COLLAPSED_CARD_H + GAP) + INNER_PADDING;
  return Math.min(total, screenAvailableHeight);
}
