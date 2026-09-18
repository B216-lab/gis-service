package analytics

import (
	"context"
	"encoding/json"
	"geopanel/backend/internal/postgres"
	"os"
	"testing"
)

// Opt-in isolated fixture uses VALUES only: no production data or schema writes.
func TestQueryDatabaseGrainAndReadOnly(t *testing.T) {
	if os.Getenv("ANALYTICS_TEST_DB") != "1" {
		t.Skip("set ANALYTICS_TEST_DB=1 with isolated PostGIS on port 55432")
	}
	db := postgres.NewService(0, postgres.ConnectionTestRequest{ID: "test", Host: "127.0.0.1", Port: "55432", Database: "geopanel_test", User: "geopanel", Password: "geopanel", RawQuery: "sslmode=disable"})
	service := NewQueryService(db)
	lookup := func(id string) (Dataset, error) {
		d, e := fixtureLookup(id)
		if id == "submissions" {
			d.SQL = "SELECT * FROM (VALUES (1, 'A'), (2, 'B'), (3, NULL)) AS x(id,city)"
		} else {
			d.SQL = "SELECT * FROM (VALUES (1, 'bus', 5), (1, 'bus', 20), (2, 'car', 30)) AS x(submission_id,vehicle,duration)"
		}
		return d, e
	}
	result, e := service.Execute(context.Background(), Query{DatasetID: "submissions", Metrics: []string{"count"}, Filters: []Filter{{DatasetID: "movements", FieldID: "vehicle", Operator: "eq", Values: []any{"bus"}}}}, lookup)
	if e != nil {
		t.Fatal(e)
	}
	countJSON, err := json.Marshal(result.Rows[0]["count"])
	if err != nil || string(countJSON) != "1" {
		t.Fatalf("grain multiplied: %#v", result.Rows)
	}
	result, e = service.Execute(context.Background(), Query{DatasetID: "submissions", Dimensions: []string{"city"}, Limit: 2}, lookup)
	if e != nil {
		t.Fatal(e)
	}
	if !result.Truncated || len(result.Rows) != 2 {
		t.Fatal(result)
	}

	result, e = service.Execute(context.Background(), Query{DatasetID: "movements", Dimensions: []string{"vehicle"}, Metrics: []string{"count"}, Having: []Filter{{FieldID: "count", Operator: "gt", Values: []any{1}}}}, lookup)
	if e != nil {
		t.Fatal(e)
	}
	if len(result.Rows) != 1 || result.Rows[0]["vehicle"] != "bus" {
		t.Fatalf("HAVING did not filter aggregate groups: %+v", result)
	}
	preciseLookup := func(id string) (Dataset, error) {
		d, e := lookup(id)
		d.SQL = "SELECT 9007199254740993::bigint AS id"
		d.Metrics = []Metric{{ID: "precise", Expression: "MAX(id)"}}
		return d, e
	}
	for range 2 {
		result, e = service.Execute(context.Background(), Query{DatasetID: "submissions", Metrics: []string{"precise"}}, preciseLookup)
		if e != nil {
			t.Fatal(e)
		}
		raw, e := json.Marshal(result.Rows[0]["precise"])
		if e != nil || string(raw) != "9007199254740993" {
			t.Fatalf("cached integer wire precision changed: %s %v", raw, e)
		}
	}
	_, _, _, e = db.ExecuteAnalytics(context.Background(), "test", "CREATE TABLE analytics_must_not_exist (id int)", nil, 1)
	if e == nil {
		t.Fatal("read-only transaction allowed DDL")
	}
	_, _, _, e = db.ExecuteAnalytics(context.Background(), "missing", "SELECT 1", nil, 1)
	if e == nil {
		t.Fatal("unknown source accepted")
	}
}

