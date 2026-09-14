package analytics

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestReferenceImportCountsIdempotencyAndDefinitions(t *testing.T) {
	s := testStore(t)
	report, e := s.ImportReference("primary")
	if e != nil {
		t.Fatal(e)
	}
	if report.Created != 23 || len(report.DatasetIDs) != 2 || len(report.ChartIDs) != 20 {
		t.Fatalf("counts %+v", report)
	}
	dash, e := s.Dashboard(report.DashboardID)
	if e != nil {
		t.Fatal(e)
	}
	charts, headers := 0, 0
	for _, w := range dash.Widgets {
		if w.ChartID == "" {
			headers++
		} else {
			charts++
		}
		if w.X+w.W > 12 {
			t.Fatal("layout overflow", w)
		}
	}
	if charts != 20 || headers != 5 || len(dash.NativeFilters) != 1 {
		t.Fatalf("layout charts=%d headers=%d filters=%d", charts, headers, len(dash.NativeFilters))
	}
	second, e := s.ImportReference("primary")
	if e != nil {
		t.Fatal(e)
	}
	if second.Created != 0 || second.Updated != 0 || second.Unchanged != 23 {
		t.Fatalf("reimport not idempotent %+v", second)
	}
	_, e = s.Publish(dash.ID, dash.Revision)
	if e != nil {
		t.Fatalf("import not publishable: %v", e)
	}
	var doc referenceDocument
	_ = json.Unmarshal(referenceExport, &doc)
	sourceIDs := map[int]string{}
	for _, c := range doc.Charts {
		sourceIDs[c.SourceChartID] = c.ID
	}
	pie, _ := s.Chart(sourceIDs[4])
	dataset, _ := s.Dataset(pie.DatasetID)
	metricFound := false
	for _, m := range dataset.Metrics {
		if m.ID == pie.Query.Metrics[0] {
			metricFound = m.Expression == `COUNT("gender")`
		}
	}
	if !metricFound {
		t.Fatal("nullable gender count lost")
	}
	line, _ := s.Chart(sourceIDs[10])
	if line.Query.TimeGrain != "week" || line.Query.TimeFieldID != "movements_date" || len(line.Query.Filters) != 1 || line.Query.Filters[0].Values[0] != "2022-01-01" {
		t.Fatal("weekly date semantics lost", line.Query)
	}
	calendar, _ := s.Chart(sourceIDs[29])
	if calendar.Query.TimeGrain != "day" || calendar.Query.TimeFieldID != "submission_created_at" || calendar.Query.Filters[0].Operator != "last_months" {
		t.Fatal("calendar semantics lost")
	}
	overlay, _ := s.Chart(sourceIDs[28])
	if len(overlay.LayerChartIDs) != 2 || overlay.LayerChartIDs[0] != sourceIDs[26] || overlay.LayerChartIDs[1] != sourceIDs[27] {
		t.Fatal("overlay layers lost")
	}
	movement, _ := s.Dataset(doc.Datasets[1].ID)
	metricCount := len(dataset.Metrics) + len(movement.Metrics)
	if metricCount != 15 {
		t.Fatalf("12 exported+3 ad hoc metrics expected, got %d", metricCount)
	}
	for _, m := range movement.Metrics {
		if m.ID == "valid_rate" && !strings.Contains(m.Expression, "::numeric") {
			t.Fatal("integer ratio uncorrected")
		}
	}
	if !hasField(movement, "gender_ru") {
		t.Fatal("gender compatibility missing")
	}
	changed, e := s.ImportReference("another-registered-source")
	if e != nil {
		t.Fatal(e)
	}
	if changed.Updated != 2 || changed.Unchanged != 21 {
		t.Fatalf("connection rebind %+v", changed)
	}
}
func TestReferenceImportReportsUnsupportedSettings(t *testing.T) {
	_, _, _, report, e := buildReference("primary")
	if e != nil {
		t.Fatal(e)
	}
	settings := map[string]bool{}
	for _, w := range report.Warnings {
		settings[w.Setting] = true
	}
	for _, setting := range []string{"linear_color_scheme", "color_scheme", "viewport", "time_range", "layout", "native_filter_scope", "valid_rate", "gender_ru"} {
		if !settings[setting] {
			t.Errorf("silent unsupported/corrected setting %s", setting)
		}
	}
}

func TestReferenceMatrixNormalizationAndCategorySort(t *testing.T) {
	_, charts, _, report, e := buildReference("primary")
	if e != nil {
		t.Fatal(e)
	}
	for _, c := range charts {
		var options map[string]any
		_ = json.Unmarshal(c.Options, &options)
		if c.Type == "matrixHeatmap" {
			if options["normalize"] != "all" || options["normalized"] != true || options["showPercentage"] != true || options["xSort"] != "labelAsc" {
				t.Fatalf("matrix settings lost %+v", options)
			}
		}
		if c.ID == "e2fb62ec-9ead-4e2b-b72e-c1f2cf5b3e5f" && options["xSort"] != "sumAsc" {
			t.Fatal("category sum sort lost")
		}
	}
	for _, w := range report.Warnings {
		if w.Setting == "normalization" || w.Setting == "normalized" {
			t.Fatal("obsolete unsupported warning")
		}
	}
}
