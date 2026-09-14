package analytics

import (
	"context"
	"encoding/json"
	"errors"
	"geopanel/backend/internal/postgres"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func seedPublication(t *testing.T) (*Store, Publication) {
	t.Helper()
	s := testStore(t)
	if _, e := s.Save("datasets", datasetJSON("trips"), true); e != nil {
		t.Fatal(e)
	}
	for _, entry := range []struct{ kind, raw string }{{"charts", `{"id":"bar","name":"Bar","datasetId":"trips","type":"bar","query":{"dimensions":["city"],"metrics":["count"],"filters":[{"fieldId":"city","operator":"ne","values":["secret"]}]}}`}, {"dashboards", `{"id":"dash","name":"Dashboard","widgets":[{"id":"one","chartId":"bar","w":4,"h":3}]}`}} {
		if _, e := s.Save(entry.kind, []byte(entry.raw), true); e != nil {
			t.Fatal(e)
		}
	}
	p, e := s.Publish("dash", 1)
	if e != nil {
		t.Fatal(e)
	}
	return s, p
}
func TestPublicationPinsDefinitionsAcrossRestart(t *testing.T) {
	s, p := seedPublication(t)
	d, _ := s.Dataset("trips")
	d.SQL = "select 'changed' as city"
	raw, _ := json.Marshal(d)
	if _, e := s.Save("datasets", raw, false); e != nil {
		t.Fatal(e)
	}
	restarted, e := OpenStore(s.path)
	if e != nil {
		t.Fatal(e)
	}
	pinned, e := restarted.Publication(p.ID)
	if e != nil {
		t.Fatal(e)
	}
	if pinned.Datasets[0].SQL == d.SQL {
		t.Fatal("publication changed with draft")
	}
	safe, _ := json.Marshal(pinned.Viewer())
	for _, forbidden := range []string{`"sql"`, `"connectionId"`, `"expression"`, `count(*)`} {
		if strings.Contains(string(safe), forbidden) {
			t.Fatalf("viewer leaked %s", forbidden)
		}
	}
	if _, e := s.Publish("dash", 2); !errors.Is(e, ErrConflict) {
		t.Fatalf("stale publish %v", e)
	}
}
func TestShareHashPersistenceExpiryAndRevoke(t *testing.T) {
	s, p := seedPublication(t)
	share, token, e := s.CreateShare(p.ID, time.Now().Add(time.Hour).Format(time.RFC3339), nil)
	if e != nil {
		t.Fatal(e)
	}
	bytes, _ := os.ReadFile(s.path)
	if strings.Contains(string(bytes), token) {
		t.Fatal("plaintext token persisted")
	}
	if !strings.Contains(string(bytes), hashToken(token)) {
		t.Fatal("missing token hash")
	}
	s, e = OpenStore(s.path)
	if e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.ResolveShare(token); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.ResolveShare(strings.Repeat("x", 64)); !errors.Is(e, ErrNotFound) {
		t.Fatal("invalid token accepted")
	}
	if e = s.RevokeShare(share.ID, share.Revision+1); !errors.Is(e, ErrConflict) {
		t.Fatal("stale revoke accepted")
	}
	if e = s.RevokeShare(share.ID, share.Revision); e != nil {
		t.Fatal(e)
	}
	s, e = OpenStore(s.path)
	if e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.ResolveShare(token); !errors.Is(e, ErrNotFound) {
		t.Fatal("revoked token accepted")
	}
	if _, _, e = s.CreateShare(p.ID, time.Now().Add(-time.Hour).Format(time.RFC3339), nil); !errors.Is(e, ErrInvalid) {
		t.Fatal("past expiry accepted")
	}
	share, token, e = s.CreateShare(p.ID, time.Now().Add(time.Hour).Format(time.RFC3339), nil)
	if e != nil {
		t.Fatal(e)
	}
	var stored storedShare
	_ = json.Unmarshal(s.objects["shares"][share.ID], &stored)
	stored.ExpiresAt = time.Now().Add(-time.Second).Format(time.RFC3339)
	s.objects["shares"][share.ID], _ = json.Marshal(stored)
	if _, _, e = s.ResolveShare(token); !errors.Is(e, ErrNotFound) {
		t.Fatal("expired share accepted")
	}
}

type recordingExecutor struct {
	SQL   string
	Args  []any
	Calls int
}

func (e *recordingExecutor) ExecuteAnalytics(_ context.Context, _ string, sql string, args []any, _ int) ([]map[string]any, []postgres.ColumnMeta, bool, error) {
	e.SQL = sql
	e.Args = args
	e.Calls++
	return []map[string]any{{"city": "A", "count": 1}}, nil, false, nil
}
func TestPublicQueriesCannotOverrideOrEscape(t *testing.T) {
	s, p := seedPublication(t)
	_, token, e := s.CreateShare(p.ID, "", []Filter{{FieldID: "city", Operator: "eq", Values: []any{"A"}}})
	if e != nil {
		t.Fatal(e)
	}
	executor := &recordingExecutor{}
	h := NewHandler(s)
	RegisterPublicationRoutes(h, NewQueryService(executor))
	path := "/api/v1/analytics/public/" + token + "/query"
	req := func(body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", path, strings.NewReader(body))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	for _, body := range []string{`{"chartId":"bar","dimensions":["private"]}`, `{"chartId":"bar","datasetId":"private"}`, `{"chartId":"bar","sql":"select secret"}`, `{"chartId":"unrelated"}`, `{"chartId":"bar","widgetId":"unrelated"}`, `{"chartId":"bar","filters":[{"datasetId":"private","fieldId":"secret","operator":"eq","values":[1]}]}`} {
		w := req(body)
		if w.Code < 400 {
			t.Fatalf("override accepted: %s", body)
		}
	}
	if executor.Calls != 0 {
		t.Fatal("invalid request reached DB")
	}
	w := req(`{"chartId":"bar","widgetId":"one","filters":[{"fieldId":"city","operator":"eq","values":["B"]}]}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if len(executor.Args) != 3 || executor.Args[0] != "secret" || executor.Args[1] != "A" || executor.Args[2] != "B" {
		t.Fatalf("locked filters lost: %v", executor.Args)
	}
	if !strings.Contains(executor.SQL, " AND ") {
		t.Fatal("filters not intersected")
	}
}
func TestPublicationPinsTransitiveRelationshipsAndLayers(t *testing.T) {
	s, p := seedPublication(t)
	if _, e := s.Save("datasets", datasetJSON("respondents"), true); e != nil {
		t.Fatal(e)
	}
	d, _ := s.Dataset("trips")
	d.Relationships = []Relationship{{ID: "respondent", TargetDatasetID: "respondents", SourceFieldID: "city", TargetFieldID: "city", AllowFiltering: true}}
	raw, _ := json.Marshal(d)
	if _, e := s.Save("datasets", raw, false); e != nil {
		t.Fatal(e)
	}
	raw = []byte(`{"id":"map","name":"Overlay","datasetId":"trips","type":"compositeMap","query":{},"layerChartIds":["bar"]}`)
	if _, e := s.Save("charts", raw, true); e != nil {
		t.Fatal(e)
	}
	dash := p.Dashboard
	dash.Widgets[0].ChartID = "map"
	raw, _ = json.Marshal(dash)
	if _, e := s.Save("dashboards", raw, false); e != nil {
		t.Fatal(e)
	}
	p, e := s.Publish("dash", 2)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.Datasets) != 2 || len(p.Charts) != 2 {
		t.Fatalf("dependencies lost: %+v", p)
	}
	if _, e = p.query("bar", "one", nil, nil); e != nil {
		t.Fatalf("layer query rejected %v", e)
	}
}

func TestPublicationSemanticFiltersAndLockedScope(t *testing.T) {
	_, p := seedPublication(t)
	p.Datasets[0].Fields[0].SemanticID = "city"
	p.Datasets = append(p.Datasets, Dataset{Metadata: Metadata{ID: "other"}, ConnectionID: "primary", SQL: "select 1 as place", Fields: []Field{{ID: "place", Name: "place", SemanticID: "city"}}})
	q, e := p.query("bar", "one", nil, []Filter{{DatasetID: "other", FieldID: "place", Operator: "eq", Values: []any{"A"}}})
	if e != nil {
		t.Fatal(e)
	}
	last := q.Filters[len(q.Filters)-1]
	if last.DatasetID != "trips" || last.FieldID != "city" {
		t.Fatalf("semantic mapping failed %+v", last)
	}
	q, e = p.query("bar", "one", []Filter{{FieldID: "city", Operator: "eq", Values: []any{"locked"}, SourceWidgetID: "one"}}, []Filter{{FieldID: "city", Operator: "eq", Values: []any{"selection"}, SourceWidgetID: "one"}})
	if e != nil {
		t.Fatal(e)
	}
	if len(q.Filters) != 2 || q.Filters[1].Values[0] != "locked" {
		t.Fatalf("source exemption escaped locked filter %+v", q.Filters)
	}
	p.Datasets[1].Fields[0].SemanticID = "unrelated"
	if _, e = p.query("bar", "one", []Filter{{DatasetID: "other", FieldID: "place", Operator: "eq", Values: []any{"A"}}}, nil); !errors.Is(e, ErrInvalid) {
		t.Fatal("unsupported locked filter silently ignored")
	}
	if _, e = p.query("bar", "one", nil, []Filter{{DatasetID: "other", FieldID: "place", Operator: "eq", Values: []any{"A"}, TargetWidgetIDs: []string{"one"}}}); !errors.Is(e, ErrInvalid) {
		t.Fatal("unsupported explicitly scoped filter silently ignored")
	}
}

func TestCachedPublicQueryStillChecksRevocationAndOverrides(t *testing.T) {
	s, p := seedPublication(t)
	share, token, e := s.CreateShare(p.ID, "", nil)
	if e != nil {
		t.Fatal(e)
	}
	executor := &recordingExecutor{}
	h := NewHandler(s)
	RegisterPublicationRoutes(h, NewQueryService(executor))
	path := "/api/v1/analytics/public/" + token + "/query"
	request := func(body, cacheControl string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", path, strings.NewReader(body))
		r.Header.Set("Cache-Control", cacheControl)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	for range 2 {
		if w := request(`{"chartId":"bar","widgetId":"one"}`, ""); w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if executor.Calls != 1 {
		t.Fatal("public result not cached")
	}
	if w := request(`{"chartId":"bar","widgetId":"one","having":[]}`, ""); w.Code != 400 {
		t.Fatal("public HAVING override accepted")
	}
	if w := request(`{"chartId":"bar","widgetId":"one"}`, "no-cache"); w.Code != 200 || executor.Calls != 2 {
		t.Fatal("public manual refresh ignored")
	}
	if e := s.RevokeShare(share.ID, share.Revision); e != nil {
		t.Fatal(e)
	}
	if w := request(`{"chartId":"bar","widgetId":"one"}`, ""); w.Code != 404 {
		t.Fatal("cached query bypassed revocation")
	}
	if executor.Calls != 2 {
		t.Fatal("revoked request reached executor")
	}
}
