package analytics

import (
	"strings"
	"testing"
)

func fixtureLookup(id string) (Dataset, error) {
	submissions := Dataset{Metadata: Metadata{ID: "submissions"}, ConnectionID: "test", SQL: "SELECT * FROM submissions", Fields: []Field{{ID: "id", Name: "id"}, {ID: "city", Name: "city"}}, Metrics: []Metric{{ID: "count", Expression: "COUNT(*)"}}, Relationships: []Relationship{{TargetDatasetID: "movements", SourceFieldID: "id", TargetFieldID: "submission", AllowFiltering: true}}}
	movements := Dataset{Metadata: Metadata{ID: "movements"}, ConnectionID: "test", SQL: "SELECT * FROM movements", Fields: []Field{{ID: "submission", Name: "submission_id"}, {ID: "vehicle", Name: "vehicle"}, {ID: "duration", Name: "duration"}, {ID: "date", Name: "at"}}, Metrics: []Metric{{ID: "count", Expression: "COUNT(*)"}}}
	if id == "submissions" {
		return submissions, nil
	}
	return movements, nil
}
func TestCompileRelatedFiltersShareExists(t *testing.T) {
	q := Query{DatasetID: "submissions", Metrics: []string{"count"}, Filters: []Filter{{DatasetID: "movements", FieldID: "vehicle", Operator: "in", Values: []any{"bus'; DROP TABLE movements;--"}}, {DatasetID: "movements", FieldID: "duration", Operator: "gt", Values: []any{10}}}}
	c, e := CompileQuery(q, fixtureLookup)
	if e != nil {
		t.Fatal(e)
	}
	if strings.Count(c.SQL, "EXISTS") != 1 || strings.Contains(c.SQL, "DROP") || len(c.Args) != 2 {
		t.Fatalf("unsafe query: %#v", c)
	}
	if !strings.Contains(c.SQL, `__data."id" = __related."submission_id"`) {
		t.Fatal(c.SQL)
	}
}
func TestCompileRejectsInvalidSelectors(t *testing.T) {
	for _, q := range []Query{{DatasetID: "submissions", Dimensions: []string{"city;select"}}, {DatasetID: "submissions", Metrics: []string{"sum(id)"}}, {DatasetID: "submissions", Dimensions: []string{"city"}, Sort: []Sort{{FieldID: "id"}}}, {DatasetID: "submissions", Metrics: []string{"count"}, Filters: []Filter{{FieldID: "city", Operator: "eq", Values: []any{nil}}}}, {DatasetID: "submissions", Metrics: []string{"count"}, Limit: 10001}} {
		if _, e := CompileQuery(q, fixtureLookup); e == nil {
			t.Fatalf("accepted %#v", q)
		}
	}
}
func TestTimeBucketsAndNulls(t *testing.T) {
	c, e := CompileQuery(Query{DatasetID: "movements", Dimensions: []string{"date"}, TimeFieldID: "date", TimeGrain: "week", Metrics: []string{"count"}, Filters: []Filter{{FieldID: "vehicle", Operator: "is_null"}}}, fixtureLookup)
	if e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(c.SQL, "date_trunc('week'") || !strings.Contains(c.SQL, "IS NULL") || len(c.Args) != 0 {
		t.Fatal(c)
	}
}

func TestTupleSelectionPreservesPairs(t *testing.T) {
	c, e := CompileQuery(Query{DatasetID: "movements", Metrics: []string{"count"}, Filters: []Filter{{AnyOf: [][]Filter{{{FieldID: "vehicle", Operator: "eq", Values: []any{"bus"}}, {FieldID: "duration", Operator: "eq", Values: []any{5}}}, {{FieldID: "vehicle", Operator: "eq", Values: []any{"car"}}, {FieldID: "duration", Operator: "eq", Values: []any{30}}}}}}}, fixtureLookup)
	if e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(c.SQL, `(__data."vehicle" = $1 AND __data."duration" = $2) OR (__data."vehicle" = $3 AND __data."duration" = $4)`) {
		t.Fatal(c.SQL)
	}
}
func TestRelativeDatesResolveBounds(t *testing.T) {
	c, e := CompileQuery(Query{DatasetID: "movements", Metrics: []string{"count"}, Filters: []Filter{{FieldID: "date", Operator: "last_months", Values: []any{float64(3)}}}}, fixtureLookup)
	if e != nil {
		t.Fatal(e)
	}
	if len(c.Args) != 2 || !strings.Contains(c.SQL, "BETWEEN $1 AND $2") {
		t.Fatal(c)
	}
	for _, n := range []any{0, 121, 3.5, "3"} {
		if _, e := CompileQuery(Query{DatasetID: "movements", Metrics: []string{"count"}, Filters: []Filter{{FieldID: "date", Operator: "last_months", Values: []any{n}}}}, fixtureLookup); e == nil {
			t.Fatalf("accepted month count %v", n)
		}
	}
}

func TestHavingFiltersSelectedMetricsAfterGrouping(t *testing.T) {
	q := Query{DatasetID: "submissions", Dimensions: []string{"city"}, Metrics: []string{"count"}, Filters: []Filter{{FieldID: "city", Operator: "ne", Values: []any{"excluded"}}}, Having: []Filter{{FieldID: "count", Operator: "between", Values: []any{2, 10}}}}
	c, e := CompileQuery(q, fixtureLookup)
	if e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(c.SQL, `GROUP BY __data."city" HAVING (COUNT(*)) BETWEEN $2 AND $3`) || len(c.Args) != 3 {
		t.Fatal(c)
	}
	for _, invalid := range []Query{{DatasetID: "submissions", Dimensions: []string{"city"}, Having: []Filter{{FieldID: "count", Operator: "gt", Values: []any{1}}}}, {DatasetID: "submissions", Dimensions: []string{"city"}, Metrics: []string{"count"}, Having: []Filter{{FieldID: "city", Operator: "eq", Values: []any{"x"}}}}, {DatasetID: "submissions", Metrics: []string{"count"}, Having: []Filter{{FieldID: "COUNT(*)", Operator: "gt", Values: []any{1}}}}, {DatasetID: "submissions", Metrics: []string{"count"}, Having: []Filter{{FieldID: "count", DatasetID: "movements", Operator: "gt", Values: []any{1}}}}} {
		if _, e := CompileQuery(invalid, fixtureLookup); e == nil {
			t.Fatalf("invalid HAVING accepted %+v", invalid)
		}
	}
	q.Having = []Filter{{FieldID: "count", Operator: "eq", Values: []any{"0); DROP TABLE submissions; --"}}}
	c, e = CompileQuery(q, fixtureLookup)
	if e != nil || strings.Contains(c.SQL, "DROP") || c.Args[len(c.Args)-1] != "0); DROP TABLE submissions; --" {
		t.Fatalf("unsafe HAVING %+v %v", c, e)
	}
	q.Having = []Filter{{FieldID: "count", Operator: "is_not_null"}}
	c, e = CompileQuery(q, fixtureLookup)
	if e != nil || !strings.Contains(c.SQL, "HAVING (COUNT(*)) IS NOT NULL") {
		t.Fatal(c, e)
	}
}
