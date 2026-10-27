import { useState } from 'react';
import type { SensorPoint } from './field-math';
import { validPair, type Pair } from './middle-zone';

/** the two sensor points of the middle zone: the default pair until the user picks another (only possible with 3+ points) */
export function useMiddleZonePair(points: SensorPoint[]): [Pair | null, (p: Pair) => void] {
  const [chosen, setChosen] = useState<Pair | null>(null);
  return [validPair(points, chosen), setChosen];
}
