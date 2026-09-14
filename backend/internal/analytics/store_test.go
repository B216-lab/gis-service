package analytics

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, e := OpenStore(filepath.Join(t.TempDir(), "metadata.json"))
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func datasetJSON(id string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"id":%q,"name":"Trips","revision":0,"connectionId":"primary","sql":"select 1 as city","fields":[{"id":"city","name":"city","type":"text"}],"metrics":[{"id":"count","name":"Count","expression":"count(*)"}]}`, id))
}
func TestStoreRestartIsolationAndConflict(t *testing.T) {
	s := testStore(t)
	saved, e := s.Save("datasets", datasetJSON("trips"), true)
	if e != nil {
		t.Fatal(e)
	}
	restarted, e := OpenStore(s.path)
	if e != nil {
		t.Fatal(e)
	}
	d, e := restarted.Dataset("trips")
	if e != nil || d.Revision != 1 {
		t.Fatalf("restart: %+v %v", d, e)
	}
	st, e := os.Stat(s.path)
	if e != nil || st.Mode().Perm() != 0600 {
		t.Fatalf("permissions %v %v", st, e)
	}
	saved[0] = 'x'
	if _, e = s.Dataset("trips"); e != nil {
		t.Fatal("returned bytes alias storage")
	}
	d.Name = "Updated"
	b, _ := json.Marshal(d)
	if _, e = s.Save("datasets", b, false); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Save("datasets", b, false); !errors.Is(e, ErrConflict) {
		t.Fatalf("stale update %v", e)
	}
	if e = s.Delete("datasets", "trips", 1); !errors.Is(e, ErrConflict) {
		t.Fatalf("stale delete %v", e)
	}
}
func TestConcurrentEditorsOneWinner(t *testing.T) {
	s := testStore(t)
	saved, e := s.Save("datasets", datasetJSON("trips"), true)
	if e != nil {
		t.Fatal(e)
	}
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() { _, e := s.Save("datasets", saved, false); results <- e })
	}
	wg.Wait()
	close(results)
	wins, conflicts := 0, 0
	for e := range results {
		if e == nil {
			wins++
		} else if errors.Is(e, ErrConflict) {
			conflicts++
		} else {
			t.Fatal(e)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("wins=%d conflicts=%d", wins, conflicts)
	}
}
func TestDependenciesAndUnknownCredentials(t *testing.T) {
	s := testStore(t)
	if _, e := s.Save("datasets", datasetJSON("trips"), true); e != nil {
		t.Fatal(e)
	}
	chart := json.RawMessage(`{"id":"bar","name":"Bar","datasetId":"trips","type":"bar","query":{"dimensions":["city"],"metrics":["count"]}}`)
	if _, e := s.Save("charts", chart, true); e != nil {
		t.Fatal(e)
	}
	if e := s.Delete("datasets", "trips", 1); !errors.Is(e, ErrInvalid) {
		t.Fatalf("dependent delete %v", e)
	}
	d, _ := s.Dataset("trips")
	d.Fields = nil
	b, _ := json.Marshal(d)
	if _, e := s.Save("datasets", b, false); !errors.Is(e, ErrInvalid) {
		t.Fatalf("break chart %v", e)
	}
	bad := strings.Replace(string(datasetJSON("bad")), `"connectionId":"primary"`, `"connectionId":"primary","password":"secret"`, 1)
	if _, e := s.Save("datasets", []byte(bad), true); !errors.Is(e, ErrInvalid) {
		t.Fatalf("credentials accepted %v", e)
	}
}
func TestFailedPersistLeavesMemoryUnchanged(t *testing.T) {
	s := testStore(t)
	s.path = filepath.Join(s.path, "nested", "metadata.json")
	if e := os.WriteFile(filepath.Dir(filepath.Dir(s.path)), []byte("blocking file"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Save("datasets", datasetJSON("trips"), true); e == nil {
		t.Fatal("expected filesystem error")
	}
	if _, e := s.Dataset("trips"); !errors.Is(e, ErrNotFound) {
		t.Fatalf("memory changed %v", e)
	}
}
func TestHTTPCRUDAndRevisionsWithoutAppAuthentication(t *testing.T) {
	s := testStore(t)
	h := NewHandler(s)
	req := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	base := "/api/v1/analytics/datasets"
	if w := req("GET", base, ""); w.Code != 200 {
		t.Fatal(w.Code)
	}
	w := req("POST", base, string(datasetJSON("trips")))
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	saved := w.Body.String()
	w = req("PUT", base+"/trips", saved)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = req("PUT", base+"/trips", saved)
	if w.Code != 409 {
		t.Fatal(w.Code)
	}
	w = req("GET", base, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"items"`) {
		t.Fatal(w.Code, w.Body.String())
	}
	w = req("DELETE", base+"/trips?revision=2", "")
	if w.Code != 204 {
		t.Fatal(w.Code, w.Body.String())
	}

}

func TestTupleFiltersPersistAndDashboardFiltersProtectDependencies(t *testing.T) {
	s := testStore(t)
	for _, id := range []string{"trips", "related"} {
		if _, e := s.Save("datasets", datasetJSON(id), true); e != nil {
			t.Fatal(e)
		}
	}
	raw := []byte(`{"id":"tuple","name":"Tuple","datasetId":"trips","type":"bar","query":{"dimensions":["city"],"metrics":["count"],"filters":[{"anyOf":[[{"fieldId":"city","operator":"eq","values":["A"]}],[{"fieldId":"city","operator":"eq","values":["B"]}]]}]}}`)
	if _, e := s.Save("charts", raw, true); e != nil {
		t.Fatalf("valid tuple rejected: %v", e)
	}
	raw = []byte(`{"id":"scope","name":"Scoped dashboard","widgets":[{"id":"one","chartId":"tuple","w":4,"h":3}],"filters":[{"datasetId":"related","fieldId":"city","operator":"eq","values":["A"]}]}`)
	if _, e := s.Save("dashboards", raw, true); e != nil {
		t.Fatal(e)
	}
	if e := s.Delete("datasets", "related", 1); !errors.Is(e, ErrInvalid) {
		t.Fatal("dashboard filter dependency discarded", e)
	}
}
func TestCompositeCyclesRejectedAtomically(t *testing.T) {
	s := testStore(t)
	if _, e := s.Save("datasets", datasetJSON("trips"), true); e != nil {
		t.Fatal(e)
	}
	for _, id := range []string{"a", "b"} {
		c := Chart{Metadata: Metadata{ID: id, Name: id}, DatasetID: "trips", Type: "compositeMap"}
		if id == "b" {
			c.LayerChartIDs = []string{"a"}
		}
		raw, _ := json.Marshal(c)
		if _, e := s.Save("charts", raw, true); e != nil {
			t.Fatal(e)
		}
	}
	c, _ := s.Chart("a")
	c.LayerChartIDs = []string{"b"}
	raw, _ := json.Marshal(c)
	if _, e := s.Save("charts", raw, false); !errors.Is(e, ErrInvalid) {
		t.Fatal("cycle accepted", e)
	}
	c, _ = s.Chart("a")
	if c.Revision != 1 || len(c.LayerChartIDs) != 0 {
		t.Fatal("failed cycle update partially applied")
	}
}
