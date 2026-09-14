package analytics

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"geopanel/backend/internal/postgres"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"
)

//go:embed testdata/movements_dashboard.reference.json
var referenceExport []byte

type ImportWarning struct {
	ObjectID string `json:"objectId"`
	Setting  string `json:"setting"`
	Message  string `json:"message"`
}
type ImportReport struct {
	DashboardID string          `json:"dashboardId"`
	DatasetIDs  []string        `json:"datasetIds"`
	ChartIDs    []string        `json:"chartIds"`
	Created     int             `json:"created"`
	Updated     int             `json:"updated"`
	Unchanged   int             `json:"unchanged"`
	Warnings    []ImportWarning `json:"warnings"`
}
type referenceDataset struct {
	ID, Name, SQL, DefaultTimeField, RowKey string
	Fields                                  []struct {
		ID, Name, Type, Expression string
		Temporal                   bool
	}
	Metrics []Metric
}
type referenceChart struct {
	ID, Name, DatasetID, Kind string
	SourceChartID             int
	Config                    map[string]any
}
type referenceDocument struct {
	Datasets  []referenceDataset
	Charts    []referenceChart
	Dashboard struct {
		ID, Name string
		Layout   map[string]json.RawMessage
		Config   map[string]any
	}
}
type referenceNode struct {
	ID, Type string
	Children []string
	Meta     struct {
		ChartID       int
		Width, Height int
		Text          string
	}
}

