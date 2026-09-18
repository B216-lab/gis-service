package analytics

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"geopanel/backend/internal/postgres"
)

type workspaceRecordingExecutor struct {
	recordingExecutor
	scope      postgres.AnalyticsWorkspaceScope
	compileErr error
	compileHit int
}

func (e *workspaceRecordingExecutor) CompileAnalyticsWorkspaceScope(_ context.Context, _ postgres.AnalyticsWorkspaceSource) (postgres.AnalyticsWorkspaceScope, error) {
	e.compileHit++
	return e.scope, e.compileErr
}

func workspaceDatasetJSON(sql string) string {
	return `{"id":"places","name":"Places","revision":0,"connectionId":"primary","sql":` + sql + `,"schema":"demo","table":"sites","fields":[{"id":"id","name":"id","type":"text"},{"id":"category","name":"category","type":"text"}],"metrics":[{"id":"count","name":"Count","expression":"count(*)"}]}`
}

func workspaceSQLDatasetJSON() string {
	return `{"id":"places","name":"Places","revision":0,"connectionId":"primary","sql":"SELECT * FROM demo.sites","fields":[{"id":"id","name":"id","type":"text"}],"metrics":[{"id":"count","name":"Count","expression":"count(*)"}]}`
}

func TestWorkspaceQueryRequiresPhysicalIdentityAndStrictBody(t *testing.T) {
	store := testStore(t)
	if _, err := store.Save("datasets", []byte(workspaceDatasetJSON(`""`)), true); err != nil {
		t.Fatal(err)
	}
	executor := &workspaceRecordingExecutor{scope: postgres.AnalyticsWorkspaceScope{SQL: `SELECT * FROM "demo"."sites" WHERE "category" = $1`, Args: []any{"park"}}}
	handler := NewHandler(store)
	RegisterQueryRoutes(handler, store, executor)
	request := func(body string) *httptest.ResponseRecorder {
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, httptest.NewRequest(http.MethodPost, "/api/v1/analytics/workspace-query", strings.NewReader(body)))
		return result
	}
	valid := `{"query":{"datasetId":"places","metrics":["count"],"filters":[{"fieldId":"category","operator":"eq","values":["school"]}]},"source":{"connectionId":"primary","schema":"demo","table":"sites","spatialFilter":{"sourceLayerId":"district-layer","sourceLayerName":"Districts","sourceSchema":"demo","sourceTable":"districts","sourceGeometryColumn":"geom","predicate":"intersects","rowRefs":[{"primaryKey":["id"],"rowKey":{"id":"d_riverside"}}]},"flowColumns":{"startMode":"coordinates","startLon":"start_lon","startLat":"start_lat","endMode":"coordinates","endLon":"end_lon","endLat":"end_lat","magnitude":"magnitude","defaultMagnitude":1}}}`
	if result := request(valid + ` garbage`); result.Code != http.StatusBadRequest {
		t.Fatalf("trailing body accepted: %d %s", result.Code, result.Body.String())
	}
	if result := request(`{"query":{"datasetId":"places","metrics":["count"]},"source":{"connectionId":"primary","schema":"demo","table":"other"}}`); result.Code != http.StatusBadRequest || executor.compileHit != 0 {
		t.Fatalf("mismatched source reached compiler: %d %d", result.Code, executor.compileHit)
	}
	if result := request(`{"query":{"datasetId":"places","metrics":["count"]},"source":{"connectionId":"primary","schema":"demo","table":"sites","unexpected":true}}`); result.Code != http.StatusBadRequest || executor.compileHit != 0 {
		t.Fatalf("unknown source field accepted: %d %d", result.Code, executor.compileHit)
	}
	if result := request(valid); result.Code != http.StatusOK {
		t.Fatalf("workspace query failed: %d %s", result.Code, result.Body.String())
	}
	if executor.compileHit != 1 || len(executor.Args) != 2 || executor.Args[0] != "park" || executor.Args[1] != "school" || !strings.Contains(executor.SQL, `$2`) {
		t.Fatalf("source args were not kept ahead of chart args: sql=%s args=%v", executor.SQL, executor.Args)
	}
}

func TestWorkspaceQueryRejectsSQLDataset(t *testing.T) {
	store := testStore(t)
	if _, err := store.Save("datasets", []byte(workspaceSQLDatasetJSON()), true); err != nil {
		t.Fatal(err)
	}
	executor := &workspaceRecordingExecutor{}
	handler := NewHandler(store)
	RegisterQueryRoutes(handler, store, executor)
	result := httptest.NewRecorder()
	handler.ServeHTTP(result, httptest.NewRequest(http.MethodPost, "/api/v1/analytics/workspace-query", strings.NewReader(`{"query":{"datasetId":"places","metrics":["count"]},"source":{"connectionId":"primary","schema":"demo","table":"sites"}}`)))
	if result.Code != http.StatusBadRequest || executor.compileHit != 0 {
		t.Fatalf("SQL dataset accepted: %d compiler=%d", result.Code, executor.compileHit)
	}
}

func TestCompileQueryWithSourceOffsetsArguments(t *testing.T) {
	compiled, err := CompileQueryWithSource(
		Query{DatasetID: "movements", Metrics: []string{"count"}, Filters: []Filter{{FieldID: "vehicle", Operator: "eq", Values: []any{"bus"}}}},
		fixtureLookup,
		`SELECT * FROM movements WHERE city = $1`,
		[]any{"Irkutsk"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(compiled.Args) != 2 || compiled.Args[0] != "Irkutsk" || compiled.Args[1] != "bus" || !strings.Contains(compiled.SQL, `__data."vehicle" = $2`) {
		t.Fatalf("source argument offset broken: %+v", compiled)
	}
}
