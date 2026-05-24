CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS demo;

CREATE TABLE demo.districts (
  id text PRIMARY KEY,
  name text NOT NULL,
  population integer NOT NULL CHECK (population > 0),
  geom geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE demo.sites (
  id text PRIMARY KEY,
  district_id text NOT NULL REFERENCES demo.districts (id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL,
  geom geometry(Point, 4326) NOT NULL
);

CREATE TABLE demo.routes (
  id text PRIMARY KEY,
  name text NOT NULL,
  mode text NOT NULL,
  geom geometry(LineString, 4326) NOT NULL
);

CREATE INDEX districts_geom_gix ON demo.districts USING GIST (geom);
CREATE INDEX sites_geom_gix ON demo.sites USING GIST (geom);
CREATE INDEX routes_geom_gix ON demo.routes USING GIST (geom);
