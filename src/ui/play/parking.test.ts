import { describe, expect, it } from 'vitest';
import { dropRect, findSpot, overlaps, turned } from './parking';

const bounds = { x: -3, y: -1, w: 10, h: 6 };

describe('parking', () => {
  it('lets dominoes touch but not overlap', () => {
    expect(overlaps({ x: 0, y: 0, w: 2, h: 1 }, { x: 2, y: 0, w: 1, h: 1 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 2, h: 1 }, { x: 1.9, y: 0.5, w: 1, h: 1 })).toBe(true);
  });

  it('centres the grabbed half on the pointer', () => {
    expect(dropRect({ x: 5, y: 5 }, 0, 0)).toEqual({ x: 4.5, y: 4.5, w: 2, h: 1 });
    expect(dropRect({ x: 5, y: 5 }, 1, 1)).toEqual({ x: 4.5, y: 3.5, w: 1, h: 2 });
  });

  it('keeps a free drop where it is', () => {
    expect(findSpot({ x: -2.3, y: 0.4, w: 2, h: 1 }, [{ x: 0, y: 0, w: 1, h: 1 }], bounds)).toEqual({ x: -2.3, y: 0.4 });
  });

  it('nudges a drop off a blocker to the nearest free spot', () => {
    const spot = findSpot({ x: -1.8, y: 0, w: 2, h: 1 }, [{ x: 0, y: 0, w: 1, h: 1 }], bounds)!;
    expect(spot.x).toBeCloseTo(-2);
    expect(spot.y).toBeCloseTo(0);
  });

  it('keeps drops inside the bounds', () => {
    expect(findSpot({ x: -3.5, y: -2, w: 2, h: 1 }, [], bounds)).toEqual({ x: -3, y: -1 });
  });

  it('gives up when there is no room nearby', () => {
    expect(findSpot({ x: 0, y: 0, w: 2, h: 1 }, [{ x: -5, y: -5, w: 20, h: 20 }], bounds)).toBeNull();
  });

  it('turns around the centre', () => {
    expect(turned({ x: 0, y: 0, orient: 0 }, 1)).toEqual({ x: 0.5, y: -0.5, w: 1, h: 2 });
  });
});
