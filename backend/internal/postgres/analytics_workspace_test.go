package postgres

import "testing"

func TestAnalyticsWorkspaceSourceRejectsUnsafeSavedFilter(t *testing.T) {
	source := AnalyticsWorkspaceSource{
		ConnectionID: "primary",
		Schema:       "demo",
		Table:        "sites",
		Filter:       &QueryFilter{Mode: "sql", Where: "category = 'park'; DROP TABLE demo.sites"},
	}
	source.TrimSpaces()
	if err := source.Validate(); err == nil {
		t.Fatal("unsafe saved SQL filter accepted")
	}
}

func TestAnalyticsWorkspaceFlowColumnsUseMapPayloadNames(t *testing.T) {
	columns := AnalyticsWorkspaceFlowColumns{
		StartMode: "coordinates", StartLonColumn: "start_lon", StartLatColumn: "start_lat",
		EndMode: "coordinates", EndLonColumn: "end_lon", EndLatColumn: "end_lat",
	}
	if err := validateFlowmapColumns(columns); err != nil {
		t.Fatal(err)
	}
}