func TestWorkspaceExtentDatabase(t *testing.T) {
	if os.Getenv("ANALYTICS_TEST_DB") != "1" {
		t.Skip("set ANALYTICS_TEST_DB=1 with isolated PostGIS on port 55432")
	}
	db := postgres.NewService(0, postgres.ConnectionTestRequest{ID: "test", Host: "127.0.0.1", Port: "55432", Database: "geopanel_test", User: "geopanel", Password: "geopanel", RawQuery: "sslmode=disable"})
	service := NewQueryService(db)
	lookup := func(string) (Dataset, error) {
		return Dataset{Metadata: Metadata{ID: "places"}, ConnectionID: "test", SQL: "SELECT ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat),4326),3857) AS geom FROM (VALUES (104.0,52.0),(130.0,52.0),(179.0,0.0),(-179.0,0.0)) AS p(lon,lat)", Fields: []Field{{ID: "geom", Name: "geom"}}, Metrics: []Metric{{ID: "count", Expression: "COUNT(*)"}}}, nil
	}
	for _, test := range []struct {
		bounds []any
		want   string
	}{
		{[]any{100, 50, 110, 60}, "1"},
		{[]any{170, -10, -170, 10}, "2"},
		{[]any{0, 0, 1, 1}, "0"},
	} {
		result, err := service.Execute(context.Background(), Query{DatasetID: "places", Metrics: []string{"count"}, Filters: []Filter{{FieldID: "geom", Operator: "within_bbox", Values: test.bounds}}}, lookup)
		if err != nil {
			t.Fatal(err)
		}
		value, err := json.Marshal(result.Rows[0]["count"])
		if err != nil || string(value) != test.want {
			t.Fatalf("extent %v: got %s, want %s", test.bounds, value, test.want)
		}
	}
}

func TestWorkspaceSourceScopeDatabase(t *testing.T) {
	if os.Getenv("ANALYTICS_TEST_DB") != "1" {
		t.Skip("set ANALYTICS_TEST_DB=1 with isolated PostGIS on port 55432")
	}
	db := postgres.NewService(0, postgres.ConnectionTestRequest{ID: "test", Host: "127.0.0.1", Port: "55432", Database: "geopanel_test", User: "geopanel", Password: "geopanel", RawQuery: "sslmode=disable"})
	district := &postgres.SpatialFilter{
		SourceSchema: "demo", SourceTable: "districts", SourceGeometryColumn: "geom", Predicate: "within",
		RowRefs: []postgres.RowReference{{PrimaryKey: []string{"id"}, RowKey: map[string]interface{}{"id": "d_riverside"}}},
	}
	flowDistrict := *district
	flowDistrict.Predicate = "intersects"
	sites := postgres.AnalyticsWorkspaceSource{
		ConnectionID: "test", Schema: "demo", Table: "sites", GeometryColumn: "geom",
		Filter: &postgres.QueryFilter{Mode: "sql", Where: "category = 'park'"}, SpatialFilter: district,
	}
	flows := postgres.AnalyticsWorkspaceSource{
		ConnectionID: "test", Schema: "demo", Table: "site_flows",
		Filter: &postgres.QueryFilter{Mode: "sql", Where: "flow_group = 'peer'"}, SpatialFilter: &flowDistrict,
		FlowColumns: &postgres.AnalyticsWorkspaceFlowColumns{
			StartMode: "coordinates", StartLonColumn: "start_lon", StartLatColumn: "start_lat",
			EndMode: "coordinates", EndLonColumn: "end_lon", EndLatColumn: "end_lat",
		},
	}
	geometryFlows := postgres.AnalyticsWorkspaceSource{
		ConnectionID: "test", Schema: "demo", Table: "sites",
		Filter: &postgres.QueryFilter{Mode: "sql", Where: "category = 'park'"}, SpatialFilter: district,
		FlowColumns: &postgres.AnalyticsWorkspaceFlowColumns{
			StartMode: "geometry", StartGeometryColumn: "geom",
			EndMode: "geometry", EndGeometryColumn: "geom",
		},
	}
	for _, test := range []struct {
		name   string
		source postgres.AnalyticsWorkspaceSource
		data   Dataset
		want   string
	}{
		{
			name: "saved SQL plus polygon scope", source: sites,
			data: Dataset{Metadata: Metadata{ID: "sites"}, ConnectionID: "test", Schema: "demo", Table: "sites", Fields: []Field{{ID: "id", Name: "id"}, {ID: "category", Name: "category"}}, Metrics: []Metric{{ID: "count", Expression: "COUNT(*)"}}},
			want: "1",
		},
		{
			name: "flow endpoints use polygon scope", source: flows,
			data: Dataset{Metadata: Metadata{ID: "flows"}, ConnectionID: "test", Schema: "demo", Table: "site_flows", Fields: []Field{{ID: "id", Name: "id"}}, Metrics: []Metric{{ID: "count", Expression: "COUNT(*)"}}},
			want: "4",
		},
		{
			name: "geometry flow endpoints use polygon scope", source: geometryFlows,
			data: Dataset{Metadata: Metadata{ID: "geometry_flows"}, ConnectionID: "test", Schema: "demo", Table: "sites", Fields: []Field{{ID: "id", Name: "id"}}, Metrics: []Metric{{ID: "count", Expression: "COUNT(*)"}}},
			want: "1",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			scope, err := db.CompileAnalyticsWorkspaceScope(context.Background(), test.source)
			if err != nil {
				t.Fatal(err)
			}
			compiled, err := CompileQueryWithSource(Query{DatasetID: test.data.ID, Metrics: []string{"count"}}, func(string) (Dataset, error) { return test.data, nil }, scope.SQL, scope.Args)
			if err != nil {
				t.Fatal(err)
			}
			rows, _, _, err := db.ExecuteAnalytics(context.Background(), compiled.ConnectionID, compiled.SQL, compiled.Args, compiled.Limit)
			if err != nil {
				t.Fatal(err)
			}
			value, err := json.Marshal(rows[0]["count"])
			if err != nil || string(value) != test.want {
				t.Fatalf("scope result = %s, want %s (%v)", value, test.want, err)
			}
		})
	}
}

