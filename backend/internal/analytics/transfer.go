package analytics

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

const dashboardBundleFormat = "geopanel-dashboard"
const dashboardBundleVersion = 1

// DashboardBundle is a portable dashboard plus every analytics definition it depends on.
type DashboardBundle struct {
	Format     string    `json:"format"`
	Version    int       `json:"version"`
	ExportedAt string    `json:"exportedAt"`
	Dashboard  Dashboard `json:"dashboard"`
	Charts     []Chart   `json:"charts"`
	Datasets   []Dataset `json:"datasets"`
}

type DashboardImportReport struct {
	DashboardID string   `json:"dashboardId"`
	DatasetIDs  []string `json:"datasetIds"`
	ChartIDs    []string `json:"chartIds"`
	Created     int      `json:"created"`
	Updated     int      `json:"updated"`
}

func filterDatasetIDs(filters []Filter, add func(string) error) error {
	for _, filter := range filters {
		if filter.DatasetID != "" {
			if err := add(filter.DatasetID); err != nil {
				return err
			}
		}
		for _, group := range filter.AnyOf {
			if err := filterDatasetIDs(group, add); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) ExportDashboard(id string) (DashboardBundle, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	bundle := DashboardBundle{Format: dashboardBundleFormat, Version: dashboardBundleVersion, ExportedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	raw, ok := s.objects["dashboards"][id]
	if !ok {
		return bundle, ErrNotFound
	}
	if err := json.Unmarshal(raw, &bundle.Dashboard); err != nil {
		return bundle, err
	}
	datasets := map[string]Dataset{}
	charts := map[string]Chart{}
	var addDataset func(string) error
	addDataset = func(datasetID string) error {
		if _, found := datasets[datasetID]; found {
			return nil
		}
		raw, found := s.objects["datasets"][datasetID]
		if !found {
			return ErrNotFound
		}
		var dataset Dataset
		if err := json.Unmarshal(raw, &dataset); err != nil {
			return err
		}
		datasets[datasetID] = dataset
		for _, relationship := range dataset.Relationships {
			if err := addDataset(relationship.TargetDatasetID); err != nil {
				return err
			}
		}
		return nil
	}
	var addChart func(string) error
	addChart = func(chartID string) error {
		if _, found := charts[chartID]; found {
			return nil
		}
		raw, found := s.objects["charts"][chartID]
		if !found {
			return ErrNotFound
		}
		var chart Chart
		if err := json.Unmarshal(raw, &chart); err != nil {
			return err
		}
		charts[chartID] = chart
		if err := addDataset(chart.DatasetID); err != nil {
			return err
		}
		if err := filterDatasetIDs(chart.Query.Filters, addDataset); err != nil {
			return err
		}
		for _, layerID := range chart.LayerChartIDs {
			if err := addChart(layerID); err != nil {
				return err
			}
		}
		return nil
	}
	for _, widget := range bundle.Dashboard.Widgets {
		if widget.ChartID != "" {
			if err := addChart(widget.ChartID); err != nil {
				return bundle, err
			}
		}
	}
	for _, filter := range bundle.Dashboard.NativeFilters {
		if err := addDataset(filter.DatasetID); err != nil {
			return bundle, err
		}
	}
	if err := filterDatasetIDs(bundle.Dashboard.Filters, addDataset); err != nil {
		return bundle, err
	}
	for _, dataset := range datasets {
		bundle.Datasets = append(bundle.Datasets, dataset)
	}
	for _, chart := range charts {
		bundle.Charts = append(bundle.Charts, chart)
	}
	sort.Slice(bundle.Datasets, func(i, j int) bool { return bundle.Datasets[i].ID < bundle.Datasets[j].ID })
	sort.Slice(bundle.Charts, func(i, j int) bool { return bundle.Charts[i].ID < bundle.Charts[j].ID })
	return bundle, nil
}

func bundleState(bundle DashboardBundle, connectionMapping map[string]string) (map[string]map[string]json.RawMessage, error) {
	if bundle.Format != dashboardBundleFormat || bundle.Version != dashboardBundleVersion {
		return nil, fmt.Errorf("%w: unsupported dashboard bundle", ErrInvalid)
	}
	state := map[string]map[string]json.RawMessage{"datasets": {}, "charts": {}, "dashboards": {}}
	put := func(kind, id, name string, value any) error {
		if !objectID.MatchString(id) || name == "" {
			return fmt.Errorf("%w: invalid object metadata", ErrInvalid)
		}
		if _, exists := state[kind][id]; exists {
			return fmt.Errorf("%w: duplicate object id", ErrInvalid)
		}
		raw, err := json.Marshal(value)
		if err != nil {
			return err
		}
		state[kind][id] = raw
		return nil
	}
	for _, dataset := range bundle.Datasets {
		target := connectionMapping[dataset.ConnectionID]
		if target == "" {
			return nil, fmt.Errorf("%w: missing connection mapping for %s", ErrInvalid, dataset.ConnectionID)
		}
		dataset.ConnectionID = target
		dataset.Revision = 1
		dataset.UpdatedAt = ""
		if err := put("datasets", dataset.ID, dataset.Name, dataset); err != nil {
			return nil, err
		}
	}
	for _, chart := range bundle.Charts {
		chart.Revision = 1
		chart.UpdatedAt = ""
		if err := put("charts", chart.ID, chart.Name, chart); err != nil {
			return nil, err
		}
	}
	bundle.Dashboard.Revision = 1
	bundle.Dashboard.UpdatedAt = ""
	if err := put("dashboards", bundle.Dashboard.ID, bundle.Dashboard.Name, bundle.Dashboard); err != nil {
		return nil, err
	}
	if err := validateState(state); err != nil {
		return nil, err
	}
	return state, nil
}

func (s *Store) ImportDashboard(bundle DashboardBundle, connectionMapping map[string]string, replace bool) (DashboardImportReport, error) {
	report := DashboardImportReport{DashboardID: bundle.Dashboard.ID}
	imported, err := bundleState(bundle, connectionMapping)
	if err != nil {
		return report, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !replace {
		for _, kind := range []string{"datasets", "charts", "dashboards"} {
			for id := range imported[kind] {
				if _, exists := s.objects[kind][id]; exists {
					return report, fmt.Errorf("%w: %s/%s already exists", ErrConflict, kind, id)
				}
			}
		}
	}
	next := s.clone()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, kind := range []string{"datasets", "charts", "dashboards"} {
		ids := make([]string, 0, len(imported[kind]))
		for id := range imported[kind] {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			revision := 1
			if old, exists := next[kind][id]; exists {
				var metadata Metadata
				_ = json.Unmarshal(old, &metadata)
				revision = metadata.Revision + 1
				report.Updated++
			} else {
				report.Created++
			}
			var fields map[string]json.RawMessage
			_ = json.Unmarshal(imported[kind][id], &fields)
			fields["revision"], _ = json.Marshal(revision)
			fields["updatedAt"], _ = json.Marshal(now)
			next[kind][id], _ = json.Marshal(fields)
			if kind == "datasets" {
				report.DatasetIDs = append(report.DatasetIDs, id)
			} else if kind == "charts" {
				report.ChartIDs = append(report.ChartIDs, id)
			}
		}
	}
	if err := validateState(next); err != nil {
		return DashboardImportReport{DashboardID: bundle.Dashboard.ID}, err
	}
	if err := s.persist(next); err != nil {
		return DashboardImportReport{DashboardID: bundle.Dashboard.ID}, err
	}
	s.objects = next
	return report, nil
}
