# FAO-56 Table 19 - typical soil water characteristics for different soil types

Source: Allen, Pereira, Raes, Smith (1998), FAO Irrigation and Drainage Paper 56, Chapter 7, Table 19.
Read from: https://www.fao.org/4/x0490e/x0490e0c.htm (2026-10-23). Status: `unverified` until the owner checks the numbers against the printed book.

- Water contents are m3/m3 (volume of water per volume of soil). REW / TEW are mm (TEW for Ze = 0.10 m); the engine does not use them yet.
- The table gives RANGES, not single values. The migration `20261023090000_soil_water_table19.sql` stores the min and max and puts the
  MIDPOINT of each range in `field_capacity_pct` / `wilting_point_pct` (the columns the engine reads). The midpoint is a choice made by NAMAA, not a number printed in FAO-56.
- Table 19 says nothing about how long a soil takes to absorb or drain water. Not used.
