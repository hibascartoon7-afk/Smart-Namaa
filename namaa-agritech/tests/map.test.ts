import { describe, it, expect } from 'vitest';
import { projectPoints, projectionBounds, unprojectXY, type SensorPoint } from '../src/lib/field-math';
import { estimateBetweenSensors } from '../src/lib/engine/idw';

const pt = (id: string, latitude: number | null, longitude: number | null): SensorPoint => ({ id, point_name: id, latitude, longitude });
const corners = [pt('sw', 32.20, 35.20), pt('se', 32.20, 35.30), pt('nw', 32.30, 35.20), pt('ne', 32.30, 35.30)];

describe('field map projection', () => {
  it('north is up and east is right, inside a 10 % margin', () => {
    const { placed } = projectPoints(corners);
    const at = (id: string) => placed.find((p) => p.id === id)!;
    expect(at('nw')).toMatchObject({ x: 10, y: 10 });
    expect(at('se')).toMatchObject({ x: 90, y: 90 });
    expect(at('ne').y).toBeLessThan(at('sw').y);
    expect(at('ne').x).toBeGreaterThan(at('nw').x);
  });
  it('puts a single located point in the middle (nothing to scale against)', () => {
    expect(projectPoints([pt('only', 32.2, 35.2)]).placed[0]).toMatchObject({ x: 50, y: 50 });
  });
  it('keeps points without coordinates apart: they are not drawn and not given invented positions', () => {
    const { placed, unplaced } = projectPoints([...corners, pt('none', null, null), pt('half', 32.2, null)]);
    expect(placed).toHaveLength(4);
    expect(unplaced.map((p) => p.id)).toEqual(['none', 'half']);
  });
  it('has no bounds when no point has coordinates', () => {
    expect(projectionBounds([pt('a', null, null)])).toBeNull();
    expect(projectPoints([pt('a', null, null)]).placed).toEqual([]);
  });
  it('unprojectXY is the inverse of projectPoints', () => {
    const b = projectionBounds(corners)!;
    for (const p of projectPoints(corners).placed) {
      const original = corners.find((c) => c.id === p.id)!;
      const back = unprojectXY(b, p.x, p.y);
      expect(back.lat).toBeCloseTo(original.latitude as number, 9);
      expect(back.lng).toBeCloseTo(original.longitude as number, 9);
    }
  });
});

describe('tapping an empty spot of the map (estimate between sensors)', () => {
  const sensors = [
    { id: 'a', lat: 32.20, lng: 35.20, value: 20 },
    { id: 'b', lat: 32.20, lng: 35.30, value: 40 },
    { id: 'c', lat: 32.30, lng: 35.25, value: 30 },
  ];
  it('stays between the lowest and the highest sensor and reports the cross-validation error', () => {
    const r = estimateBetweenSensors(sensors, { lat: 32.24, lng: 35.25 });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.value).toBeGreaterThanOrEqual(20);
      expect(r.value).toBeLessThanOrEqual(40);
      expect(r.sensors).toBe(3);
      expect(r.outsideSensorArea).toBe(false);
      expect(Number.isFinite(r.looRmse)).toBe(true);
    }
  });
  it('says so when the tapped spot is outside the area of the sensors', () => {
    const r = estimateBetweenSensors(sensors, { lat: 32.50, lng: 35.25 });
    expect(r.status === 'ok' && r.outsideSensorArea).toBe(true);
  });
  it('refuses to estimate with fewer than 3 sensors (no guessing)', () => {
    expect(estimateBetweenSensors(sensors.slice(0, 2), { lat: 32.24, lng: 35.25 })).toEqual({ status: 'unavailable', reason: 'too_few_points' });
  });
  it('ignores a sensor whose value is missing instead of reading it as 0', () => {
    const withMissing = [...sensors, { id: 'd', lat: 32.25, lng: 35.22, value: Number.NaN }];
    const r = estimateBetweenSensors(withMissing, { lat: 32.24, lng: 35.25 });
    expect(r.status === 'ok' && r.sensors).toBe(3);
  });
});
