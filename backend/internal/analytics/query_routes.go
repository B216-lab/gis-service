package analytics

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"geopanel/backend/internal/postgres"
)

type QueryExecutor interface {
	ExecuteAnalytics(context.Context, string, string, []any, int) ([]map[string]any, []postgres.ColumnMeta, bool, error)
}
type QueryResult struct {
	Rows      []map[string]any      `json:"rows"`
	Columns   []postgres.ColumnMeta `json:"columns"`
	Truncated bool                  `json:"truncated"`
	Limit     int                   `json:"limit"`
}
type QueryService struct {
	executor QueryExecutor
	slots    chan struct{}
	cache    *queryCache
}

func NewQueryService(executor QueryExecutor) *QueryService {
	return &QueryService{executor: executor, slots: make(chan struct{}, 4), cache: newQueryCache()}
}
func (s *QueryService) Execute(ctx context.Context, q Query, lookup DatasetLookup) (QueryResult, error) {
	return s.ExecuteScoped(ctx, q, lookup, "editor")
}
func (s *QueryService) execute(ctx context.Context, c CompiledQuery) (QueryResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		return QueryResult{}, ctx.Err()
	}
	rows, columns, truncated, e := s.executor.ExecuteAnalytics(ctx, c.ConnectionID, c.SQL, c.Args, c.Limit)
	return QueryResult{Rows: rows, Columns: columns, Truncated: truncated, Limit: c.Limit}, e
}

// RegisterQueryRoutes returns the same bounded executor for pinned publication queries.
func RegisterQueryRoutes(h *Handler, store *Store, executor QueryExecutor) *QueryService {
	service := NewQueryService(executor)
	decode := func(w http.ResponseWriter, r *http.Request, v any) error {
		r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(v); err != nil {
			return fmt.Errorf("invalid query request")
		}
		return nil
	}
	reply := func(w http.ResponseWriter, result QueryResult, err error) {
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": "ANALYTICS_QUERY", "message": "Query failed. Check dataset fields, SQL, filters, and source access."}})
			return
		}
		json.NewEncoder(w).Encode(result)
	}
	h.Mux.HandleFunc("POST /api/v1/analytics/query", noStore(func(w http.ResponseWriter, r *http.Request) {
		var q Query
		if e := decode(w, r, &q); e != nil {
			reply(w, QueryResult{}, e)
			return
		}
		result, e := service.ExecuteScopedFresh(r.Context(), q, store.Dataset, "editor", requestNoCache(r))
		reply(w, result, e)
	}))
	h.Mux.HandleFunc("POST /api/v1/analytics/preview", noStore(func(w http.ResponseWriter, r *http.Request) {
		var d Dataset
		if e := decode(w, r, &d); e != nil {
			reply(w, QueryResult{}, e)
			return
		}
		sql, e := datasetRelation(d)
		if e != nil {
			reply(w, QueryResult{}, e)
			return
		}
		result, e := service.execute(r.Context(), CompiledQuery{SQL: "SELECT * FROM " + sql + " AS __preview LIMIT 101", ConnectionID: d.ConnectionID, Limit: 100})
		reply(w, result, e)
	}))
	h.Mux.HandleFunc("POST /api/v1/analytics/filter-options", noStore(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			DatasetID string   `json:"datasetId"`
			FieldID   string   `json:"fieldId"`
			Search    string   `json:"search"`
			Filters   []Filter `json:"filters"`
			Limit     int      `json:"limit"`
		}
		if e := decode(w, r, &req); e != nil {
			reply(w, QueryResult{}, e)
			return
		}
		if req.Limit <= 0 || req.Limit > 200 {
			req.Limit = 100
		}
		q := Query{DatasetID: req.DatasetID, Dimensions: []string{req.FieldID}, Filters: req.Filters, Limit: req.Limit, Sort: []Sort{{FieldID: req.FieldID}}}
		if req.Search != "" {
			q.Filters = append(q.Filters, Filter{FieldID: req.FieldID, Operator: "contains", Values: []any{req.Search}})
		}
		c, e := CompileQuery(q, store.Dataset)
		if e != nil {
			reply(w, QueryResult{}, e)
			return
		}
		c.SQL = "SELECT DISTINCT" + c.SQL[len("SELECT"):]
		result, e := service.execute(r.Context(), c)
		reply(w, result, e)
	}))
	return service
}

func requestNoCache(r *http.Request) bool {
	for _, directive := range strings.Split(r.Header.Get("Cache-Control"), ",") {
		if strings.EqualFold(strings.TrimSpace(directive), "no-cache") {
			return true
		}
	}
	return false
}
