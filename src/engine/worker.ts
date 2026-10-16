import { generate, quickPuzzle, verify } from './generator';

export type EngineRequest =
  | { type: 'generate'; payload: Parameters<typeof generate> }
  | { type: 'quick'; payload: Parameters<typeof quickPuzzle> }
  | { type: 'verify'; payload: Parameters<typeof verify> };

const post = (msg: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(msg);

self.onmessage = (e: MessageEvent<EngineRequest>) => {
  try {
    const req = e.data;
    const result =
      req.type === 'generate'
        ? generate(...req.payload)
        : req.type === 'quick'
          ? quickPuzzle(...req.payload)
          : verify(...req.payload);
    post({ ok: true, result });
  } catch (err) {
    post({ ok: false, error: String(err) });
  }
};
