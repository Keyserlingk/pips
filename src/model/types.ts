export type Cell = { r: number; c: number };

export type SumOp = '=' | '<' | '>';

export type Constraint =
  | { kind: 'sum'; op: SumOp; value: number }
  | { kind: 'equal' }
  | { kind: 'distinct' }
  | { kind: 'none' };

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

export type Difficulty = 'easy' | 'medium' | 'hard';

export type PuzzleOptions = {
  maxPip: 6 | 9;
  allowDuplicates: boolean;
  requireUnique: boolean;
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

export const DEFAULT_OPTIONS: PuzzleOptions = { maxPip: 6, allowDuplicates: false, requireUnique: true };
