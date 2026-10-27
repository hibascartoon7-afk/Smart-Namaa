import { useMemo, useState } from 'react';
import { FlaskConical, Loader2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useFieldData } from '@/lib/field-data';
import { useLang } from '@/lib/lang';
import { entryOptions, insertRow, measurementLines, validateEntry, type EntryError } from '@/lib/nutrient-entry';

const INPUT = 'w-full bg-white/70 rounded-xl px-3 py-2 text-sm text-forest-700 outline-none focus:bg-white transition';

const T = {
  title: { en: 'Soil and leaf test results', ar: 'نتائج تحاليل التربة والأوراق' },
  intro: {
    en: 'Enter a lab result so the engine can decide on fertilization. A result can be judged only by a limit that is stored for your crop in the same method and unit; irrigation does not depend on it.',
    ar: 'أدخلي نتيجة تحليل مخبري ليقرر المحرك بشأن التسميد. لا يمكن الحكم على النتيجة إلا بحدّ مخزّن لمحصولك بنفس الطريقة والوحدة؛ والري لا يعتمد عليها.',
  },
  noCrop: { en: 'Choose a crop for this environment first.', ar: 'اختاري محصولاً لهذه البيئة أولاً.' },
  noLimits: {
    en: 'No limits are stored for this crop, so a result could not be judged. See docs/ADDING_A_CROP.md to add limits with a source.',
    ar: 'لا توجد حدود مخزّنة لهذا المحصول، فلا يمكن الحكم على أي نتيجة. راجعي docs/ADDING_A_CROP.md لإضافة حدود مع مصدرها.',
  },
  test: { en: 'Test', ar: 'التحليل' },
  choose: { en: 'Choose the test…', ar: 'اختاري التحليل…' },
  value: { en: 'Result', ar: 'النتيجة' },
  date: { en: 'Sampling date', ar: 'تاريخ أخذ العينة' },
  note: { en: 'Note (optional)', ar: 'ملاحظة (اختياري)' },
  save: { en: 'Save and run the engine', ar: 'حفظ وتشغيل المحرك' },
  recent: { en: 'Stored results', ar: 'النتائج المخزّنة' },
  none: { en: 'No result stored yet.', ar: 'لا توجد نتائج مخزّنة بعد.' },
  notJudged: { en: 'not judged: no stored limit for this method and unit', ar: 'لا يُحكم عليها: لا يوجد حدّ مخزّن لهذه الطريقة والوحدة' },
  remove: { en: 'Remove', ar: 'حذف' },
  confirm: { en: 'Remove this result?', ar: 'حذف هذه النتيجة؟' },
} as const;

const ERRORS: Record<EntryError, { en: string; ar: string }> = {
  choose_test: { en: 'Choose the test.', ar: 'اختاري التحليل.' },
  value: { en: 'Enter the result as a number, zero or more.', ar: 'أدخلي النتيجة كرقم، صفر أو أكثر.' },
  date: { en: 'Enter a valid date.', ar: 'أدخلي تاريخاً صحيحاً.' },
  future: { en: 'The date cannot be in the future.', ar: 'لا يمكن أن يكون التاريخ في المستقبل.' },
  note: { en: 'The note is too long (300 characters at most).', ar: 'الملاحظة طويلة (300 حرف كحد أقصى).' },
};

export default function NutrientEntry() {
  const { field, nutrientMeasurements, nutrientLimits, nutrientMethods, refreshDecision, refreshing } = useFieldData();
  const { lang } = useLang();
  const today = new Date().toLocaleDateString('en-CA');
  const [key, setKey] = useState('');
  const [valueText, setValueText] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => entryOptions(nutrientLimits, nutrientMethods, lang), [nutrientLimits, nutrientMethods, lang]);
  const lines = useMemo(() => measurementLines(nutrientMeasurements.slice(0, 10), nutrientLimits, nutrientMethods, lang), [nutrientMeasurements, nutrientLimits, nutrientMethods, lang]);
  if (!field) return null;
  const option = options.find((o) => o.key === key);

  const save = async () => {
    setError(null);
    const check = validateEntry({ option, valueText, date, today, note });
    if (!check.ok) { setError(ERRORS[check.error][lang]); return; }
    setBusy(true);
    const { error: e } = await supabase.from('nutrient_measurements').insert(insertRow(field.id, option!, check.value, check.measuredAt, note));
    if (e) { setBusy(false); setError(e.message); return; }
    setValueText(''); setNote('');
    await refreshDecision();
    setBusy(false);
  };

  const remove = async (id: string) => {
    if (!window.confirm(T.confirm[lang])) return;
    setBusy(true);
    const { error: e } = await supabase.from('nutrient_measurements').delete().eq('id', id);
    if (e) setError(e.message);
    await refreshDecision();
    setBusy(false);
  };

  return (
    <article dir={lang === 'ar' ? 'rtl' : 'ltr'} className="glass-card p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="grid place-items-center w-10 h-10 rounded-2xl border bg-moss-50 border-moss-200 shrink-0"><FlaskConical className="w-5 h-5 text-moss-600" /></div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-base font-semibold text-forest-700">{T.title[lang]}</h3>
          <p className="mt-1 text-sm text-forest-700/70 text-pretty">{T.intro[lang]}</p>

          {!field.crop_id ? (
            <p className="mt-3 text-sm text-forest-700/70">{T.noCrop[lang]}</p>
          ) : options.length === 0 ? (
            <p className="mt-3 text-sm text-forest-700/70">{T.noLimits[lang]}</p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-forest-700/70 sm:col-span-2">{T.test[lang]}
                <select className={`${INPUT} mt-1`} value={key} onChange={(e) => setKey(e.target.value)}>
                  <option value="">{T.choose[lang]}</option>
                  {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </label>
              <label className="text-xs text-forest-700/70">{T.value[lang]}{option ? ` (${option.unit})` : ''}
                <input className={`${INPUT} mt-1`} value={valueText} onChange={(e) => setValueText(e.target.value)} inputMode="decimal" />
              </label>
              <label className="text-xs text-forest-700/70">{T.date[lang]}
                <input type="date" className={`${INPUT} mt-1`} value={date} max={today} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="text-xs text-forest-700/70 sm:col-span-2">{T.note[lang]}
                <input className={`${INPUT} mt-1`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => void save()} disabled={busy || refreshing} className="btn-ghost !py-2 !px-4 text-sm disabled:opacity-60">
                  {busy || refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />} {T.save[lang]}
                </button>
                {error && <span role="alert" className="text-xs text-rose-500">{error}</span>}
              </div>
            </div>
          )}

          <h4 className="mt-5 text-sm font-semibold text-forest-700">{T.recent[lang]}</h4>
          {lines.length === 0 ? (
            <p className="mt-1 text-xs text-forest-700/50">{T.none[lang]}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 rounded-xl border border-forest-100 bg-white/60 px-3 py-2 text-xs text-forest-700/80">
                  <span className="min-w-0">
                    <strong className="text-forest-700">{l.nutrient} {l.value}</strong> · {l.method} · {l.source} · {l.date}
                    {l.note ? <span className="block text-forest-700/50">{l.note}</span> : null}
                    {!l.judged ? <span className="block text-moss-600">{T.notJudged[lang]}</span> : null}
                  </span>
                  {l.deletable ? (
                    <button type="button" aria-label={T.remove[lang]} onClick={() => void remove(l.id)} disabled={busy || refreshing} className="p-1.5 rounded-lg text-forest-700/50 hover:bg-rose-500 hover:text-white transition shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}
