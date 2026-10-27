-- Crop water parameters from FAO-56 Table 22 (maximum effective root depth Zr and depletion fraction p).
-- Used by the decision engine for TAW = 1000 (theta_FC - theta_WP) Zr  and  RAW = p x TAW  (FAO-56 Eq. 82, 83).
-- p is for ETc about 5 mm/day; the engine adjusts it: p = p + 0.04 (5 - ETc), limited to 0.1 .. 0.8.
-- Source: Allen et al. (1998) FAO-56, Chapter 8, Table 22. Marked 'unverified' until the owner has checked it against the book.
-- Safe to run again. Nothing existing is deleted.

-- A) the source (copies source_type from the existing Table 12 source so any allowed-value rule still holds)
insert into public.sources (id, title, source_type, verification_status, url)
select 'FAO56_TABLE22',
       'FAO-56 (Allen et al., 1998) Table 22: maximum effective rooting depth and soil water depletion fraction for no stress',
       s.source_type,
       'unverified',
       'https://www.fao.org/4/X0490e/x0490e0e.htm'
from public.sources s
where s.title ilike '%Table 12%'
limit 1
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from public.sources where id = 'FAO56_TABLE22') then
    raise exception 'Source FAO56_TABLE22 was not created: no source with "Table 12" in its title was found in public.sources.';
  end if;
end $$;

-- B) the table
create table if not exists public.crop_water_params (
  id                    uuid primary key default gen_random_uuid(),
  section               text not null,
  crop                  text not null,
  variant               text,
  root_depth_min_m      numeric not null check (root_depth_min_m > 0),
  root_depth_max_m      numeric not null check (root_depth_max_m >= root_depth_min_m),
  depletion_fraction_p  numeric not null check (depletion_fraction_p > 0 and depletion_fraction_p <= 1),
  footnote              text,
  source_id             text not null references public.sources(id),
  created_at            timestamptz not null default now()
);

create unique index if not exists crop_water_params_crop_variant_key
  on public.crop_water_params (crop, coalesce(variant, ''));

alter table public.crop_water_params enable row level security;
drop policy if exists crop_water_params_read on public.crop_water_params;
create policy crop_water_params_read on public.crop_water_params
  for select to authenticated using (true);

-- C) the rows (FAO-56 Table 22)
insert into public.crop_water_params
  (section, crop, variant, root_depth_min_m, root_depth_max_m, depletion_fraction_p, footnote, source_id)
