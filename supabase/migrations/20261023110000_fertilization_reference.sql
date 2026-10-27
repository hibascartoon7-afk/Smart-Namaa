-- Reference data for the fertilization decision: fertilizers (what each contains) and the nutrient limits of two crops
-- (Tomato, Olives). Until now these tables were empty, so the fertilization answer could only be "insufficient_data".
-- Every row has a source_id. Sources are marked 'unverified' until the owner has checked them.
--
-- A) fertilizers: FAO "Fertilizer Specifications" (Plant Production and Protection Division). The numbers are the
--    GUARANTEED MINIMUM nutrient content of the FAO purchasing specification (N, P2O5, K2O in % by weight); a commercial
--    grade can be a little higher (ammonium sulphate is sold as 21% N, the FAO minimum is 20%).
--    Potassium chloride (MOP, 60% K2O) is in the FAO list but is NOT stored on purpose: the engine proposes the product with the
--    highest content of the missing nutrient and does not know about chloride. The olive guideline (source below) warns that KCl
--    can cause chloride toxicity on sandy, poorly drained or saline soils and says potassium sulphate is safer there. The owner can add MOP
--    herself once the engine can take the soil into account.
-- B) crop_nutrient_sufficiency: the value BELOW which the crop needs the nutrient ("low_below"), with the unit and the method it
--    was measured with. The method is part of the number: a leaf value in % is not comparable to a soil value in ppm.
--    Tomato (soil test, UC IPM): P (Olsen) 15 ppm, K (ammonium acetate) 130 ppm. N is NOT stored: UC IPM does not give a soil N limit.
--    Olives (July leaf analysis, CDFA FREP / UC): N 1.4 %, P 0.1 %, K 0.4 % of dry weight ("Deficient" column of the guideline).
--    Both are California values (processing tomato; California olive orchards). They are not Palestinian values.
-- C) alert_thresholds is left EMPTY: no source with a number was found for "do not fertilize above X degrees C"
--    (the literature says only that ammonia loss from urea grows with temperature).
--
-- Safe to run again. A row that already exists (same name / same crop and nutrient) is never changed. Nothing is deleted.

-- A) sources (copies source_type from the existing Table 12 source so any allowed-value rule still holds)
insert into public.sources (id, title, source_type, verification_status, url)
select v.id, v.title, s.source_type, 'unverified', v.url
from public.sources s,
     (values
       ('FAO_FERT_SPECS',
        'FAO Plant Production and Protection Division: Fertilizer Specifications (specifications for commonly used fertilizers)',
        'https://www.fao.org/agriculture/crops/core-themes/theme/spi/plantnutrition/fertspecs/en/'),
       ('CDFA_OLIVE_LEAF',
        'CDFA FREP / UC Davis California Crop Fertilization Guidelines: Olives (critical nutrient levels in July olive leaf samples)',
        'https://www.cdfa.ca.gov/is/ffldrs/frep/FertilizationGuidelines/Olives.html'),
       ('UCIPM_TOMATO_SOIL',
        'UC IPM Pest Management Guidelines: Tomato, Fertilization (soil test interpretation for phosphorus and potassium)',
        'https://ipm.ucanr.edu/agriculture/tomato/fertilization/')
     ) as v(id, title, url)
where s.title ilike '%Table 12%'
  and s.id = (select id from public.sources where title ilike '%Table 12%' order by id limit 1)
on conflict (id) do nothing;

do $$
declare missing text;
begin
  select string_agg(x, ', ') into missing
    from unnest(array['FAO_FERT_SPECS', 'CDFA_OLIVE_LEAF', 'UCIPM_TOMATO_SOIL']) as x
   where not exists (select 1 from public.sources where id = x);
  if missing is not null then
    raise exception 'Sources not created: %. No source with "Table 12" in its title was found in public.sources.', missing;
  end if;
end $$;

-- B) fertilizers
alter table public.fertilizers add column if not exists value_basis text;

