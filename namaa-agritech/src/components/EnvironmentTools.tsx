import { useState } from 'react';
import { Check, Copy, Cpu, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useFieldData } from '@/lib/field-data';
import { formatLocalTime } from '@/lib/field-math';
import { cleanName, MAX_NAME_LENGTH, parseNumber } from '@/lib/new-environment';

const INPUT = 'w-full bg-white/70 rounded-xl px-3 py-2 text-sm text-forest-700 outline-none focus:bg-white transition';

/** names are what the farmer says ("sensor 1", "left"): they must be unique inside the environment */
function SensorManager() {
  const { field, points, reload } = useFieldData();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!field) return null;

  const check = (value: string, selfId: string | null): string | null => {
    const n = cleanName(value);
    if (!n) return 'Enter a name.';
    if (n.length > MAX_NAME_LENGTH) return `At most ${MAX_NAME_LENGTH} characters.`;
    if (points.some((p) => p.id !== selfId && p.point_name.toLowerCase() === n.toLowerCase())) return 'Another sensor already has this name.';
    return null;
  };

  const coords = (): { latitude: number | null; longitude: number | null } | string => {
    const a = parseNumber(lat);
    const b = parseNumber(lng);
    if (a === null && b === null) return { latitude: null, longitude: null };
    if (a === null || b === null || Number.isNaN(a) || Number.isNaN(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return 'Enter both latitude (-90..90) and longitude (-180..180), or leave both empty.';
    return { latitude: a, longitude: b };
  };

  const save = async (id: string | null) => {
    const err = check(name, id);
    if (err) return setMsg(err);
    const c = coords();
    if (typeof c === 'string') return setMsg(c);
    setBusy(true);
    setMsg(null);
    const res = id
      ? await supabase.from('sensor_points').update({ point_name: cleanName(name), ...c }).eq('id', id)
      : await supabase.from('sensor_points').insert({ field_id: field.id, point_name: cleanName(name), ...c });
    setBusy(false);
    if (res.error) return setMsg(res.error.message);
    setEditing(null);
    setAdding(false);
    setName(''); setLat(''); setLng('');
    reload();
  };

  const remove = async (id: string, label: string) => {
    if (!window.confirm(`Remove sensor "${label}" and all its readings?`)) return;
    const res = await supabase.from('sensor_points').delete().eq('id', id);
    if (res.error) setMsg(res.error.message);
    else reload();
  };

  const form = (id: string | null) => (
    <div className="flex flex-wrap items-center gap-2">
      <input className={`${INPUT} !w-40`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (1, left…)" autoFocus />
      <input className={`${INPUT} !w-28`} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude" inputMode="decimal" />
      <input className={`${INPUT} !w-28`} value={lng} onChange={(e) => setLng(e.target.value)} placeholder="Longitude" inputMode="decimal" />
      <button onClick={() => void save(id)} disabled={busy} className="grid place-items-center w-9 h-9 rounded-xl bg-forest-600 text-cream-100 hover:bg-moss-600 transition">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
      </button>
      <button onClick={() => { setEditing(null); setAdding(false); setMsg(null); }} className="grid place-items-center w-9 h-9 rounded-xl bg-white/60 text-forest-700/60 hover:bg-forest-600 hover:text-cream-100 transition"><X className="w-4 h-4" /></button>
    </div>
  );

  return (
    <div>
      <p className="text-xs font-semibold text-forest-700/60 mb-2">Sensors (their names are what you say to the assistant)</p>
      <div className="space-y-2">
        {points.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3">
            {editing === p.id ? form(p.id) : (
              <>
                <span className="rounded-full bg-white/60 px-3 py-1 text-sm font-semibold text-forest-700">{p.point_name}</span>
                <span className="text-[11px] text-forest-700/40">{p.latitude !== null && p.longitude !== null ? `${p.latitude}, ${p.longitude}` : 'no coordinates'}</span>
                <button aria-label="Edit" onClick={() => { setEditing(p.id); setAdding(false); setName(p.point_name); setLat(p.latitude?.toString() ?? ''); setLng(p.longitude?.toString() ?? ''); setMsg(null); }} className="p-1.5 rounded-lg text-forest-700/50 hover:bg-forest-600 hover:text-cream-100 transition"><Pencil className="w-3.5 h-3.5" /></button>
                <button aria-label="Remove" onClick={() => void remove(p.id, p.point_name)} className="p-1.5 rounded-lg text-forest-700/50 hover:bg-rose-500 hover:text-white transition"><Trash2 className="w-3.5 h-3.5" /></button>
              </>
            )}
          </div>
        ))}
        {adding ? form(null) : (
          <button onClick={() => { setAdding(true); setEditing(null); setName(''); setLat(''); setLng(''); setMsg(null); }} className="text-xs font-semibold text-forest-600 flex items-center gap-1 hover:underline"><Plus className="w-3.5 h-3.5" /> Add a sensor</button>
        )}
      </div>
      {msg && <p className="text-[11px] text-rose-500 mt-2">{msg}</p>}
      <p className="text-[11px] text-forest-700/40 mt-2">Coordinates are optional. With 3 or more located sensors the map can estimate values between them.</p>
    </div>
  );
}

