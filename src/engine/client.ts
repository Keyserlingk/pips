import type { generate, quickPuzzle, verify } from './generator';
import type { EngineRequest } from './worker';

type ResultOf<T extends EngineRequest['type']> = T extends 'generate'
  ? ReturnType<typeof generate>
  : T extends 'quick'
    ? ReturnType<typeof quickPuzzle>
    : ReturnType<typeof verify>;

/** Runs an engine job in a fresh Web Worker; `cancel` terminates it. */
export function runEngine<T extends EngineRequest['type']>(
  type: T,
  ...payload: Extract<EngineRequest, { type: T }>['payload']
): { promise: Promise<ResultOf<T>>; cancel: () => void } {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let reject: (e: Error) => void = () => {};
  const promise = new Promise<ResultOf<T>>((res, rej) => {
    reject = rej;
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.ok) res(e.data.result);
      else rej(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      rej(new Error(e.message));
    };
  });
  worker.postMessage({ type, payload });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      reject(new Error('cancelled'));
    },
  };
}
