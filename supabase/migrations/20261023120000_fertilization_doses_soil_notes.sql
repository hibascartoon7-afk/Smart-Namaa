-- Fertilization: (1) heat limit, (2) dose ceilings per crop and nutrient, (3) soil notes per fertilizer.
-- Every row has a source_id; the sources are 'unverified' until the owner has checked them. Safe to run again, nothing is deleted,
-- a row that already exists is never changed.
--
-- A) alert_thresholds: 'fertilizer_hold_air_temp_max_c' = 30 degrees C for every crop. A PRECAUTION, not a measured limit:
--    the sources are home-garden / lawn guidance (about 29-32 C = 85-90 F; one horticulture professor says 86 F = 30 C) plus a
--    North Carolina State Extension note that granular fertilizer can burn plants in hot weather. No field-crop trial was found.
-- B) crop_nutrient_rates: the CEILING (and where the source gives one, the lower end) of the nutrient dose, in kg of nutrient per
--    dunum (1 dunum = 1000 m2). The sources give pounds per acre: kg/dunum = lb/acre x 0.45359237 / 4.0468564224 (definitions of
--    lb and acre). California rates for high-yield systems, not local trials: the engine shows them as a ceiling, never as a target.
--      Tomato (UC IPM, soil test "Low"): up to 150 lb P2O5/acre, up to 200 lb K2O/acre.
--      Olives (CDFA FREP / UC): N 40-100 lb N/acre per year; K (fertigation) 200-300 lb K2SO4/acre, shown as K2O with the 50 % K2O
--      of potassium sulphate (FAO minimum) = 100-150 lb K2O/acre. No phosphorus rate: the guideline says P fertilization will
--      not normally improve olive yields.
-- C) fertilizer_soil_notes: what the sources say about a fertilizer on a soil type. Only statements found in a source are stored; a
--    fertilizer or soil with no row simply has "no information stored" (it is NOT read as "suitable").
--      University of Idaho BUL 926: ammonium-forming N fertilizers (urea, ammonium sulphate) lose more N as ammonia gas on sandy
--      soils (low CEC, organic matter and buffering) than on silty or clay soils; alkaline soils (pH above 7) lose more.
--      CDFA olive guideline: potassium chloride can cause chloride toxicity on sandy or sandy loam soils, poorly drained or saline
--      soils; potassium sulphate is safer there.
--    The texture groups are a NAMAA reading of the sources: "sandy" = Sand, Loamy sand; "silty or clay" = Silt loam, Silt, Silty clay
--    loam, Silty clay, Clay; Sandy loam and Loam are not classified by the Idaho bulletin (Sandy loam is "light" for potassium sulphate,
--    as the olive guideline names it). Soil pH, salinity and drainage are not recorded in the app: those notes are shown as conditions to check.

-- sources (copies source_type from the existing Table 12 source so any allowed-value rule still holds)
insert into public.sources (id, title, source_type, verification_status, url)
select v.id, v.title, s.source_type, 'unverified', v.url
from (select source_type from public.sources where title ilike '%Table 12%' order by id limit 1) s,
     (values
       ('HEAT_GUIDANCE',
        'Garden and lawn guidance on fertilizing in hot weather (avoid about 29-32 C / 85-90 F; granular fertilizer can burn plants; NC State Extension: be cautious with fertilizer in hot weather). Not a field-crop trial.',
        'https://simplelawnsolutions.com/blogs/lawncare/when-is-it-too-hot-to-apply-fertilizer'),
       ('UIDAHO_BUL926',
        'University of Idaho Extension BUL 926: Understanding Factors Controlling Ammonia Volatilization from Fertilizer Nitrogen Applications (Dari, Rogers, Walsh, 2019)',
        'https://uidaho.edu/-/media/UIdaho-Responsive/Files/Extension/publications/bul/bul926.pdf')
     ) as v(id, title, url)
on conflict (id) do nothing;

do $$
declare missing text;
begin
  select string_agg(x, ', ') into missing
    from unnest(array['HEAT_GUIDANCE', 'UIDAHO_BUL926', 'CDFA_OLIVE_LEAF', 'UCIPM_TOMATO_SOIL', 'FAO_FERT_SPECS']) as x
   where not exists (select 1 from public.sources where id = x);
  if missing is not null then
    raise exception 'Sources missing: %. Run the earlier fertilization migrations first.', missing;
  end if;
end $$;

