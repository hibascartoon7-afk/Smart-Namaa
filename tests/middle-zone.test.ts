import { describe, it, expect } from 'vitest';
import { defaultPair, validPair, middleZoneValues, middleZoneMarker } from '../src/lib/middle-zone';
import { projectPoints, projectionBounds, projectLatLng, type Reading, type SensorPoint } from '../src/lib/field-math';

const TZ = 'Asia/Hebron';
const DAY = '2026-10-20';
const P = (id: string, name: string, lat: number | null, lng: number | null): SensorPoint => ({ id, point_name: name, latitude: lat, longitude: lng });
const R = (id: string, at: string, moisture: number | null, status = 'measured', temp: number | null = null): Reading => ({
  sensor_point_id: id, measured_at: at, moisture, soil_temperature: temp, ec: null,
  moisture_status: status, soil_temperature_status: temp === null ? 'not_measured' : 'measured', ec_status: 'not_measured',
});
const two = [P('a', 'Left', 32.2210, 35.2540), P('b', 'Right', 32.2214, 35.2548)];
const three = [...two, P('c', 'Back', 32.2220, 35.2544)];

describe('which two sensor points', () => {
  it('needs two points; prefers the points that have coordinates', () => {
    expect(defaultPair([P('a', 'A', null, null)])).toBeNull();
    expect(defaultPair([P('a', 'A', null, null), P('b', 'B', 32.1, 35.1), P('c', 'C', 32.2, 35.2)])).toEqual(['b', 'c']);
    expect(defaultPair([P('a', 'A', null, null), P('b', 'B', null, null)])).toEqual(['a', 'b']);
  });
  it('keeps a valid choice, falls back to the default when a point was removed or both are the same', () => {
    expect(validPair(three, ['a', 'c'])).toEqual(['a', 'c']);
    expect(validPair(two, ['a', 'c'])).toEqual(['a', 'b']);
    expect(validPair(three, ['a', 'a'])).toEqual(['a', 'b']);
  });
});

describe('middle zone values on the screen', () => {
  it('mean of the two latest readings of TODAY, per variable', () => {
    const rows = [
      R('a', '2026-10-20T06:00:00Z', 10), R('a', '2026-10-20T08:00:00Z', 20, 'measured', 22),
      R('b', '2026-10-20T07:00:00Z', 30, 'measured', 26),
      R('b', '2026-10-19T07:00:00Z', 99), // yesterday: ignored
    ];
    const v = middleZoneValues(two, rows, ['a', 'b'], DAY, TZ);
    expect(v.moisture).toMatchObject({ status: 'ok', value: 25, difference: 10 });
    expect(v.soil_temperature).toMatchObject({ status: 'ok', value: 24 });
    expect(v.ec).toMatchObject({ status: 'unavailable', missing: ['Left', 'Right'] }); // nobody measured EC
  });
  it('a flagged or missing reading means no estimate (never 0, never the other sensor)', () => {
    const rows = [R('a', '2026-10-20T08:00:00Z', 20), R('b', '2026-10-20T08:00:00Z', 55, 'suspect')];
    expect(middleZoneValues(two, rows, ['a', 'b'], DAY, TZ).moisture).toEqual({ status: 'unavailable', reason: 'reading_missing', missing: ['Right'] });
  });
});

describe('middle zone on the map', () => {
  it('sits halfway between the two drawn points and is drawn with the same projection as the points', () => {
    const m = middleZoneMarker(three, ['a', 'b'])!;
    expect(m.mid.x).toBeCloseTo((m.from.x + m.to.x) / 2, 9);
    expect(m.mid.y).toBeCloseTo((m.from.y + m.to.y) / 2, 9);
    const placed = projectPoints(three).placed;
    expect(m.from).toEqual({ x: placed.find((p) => p.id === 'a')!.x, y: placed.find((p) => p.id === 'a')!.y });
    expect(m.to).toEqual({ x: placed.find((p) => p.id === 'b')!.x, y: placed.find((p) => p.id === 'b')!.y });
  });
  it('is not drawn when one of the two points has no coordinates', () => {
    expect(middleZoneMarker([P('a', 'A', 32.1, 35.1), P('b', 'B', null, null), P('c', 'C', 32.2, 35.2)], ['a', 'b'])).toBeNull();
  });
  it('projectLatLng agrees with projectPoints', () => {
    const b = projectionBounds(three)!;
    expect(projectLatLng(b, 32.2214, 35.2548)).toEqual({ x: projectPoints(three).placed[1].x, y: projectPoints(three).placed[1].y });
  });
});