select v.section, v.crop, v.variant, v.zmin, v.zmax, v.p, v.footnote, 'FAO56_TABLE22'
from (values
  ('a. Small Vegetables', 'Broccoli', null, 0.4, 0.6, 0.45, null),
  ('a. Small Vegetables', 'Brussel Sprouts', null, 0.4, 0.6, 0.45, null),
  ('a. Small Vegetables', 'Cabbage', null, 0.5, 0.8, 0.45, null),
  ('a. Small Vegetables', 'Carrots', null, 0.5, 1.0, 0.35, null),
  ('a. Small Vegetables', 'Cauliflower', null, 0.4, 0.7, 0.45, null),
  ('a. Small Vegetables', 'Celery', null, 0.3, 0.5, 0.2, null),
  ('a. Small Vegetables', 'Garlic', null, 0.3, 0.5, 0.3, null),
  ('a. Small Vegetables', 'Lettuce', null, 0.3, 0.5, 0.3, null),
  ('a. Small Vegetables', 'Onions', 'dry', 0.3, 0.6, 0.3, null),
  ('a. Small Vegetables', 'Onions', 'green', 0.3, 0.6, 0.3, null),
  ('a. Small Vegetables', 'Onions', 'seed', 0.3, 0.6, 0.35, null),
  ('a. Small Vegetables', 'Spinach', null, 0.3, 0.5, 0.2, null),
  ('a. Small Vegetables', 'Radishes', null, 0.3, 0.5, 0.3, null),
  ('b. Vegetables - Solanum Family (Solanaceae)', 'Egg Plant', null, 0.7, 1.2, 0.45, null),
  ('b. Vegetables - Solanum Family (Solanaceae)', 'Sweet Peppers (bell)', null, 0.5, 1.0, 0.3, null),
  ('b. Vegetables - Solanum Family (Solanaceae)', 'Tomato', null, 0.7, 1.5, 0.4, null),
  ('c. Vegetables - Cucumber Family (Cucurbitaceae)', 'Cantaloupe', null, 0.9, 1.5, 0.45, null),
  ('c. Vegetables - Cucumber Family (Cucurbitaceae)', 'Cucumber', 'Fresh Market', 0.7, 1.2, 0.5, null),
  ('c. Vegetables - Cucumber Family (Cucurbitaceae)', 'Cucumber', 'Machine harvest', 0.7, 1.2, 0.5, null),
  ('c. Vegetables - Cucumber Family (Cucurbitaceae)', 'Pumpkin, Winter Squash', null, 1.0, 1.5, 0.35, null),
  ('c. Vegetables - Cucumber Family (Cucurbitaceae)', 'Squash, Zucchini', null, 0.6, 1.0, 0.5, null),
  ('c. Vegetables - Cucumber Family (Cucurbitaceae)', 'Sweet Melons', null, 0.8, 1.5, 0.4, null),
  ('c. Vegetables - Cucumber Family (Cucurbitaceae)', 'Watermelon', null, 0.8, 1.5, 0.4, null),
  ('d. Roots and Tubers', 'Beets, table', null, 0.6, 1.0, 0.5, null),
  ('d. Roots and Tubers', 'Cassava', 'year 1', 0.5, 0.8, 0.35, null),
  ('d. Roots and Tubers', 'Cassava', 'year 2', 0.7, 1.0, 0.4, null),
  ('d. Roots and Tubers', 'Parsnip', null, 0.5, 1.0, 0.4, null),
  ('d. Roots and Tubers', 'Potato', null, 0.4, 0.6, 0.35, null),
  ('d. Roots and Tubers', 'Sweet Potato', null, 1.0, 1.5, 0.65, null),
  ('d. Roots and Tubers', 'Turnip (and Rutabaga)', null, 0.5, 1.0, 0.5, null),
  ('d. Roots and Tubers', 'Sugar Beet', null, 0.7, 1.2, 0.55, 'Sugar beets often wilt in the late afternoon in arid climates even at p below 0.55, usually with only a minor effect on sugar yield (FAO-56 Table 22, note 3).'),
  ('e. Legumes (Leguminosae)', 'Beans, green', null, 0.5, 0.7, 0.45, null),
  ('e. Legumes (Leguminosae)', 'Beans, dry and Pulses', null, 0.6, 0.9, 0.45, null),
  ('e. Legumes (Leguminosae)', 'Beans, lima, large vines', null, 0.8, 1.2, 0.45, null),
  ('e. Legumes (Leguminosae)', 'Chick pea', null, 0.6, 1.0, 0.5, null),
  ('e. Legumes (Leguminosae)', 'Fababean (broad bean)', 'Fresh', 0.5, 0.7, 0.45, null),
  ('e. Legumes (Leguminosae)', 'Fababean (broad bean)', 'Dry/Seed', 0.5, 0.7, 0.45, null),
  ('e. Legumes (Leguminosae)', 'Grabanzo', null, 0.6, 1.0, 0.45, null),
  ('e. Legumes (Leguminosae)', 'Green Gram and Cowpeas', null, 0.6, 1.0, 0.45, null),
  ('e. Legumes (Leguminosae)', 'Groundnut (Peanut)', null, 0.5, 1.0, 0.5, null),
  ('e. Legumes (Leguminosae)', 'Lentil', null, 0.6, 0.8, 0.5, null),
  ('e. Legumes (Leguminosae)', 'Peas', 'Fresh', 0.6, 1.0, 0.35, null),
  ('e. Legumes (Leguminosae)', 'Peas', 'Dry/Seed', 0.6, 1.0, 0.4, null),
  ('e. Legumes (Leguminosae)', 'Soybeans', null, 0.6, 1.3, 0.5, null),
  ('f. Perennial Vegetables (with winter dormancy and initially bare or mulched soil)', 'Artichokes', null, 0.6, 0.9, 0.45, null),
  ('f. Perennial Vegetables (with winter dormancy and initially bare or mulched soil)', 'Asparagus', null, 1.2, 1.8, 0.45, null),
  ('f. Perennial Vegetables (with winter dormancy and initially bare or mulched soil)', 'Mint', null, 0.4, 0.8, 0.4, null),
  ('f. Perennial Vegetables (with winter dormancy and initially bare or mulched soil)', 'Strawberries', null, 0.2, 0.3, 0.2, null),
  ('g. Fibre Crops', 'Cotton', null, 1.0, 1.7, 0.65, null),
  ('g. Fibre Crops', 'Flax', null, 1.0, 1.5, 0.5, null),
  ('g. Fibre Crops', 'Sisal', null, 0.5, 1.0, 0.8, null),
  ('h. Oil Crops', 'Castorbean (Ricinus)', null, 1.0, 2.0, 0.5, null),
  ('h. Oil Crops', 'Rapeseed, Canola', null, 1.0, 1.5, 0.6, null),
  ('h. Oil Crops', 'Safflower', null, 1.0, 2.0, 0.6, null),
  ('h. Oil Crops', 'Sesame', null, 1.0, 1.5, 0.6, null),
  ('h. Oil Crops', 'Sunflower', null, 0.8, 1.5, 0.45, null),
  ('i. Cereals', 'Barley', null, 1.0, 1.5, 0.55, null),
  ('i. Cereals', 'Oats', null, 1.0, 1.5, 0.55, null),
  ('i. Cereals', 'Spring Wheat', null, 1.0, 1.5, 0.55, null),
  ('i. Cereals', 'Winter Wheat', null, 1.5, 1.8, 0.55, null),
  ('i. Cereals', 'Maize, Field (grain) (field corn)', null, 1.0, 1.7, 0.55, null),
  ('i. Cereals', 'Maize, Sweet (sweet corn)', null, 0.8, 1.2, 0.5, null),
  ('i. Cereals', 'Millet', null, 1.0, 2.0, 0.55, null),
  ('i. Cereals', 'Sorghum', 'grain', 1.0, 2.0, 0.55, null),
  ('i. Cereals', 'Sorghum', 'sweet', 1.0, 2.0, 0.5, null),
  ('i. Cereals', 'Rice', null, 0.5, 1.0, 0.2, 'For rice, p is 0.20 of saturation (FAO-56 Table 22, note 4).'),
  ('j. Forages', 'Alfalfa', 'for hay', 1.0, 2.0, 0.55, null),
  ('j. Forages', 'Alfalfa', 'for seed', 1.0, 3.0, 0.6, null),
  ('j. Forages', 'Bermuda', 'for hay', 1.0, 1.5, 0.55, null),
  ('j. Forages', 'Bermuda', 'Spring crop for seed', 1.0, 1.5, 0.6, null),
  ('j. Forages', 'Clover hay, Berseem', null, 0.6, 0.9, 0.5, null),
  ('j. Forages', 'Rye Grass hay', null, 0.6, 1.0, 0.6, null),
  ('j. Forages', 'Sudan Grass hay (annual)', null, 1.0, 1.5, 0.55, null),
  ('j. Forages', 'Grazing Pasture', 'Rotated Grazing', 0.5, 1.5, 0.6, null),
  ('j. Forages', 'Grazing Pasture', 'Extensive Grazing', 0.5, 1.5, 0.6, null),
  ('j. Forages', 'Turf grass', 'cool season', 0.5, 1.0, 0.4, 'Cool-season grasses: bluegrass, ryegrass, fescue. Warm-season: bermuda, buffalo grass, St. Augustine. Rooting depth varies; the deeper values apply with careful water management (FAO-56 Table 22, note 5).'),
  ('j. Forages', 'Turf grass', 'warm season', 0.5, 1.0, 0.5, 'Cool-season grasses: bluegrass, ryegrass, fescue. Warm-season: bermuda, buffalo grass, St. Augustine. Rooting depth varies; the deeper values apply with careful water management (FAO-56 Table 22, note 5).'),
  ('k. Sugar Cane', 'Sugar Cane', null, 1.2, 2.0, 0.65, null),
  ('l. Tropical Fruits and Trees', 'Banana', '1st year', 0.5, 0.9, 0.35, null),
  ('l. Tropical Fruits and Trees', 'Banana', '2nd year', 0.5, 0.9, 0.35, null),
  ('l. Tropical Fruits and Trees', 'Cacao', null, 0.7, 1.0, 0.3, null),
  ('l. Tropical Fruits and Trees', 'Coffee', null, 0.9, 1.5, 0.4, null),
  ('l. Tropical Fruits and Trees', 'Date Palms', null, 1.5, 2.5, 0.5, null),
  ('l. Tropical Fruits and Trees', 'Palm Trees', null, 0.7, 1.1, 0.65, null),
  ('l. Tropical Fruits and Trees', 'Pineapple', null, 0.3, 0.6, 0.5, null),
  ('l. Tropical Fruits and Trees', 'Rubber Trees', null, 1.0, 1.5, 0.4, null),
  ('l. Tropical Fruits and Trees', 'Tea', 'non-shaded', 0.9, 1.5, 0.4, null),
  ('l. Tropical Fruits and Trees', 'Tea', 'shaded', 0.9, 1.5, 0.45, null),
  ('m. Grapes and Berries', 'Berries (bushes)', null, 0.6, 1.2, 0.5, null),
  ('m. Grapes and Berries', 'Grapes', 'Table or Raisin', 1.0, 2.0, 0.35, null),
  ('m. Grapes and Berries', 'Grapes', 'Wine', 1.0, 2.0, 0.45, null),
  ('m. Grapes and Berries', 'Hops', null, 1.0, 1.2, 0.5, null),
  ('n. Fruit Trees', 'Almonds', null, 1.0, 2.0, 0.4, null),
  ('n. Fruit Trees', 'Apples, Cherries, Pears', null, 1.0, 2.0, 0.5, null),
  ('n. Fruit Trees', 'Apricots, Peaches, Stone Fruit', null, 1.0, 2.0, 0.5, null),
  ('n. Fruit Trees', 'Avocado', null, 0.5, 1.0, 0.7, null),
  ('n. Fruit Trees', 'Citrus', '70% canopy', 1.2, 1.5, 0.5, null),
  ('n. Fruit Trees', 'Citrus', '50% canopy', 1.1, 1.5, 0.5, null),
  ('n. Fruit Trees', 'Citrus', '20% canopy', 0.8, 1.1, 0.5, null),
  ('n. Fruit Trees', 'Conifer Trees', null, 1.0, 1.5, 0.7, null),
  ('n. Fruit Trees', 'Kiwi', null, 0.7, 1.3, 0.35, null),
  ('n. Fruit Trees', 'Olives (40 to 60% ground coverage by canopy)', null, 1.2, 1.7, 0.65, null),
  ('n. Fruit Trees', 'Pistachios', null, 1.0, 1.5, 0.4, null),
  ('n. Fruit Trees', 'Walnut Orchard', null, 1.7, 2.4, 0.5, null)
) as v(section, crop, variant, zmin, zmax, p, footnote)
on conflict (crop, coalesce(variant, '')) do nothing;

-- D) a crop in the app points to its Table 12 row (Kc, already there) AND its Table 22 row (Zr, p)
alter table public.crops
  add column if not exists water_params_id uuid references public.crop_water_params(id);

-- Tomato is linked by name. Any other crop is linked the same way when it is added to public.crops.
update public.crops c
   set water_params_id = w.id
  from public.crop_water_params w
 where c.water_params_id is null and c.crop_name = w.crop and w.variant is null;
