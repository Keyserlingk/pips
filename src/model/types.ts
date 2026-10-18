export type Cell = { r: number; c: number };

export type SumOp = '=' | '<' | '>';

export type Constraint =
  | { kind: 'sum'; op: SumOp; value: number }
  | { kind: 'equal' }
  | { kind: 'distinct' }
  | { kind: 'none' }
  // Extra constraints (opt-in via PuzzleOptions.extras)
  /** Orthogonally adjacent cells in the region differ by at most `max`. */
  | { kind: 'step'; max: number }
  /** The values multiply to `value`. */
  | { kind: 'product'; value: number }
  /** The largest (or smallest) value in the region is exactly `value`. */
  | { kind: 'extreme'; which: 'max' | 'min'; value: number }
  /** The region's sum is even (or odd). */
  | { kind: 'sumParity'; even: boolean };

export type ExtraKind = 'step' | 'product' | 'extreme' | 'sumParity';

export const EXTRA_KINDS: { id: ExtraKind; name: string }[] = [
  { id: 'step', name: 'Max step' },
  { id: 'product', name: 'Product' },
  { id: 'extreme', name: 'Max / min' },
  { id: 'sumParity', name: 'Sum even / odd' },
];

export type Region = {
  id: string;
  cells: Cell[];
  constraint: Constraint;
  /** Palette slot (0..NUM_REGION_COLORS-1); the theme decides the actual colour. */
  color: number;
};

/** Pip values of the two halves of a domino. */
export type Domino = [number, number];

/** A domino in the solution: pips[0] lies on `a`, pips[1] on `b`. */
export type Placement = { a: Cell; b: Cell; pips: Domino };

/** 'rachel' is the level above expert: bigger boards and the hardest puzzles. */
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'rachel';

export type PuzzleOptions = {
  maxPip: 6 | 9;
  allowDuplicates: boolean;
  requireUnique: boolean;
  /** Extra constraint kinds the editor offers and the generator may use. Missing = none. */
  extras?: ExtraKind[];
};

export type Puzzle = {
  version: 1;
  id: string;
  title: string;
  author?: string;
  difficulty?: Difficulty;
  width: number;
  height: number;
  cells: Cell[];
  regions: Region[];
  /** The tray. */
  dominoes: Domino[];
  solution?: Placement[];
  options: PuzzleOptions;
};

export const NUM_REGION_COLORS = 8;

export const DEFAULT_OPTIONS: PuzzleOptions = { maxPip: 6, allowDuplicates: false, requireUnique: true, extras: [] };
