package analytics

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"
)

var ErrNotFound = errors.New("object not found")
var ErrConflict = errors.New("revision conflict")
var ErrInvalid = errors.New("invalid definition")
var objectID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`)

type Store struct {
	mu      sync.RWMutex
	path    string
	objects map[string]map[string]json.RawMessage
}

func OpenStore(path string) (*Store, error) {
	s := &Store{path: path, objects: map[string]map[string]json.RawMessage{"datasets": {}, "charts": {}, "dashboards": {}}}
	b, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		if err = json.Unmarshal(b, &s.objects); err != nil {
			return nil, fmt.Errorf("read analytics metadata: %w", err)
		}
		for _, kind := range []string{"datasets", "charts", "dashboards"} {
			if s.objects == nil {
				return nil, fmt.Errorf("%w: null metadata", ErrInvalid)
			}
			if s.objects[kind] == nil {
				s.objects[kind] = map[string]json.RawMessage{}
			}
		}
		if err = validateState(s.objects); err != nil {
			return nil, err
		}
	}
	return s, nil
}
func validKind(kind string) bool {
	return kind == "datasets" || kind == "charts" || kind == "dashboards"
}
func (s *Store) Get(kind, id string) (json.RawMessage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	b, ok := s.objects[kind][id]
	if !ok {
		return nil, ErrNotFound
	}
	return append(json.RawMessage(nil), b...), nil
}
func (s *Store) List(kind string) []json.RawMessage {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := []json.RawMessage{}
	ids := []string{}
	for id := range s.objects[kind] {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		result = append(result, append(json.RawMessage(nil), s.objects[kind][id]...))
	}
	return result
}
func (s *Store) Dataset(id string) (Dataset, error) {
	var v Dataset
	b, e := s.Get("datasets", id)
	if e == nil {
		e = json.Unmarshal(b, &v)
	}
	return v, e
}
func (s *Store) Chart(id string) (Chart, error) {
	var v Chart
	b, e := s.Get("charts", id)
	if e == nil {
		e = json.Unmarshal(b, &v)
	}
	return v, e
}
func (s *Store) Dashboard(id string) (Dashboard, error) {
	var v Dashboard
	b, e := s.Get("dashboards", id)
	if e == nil {
		e = json.Unmarshal(b, &v)
	}
	return v, e
}
func (s *Store) Save(kind string, raw json.RawMessage, create bool) (json.RawMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !validKind(kind) {
		return nil, ErrNotFound
	}
	var err error
	raw, err = canonical(kind, raw)
	if err != nil {
		return nil, err
	}
	var meta Metadata
	if json.Unmarshal(raw, &meta) != nil || !objectID.MatchString(meta.ID) || meta.Name == "" {
		return nil, fmt.Errorf("%w: id and name required", ErrInvalid)
	}
	old, exists := s.objects[kind][meta.ID]
	var previous Metadata
	if exists {
		_ = json.Unmarshal(old, &previous)
	}
	if create && exists || !create && (!exists || meta.Revision != previous.Revision) || create && meta.Revision != 0 {
		return nil, ErrConflict
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return nil, ErrInvalid
	}
	fields["revision"], _ = json.Marshal(previous.Revision + 1)
	fields["updatedAt"], _ = json.Marshal(time.Now().UTC().Format(time.RFC3339Nano))
	raw, _ = json.Marshal(fields)
	next := s.clone()
	next[kind][meta.ID] = raw
	if err := validateState(next); err != nil {
		return nil, err
	}
	if err := s.persist(next); err != nil {
		return nil, err
	}
	s.objects = next
	return append(json.RawMessage(nil), raw...), nil
}
func (s *Store) Delete(kind, id string, revision int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, ok := s.objects[kind][id]
	if !ok {
		return ErrNotFound
	}
	var m Metadata
	_ = json.Unmarshal(raw, &m)
	if m.Revision != revision {
		return ErrConflict
	}
	next := s.clone()
	delete(next[kind], id)
	if err := validateState(next); err != nil {
		return err
	}
	if err := s.persist(next); err != nil {
		return err
	}
	s.objects = next
	return nil
}
func (s *Store) clone() map[string]map[string]json.RawMessage {
	next := map[string]map[string]json.RawMessage{}
	for k, items := range s.objects {
		next[k] = map[string]json.RawMessage{}
		for id, b := range items {
			next[k][id] = b
		}
	}
	return next
}
func (s *Store) persist(next map[string]map[string]json.RawMessage) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	b, e := json.MarshalIndent(next, "", "  ")
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(s.path), ".analytics-*")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if _, e = f.Write(b); e != nil {
		f.Close()
		return e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	return os.Rename(f.Name(), s.path)
}
func validateState(state map[string]map[string]json.RawMessage) error {
	invalid := func(msg string) error { return fmt.Errorf("%w: %s", ErrInvalid, msg) }
	datasets := map[string]Dataset{}
	for id, b := range state["datasets"] {
		var d Dataset
		if json.Unmarshal(b, &d) != nil {
			return invalid("malformed dataset")
		}
		if d.ConnectionID == "" || (d.SQL == "") == (d.Table == "") || d.Table != "" && d.Schema == "" {
			return invalid("dataset needs connectionId and either SQL or schema/table")
		}
		ids := map[string]bool{}
		for _, f := range d.Fields {
			if !objectID.MatchString(f.ID) || f.Name == "" || ids[f.ID] {
				return invalid("invalid or duplicate field")
			}
			ids[f.ID] = true
		}
		for _, m := range d.Metrics {
			if !objectID.MatchString(m.ID) || m.Expression == "" || ids[m.ID] {
				return invalid("invalid or duplicate metric")
			}
			ids[m.ID] = true
		}
		if d.DefaultTimeFieldID != "" && !hasField(d, d.DefaultTimeFieldID) {
			return invalid("unknown default date field")
		}
		datasets[id] = d
	}
	for _, d := range datasets {
		for _, r := range d.Relationships {
			target, ok := datasets[r.TargetDatasetID]
			if !ok || !hasField(d, r.SourceFieldID) || !hasField(target, r.TargetFieldID) {
				return invalid("relationship references unknown dataset/field")
			}
		}
	}
	for _, b := range state["charts"] {
		var c Chart
		if json.Unmarshal(b, &c) != nil {
			return invalid("malformed chart")
		}
		d, ok := datasets[c.DatasetID]
		if !ok {
			return invalid("chart references unknown dataset")
		}
		if c.Query.DatasetID != "" && c.Query.DatasetID != c.DatasetID {
			return invalid("chart query dataset mismatch")
		}
		for _, id := range c.Query.Dimensions {
			if !hasField(d, id) {
				return invalid("chart references unknown field")
			}
		}
		for _, id := range c.Query.Metrics {
			found := false
			for _, m := range d.Metrics {
				found = found || m.ID == id
			}
			if !found {
				return invalid("chart references unknown metric")
			}
		}
		if c.Query.TimeFieldID != "" && !hasField(d, c.Query.TimeFieldID) {
			return invalid("chart references unknown date field")
		}
		for _, f := range c.Query.Filters {
			if err := validateFilterReferences(f, &d, datasets); err != nil {
				return err
			}
		}

		for _, filter := range c.Query.Having {
			found := false
			for _, id := range c.Query.Metrics {
				found = found || filter.FieldID == id
			}
			if !found {
				return invalid("HAVING references unselected metric")
			}
		}
		for _, id := range c.LayerChartIDs {
			if _, ok := state["charts"][id]; !ok || id == c.ID {
				return invalid("invalid layer chart reference")
			}
		}
	}
	colors := map[string]int{}
	var visitChart func(string) error
	visitChart = func(id string) error {
		if colors[id] == 1 {
			return invalid("composite chart dependency cycle")
		}
		if colors[id] == 2 {
			return nil
		}
		colors[id] = 1
		var c Chart
		_ = json.Unmarshal(state["charts"][id], &c)
		for _, layer := range c.LayerChartIDs {
			if err := visitChart(layer); err != nil {
				return err
			}
		}
		colors[id] = 2
		return nil
	}
	for id := range state["charts"] {
		if err := visitChart(id); err != nil {
			return err
		}
	}
	for _, b := range state["dashboards"] {
		var d Dashboard
		if json.Unmarshal(b, &d) != nil {
			return invalid("malformed dashboard")
		}

		if d.RefreshIntervalSeconds < 0 || d.RefreshIntervalSeconds > 0 && d.RefreshIntervalSeconds < 30 {
			return invalid("refresh interval must be zero or at least 30 seconds")
		}
		for _, filter := range d.Filters {
			if err := validateFilterReferences(filter, nil, datasets); err != nil {
				return err
			}
		}
		filterIDs := map[string]bool{}
		for _, filter := range d.NativeFilters {
			dataset, ok := datasets[filter.DatasetID]
			if !ok || !hasField(dataset, filter.FieldID) || filter.ID == "" || filterIDs[filter.ID] {
				return invalid("invalid native filter reference")
			}
			filterIDs[filter.ID] = true
		}
		ids := map[string]bool{}
		for _, w := range d.Widgets {
			if w.ID == "" || ids[w.ID] || w.W < 1 || w.H < 1 || w.X < 0 || w.Y < 0 {
				return invalid("invalid widget id or layout")
			}
			ids[w.ID] = true
			if w.ChartID != "" {
				if _, ok := state["charts"][w.ChartID]; !ok {
					return invalid("widget references unknown chart")
				}
			}
		}
		for _, f := range d.NativeFilters {
			for _, id := range f.TargetWidgetIDs {
				if !ids[id] {
					return invalid("native filter targets unknown widget")
				}
			}
		}
		for _, w := range d.Widgets {
			for _, id := range w.FilterTargetWidgetIDs {
				if !ids[id] {
					return invalid("chart filter targets unknown widget")
				}
			}
		}
		for _, f := range d.Filters {
			for _, id := range f.TargetWidgetIDs {
				if !ids[id] {
					return invalid("filter targets unknown widget")
				}
			}
		}
	}
	return nil
}
func hasField(d Dataset, id string) bool {
	for _, f := range d.Fields {
		if f.ID == id {
			return true
		}
	}
	return false
}

// Tuple selections preserve dependencies of every field, including inherited datasets.
func validateFilterReferences(f Filter, fallback *Dataset, datasets map[string]Dataset) error {
	target := fallback
	if f.DatasetID != "" {
		d, ok := datasets[f.DatasetID]
		if !ok {
			return fmt.Errorf("%w: filter references unknown dataset", ErrInvalid)
		}
		target = &d
	}
	if len(f.AnyOf) > 0 {
		for _, group := range f.AnyOf {
			for _, child := range group {
				if err := validateFilterReferences(child, target, datasets); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if target != nil && !hasField(*target, f.FieldID) {
		return fmt.Errorf("%w: filter references unknown field", ErrInvalid)
	}
	return nil
}
