import { describe, it, expect } from 'vitest';
import { validateNewEnvironment, parseNumber, type NewEnvironmentForm } from '../src/lib/new-environment';

const TODAY = '2026-10-20';
const good: NewEnvironmentForm = {
  name: '  Tomato   greenhouse ',
  cropId: 'c1',
  soilTypeId: 's1',
  plantingDate: '2026-09-01',
  latitude: '32.2211',
  longitude: '35.2544',
  timezone: 'Asia/Hebron',
  areaM2: '',
  sensorNames: ['1', ' left  side ', ''],
};

describe('validateNewEnvironment', () => {
  it('accepts a good form and cleans names; empty area stays null (not 0)', () => {
    const r = validateNewEnvironment(good, TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('Tomato greenhouse');
      expect(r.value.sensorNames).toEqual(['1', 'left side']);
      expect(r.value.areaM2).toBeNull();
      expect(r.value.latitude).toBeCloseTo(32.2211);
    }
  });
  it('empty coordinates are missing, never 0', () => {
    const r = validateNewEnvironment({ ...good, latitude: '', longitude: '' }, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.latitude).toBeDefined();
      expect(r.errors.longitude).toBeDefined();
    }
  });
  it('rejects out-of-range or non-numeric coordinates', () => {
    expect(validateNewEnvironment({ ...good, latitude: '91' }, TODAY).ok).toBe(false);
    expect(validateNewEnvironment({ ...good, longitude: '181' }, TODAY).ok).toBe(false);
    expect(validateNewEnvironment({ ...good, latitude: '32,2' }, TODAY).ok).toBe(false);
  });
  it('rejects future or impossible planting dates', () => {
    expect(validateNewEnvironment({ ...good, plantingDate: '2026-10-21' }, TODAY).ok).toBe(false);
    expect(validateNewEnvironment({ ...good, plantingDate: '2026-02-30' }, TODAY).ok).toBe(false);
    expect(validateNewEnvironment({ ...good, plantingDate: '' }, TODAY).ok).toBe(false);
  });
  it('rejects an unknown time zone', () => {
    expect(validateNewEnvironment({ ...good, timezone: 'Mars/Base' }, TODAY).ok).toBe(false);
  });
  it('needs crop, soil and at least one sensor; names must be unique', () => {
    expect(validateNewEnvironment({ ...good, cropId: '' }, TODAY).ok).toBe(false);
    expect(validateNewEnvironment({ ...good, soilTypeId: '' }, TODAY).ok).toBe(false);
    expect(validateNewEnvironment({ ...good, sensorNames: ['', '  '] }, TODAY).ok).toBe(false);
    expect(validateNewEnvironment({ ...good, sensorNames: ['A', ' a '] }, TODAY).ok).toBe(false);
  });
  it('area must be positive when given', () => {
    expect(validateNewEnvironment({ ...good, areaM2: '0' }, TODAY).ok).toBe(false);
    expect(validateNewEnvironment({ ...good, areaM2: '-5' }, TODAY).ok).toBe(false);
    const r = validateNewEnvironment({ ...good, areaM2: '1000' }, TODAY);
    expect(r.ok && r.value.areaM2).toBe(1000);
  });
});

describe('parseNumber', () => {
  it('empty is null, junk is NaN', () => {
    expect(parseNumber('  ')).toBeNull();
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('-12.5')).toBe(-12.5);
  });
});
