package analytics

import (
	"math"
	"strings"
	"testing"
)

func TestWorkspaceExtentFilter(t *testing.T) {
	d := Dataset{Metadata: Metadata{ID: "places"}, ConnectionID: "primary", Schema: "public", Table: "places", Fields: []Field{{ID: "geometry", Name: "geom"}}, Metrics: []Metric{{ID: "count", Expression: "COUNT(*)"}}}
	lookup := func(string) (Dataset, error) { return d, nil }
	query := Query{DatasetID: d.ID, Metrics: []string{"count"}, Filters: []Filter{{FieldID: "geometry", Operator: "within_bbox", Values: []any{100, 50, 110, 60}}}}
	compiled, err := CompileQuery(query, lookup)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(compiled.SQL, `ST_Transform(__data."geom"::geometry, 4326)`) || !strings.Contains(compiled.SQL, "ST_MakeEnvelope($1, $2, $3, $4, 4326)") || len(compiled.Args) != 4 {
		t.Fatalf("extent not compiled as parameterized spatial predicate: %+v", compiled)
	}
	query.Filters[0].Values = []any{170, -20, -170, 20}
	compiled, err = CompileQuery(query, lookup)
	if err != nil || !strings.Contains(compiled.SQL, " OR ") || len(compiled.Args) != 8 {
		t.Fatalf("antimeridian: %+v, %v", compiled, err)
	}
	for _, values := range [][]any{{0, 0, 1}, {-181, 0, 1, 1}, {0, 2, 1, 1}, {0, 0, math.Inf(1), 1}, {"0;drop", 0, 1, 1}} {
		query.Filters[0].Values = values
		if _, err := CompileQuery(query, lookup); err == nil {
			t.Fatalf("accepted invalid extent: %v", values)
		}
	}
}
