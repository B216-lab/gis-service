package analytics

import (
	"geopanel/backend/internal/httpapi"
	"geopanel/backend/internal/postgres"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAnalyticsAndLegacyAccessWithoutAppAuthentication(t *testing.T) {
	store := testStore(t)
	if _, e := store.Save("datasets", datasetJSON("trips"), true); e != nil {
		t.Fatal(e)
	}
	handler := NewHandler(store)
	RegisterQueryRoutes(handler, store, &recordingExecutor{})
	mux := httpapi.NewServer(postgres.NewService(0))
	mux.Handle("/api/v1/analytics/", handler)
	for _, path := range []string{"/api/v1/health", "/api/v1/database-connections", "/api/v1/analytics/datasets"} {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != 200 {
			t.Fatalf("%s requires app authentication: %d", path, response.Code)
		}
		if len(response.Result().Cookies()) != 0 {
			t.Fatal("unexpected editor session cookie")
		}
	}
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/analytics/query", strings.NewReader(`{"datasetId":"trips","metrics":["count"]}`)))
	if response.Code != 200 {
		t.Fatalf("query requires app authentication: %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/analytics/query", strings.NewReader(`{"datasetId":"trips","metrics":["injected"]}`)))
	if response.Code != 400 {
		t.Fatal("query validation bypassed")
	}
	response = httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/analytics/session", nil))
	if response.Code != 404 {
		t.Fatal("removed editor session route still exists")
	}
}