-- A) heat limit
insert into public.alert_thresholds (code, crop_id, value, unit, source_id, notes)
values ('fertilizer_hold_air_temp_max_c', null, 30, 'C', 'HEAT_GUIDANCE',
        'Precaution for all crops: the forecast maximum air temperature of the next 24 hours at or above this value raises "do not apply fertilizer: heat" (fertilizer salts plus heat and dry soil can burn plants). Garden and lawn guidance, about 29-32 C; no field-crop trial.')
on conflict do nothing;

-- B) dose ceilings
create table if not exists public.crop_nutrient_rates (
  id               uuid primary key default gen_random_uuid(),
  crop_id          uuid not null references public.crops(id) on delete cascade,
  nutrient         text not null check (nutrient in ('n', 'p', 'k')),
  min_kg_per_dunum numeric check (min_kg_per_dunum is null or min_kg_per_dunum >= 0),
  max_kg_per_dunum numeric not null check (max_kg_per_dunum > 0),
  basis_en         text not null,
  basis_ar         text not null,
  source_id        text not null references public.sources(id),
  unique (crop_id, nutrient),
  check (min_kg_per_dunum is null or min_kg_per_dunum <= max_kg_per_dunum)
);
alter table public.crop_nutrient_rates enable row level security;
drop policy if exists crop_nutrient_rates_read on public.crop_nutrient_rates;
create policy crop_nutrient_rates_read on public.crop_nutrient_rates for select to authenticated using (true);

insert into public.crop_nutrient_rates (crop_id, nutrient, min_kg_per_dunum, max_kg_per_dunum, basis_en, basis_ar, source_id)
select c.id, v.nutrient,
       case when v.lb_min is null then null else round((v.lb_min * 0.45359237 / 4.0468564224)::numeric, 2) end,
       round((v.lb_max * 0.45359237 / 4.0468564224)::numeric, 2),
       v.basis_en, v.basis_ar, v.source_id
from (values
  ('Tomato', 'p', null::numeric, 150::numeric, 'UC IPM: up to 150 lb P2O5/acre for soil testing Low in phosphorus (up to half for Medium). Season total, a ceiling. Phosphorus is best applied before planting or as a starter solution at transplanting. Processing tomato in California.',
   'مرجع UC IPM: حتى 150 رطل P2O5 للأكر للتربة الفقيرة بالفسفور (نصفها للمتوسطة). مجموع الموسم، وهو سقف أقصى. الأفضل وضع الفسفور قبل الزراعة أو كمحلول بادئ عند الشتل. طماطم المصانع في كاليفورنيا.', 'UCIPM_TOMATO_SOIL'),
  ('Tomato', 'k', null, 200, 'UC IPM: up to 200 lb K2O/acre for soil testing Low in potassium (up to half for Medium). Season total, a ceiling. Potassium can be applied before planting, as a side-dress or through drip irrigation; fertigating more than once a week is generally unnecessary. Processing tomato in California.',
   'مرجع UC IPM: حتى 200 رطل K2O للأكر للتربة الفقيرة بالبوتاسيوم (نصفها للمتوسطة). مجموع الموسم، وهو سقف أقصى. يمكن وضع البوتاسيوم قبل الزراعة أو كتسميد جانبي أو مع ماء التنقيط؛ التسميد بالتنقيط أكثر من مرة بالأسبوع غير ضروري عموماً. طماطم المصانع في كاليفورنيا.', 'UCIPM_TOMATO_SOIL'),
  ('Olives (40 to 60% ground coverage by canopy)', 'n', 40, 100, 'CDFA FREP / UC: 40-100 lb N/acre per year for California oil olives. Adjust so the July leaf N stays between 1.5 and 2.0 %; do not fertilize when leaf N is adequate. Fertigate in low doses from about February; finish by the end of September.',
   'مرجع CDFA/UC: 40-100 رطل N للأكر سنوياً لزيتون الزيت في كاليفورنيا. تُعدَّل حتى يبقى نيتروجين ورقة تموز بين 1.5 و2.0%؛ لا تسمّدي إذا كان نيتروجين الورقة كافياً. تُوزَّع بجرعات صغيرة مع الري من حوالي شباط وتنتهي بنهاية أيلول.', 'CDFA_OLIVE_LEAF'),
  ('Olives (40 to 60% ground coverage by canopy)', 'k', 100, 150, 'CDFA FREP / UC: when leaf K is deficient and K is fertigated, 200-300 lb potassium sulphate (K2SO4)/acre; shown as K2O with 50 % K2O (FAO minimum) = 100-150 lb K2O/acre. A banded application of 500-1000 lb K2SO4/acre can correct a deficiency for several years. Potassium sulphate is safer than potassium chloride on sandy, poorly drained or saline soils.',
   'مرجع CDFA/UC: عند نقص بوتاسيوم الورقة مع التسميد بالتنقيط، 200-300 رطل كبريتات البوتاسيوم (K2SO4) للأكر؛ معروضة كـ K2O بنسبة 50% (الحد الأدنى عند FAO) = 100-150 رطل K2O للأكر. التسميد المشريط بـ 500-1000 رطل K2SO4 للأكر قد يصحّح النقص لعدة سنوات. كبريتات البوتاسيوم أأمن من كلوريد البوتاسيوم في التربة الرملية أو سيئة الصرف أو المالحة.', 'CDFA_OLIVE_LEAF')
) as v(crop_name, nutrient, lb_min, lb_max, basis_en, basis_ar, source_id)
join public.crops c on c.crop_name = v.crop_name
on conflict (crop_id, nutrient) do nothing;

