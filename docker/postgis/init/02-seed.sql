INSERT INTO demo.districts (id, name, population, geom)
VALUES
  (
    'd_riverside',
    'Riverside',
    24530,
    ST_Multi(
      ST_GeomFromText(
        'POLYGON((104.270 52.285, 104.295 52.285, 104.295 52.300, 104.270 52.300, 104.270 52.285))',
        4326
      )
    )
  ),
  (
    'd_hillcrest',
    'Hillcrest',
    18920,
    ST_Multi(
      ST_GeomFromText(
        'POLYGON((104.295 52.285, 104.320 52.285, 104.320 52.300, 104.295 52.300, 104.295 52.285))',
        4326
      )
    )
  ),
  (
    'd_harbor',
    'Harbor',
    31210,
    ST_Multi(
      ST_GeomFromText(
        'POLYGON((104.270 52.300, 104.320 52.300, 104.320 52.320, 104.270 52.320, 104.270 52.300))',
        4326
      )
    )
  ),
  (
    'd_uplands',
    'Uplands',
    21480,
    ST_Multi(
      ST_GeomFromText(
        'POLYGON((104.320 52.285, 104.345 52.285, 104.345 52.300, 104.320 52.300, 104.320 52.285))',
        4326
      )
    )
  ),
  (
    'd_market',
    'Market',
    27840,
    ST_Multi(
      ST_GeomFromText(
        'POLYGON((104.320 52.300, 104.345 52.300, 104.345 52.320, 104.320 52.320, 104.320 52.300))',
        4326
      )
    )
  ),
  (
    'd_southbank',
    'Southbank',
    22670,
    ST_Multi(
      ST_GeomFromText(
        'POLYGON((104.270 52.270, 104.345 52.270, 104.345 52.285, 104.270 52.285, 104.270 52.270))',
        4326
      )
    )
  );

INSERT INTO demo.sites (id, district_id, name, category, geom)
VALUES
  (
    's_park_01',
    'd_riverside',
    'Riverside Park',
    'park',
    ST_SetSRID(ST_MakePoint(104.282, 52.292), 4326)
  ),
  (
    's_school_01',
    'd_riverside',
    'South Primary',
    'school',
    ST_SetSRID(ST_MakePoint(104.288, 52.289), 4326)
  ),
  (
    's_clinic_01',
    'd_hillcrest',
    'Hillcrest Clinic',
    'clinic',
    ST_SetSRID(ST_MakePoint(104.308, 52.292), 4326)
  ),
  (
    's_station_01',
    'd_hillcrest',
    'East Transit Stop',
    'transit',
    ST_SetSRID(ST_MakePoint(104.313, 52.297), 4326)
  ),
  (
    's_port_01',
    'd_harbor',
    'Harbor Terminal',
    'logistics',
    ST_SetSRID(ST_MakePoint(104.296, 52.311), 4326)
  ),
  (
    's_park_02',
    'd_harbor',
    'North Wetland',
    'park',
    ST_SetSRID(ST_MakePoint(104.281, 52.314), 4326)
  ),
  (
    's_library_01',
    'd_riverside',
    'Riverside Library',
    'library',
    ST_SetSRID(ST_MakePoint(104.291, 52.296), 4326)
  ),
  (
    's_market_01',
    'd_hillcrest',
    'Hillcrest Market Hall',
    'market',
    ST_SetSRID(ST_MakePoint(104.304, 52.298), 4326)
  ),
  (
    's_fire_01',
    'd_harbor',
    'Harbor Fire Station',
    'safety',
    ST_SetSRID(ST_MakePoint(104.300, 52.306), 4326)
  ),
  (
    's_college_01',
    'd_uplands',
    'Uplands College',
    'education',
    ST_SetSRID(ST_MakePoint(104.329, 52.294), 4326)
  ),
  (
    's_reservoir_01',
    'd_uplands',
    'North Reservoir',
    'utility',
    ST_SetSRID(ST_MakePoint(104.337, 52.289), 4326)
  ),
  (
    's_hub_01',
    'd_market',
    'Market Mobility Hub',
    'transit',
    ST_SetSRID(ST_MakePoint(104.332, 52.309), 4326)
  ),
  (
    's_museum_01',
    'd_market',
    'City Trade Museum',
    'culture',
    ST_SetSRID(ST_MakePoint(104.340, 52.315), 4326)
  ),
  (
    's_clinic_02',
    'd_market',
    'Market Urgent Care',
    'clinic',
    ST_SetSRID(ST_MakePoint(104.327, 52.304), 4326)
  ),
  (
    's_terminal_01',
    'd_southbank',
    'Southbank Ferry Gate',
    'transport',
    ST_SetSRID(ST_MakePoint(104.300, 52.278), 4326)
  ),
  (
    's_stadium_01',
    'd_southbank',
    'Southbank Arena',
    'sports',
    ST_SetSRID(ST_MakePoint(104.321, 52.281), 4326)
  ),
  (
    's_office_01',
    'd_southbank',
    'Civic Service Center',
    'government',
    ST_SetSRID(ST_MakePoint(104.338, 52.276), 4326)
  ),
  (
    's_school_02',
    'd_southbank',
    'Southbank Secondary',
    'school',
    ST_SetSRID(ST_MakePoint(104.284, 52.274), 4326)
  );

INSERT INTO demo.routes (id, name, mode, geom)
VALUES
  (
    'r_green_loop',
    'Green Loop',
    'bike',
    ST_GeomFromText(
      'LINESTRING(104.276 52.289, 104.286 52.295, 104.301 52.294, 104.314 52.309)',
      4326
    )
  ),
  (
    'r_blue_line',
    'Blue Line',
    'bus',
    ST_GeomFromText(
      'LINESTRING(104.274 52.305, 104.289 52.308, 104.307 52.311, 104.317 52.316)',
      4326
    )
  ),
  (
    'r_orange_connector',
    'Orange Connector',
    'tram',
    ST_GeomFromText(
      'LINESTRING(104.286 52.279, 104.301 52.287, 104.322 52.296, 104.336 52.309)',
      4326
    )
  ),
  (
    'r_harbor_arc',
    'Harbor Arc',
    'freight',
    ST_GeomFromText(
      'LINESTRING(104.278 52.304, 104.294 52.309, 104.312 52.314, 104.334 52.317)',
      4326
    )
  ),
  (
    'r_upland_spine',
    'Upland Spine',
    'bus',
    ST_GeomFromText(
      'LINESTRING(104.323 52.287, 104.329 52.293, 104.333 52.301, 104.341 52.314)',
      4326
    )
  ),
  (
    'r_river_loop',
    'River Loop',
    'pedestrian',
    ST_GeomFromText(
      'LINESTRING(104.274 52.281, 104.279 52.289, 104.286 52.296, 104.281 52.303, 104.272 52.297, 104.274 52.281)',
      4326
    )
  );

CREATE OR REPLACE VIEW demo.district_summary AS
SELECT
  d.id,
  d.name,
  d.population,
  ROUND((ST_Area(d.geom::geography) / 1000000.0)::numeric, 2) AS area_km2,
  COUNT(s.id) AS site_count
FROM demo.districts AS d
LEFT JOIN demo.sites AS s
  ON ST_Contains(d.geom, s.geom)
GROUP BY d.id, d.name, d.population, d.geom
ORDER BY d.name;
