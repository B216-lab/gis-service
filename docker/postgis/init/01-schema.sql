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

CREATE TABLE demo.site_flows (
  id text PRIMARY KEY,
  origin_site_id text NOT NULL REFERENCES demo.sites (id) ON DELETE CASCADE,
  origin_name text NOT NULL,
  destination_site_id text NOT NULL REFERENCES demo.sites (id) ON DELETE CASCADE,
  destination_name text NOT NULL,
  flow_group text NOT NULL,
  start_lon double precision NOT NULL,
  start_lat double precision NOT NULL,
  end_lon double precision NOT NULL,
  end_lat double precision NOT NULL,
  magnitude integer NOT NULL CHECK (magnitude > 0)
);

CREATE INDEX districts_geom_gix ON demo.districts USING GIST (geom);
CREATE INDEX sites_geom_gix ON demo.sites USING GIST (geom);
CREATE INDEX routes_geom_gix ON demo.routes USING GIST (geom);
CREATE INDEX site_flows_origin_site_id_idx ON demo.site_flows (origin_site_id);
CREATE INDEX site_flows_destination_site_id_idx ON demo.site_flows (destination_site_id);