function DevicePanel() {
  const { field, devices, reload } = useFieldData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ token: string; endpoint: string; deviceId: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (!field) return null;

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const res = await supabase.functions.invoke('device-provision', { body });
    setBusy(false);
    if (res.error) {
      let text = res.error.message;
      const ctx = (res.error as { context?: Response }).context;
      try { const j = ctx ? ((await ctx.json()) as { error?: string }) : null; if (j?.error) text = j.error; } catch { /* keep message */ }
      setError(text);
      return null;
    }
    return res.data as Record<string, string>;
  };

  const create = async () => {
    const d = await call({ action: 'create', field_id: field.id, device_name: `ESP32 ${field.crop_name ?? field.name}` });
    if (d) { setCreated({ token: d.token, endpoint: d.endpoint, deviceId: d.device_id }); reload(); }
  };

  const sample = created
    ? `POST ${created.endpoint}\nAuthorization: Bearer ${created.token}\nContent-Type: application/json\n\n{"readings":[{"sensor":"${'1'}","moisture":31.2,"soil_temperature":24.1,"ec":1.3}]}`
    : '';

  return (
    <div>
      <p className="text-xs font-semibold text-forest-700/60 mb-2">ESP32 devices</p>
      <div className="space-y-2">
        {devices.length === 0 && <p className="text-sm text-forest-700/60">No device connected yet.</p>}
        {devices.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-3 text-sm">
            <Cpu className="w-4 h-4 text-forest-600" />
            <span className="font-semibold text-forest-700">{d.device_name ?? 'ESP32'}</span>
            <span className="text-[11px] text-forest-700/50">
              {d.device_status === 'revoked' ? 'revoked' : d.last_seen_at ? `last seen ${formatLocalTime(d.last_seen_at, field.timezone)}` : 'never connected'}
            </span>
            {d.device_status !== 'revoked' && (
              <button
                onClick={async () => { if (window.confirm('Stop this device from sending data? Its token will no longer work.') && (await call({ action: 'revoke', device_id: d.id }))) reload(); }}
                className="text-[11px] font-semibold text-rose-500 hover:underline"
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>
      <button onClick={() => void create()} disabled={busy} className="mt-3 text-xs font-semibold text-forest-600 flex items-center gap-1 hover:underline disabled:opacity-50">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Connect a new ESP32
      </button>
      {error && <p className="text-[11px] text-rose-500 mt-2">{error}</p>}

      {created && (
        <div className="mt-3 rounded-2xl bg-forest-700 text-cream-100 p-4 text-xs">
          <p className="font-semibold mb-1">Copy the token now: it is shown only once.</p>
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] bg-forest-900/40 rounded-lg p-3">{sample}</pre>
          <button
            onClick={() => { void navigator.clipboard.writeText(sample).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }}
            className="mt-2 flex items-center gap-1 rounded-full bg-forest-600 px-3 py-1 font-semibold hover:bg-moss-600 transition"
          >
            <Copy className="w-3 h-3" /> {copied ? 'Copied' : 'Copy'}
          </button>
          <p className="mt-2 text-cream-100/70">Send one request per reading time, with the sensor names exactly as they are written here. A value that was not measured: send null or leave it out (never 0).</p>
          <button onClick={() => setCreated(null)} className="mt-2 underline text-cream-100/80 hover:text-white">I saved it</button>
        </div>
      )}
    </div>
  );
}

export default function EnvironmentTools() {
  const { field } = useFieldData();
  const [open, setOpen] = useState(false);
  if (!field) return null;
  return (
    <div className="mt-4 border-t border-forest-700/10 pt-3">
      <button onClick={() => setOpen((o) => !o)} className="text-sm font-semibold text-forest-600 hover:text-moss-600 hover:underline">
        {open ? 'Hide' : 'Manage'} sensors and devices of “{field.name}”
      </button>
      {open && (
        <div className="mt-4 grid md:grid-cols-2 gap-8">
          <SensorManager />
          <DevicePanel />
        </div>
      )}
    </div>
  );
}
