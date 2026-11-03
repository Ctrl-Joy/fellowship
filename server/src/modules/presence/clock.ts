import type { ModuleContext } from '../../context';

export interface Clock {
  now(): number;
  /** Tests replace the clock to move time forward deterministically. */
  set(fn: () => number): void;
  reset(): void;
}

const clocks = new WeakMap<object, Clock>();

/** One clock per app context, shared by presence and notifications (DND windows, expiry). */
export function clockFor(ctx: ModuleContext): Clock {
  let c = clocks.get(ctx);
  if (!c) {
    let fn: () => number = () => Date.now();
    c = {
      now: () => fn(),
      set: (next) => { fn = next; },
      reset: () => { fn = () => Date.now(); },
    };
    clocks.set(ctx, c);
  }
  return c;
}