func TestWorkspaceSourceBuilderScopeOrdersArguments(t *testing.T) {
	if os.Getenv("ANALYTICS_TEST_DB") != "1" {
		t.Skip("set ANALYTICS_TEST_DB=1 with isolated PostGIS on port 55432")
	}
	db := postgres.NewService(0, postgres.ConnectionTestRequest{ID: "test", Host: "127.0.0.1", Port: "55432", Database: "geopanel_test", User: "geopanel", Password: "geopanel", RawQuery: "sslmode=disable"})
	source := postgres.AnalyticsWorkspaceSource{
		ConnectionID: "test", Schema: "demo", Table: "sites", GeometryColumn: "geom",
		Filter: &postgres.QueryFilter{Conditions: []postgres.FilterCondition{{Column: "category", Operator: "eq", Value: "park"}}},
		SpatialFilter: &postgres.SpatialFilter{
			SourceSchema: "demo", SourceTable: "districts", SourceGeometryColumn: "geom", Predicate: "within",
			RowRefs: []postgres.RowReference{{PrimaryKey: []string{"id"}, RowKey: map[string]interface{}{"id": "d_riverside"}}},
		},
	}
	scope, err := db.CompileAnalyticsWorkspaceScope(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	data := Dataset{Metadata: Metadata{ID: "sites"}, ConnectionID: "test", Schema: "demo", Table: "sites", Fields: []Field{{ID: "id", Name: "id"}}, Metrics: []Metric{{ID: "count", Expression: "COUNT(*)"}}}
	compiled, err := CompileQueryWithSource(Query{DatasetID: "sites", Metrics: []string{"count"}, Filters: []Filter{{FieldID: "id", Operator: "eq", Values: []any{"s_park_01"}}}}, func(string) (Dataset, error) { return data, nil }, scope.SQL, scope.Args)
	if err != nil {
		t.Fatal(err)
	}
	if len(compiled.Args) != 3 || compiled.Args[0] != "park" || compiled.Args[1] != "d_riverside" || compiled.Args[2] != "s_park_01" {
		t.Fatalf("scope/chart parameter order = %#v", compiled.Args)
	}
	rows, _, _, err := db.ExecuteAnalytics(context.Background(), compiled.ConnectionID, compiled.SQL, compiled.Args, compiled.Limit)
	if err != nil {
		t.Fatal(err)
	}
	value, err := json.Marshal(rows[0]["count"])
	if err != nil || string(value) != "1" {
		t.Fatalf("builder scope result = %s, err=%v", value, err)
	}
}
