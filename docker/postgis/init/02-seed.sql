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
