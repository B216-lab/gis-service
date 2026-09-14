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