insert into public.fertilizers (name, n_pct, p2o5_pct, k2o_pct, source_id, value_basis)
select f.name, f.n, f.p, f.k, 'FAO_FERT_SPECS',
       'FAO specification, guaranteed minimum % by weight (' || f.what || '). Commercial grades can be slightly higher.'
from (values
  ('Urea',                          46.0, null::numeric, null::numeric, 'total N, dry basis'),
  ('Ammonium sulphate',             20.0, null,          null,          'total N, dry basis; also 23% S'),
  ('Calcium ammonium nitrate (CAN)', 26.0, null,          null,          'total N'),
  ('Diammonium phosphate (DAP)',    18.0, 46.0,          null,          'total N; P2O5 soluble in neutral ammonium citrate'),
  ('Triple superphosphate (TSP)',   null, 46.0,          null,          'total P2O5'),
  ('Single superphosphate (SSP)',   null, 15.8,          null,          'water-soluble P2O5; also 11% S'),
  ('Potassium sulphate (SOP)',      null, null,          50.0,          'K2O; also 17.5% S'),
  ('NPK 15-15-15',                  15.0, 15.0,          15.0,          'N; P2O5 soluble in neutral ammonium citrate; water-soluble K2O'),
  ('NPK 17-17-17',                  17.0, 17.0,          17.0,          'N; P2O5 soluble in neutral ammonium citrate; water-soluble K2O'),
  ('NPK 19-19-19',                  19.0, 19.0,          19.0,          'N; P2O5 soluble in neutral ammonium citrate; water-soluble K2O')
) as f(name, n, p, k, what)
on conflict (name) do nothing;

-- C) nutrient limits per crop (crop looked up by the crop_name used in public.crops)
insert into public.crop_nutrient_sufficiency (crop_id, nutrient, unit, low_below, method, source_id)
select c.id, v.nutrient, v.unit, v.low_below, v.method, v.source_id
from (values
  ('Tomato', 'p', 'ppm (mg/kg)', 15::numeric,
   'Soil test, Olsen (bicarbonate) phosphorus, top foot of soil (the main rooting zone), before planting. "Low" class of the UC IPM table. Processing tomato in California. The Olsen method is not appropriate for soils with pH below 6.5.',
   'UCIPM_TOMATO_SOIL'),
  ('Tomato', 'k', 'ppm (mg/kg)', 130,
   'Soil test, ammonium acetate extractable potassium, top foot of soil, before planting. "Low" class of the UC IPM table. Processing tomato in California.',
   'UCIPM_TOMATO_SOIL'),
  ('Olives (40 to 60% ground coverage by canopy)', 'n', '% of leaf dry weight', 1.4,
   'July leaf analysis: mature leaves from the middle of non-bearing current-season shoots, 80-100 leaves. "Deficient" column (below 1.4 %); the guideline calls 1.5-2.0 % sufficient, values between are not classified. California olive orchards.',
   'CDFA_OLIVE_LEAF'),
  ('Olives (40 to 60% ground coverage by canopy)', 'p', '% of leaf dry weight', 0.1,
   'July leaf analysis (same sampling as N). "Deficient" column (below 0.1 %); sufficient 0.1-0.3 %. The guideline says true P deficiency is very rare and low leaf P is mostly a drainage problem.',
   'CDFA_OLIVE_LEAF'),
  ('Olives (40 to 60% ground coverage by canopy)', 'k', '% of leaf dry weight', 0.4,
   'July leaf analysis (same sampling as N). "Deficient" column (below 0.4 %); the guideline calls more than 0.8 % sufficient, values between are not classified.',
   'CDFA_OLIVE_LEAF')
) as v(crop_name, nutrient, unit, low_below, method, source_id)
join public.crops c on c.crop_name = v.crop_name
-- not "on conflict": a later migration (20261024100000) changes the unique key of this table, and this file must still run again
where not exists (select 1 from public.crop_nutrient_sufficiency x where x.crop_id = c.id and x.nutrient = v.nutrient);
