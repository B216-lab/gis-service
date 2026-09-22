package analytics

import (
	"encoding/json"
	"errors"
	"testing"
)

func saveTransferFixture(t *testing.T, store *Store) {
	t.Helper()
	if _, err := store.Save("datasets", datasetJSON("regions"), true); err != nil {
		t.Fatal(err)
	}
	var trips Dataset
	_ = json.Unmarshal(datasetJSON("trips"), &trips)
	trips.Relationships = []Relationship{{
		ID: "region", TargetDatasetID: "regions", SourceFieldID: "city",
		TargetFieldID: "city", Cardinality: "many-to-one", AllowFiltering: true,
	}}
	raw, _ := json.Marshal(trips)
	if _, err := store.Save("datasets", raw, true); err != nil {
		t.Fatal(err)
	}
	child := Chart{
		Metadata: Metadata{ID: "trip-count", Name: "Trip count"}, DatasetID: "trips", Type: "bar",
		Query: Query{DatasetID: "trips", Dimensions: []string{"city"}, Metrics: []string{"count"}},
	}
	raw, _ = json.Marshal(child)
	if _, err := store.Save("charts", raw, true); err != nil {
		t.Fatal(err)
	}
	composite := Chart{
		Metadata: Metadata{ID: "map", Name: "Map"}, DatasetID: "trips", Type: "compositeMap",
		Query: Query{DatasetID: "trips"}, LayerChartIDs: []string{"trip-count"},
	}
	raw, _ = json.Marshal(composite)
	if _, err := store.Save("charts", raw, true); err != nil {
		t.Fatal(err)
	}
	dashboard := Dashboard{
		Metadata: Metadata{ID: "mobility", Name: "Mobility"},
		Widgets:  []Widget{{ID: "map-widget", ChartID: "map", W: 12, H: 5}},
		Filters:  []Filter{{DatasetID: "regions", FieldID: "city", Operator: "eq", Values: []any{"A"}}},
	}
	raw, _ = json.Marshal(dashboard)
	if _, err := store.Save("dashboards", raw, true); err != nil {
		t.Fatal(err)
	}
}

func TestDashboardExportIncludesTransitiveDependencies(t *testing.T) {
	store := testStore(t)
	saveTransferFixture(t, store)
	bundle, err := store.ExportDashboard("mobility")
	if err != nil {
		t.Fatal(err)
	}
	if bundle.Format != dashboardBundleFormat || bundle.Version != 1 || bundle.ExportedAt == "" {
		t.Fatalf("invalid envelope: %+v", bundle)
	}
	if len(bundle.Datasets) != 2 || len(bundle.Charts) != 2 || bundle.Dashboard.ID != "mobility" {
		t.Fatalf("dependencies missing: datasets=%d charts=%d dashboard=%s", len(bundle.Datasets), len(bundle.Charts), bundle.Dashboard.ID)
	}
}

func TestDashboardImportMapsConnectionsAndHandlesConflictsAtomically(t *testing.T) {
	source := testStore(t)
	saveTransferFixture(t, source)
	bundle, _ := source.ExportDashboard("mobility")
	target := testStore(t)
	report, err := target.ImportDashboard(bundle, map[string]string{"primary": "production"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if report.Created != 5 || report.Updated != 0 || report.DashboardID != "mobility" {
		t.Fatalf("unexpected report: %+v", report)
	}
	dataset, _ := target.Dataset("trips")
	if dataset.ConnectionID != "production" || dataset.Revision != 1 {
		t.Fatalf("connection was not mapped: %+v", dataset)
	}
	if _, err = target.ImportDashboard(bundle, map[string]string{"primary": "production"}, false); !errors.Is(err, ErrConflict) {
		t.Fatalf("collision was not rejected: %v", err)
	}
	dashboard, _ := target.Dashboard("mobility")
	if dashboard.Revision != 1 {
		t.Fatal("failed import changed stored objects")
	}
	report, err = target.ImportDashboard(bundle, map[string]string{"primary": "production"}, true)
	if err != nil || report.Created != 0 || report.Updated != 5 {
		t.Fatalf("replace failed: report=%+v err=%v", report, err)
	}
	dashboard, _ = target.Dashboard("mobility")
	if dashboard.Revision != 2 {
		t.Fatalf("replace did not advance revision: %+v", dashboard)
	}
}

func TestDashboardImportRejectsIncompleteBundle(t *testing.T) {
	source := testStore(t)
	saveTransferFixture(t, source)
	bundle, _ := source.ExportDashboard("mobility")
	bundle.Datasets = bundle.Datasets[:1]
	target := testStore(t)
	if _, err := target.ImportDashboard(bundle, map[string]string{"primary": "production"}, false); !errors.Is(err, ErrInvalid) {
		t.Fatalf("incomplete bundle accepted: %v", err)
	}
	if _, err := target.Dashboard("mobility"); !errors.Is(err, ErrNotFound) {
		t.Fatal("invalid import partially persisted")
	}
}
