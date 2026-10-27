import { useEffect, useState } from 'react';
import { Plus, X, Loader2, LocateFixed, Trash2, Sprout } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useFieldData } from '@/lib/field-data';
import { createEnvironment } from '@/lib/environment-api';
import EnvironmentTools from './EnvironmentTools';
import { validateNewEnvironment, type FormErrors, type NewEnvironmentForm } from '@/lib/new-environment';

interface Option {
  id: string;
  label: string;
}

interface CropOption extends Option {
  ready: boolean;
  missing: string[];
}

const INPUT = 'w-full bg-white/70 rounded-xl px-4 py-2.5 text-sm text-forest-700 outline-none focus:bg-white transition';
const LABEL = 'text-xs font-semibold text-forest-700/60 mb-1.5 block';

function todayLocal(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

function emptyForm(): NewEnvironmentForm {
  return {
    name: '',
    cropId: '',
    soilTypeId: '',
    plantingDate: '',
    latitude: '',
    longitude: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    areaM2: '',
    sensorNames: ['1', '2'],
  };
}

function Err({ text }: { text?: string }) {
  return text ? <p className="text-[11px] text-rose-500 mt-1">{text}</p> : null;
}

function CreateEnvironmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (fieldId: string, note: string | null) => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState<NewEnvironmentForm>(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [soils, setSoils] = useState<Option[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [geoNote, setGeoNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [c, s] = await Promise.all([
        supabase.from('crop_readiness').select('crop_id,crop_name,has_kc,has_water_params,has_stage_lengths').order('crop_name'),
        supabase.from('soil_types').select('id,soil_name').order('soil_name'),
      ]);
      if (cancelled) return;
      if (c.error || s.error) setListError((c.error ?? s.error)!.message);
      setCrops(
        (c.data ?? []).map((r) => {
          const missing = [!r.has_kc && 'Kc values', !r.has_water_params && 'root depth', !r.has_stage_lengths && 'growth-stage lengths'].filter(Boolean) as string[];
          return { id: r.crop_id, label: r.crop_name, ready: missing.length === 0, missing };
        }),
      );
      setSoils((s.data ?? []).map((r) => ({ id: r.id, label: r.soil_name })));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const set = <K extends keyof NewEnvironmentForm>(k: K, v: NewEnvironmentForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const useMyLocation = () => {
    setGeoNote(null);
    if (!navigator.geolocation) {
      setGeoNote('This browser cannot give a location. Enter the coordinates by hand.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        set('latitude', p.coords.latitude.toFixed(5));
        set('longitude', p.coords.longitude.toFixed(5));
      },
      () => setGeoNote('Location was not allowed. Enter the coordinates by hand.'),
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const result = validateNewEnvironment(form, todayLocal());
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    if (!user) {
      setSubmitError('Please sign in again.');
      return;
    }
    setSaving(true);
    const res = await createEnvironment(user.id, result.value);
    setSaving(false);
    if (res.error || !res.fieldId) {
      setSubmitError(res.error ?? 'Could not create the environment.');
      return;
    }
    onCreated(res.fieldId, res.weatherNote);
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-forest-900/40 backdrop-blur-sm p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg glass rounded-3xl shadow-2xl p-6 sm:p-7 my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-display text-xl font-semibold text-forest-700">New environment</h3>
            <p className="text-xs text-forest-700/50">One crop, one ESP32 unit, several sensor points.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid place-items-center w-9 h-9 rounded-full bg-white/50 text-forest-700/60 hover:bg-forest-600 hover:text-cream-100 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={LABEL}>Name</label>
            <input className={INPUT} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Tomato greenhouse" />
            <Err text={errors.name} />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>Crop</label>
              <select className={INPUT} value={form.cropId} onChange={(e) => set('cropId', e.target.value)}>
                <option value="">Choose…</option>
                {crops.filter((c) => c.ready).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                {crops.some((c) => !c.ready) && (
                  <optgroup label="Data incomplete (the engine cannot decide yet)">
                    {crops.filter((c) => !c.ready).map((c) => <option key={c.id} value={c.id} disabled>{c.label} — needs {c.missing.join(', ')}</option>)}
                  </optgroup>
                )}
              </select>
              <Err text={errors.cropId} />
            </div>
            <div>
              <label className={LABEL}>Soil type</label>
              <select className={INPUT} value={form.soilTypeId} onChange={(e) => set('soilTypeId', e.target.value)}>
                <option value="">Choose…</option>
                {soils.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <Err text={errors.soilTypeId} />
            </div>
          </div>
          {listError && <p className="text-[11px] text-rose-500">Could not load the lists: {listError}</p>}
          {!listError && crops.length === 0 && <p className="text-[11px] text-forest-700/50">No crops found in the database yet.</p>}
          {!listError && crops.length > 0 && !crops.some((c) => c.ready) && <p className="text-[11px] text-rose-500">No crop is ready: add its growth-stage lengths first (see docs/ADDING_A_CROP.md).</p>}

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>Planting date</label>
              <input type="date" className={INPUT} value={form.plantingDate} max={todayLocal()} onChange={(e) => set('plantingDate', e.target.value)} />
              <Err text={errors.plantingDate} />
            </div>
            <div>
              <label className={LABEL}>Area in m² (optional)</label>
              <input className={INPUT} inputMode="decimal" value={form.areaM2} onChange={(e) => set('areaM2', e.target.value)} placeholder="1000" />
              <Err text={errors.areaM2} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className={LABEL}>Location (used for weather)</label>
              <button type="button" onClick={useMyLocation} className="text-xs font-semibold text-forest-600 flex items-center gap-1 mb-1.5 hover:underline">
                <LocateFixed className="w-3.5 h-3.5" /> Use my location
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <input className={INPUT} inputMode="decimal" value={form.latitude} onChange={(e) => set('latitude', e.target.value)} placeholder="Latitude" />
                <Err text={errors.latitude} />
              </div>
              <div>
                <input className={INPUT} inputMode="decimal" value={form.longitude} onChange={(e) => set('longitude', e.target.value)} placeholder="Longitude" />
                <Err text={errors.longitude} />
              </div>
            </div>
            {geoNote && <p className="text-[11px] text-forest-700/60 mt-1">{geoNote}</p>}
          </div>

          <div>
            <label className={LABEL}>Time zone</label>
            <input className={INPUT} value={form.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Asia/Hebron" />
            <Err text={errors.timezone} />
          </div>

          <div>
            <label className={LABEL}>Sensor names (so &quot;irrigate at sensor 1&quot; is understood)</label>
            <div className="space-y-2">
              {form.sensorNames.map((n, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className={INPUT}
                    value={n}
                    onChange={(e) => set('sensorNames', form.sensorNames.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder={`Sensor ${i + 1} (e.g. 1, left, near the door)`}
                  />
                  <button
                    type="button"
                    aria-label="Remove sensor"
                    disabled={form.sensorNames.length <= 1}
                    onClick={() => set('sensorNames', form.sensorNames.filter((_, j) => j !== i))}
                    className="grid place-items-center w-10 shrink-0 rounded-xl bg-white/50 text-forest-700/50 hover:bg-forest-600 hover:text-cream-100 disabled:opacity-30"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => set('sensorNames', [...form.sensorNames, ''])} className="mt-2 text-xs font-semibold text-forest-600 flex items-center gap-1 hover:underline">
              <Plus className="w-3.5 h-3.5" /> Add a sensor
            </button>
            <Err text={errors.sensorNames} />
          </div>

          {submitError && <p className="text-xs text-rose-500 bg-rose-50 rounded-lg px-3 py-2 border border-rose-200">{submitError}</p>}

          <button type="submit" disabled={saving} className="w-full btn-primary justify-center disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create environment'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function EnvironmentBar({ onAuthClick }: { onAuthClick: () => void }) {
  const { signedIn, loading, fields, field, selectField, reload } = useFieldData();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  return (
    <section id="environments" className="relative pt-28 pb-6">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="glass-card p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-3">
            <Sprout className="w-5 h-5 text-forest-600" />
            <h2 className="font-display text-lg font-semibold text-forest-700">My environments</h2>
          </div>

          {!signedIn ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-forest-700/60">Sign in to create an environment for each crop.</p>
              <button onClick={onAuthClick} className="btn-primary !py-2 !px-5 text-sm">Sign in</button>
            </div>
          ) : loading && fields.length === 0 ? (
            <p className="text-sm text-forest-700/60">Loading…</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {fields.map((f) => (
                <button
                  key={f.id}
                  onClick={() => selectField(f.id)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    field?.id === f.id ? 'bg-forest-600 text-cream-100 shadow' : 'bg-white/60 text-forest-700/70 hover:bg-forest-600 hover:text-cream-100'
                  }`}
                >
                  {f.name}
                  {f.crop_name ? <span className="opacity-60 font-normal"> · {f.crop_name}</span> : null}
                </button>
              ))}
              <button onClick={() => setOpen(true)} className="rounded-full px-4 py-2 text-sm font-semibold border border-dashed border-forest-700/30 text-forest-600 hover:bg-forest-600 hover:text-cream-100 flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> New environment
              </button>
              {fields.length === 0 && <p className="w-full text-sm text-forest-700/60 mt-1">No environment yet. Create your first one to start.</p>}
            </div>
          )}
          {note && <p className="mt-3 text-xs text-forest-700/60">{note}</p>}
          {signedIn && fields.length > 0 && <EnvironmentTools />}
        </div>
      </div>

      {open && (
        <CreateEnvironmentModal
          onClose={() => setOpen(false)}
          onCreated={(id, weatherNote) => {
            setOpen(false);
            setNote(weatherNote);
            selectField(id);
            reload();
          }}
        />
      )}
    </section>
  );
}
