/*
  Fills public.crops with every FAO-56 crop that has BOTH a Kc row (Table 12) and a root-depth / depletion row (Table 22),
  matched by exact name (letters and digits only, case ignored; a variant matches its own Table 22 variant, otherwise the
  crop's general Table 22 row). Nothing is guessed: crops that do not match stay out until someone links them by hand.
  Existing rows (Tomato) are kept; only a missing water_params_id is filled in.
  A crop can only be used by the decision engine when its growth-stage lengths are stored too (see view crop_readiness).
*/

create or replace function public.norm_crop_name(t text)
returns text language sql immutable as
$$ select trim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g')) $$;

-- 1) link existing crops that still have no root-depth / depletion row
update public.crops c
   set water_params_id = w.id
  from public.crop_coefficients cc
  cross join lateral (
    select p.id from public.crop_water_params p
     where public.norm_crop_name(p.crop) = public.norm_crop_name(cc.crop)
       and (p.variant is null or public.norm_crop_name(p.variant) = public.norm_crop_name(cc.variant))
     order by (p.variant is null) asc
     limit 1
  ) w
 where c.coefficient_id = cc.id and c.water_params_id is null;

-- 2) add the crops that are not in the table yet
insert into public.crops (crop_name, coefficient_id, water_params_id)
select cc.crop || case when nullif(trim(coalesce(cc.variant, '')), '') is not null then ' - ' || trim(cc.variant) else '' end,
       cc.id,
       w.id
  from public.crop_coefficients cc
  cross join lateral (
    select p.id from public.crop_water_params p
     where public.norm_crop_name(p.crop) = public.norm_crop_name(cc.crop)
       and (p.variant is null or public.norm_crop_name(p.variant) = public.norm_crop_name(cc.variant))
     order by (p.variant is null) asc
     limit 1
  ) w
 where cc.row_type = 'crop'
   and not exists (
     select 1 from public.crops c
      where c.coefficient_id = cc.id
         or lower(c.crop_name) = lower(cc.crop || case when nullif(trim(coalesce(cc.variant, '')), '') is not null then ' - ' || trim(cc.variant) else '' end)
   );