func str(v any) string            { s, _ := v.(string); return s }
func number(v any) int            { f, _ := v.(float64); return int(f) }
func list(v any) []any            { items, _ := v.([]any); return items }
func object(v any) map[string]any { m, _ := v.(map[string]any); return m }
func textList(v any) []string {
	if s, ok := v.(string); ok {
		return []string{s}
	}
	r := []string{}
	for _, x := range list(v) {
		r = append(r, str(x))
	}
	return r
}
func nativeFieldType(f string) string {
	switch f {
	case "DATETIMETZ", "DATE":
		return "timestamp"
	case "INTEGER", "LONGINTEGER", "DECIMAL", "FLOAT":
		return "number"
	default:
		return "text"
	}
}
func buildReference(connectionID string) ([]Dataset, []Chart, Dashboard, ImportReport, error) {
	var doc referenceDocument
	var report ImportReport
	if e := json.Unmarshal(referenceExport, &doc); e != nil {
		return nil, nil, Dashboard{}, report, e
	}
	warn := func(id, setting, message string) {
		report.Warnings = append(report.Warnings, ImportWarning{id, setting, message})
	}
	datasets := []Dataset{}
	byID := map[string]*Dataset{}
	for _, source := range doc.Datasets {
		d := Dataset{Metadata: Metadata{ID: source.ID, Name: source.Name}, ConnectionID: connectionID, SQL: source.SQL, Grain: source.RowKey, DefaultTimeFieldID: source.DefaultTimeField, Metrics: source.Metrics}
		for _, f := range source.Fields {
			field := Field{ID: f.ID, Name: f.Name, Type: nativeFieldType(f.Type), Expression: f.Expression}
			switch f.ID {
			case "submission_id", "city_id", "city_name", "gender", "gender_ru", "social_status_code", "social_status_ru", "movements_date":
				field.SemanticID = f.ID
			}
			if strings.HasSuffix(f.ID, "_lon") {
				field.Role = "longitude"
			}
			if strings.HasSuffix(f.ID, "_lat") {
				field.Role = "latitude"
			}
			d.Fields = append(d.Fields, field)
		}
		for i, m := range d.Metrics {
			if m.ID == "valid_rate" {
				d.Metrics[i].Expression = "sum(case when validation_status_code = 'VALID' then 1 else 0 end)::numeric / NULLIF(count(*), 0)"
				warn(d.ID, "valid_rate", "Corrected integer division to numeric ratio and guarded zero denominator.")
			}
		}
		datasets = append(datasets, d)
	}
	for i := range datasets {
		byID[datasets[i].ID] = &datasets[i]
	}
	submissions, movements := &datasets[0], &datasets[1]
	for _, f := range submissions.Fields {
		if f.ID == "gender_ru" {
			movements.Fields = append(movements.Fields, f)
		}
	}
	warn(movements.ID, "gender_ru", "Added matching Russian gender calculated field for value-compatible semantic filtering; raw gender codes remain separately mapped.")
	submissions.Relationships = []Relationship{{ID: "matching_movements", TargetDatasetID: movements.ID, SourceFieldID: "submission_id", TargetFieldID: "submission_id", Cardinality: "one-to-many", AllowFiltering: true}}
	movements.Relationships = []Relationship{{ID: "respondent", TargetDatasetID: submissions.ID, SourceFieldID: "submission_id", TargetFieldID: "submission_id", Cardinality: "many-to-one", AllowFiltering: true}}
	warn(submissions.ID, "relationships", "Journey filters mean respondents with matching journeys, implemented with EXISTS; respondent totals retain questionnaire grain.")
	charts := []Chart{}
	sourceIDs := map[int]string{}
	for _, c := range doc.Charts {
		sourceIDs[c.SourceChartID] = c.ID
	}
	for _, source := range doc.Charts {
		cfg := source.Config
		d := byID[source.DatasetID]
		c := Chart{Metadata: Metadata{ID: source.ID, Name: source.Name}, DatasetID: source.DatasetID, Type: source.Kind, Query: Query{DatasetID: source.DatasetID, Limit: 10000}}
		used := map[string]bool{}
		read := func(key string) any { used[key] = true; return cfg[key] }
		options := map[string]any{}
		if source.Kind == "matrixHeatmap" {
			if value, ok := read("normalized").(bool); ok {
				options["normalized"] = value
			}
			if value, ok := read("show_percentage").(bool); ok {
				options["showPercentage"] = value
			}
			if value, ok := read("show_values").(bool); ok {
				options["showLabels"] = value
			}
			options["normalize"] = map[string]string{"heatmap": "all", "x": "column", "y": "row"}[str(read("normalize_across"))]
			modes := map[string]string{"alpha_asc": "labelAsc", "alpha_desc": "labelDesc", "value_asc": "sumAsc", "value_desc": "sumDesc"}
			if mode := modes[str(read("sort_x_axis"))]; mode != "" {
				options["xSort"] = mode
			}
			if mode := modes[str(read("sort_y_axis"))]; mode != "" {
				options["ySort"] = mode
			}
		}

		// Export bookkeeping never enters runtime configuration.
		for _, key := range []string{"datasource", "viz_type", "slice_id", "dashboards", "extra_form_data"} {
			used[key] = true
		}
		addMetric := func(value any) error {
			if value == nil {
				return nil
			}
			if id, ok := value.(string); ok {
				c.Query.Metrics = append(c.Query.Metrics, id)
				return nil
			}
			m := object(value)
			column := str(object(m["column"])["column_name"])
			if str(m["aggregate"]) != "COUNT" || !hasField(*d, column) {
				return fmt.Errorf("unsupported ad-hoc metric on %s", source.ID)
			}
			id := "count_" + column
			exists := false
			for _, existing := range d.Metrics {
				exists = exists || existing.ID == id
			}
			if !exists {
				d.Metrics = append(d.Metrics, Metric{ID: id, Name: "COUNT(" + column + ")", Expression: "COUNT(" + quote(column) + ")"})
			}
			c.Query.Metrics = append(c.Query.Metrics, id)
			return nil
		}
		if e := addMetric(read("metric")); e != nil {
			return nil, nil, Dashboard{}, report, e
		}
		for _, m := range list(read("metrics")) {
			if e := addMetric(m); e != nil {
				return nil, nil, Dashboard{}, report, e
			}
		}
		if axis := str(read("x_axis")); axis != "" {
			c.Query.Dimensions = append(c.Query.Dimensions, axis)
		}
		c.Query.Dimensions = append(c.Query.Dimensions, textList(read("groupby"))...)
		if limit := number(read("row_limit")); limit > 0 {
			c.Query.Limit = min(limit, 10000)
			if limit > 10000 {
				warn(c.ID, "row_limit", "Clamped exported row limit to server maximum 10000; truncation is reported.")
			}
		}
		if value, ok := read("show_legend").(bool); ok {
			options["showLegend"] = value
		}
		if value, ok := read("show_labels").(bool); ok {
			options["showLabels"] = value
		}
		if value, ok := read("show_value").(bool); ok {
			options["showLabels"] = value
		}
		options["horizontal"] = str(read("orientation")) == "horizontal"
		options["stacked"] = str(read("stack")) == "Stack"
		if str(read("y_axis_format")) == ",d" {
			options["decimals"] = 0
		} else {
			options["decimals"] = 2
		}
		if palette := str(read("color_scheme")); palette != "" {
			palettes := map[string][]string{"SUPERSET_DEFAULT": {"#1FA8C9", "#454E7C", "#5AC189", "#FF7F44", "#666666", "#E04355"}, "d3Category10": {"#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"}, "d3Category20c": {"#3182bd", "#6baed6", "#9ecae1", "#c6dbef", "#e6550d", "#fd8d3c"}}
			options["colors"] = palettes[palette]
			warn(c.ID, "color_scheme", "Palette approximated; exact Superset category-to-color assignments are not pinned.")
		}
		if palette := str(read("linear_color_scheme")); palette != "" {
			warn(c.ID, "linear_color_scheme", "Native renderer heat scale replaces exported palette "+palette+".")
		}
		if source.Kind == "geoHeatmap" || source.Kind == "geoArc" {
			spatial := object(read("spatial"))
			if source.Kind == "geoArc" {
				spatial = object(read("start_spatial"))
			}
			lon, lat := str(spatial["lonCol"]), str(spatial["latCol"])
			c.Query.Dimensions = []string{lon, lat}
			options["longitudeFieldId"] = lon
			options["latitudeFieldId"] = lat
			if source.Kind == "geoArc" {
				end := object(read("end_spatial"))
				toLon, toLat := str(end["lonCol"]), str(end["latCol"])
				c.Query.Dimensions = append(c.Query.Dimensions, toLon, toLat)
				options["targetLongitudeFieldId"] = toLon
				options["targetLatitudeFieldId"] = toLat
			} else {
				if e := addMetric(read("size")); e != nil {
					return nil, nil, Dashboard{}, report, e
				}
				if len(c.Query.Metrics) > 0 {
					options["weightMetricId"] = c.Query.Metrics[0]
				}
			}
			if radius := number(read("radius_pixels")); radius > 0 {
				options["radius"] = radius
			}
			if yes, _ := read("filter_nulls").(bool); yes {
				for _, field := range c.Query.Dimensions {
					c.Query.Filters = append(c.Query.Filters, Filter{FieldID: field, Operator: "is_not_null"})
				}
			}
		}
		if source.Kind == "compositeMap" {
			for _, id := range list(read("deck_slices")) {
				c.LayerChartIDs = append(c.LayerChartIDs, sourceIDs[number(id)])
			}
			warn(c.ID, "overlay", "Departure/destination layers overlaid; title does not imply subtraction.")
		}
		if source.Kind == "calendarHeatmap" {
			c.Query.TimeFieldID = str(read("granularity_sqla"))
			c.Query.TimeGrain = "day"
			c.Query.Dimensions = []string{c.Query.TimeFieldID}
			read("time_range")
			c.Query.Filters = append(c.Query.Filters, Filter{FieldID: c.Query.TimeFieldID, Operator: "last_months", Values: []any{3}})
			warn(c.ID, "time_range", "Rolling three months resolved in UTC at request time; source Superset timezone was not exported.")
		}
		if grain := str(read("time_grain_sqla")); grain != "" && len(c.Query.Dimensions) > 0 {
			field := c.Query.Dimensions[0]
			for _, f := range d.Fields {
				if f.ID == field && f.Type == "timestamp" {
					c.Query.TimeFieldID = field
					c.Query.TimeGrain = map[string]string{"P1W": "week", "P1D": "day"}[grain]
				}
			}
		}
		for _, entry := range list(read("adhoc_filters")) {
			f := object(entry)
			if str(f["operator"]) == "TEMPORAL_RANGE" {
				value := str(f["comparator"])
				if value == "No filter" {
					continue
				}
				if value == "2022 : " {
					c.Query.Filters = append(c.Query.Filters, Filter{FieldID: str(f["subject"]), Operator: "gte", Values: []any{"2022-01-01"}})
					warn(c.ID, "time_range", "Preserved lower date bound 2022-01-01; weekly bucketing uses UTC source sessions.")
					continue
				}
			}
			return nil, nil, Dashboard{}, report, fmt.Errorf("unsupported source filter in %s", c.ID)
		}
		sortBy := str(read("x_axis_sort"))
		ascending, _ := read("x_axis_sort_asc").(bool)
		if sortBy != "" {
			for _, m := range d.Metrics {
				if m.ID == sortBy || m.Name == sortBy {
					c.Query.Sort = []Sort{{FieldID: m.ID, Desc: !ascending}}
				}
			}
		}
		if sortBy == "sum" {
			if ascending {
				options["xSort"] = "sumAsc"
			} else {
				options["xSort"] = "sumDesc"
			}
		}
		if sortBy != "" && sortBy != "sum" && len(c.Query.Sort) == 0 {
			warn(c.ID, "x_axis_sort", "Export category sort "+sortBy+" is not reproduced; native series ordering applies.")
		}
		if source.Kind == "line" || source.Kind == "calendarHeatmap" {
			c.Query.Sort = []Sort{{FieldID: c.Query.Dimensions[0]}}
		}
		if yes, _ := read("sort_by_metric").(bool); yes && len(c.Query.Metrics) > 0 {
			c.Query.Sort = []Sort{{FieldID: c.Query.Metrics[0], Desc: true}}
		}
		if source.Kind == "matrixHeatmap" {
			c.Query.Sort = []Sort{{FieldID: c.Query.Dimensions[0]}, {FieldID: c.Query.Dimensions[1]}}
		}
		c.Options, _ = json.Marshal(options)
		keys := []string{}
		for key := range cfg {
			if !used[key] {
				keys = append(keys, key)
			}
		}
		sort.Strings(keys)
		for _, key := range keys {
			warn(c.ID, key, "Export setting not migrated; native renderer behavior applies.")
		}
		charts = append(charts, c)
	}
	dashboard := Dashboard{Metadata: Metadata{ID: doc.Dashboard.ID, Name: doc.Dashboard.Name}, RefreshIntervalSeconds: number(doc.Dashboard.Config["refresh_frequency"])}
	nodes := map[string]referenceNode{}
	for key, raw := range doc.Dashboard.Layout {
		var node referenceNode
		if json.Unmarshal(raw, &node) == nil {
			nodes[key] = node
		}
	}
	var place func(string, int, int, int) int
	place = func(id string, x, y, width int) int {
		node := nodes[id]
		switch node.Type {
		case "HEADER":
			dashboard.Widgets = append(dashboard.Widgets, Widget{ID: id, Text: node.Meta.Text, X: x, Y: y, W: width, H: 1})
			return 1
		case "CHART":
			h := max(3, int(math.Ceil(float64(node.Meta.Height)/10)))
			dashboard.Widgets = append(dashboard.Widgets, Widget{ID: id, ChartID: sourceIDs[node.Meta.ChartID], X: x, Y: y, W: width, H: h})
			return h
		case "ROW":
			height, offset := 0, 0
			for _, child := range node.Children {
				w := nodes[child].Meta.Width
				if w < 1 {
					w = width
				}
				w = min(w, width-offset)
				if w < 1 {
					w = 1
				}
				height = max(height, place(child, x+offset, y, w))
				offset += w
			}
			return height
		default:
			height := 0
			for _, child := range node.Children {
				height += place(child, x, y+height, width)
			}
			return height
		}
	}
	place("GRID_ID", 0, 0, 12)
	for _, raw := range list(doc.Dashboard.Config["native_filter_configuration"]) {
		f := object(raw)
		targets := list(f["targets"])
		if len(targets) > 0 {
			target := object(targets[0])
			dashboard.NativeFilters = append(dashboard.NativeFilters, NativeFilter{ID: str(f["id"]), Name: str(f["name"]), DatasetID: str(target["datasetUuid"]), FieldID: str(object(target["column"])["name"])})
		}
	}
	warn(dashboard.ID, "native_filter_configuration.controlValues.creatable", "Public city control accepts typed values because public arbitrary field-options queries are intentionally unavailable.")
	warn(dashboard.ID, "native_filter_scope", "City filter expanded to all compatible widgets; export lists only ten chart IDs despite global scope.")
	warn(dashboard.ID, "layout", "Preserved section/order/12-column widths; exported pixel heights scaled to native grid rows. Header typography is native.")
	for key := range doc.Dashboard.Config {
		if key != "native_filter_configuration" && key != "refresh_frequency" {
			warn(dashboard.ID, key, "Dashboard setting not migrated; native interactive dashboard behavior applies.")
		}
	}
	for _, d := range datasets {
		report.DatasetIDs = append(report.DatasetIDs, d.ID)
	}
	for _, c := range charts {
		report.ChartIDs = append(report.ChartIDs, c.ID)
	}
	report.DashboardID = dashboard.ID
	return datasets, charts, dashboard, report, nil
}
func (s *Store) ImportReference(connectionID string) (ImportReport, error) {
	datasets, charts, dashboard, report, e := buildReference(connectionID)
	if e != nil {
		return report, e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.clone()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	save := func(kind string, value any) {
		raw, _ := json.Marshal(value)
		var incoming map[string]json.RawMessage
		_ = json.Unmarshal(raw, &incoming)
		var meta Metadata
		_ = json.Unmarshal(raw, &meta)
		old, exists := next[kind][meta.ID]
		revision := 1
		if exists {
			var previous Metadata
			_ = json.Unmarshal(old, &previous)
			revision = previous.Revision + 1
			var clean map[string]json.RawMessage
			_ = json.Unmarshal(old, &clean)
			delete(clean, "revision")
			delete(clean, "updatedAt")
			delete(incoming, "revision")
			delete(incoming, "updatedAt")
			a, _ := json.Marshal(clean)
			b, _ := json.Marshal(incoming)
			if bytes.Equal(a, b) {
				report.Unchanged++
				return
			}
			report.Updated++
		} else {
			report.Created++
		}
		incoming["revision"], _ = json.Marshal(revision)
		incoming["updatedAt"], _ = json.Marshal(now)
		next[kind][meta.ID], _ = json.Marshal(incoming)
	}
	for _, d := range datasets {
		save("datasets", d)
	}
	for _, c := range charts {
		save("charts", c)
	}
	save("dashboards", dashboard)
	if e = validateState(next); e != nil {
		return report, e
	}
	lookup := func(id string) (Dataset, error) {
		var d Dataset
		raw, ok := next["datasets"][id]
		if !ok {
			return d, ErrNotFound
		}
		e := json.Unmarshal(raw, &d)
		return d, e
	}
	for _, c := range charts {
		if c.Type != "compositeMap" {
			if _, e = CompileQuery(c.Query, lookup); e != nil {
				return report, e
			}
		}
	}
	if report.Created+report.Updated > 0 {
		if e = s.persist(next); e != nil {
			return report, e
		}
		s.objects = next
	}
	return report, nil
}

type ConnectionRegistry interface {
	ListRegisteredConnections() *postgres.ListRegisteredConnectionsResult
}

func RegisterImportRoutes(h *Handler, registry ConnectionRegistry) {
	h.Mux.HandleFunc("POST /api/v1/analytics/import-reference", noStore(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ConnectionID string `json:"connectionId"`
		}
		if e := decodePublicationRequest(w, r, &req); e != nil {
			writeError(w, e)
			return
		}
		found := false
		for _, c := range registry.ListRegisteredConnections().Connections {
			found = found || c.ID == req.ConnectionID
		}
		if !found {
			writeError(w, ErrInvalid)
			return
		}
		report, e := h.Store.ImportReference(req.ConnectionID)
		if e != nil {
			writeError(w, fmt.Errorf("%w: import validation failed", ErrInvalid))
			return
		}
		writeJSON(w, 200, report)
	}))
}
