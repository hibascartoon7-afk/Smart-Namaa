import { describe, it, expect } from 'vitest';
import { run } from '../scripts/sync-engine.mjs';

describe('engine copies', () => {
  it('the Edge Function copy and the web app copy are identical to src/engine (run "npm run sync-engine" if this fails)', () => {
    expect(run(true)).toEqual([]);
  });
});
