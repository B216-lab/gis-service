package analytics

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"
)

// storedShare keeps the hash durable without ever exposing it through Share JSON.
type storedShare struct {
	Share
	Hash string `json:"tokenHash"`
}

func randomID() (string, error) {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		return "", e
	}
	return hex.EncodeToString(b), nil
}
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func (s *Store) Publish(id string, revision int) (Publication, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var p Publication
	raw, ok := s.objects["dashboards"][id]
	if !ok {
		return p, ErrNotFound
	}
	if e := json.Unmarshal(raw, &p.Dashboard); e != nil {
		return p, e
	}
	if p.Dashboard.Revision != revision {
		return p, ErrConflict
	}
	charts := map[string]Chart{}
	datasets := map[string]Dataset{}
	var addDataset func(string) error
	addDataset = func(id string) error {
		if _, ok := datasets[id]; ok {
			return nil
		}
		b, ok := s.objects["datasets"][id]
		if !ok {
			return ErrNotFound
		}
		var d Dataset
		if e := json.Unmarshal(b, &d); e != nil {
			return e
		}
		datasets[id] = d
		for _, r := range d.Relationships {
			if e := addDataset(r.TargetDatasetID); e != nil {
				return e
			}
		}
		return nil
	}
	var addChart func(string) error
	addChart = func(id string) error {
		if _, ok := charts[id]; ok {
			return nil
		}
		b, ok := s.objects["charts"][id]
		if !ok {
			return ErrNotFound
		}
		var c Chart
		if e := json.Unmarshal(b, &c); e != nil {
			return e
		}
		charts[id] = c
		if e := addDataset(c.DatasetID); e != nil {
			return e
		}
		for _, id := range c.LayerChartIDs {
			if e := addChart(id); e != nil {
				return e
			}
		}
		return nil
	}
	for _, filter := range p.Dashboard.NativeFilters {
		if e := addDataset(filter.DatasetID); e != nil {
			return p, e
		}
	}
	for _, w := range p.Dashboard.Widgets {
		if w.ChartID != "" {
			if e := addChart(w.ChartID); e != nil {
				return p, e
			}
		}
	}
	for _, d := range datasets {
		p.Datasets = append(p.Datasets, d)
	}
	for _, c := range charts {
		p.Charts = append(p.Charts, c)
	}
	sort.Slice(p.Datasets, func(i, j int) bool { return p.Datasets[i].ID < p.Datasets[j].ID })
	sort.Slice(p.Charts, func(i, j int) bool { return p.Charts[i].ID < p.Charts[j].ID })
	pid, e := randomID()
	if e != nil {
		return p, e
	}
	p.Metadata = Metadata{ID: pid, Name: p.Dashboard.Name, Revision: 1, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	// Compile every pinned query before publication; no executable broken snapshot.
	for _, c := range p.Charts {
		if c.Type == "compositeMap" {
			continue
		}
		q := c.Query
		q.DatasetID = c.DatasetID
		if _, e := CompileQuery(q, p.Dataset); e != nil {
			return p, fmt.Errorf("%w: chart %s: %s", ErrInvalid, c.ID, e)
		}
	}
	if e := p.validateFilters(nil); e != nil {
		return p, e
	}
	next := s.clone()
	if next["publications"] == nil {
		next["publications"] = map[string]json.RawMessage{}
	}
	next["publications"][pid], _ = json.Marshal(p)
	if e = s.persist(next); e != nil {
		return p, e
	}
	s.objects = next
	return p, nil
}
func (p Publication) Dataset(id string) (Dataset, error) {
	for _, d := range p.Datasets {
		if d.ID == id {
			return d, nil
		}
	}
	return Dataset{}, ErrNotFound
}
func (s *Store) Publication(id string) (Publication, error) {
	var p Publication
	b, e := s.Get("publications", id)
	if e == nil {
		e = json.Unmarshal(b, &p)
	}
	return p, e
}
func (s *Store) CreateShare(publicationID, expiresAt string, filters []Filter) (Share, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var share Share
	raw, ok := s.objects["publications"][publicationID]
	if !ok {
		return share, "", ErrNotFound
	}
	if expiresAt != "" {
		expiry, e := time.Parse(time.RFC3339, expiresAt)
		if e != nil || !expiry.After(time.Now()) {
			return share, "", fmt.Errorf("%w: expiry must be a future RFC3339 timestamp", ErrInvalid)
		}
	}
	var p Publication
	if e := json.Unmarshal(raw, &p); e != nil {
		return share, "", e
	}
	if e := p.validateFilters(filters); e != nil {
		return share, "", e
	}
	token, e := randomID()
	if e != nil {
		return share, "", e
	}
	id, e := randomID()
	if e != nil {
		return share, "", e
	}
	share = Share{Metadata: Metadata{ID: id, Name: p.Name, Revision: 1, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}, PublicationID: publicationID, ExpiresAt: expiresAt, Filters: filters}
	next := s.clone()
	if next["shares"] == nil {
		next["shares"] = map[string]json.RawMessage{}
	}
	next["shares"][id], _ = json.Marshal(storedShare{Share: share, Hash: hashToken(token)})
	if e = s.persist(next); e != nil {
		return Share{}, "", e
	}
	s.objects = next
	return share, token, nil
}
func (s *Store) ResolveShare(token string) (Share, Publication, error) {
	var empty Share
	if len(token) != 64 {
		return empty, Publication{}, ErrNotFound
	}
	digest := hashToken(token)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, raw := range s.objects["shares"] {
		var saved storedShare
		if json.Unmarshal(raw, &saved) != nil {
			continue
		}
		if saved.Hash != digest || saved.Revoked {
			continue
		}
		if saved.ExpiresAt != "" {
			expiry, e := time.Parse(time.RFC3339, saved.ExpiresAt)
			if e != nil || !expiry.After(time.Now()) {
				return empty, Publication{}, ErrNotFound
			}
		}
		var p Publication
		if e := json.Unmarshal(s.objects["publications"][saved.PublicationID], &p); e != nil {
			return empty, p, ErrNotFound
		}
		return saved.Share, p, nil
	}
	return empty, Publication{}, ErrNotFound
}
func (s *Store) RevokeShare(id string, revision int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, ok := s.objects["shares"][id]
	if !ok {
		return ErrNotFound
	}
	var saved storedShare
	if e := json.Unmarshal(raw, &saved); e != nil {
		return e
	}
	if saved.Revision != revision {
		return ErrConflict
	}
	saved.Revoked = true
	saved.Revision++
	saved.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	next := s.clone()
	next["shares"][id], _ = json.Marshal(saved)
	if e := s.persist(next); e != nil {
		return e
	}
	s.objects = next
	return nil
}

// Viewer metadata intentionally excludes source connection/table/SQL and expressions.
func (p Publication) Viewer() map[string]any {
	datasets := []map[string]any{}
	for _, d := range p.Datasets {
		fields := []map[string]any{}
		for _, f := range d.Fields {
			fields = append(fields, map[string]any{"id": f.ID, "name": f.Name, "label": f.Label, "type": f.Type, "semanticId": f.SemanticID, "role": f.Role, "format": f.Format})
		}
		metrics := []map[string]any{}
		for _, m := range d.Metrics {
			metrics = append(metrics, map[string]any{"id": m.ID, "name": m.Name, "format": m.Format})
		}
		datasets = append(datasets, map[string]any{"id": d.ID, "name": d.Name, "fields": fields, "metrics": metrics, "relationships": d.Relationships, "defaultTimeFieldId": d.DefaultTimeFieldID})
	}
	return map[string]any{"id": p.ID, "name": p.Name, "revision": p.Revision, "dashboard": p.Dashboard, "charts": p.Charts, "datasets": datasets}
}
func (p Publication) query(chartID, widgetID string, locked, additional []Filter) (Query, error) {
	var chart Chart
	found := false
	for _, c := range p.Charts {
		if c.ID == chartID {
			chart = c
			found = true
			break
		}
	}
	if !found {
		return Query{}, ErrNotFound
	}
	if widgetID != "" {
		valid := false
		var contains func(string, map[string]bool) bool
		contains = func(id string, seen map[string]bool) bool {
			if id == chartID {
				return true
			}
			if seen[id] {
				return false
			}
			seen[id] = true
			for _, c := range p.Charts {
				if c.ID == id {
					for _, layer := range c.LayerChartIDs {
						if contains(layer, seen) {
							return true
						}
					}
				}
			}
			return false
		}
		for _, w := range p.Dashboard.Widgets {
			if w.ID == widgetID && contains(w.ChartID, map[string]bool{}) {
				valid = true
			}
		}
		if !valid {
			return Query{}, ErrNotFound
		}
	}
	q := chart.Query
	q.DatasetID = chart.DatasetID
	q.Filters = append([]Filter(nil), chart.Query.Filters...)
	// Locked filters always apply; callers cannot remove them or change their scope.
	for groupIndex, group := range [][]Filter{p.Dashboard.Filters, locked, additional} {
		for _, f := range group {
			if groupIndex == 2 && widgetID != "" && f.SourceWidgetID == widgetID {
				continue
			}
			if len(f.TargetWidgetIDs) > 0 {
				if widgetID == "" {
					return Query{}, fmt.Errorf("%w: widgetId required for scoped filters", ErrInvalid)
				}
				applies := false
				for _, id := range f.TargetWidgetIDs {
					applies = applies || id == widgetID
				}
				if !applies {
					continue
				}
			}
			mapped, compatible, err := p.mapFilter(f, chart.DatasetID)
			if err != nil {
				return Query{}, err
			}
			if !compatible {
				if groupIndex != 1 && len(f.TargetWidgetIDs) == 0 {
					continue
				}
				return Query{}, fmt.Errorf("%w: incompatible scoped filter", ErrInvalid)
			}
			q.Filters = append(q.Filters, mapped)
		}
	}
	if _, e := CompileQuery(q, p.Dataset); e != nil {
		return Query{}, fmt.Errorf("%w: incompatible publication filter", ErrInvalid)
	}
	return q, nil
}

// mapFilter prefers declared semantic equivalence, then an allowed relationship.
func (p Publication) mapFilter(f Filter, targetID string) (Filter, bool, error) {
	target, e := p.Dataset(targetID)
	if e != nil {
		return f, false, e
	}
	sourceID := f.DatasetID
	if sourceID == "" {
		sourceID = targetID
	}
	source, e := p.Dataset(sourceID)
	if e != nil {
		return f, false, ErrInvalid
	}
	if len(f.AnyOf) > 0 {
		mapped := make([][]Filter, len(f.AnyOf))
		mappedID := ""
		for i, group := range f.AnyOf {
			for _, child := range group {
				if child.DatasetID == "" {
					child.DatasetID = sourceID
				}
				m, ok, e := p.mapFilter(child, targetID)
				if e != nil || !ok {
					return f, ok, e
				}
				if mappedID != "" && mappedID != m.DatasetID {
					return f, false, nil
				}
				mappedID = m.DatasetID
				mapped[i] = append(mapped[i], m)
			}
		}
		f.AnyOf = mapped
		f.DatasetID = mappedID
		return f, true, nil
	}
	var original Field
	found := false
	for _, field := range source.Fields {
		if field.ID == f.FieldID {
			original = field
			found = true
			break
		}
	}
	if !found {
		return f, false, ErrInvalid
	}
	if sourceID == targetID {
		f.DatasetID = targetID
		return f, true, nil
	}
	if original.SemanticID != "" {
		for _, field := range target.Fields {
			if field.SemanticID == original.SemanticID {
				f.FieldID = field.ID
				f.DatasetID = targetID
				return f, true, nil
			}
		}
	}
	for _, relation := range target.Relationships {
		if relation.TargetDatasetID == sourceID && relation.AllowFiltering {
			f.DatasetID = sourceID
			return f, true, nil
		}
	}
	return f, false, nil
}

func (p Publication) validateFilters(locked []Filter) error {
	for _, group := range [][]Filter{p.Dashboard.Filters, locked} {
		for _, f := range group {
			for _, target := range f.TargetWidgetIDs {
				found := false
				for _, w := range p.Dashboard.Widgets {
					found = found || w.ID == target
				}
				if !found {
					return fmt.Errorf("%w: unknown filter widget", ErrInvalid)
				}
			}
		}
	}
	for _, w := range p.Dashboard.Widgets {
		if w.ChartID == "" {
			continue
		}
		for _, c := range p.Charts {
			if c.Type == "compositeMap" {
				continue
			}
			if _, e := p.query(c.ID, w.ID, locked, nil); e != nil && !errors.Is(e, ErrNotFound) {
				return e
			}
		}
	}
	return nil
}
