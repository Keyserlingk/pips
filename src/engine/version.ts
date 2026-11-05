/**
 * Version of what quickPuzzle makes from a seed in deterministic mode. Seed links
 * (#/s/...) carry it, because a link can only be turned back into its puzzle by
 * the same generator. Bump it whenever a change alters that output; the
 * "seed links" test in seedLink.test.ts fails when it does.
 */
export const GENERATOR_VERSION = 1;