-- C) soil notes
create table if not exists public.fertilizer_soil_notes (
  id            uuid primary key default gen_random_uuid(),
  fertilizer_id uuid not null references public.fertilizers(id) on delete cascade,
  soil_type_id  uuid references public.soil_types(id) on delete cascade,
  condition     text,
  rating        text not null check (rating in ('better', 'caution')),
  note_en       text not null,
  note_ar       text not null,
  source_id     text not null references public.sources(id),
  check (soil_type_id is not null or condition is not null)
);
create unique index if not exists fertilizer_soil_notes_key
  on public.fertilizer_soil_notes (fertilizer_id, coalesce(soil_type_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(condition, ''));
alter table public.fertilizer_soil_notes enable row level security;
drop policy if exists fertilizer_soil_notes_read on public.fertilizer_soil_notes;
create policy fertilizer_soil_notes_read on public.fertilizer_soil_notes for select to authenticated using (true);

drop table if exists pg_temp._soil_notes;
create temporary table _soil_notes (fertilizer text, soil text, condition text, rating text, note_en text, note_ar text, source_id text);

-- texture rows (one per soil type name; the two spellings of "silty clay loam" are both listed)
insert into _soil_notes
select f.fertilizer, s.soil, null, g.rating, g.note_en, g.note_ar, g.source_id
from (values ('Urea'), ('Ammonium sulphate')) as f(fertilizer)
join (values
  ('Sand',            'caution', 'Sandy soils (low CEC, organic matter and buffering) lose more of this nitrogen as ammonia gas than silty or clay soils. Work it into the soil or irrigate it in right after spreading.',
                                 'التربة الرملية (قدرتها على الاحتفاظ بالعناصر وموادها العضوية وقدرتها على تثبيت الحموضة قليلة) تخسر من هذا النيتروجين كغاز أمونيا أكثر من التربة الغرينية أو الطينية. اخلطيه بالتربة أو اروي مباشرة بعد النثر.', 'UIDAHO_BUL926'),
  ('Loamy sand',      'caution', 'Sandy soils (low CEC, organic matter and buffering) lose more of this nitrogen as ammonia gas than silty or clay soils. Work it into the soil or irrigate it in right after spreading.',
                                 'التربة الرملية (قدرتها على الاحتفاظ بالعناصر وموادها العضوية وقدرتها على تثبيت الحموضة قليلة) تخسر من هذا النيتروجين كغاز أمونيا أكثر من التربة الغرينية أو الطينية. اخلطيه بالتربة أو اروي مباشرة بعد النثر.', 'UIDAHO_BUL926'),
  ('Silt loam',       'better',  'Silty and clay soils (higher CEC and buffering) lose less of this nitrogen as ammonia gas than sandy soils.',
                                 'التربة الغرينية والطينية (قدرتها على الاحتفاظ بالعناصر وتثبيت الحموضة أعلى) تخسر من هذا النيتروجين كغاز أمونيا أقل من التربة الرملية.', 'UIDAHO_BUL926'),
  ('Silt',            'better',  'Silty and clay soils (higher CEC and buffering) lose less of this nitrogen as ammonia gas than sandy soils.',
                                 'التربة الغرينية والطينية (قدرتها على الاحتفاظ بالعناصر وتثبيت الحموضة أعلى) تخسر من هذا النيتروجين كغاز أمونيا أقل من التربة الرملية.', 'UIDAHO_BUL926'),
  ('Silt clay loam',  'better',  'Silty and clay soils (higher CEC and buffering) lose less of this nitrogen as ammonia gas than sandy soils.',
                                 'التربة الغرينية والطينية (قدرتها على الاحتفاظ بالعناصر وتثبيت الحموضة أعلى) تخسر من هذا النيتروجين كغاز أمونيا أقل من التربة الرملية.', 'UIDAHO_BUL926'),
  ('Silty clay loam', 'better',  'Silty and clay soils (higher CEC and buffering) lose less of this nitrogen as ammonia gas than sandy soils.',
                                 'التربة الغرينية والطينية (قدرتها على الاحتفاظ بالعناصر وتثبيت الحموضة أعلى) تخسر من هذا النيتروجين كغاز أمونيا أقل من التربة الرملية.', 'UIDAHO_BUL926'),
  ('Silty clay',      'better',  'Silty and clay soils (higher CEC and buffering) lose less of this nitrogen as ammonia gas than sandy soils.',
                                 'التربة الغرينية والطينية (قدرتها على الاحتفاظ بالعناصر وتثبيت الحموضة أعلى) تخسر من هذا النيتروجين كغاز أمونيا أقل من التربة الرملية.', 'UIDAHO_BUL926'),
  ('Clay',            'better',  'Silty and clay soils (higher CEC and buffering) lose less of this nitrogen as ammonia gas than sandy soils.',
                                 'التربة الغرينية والطينية (قدرتها على الاحتفاظ بالعناصر وتثبيت الحموضة أعلى) تخسر من هذا النيتروجين كغاز أمونيا أقل من التربة الرملية.', 'UIDAHO_BUL926')
) as g(soil, rating, note_en, note_ar, source_id) on true
join (values ('Sand'), ('Loamy sand'), ('Silt loam'), ('Silt'), ('Silt clay loam'), ('Silty clay loam'), ('Silty clay'), ('Clay')) as s(soil) on s.soil = g.soil;

insert into _soil_notes
select 'Potassium sulphate (SOP)', s.soil, null, 'better',
       'Safer than potassium chloride on sandy and sandy loam soils, where potassium chloride can cause chloride toxicity (olive guideline).',
       'أأمن من كلوريد البوتاسيوم في التربة الرملية والرملية الطميية، حيث قد يسبّب كلوريد البوتاسيوم تسمم الكلوريد (دليل الزيتون).',
       'CDFA_OLIVE_LEAF'
from (values ('Sand'), ('Loamy sand'), ('Sandy loam')) as s(soil);

-- conditions the app does not record (soil pH, salinity, drainage): shown as "check"
insert into _soil_notes values
  ('Urea', null, 'soil pH above 7 (alkaline or calcareous soil)', 'caution',
   'Alkaline soils (pH above 7) lose more nitrogen from urea as ammonia gas; placing it below the surface or irrigating it in reduces the loss. The app does not record soil pH: check it.',
   'التربة القلوية (pH أعلى من 7) تخسر نيتروجين أكثر من اليوريا كغاز أمونيا؛ وضعه تحت السطح أو الري بعده يقلل الخسارة. التطبيق لا يسجّل حموضة التربة: افحصيها.', 'UIDAHO_BUL926'),
  ('Ammonium sulphate', null, 'soil pH above 7 (alkaline or calcareous soil)', 'caution',
   'Alkaline soils (pH above 7) lose more nitrogen from ammonium fertilizers as ammonia gas; placing it below the surface or irrigating it in reduces the loss. The app does not record soil pH: check it.',
   'التربة القلوية (pH أعلى من 7) تخسر نيتروجين أكثر من الأسمدة الأمونيومية كغاز أمونيا؛ وضعه تحت السطح أو الري بعده يقلل الخسارة. التطبيق لا يسجّل حموضة التربة: افحصيها.', 'UIDAHO_BUL926'),
  ('Potassium sulphate (SOP)', null, 'saline soil, poor drainage (perched water table, restrictive layer) or a chloride-sensitive variety', 'better',
   'Safer than potassium chloride where the soil is saline, drains poorly or the variety is chloride-sensitive (olive guideline). The app does not record salinity or drainage: check them.',
   'أأمن من كلوريد البوتاسيوم عندما تكون التربة مالحة أو سيئة الصرف أو الصنف حسّاساً للكلوريد (دليل الزيتون). التطبيق لا يسجّل الملوحة أو الصرف: افحصيهما.', 'CDFA_OLIVE_LEAF');

insert into public.fertilizer_soil_notes (fertilizer_id, soil_type_id, condition, rating, note_en, note_ar, source_id)
select f.id, st.id, n.condition, n.rating, n.note_en, n.note_ar, n.source_id
  from _soil_notes n
  join public.fertilizers f on f.name = n.fertilizer
  left join public.soil_types st on n.soil is not null and lower(trim(st.soil_name)) = lower(n.soil)
 where n.soil is null or st.id is not null
on conflict do nothing;

drop table pg_temp._soil_notes;
