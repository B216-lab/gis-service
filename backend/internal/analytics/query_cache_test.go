package analytics

import (
	"context"
	"errors"
	"geopanel/backend/internal/postgres"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type cacheExecutor struct {
	calls atomic.Int32
	gate  chan struct{}
	fail  bool
	large bool
}

func (e *cacheExecutor) ExecuteAnalytics(ctx context.Context, _ string, _ string, _ []any, _ int) ([]map[string]any, []postgres.ColumnMeta, bool, error) {
	e.calls.Add(1)
	if e.gate != nil {
		select {
		case <-e.gate:
		case <-ctx.Done():
			return nil, nil, false, ctx.Err()
		}
	}
	if e.fail {
		return nil, nil, false, errors.New("source unavailable")
	}
	value := "result"
	if e.large {
		value = strings.Repeat("x", queryCacheEntryBytes+1)
	}
	return []map[string]any{{"count": int64(9007199254740993), "nested": map[string]any{"label": value}}}, []postgres.ColumnMeta{{Name: "count", Type: "int8"}}, false, nil
}
func countQuery() Query { return Query{DatasetID: "submissions", Metrics: []string{"count"}} }
func TestQueryCacheScopeRevisionsTTLAndCopies(t *testing.T) {
	executor := &cacheExecutor{}
	s := NewQueryService(executor)
	now := time.Now()
	s.cache.now = func() time.Time { return now }
	lookup := fixtureLookup
	first, e := s.Execute(context.Background(), countQuery(), lookup)
	if e != nil {
		t.Fatal(e)
	}
	first.Rows[0]["nested"].(map[string]any)["label"] = "corrupted"
	first.Columns[0].Name = "corrupted"
	second, e := s.Execute(context.Background(), countQuery(), lookup)
	if e != nil {
		t.Fatal(e)
	}
	if executor.calls.Load() != 1 || second.Rows[0]["nested"].(map[string]any)["label"] != "result" || second.Columns[0].Name != "count" {
		t.Fatal("cache alias/miss")
	}
	if string(second.Rows[0]["count"].(interface{ String() string }).String()) != "9007199254740993" {
		t.Fatal("integer precision lost")
	}
	if _, e = s.ExecuteScoped(context.Background(), countQuery(), lookup, "public:share-one"); e != nil {
		t.Fatal(e)
	}
	if executor.calls.Load() != 2 {
		t.Fatal("scope collision")
	}
	revised := func(id string) (Dataset, error) { d, e := lookup(id); d.Revision++; return d, e }
	if _, e = s.Execute(context.Background(), countQuery(), revised); e != nil {
		t.Fatal(e)
	}
	if executor.calls.Load() != 3 {
		t.Fatal("revision collision")
	}
	q := countQuery()
	q.Filters = []Filter{{FieldID: "city", Operator: "eq", Values: []any{"A"}}}
	if _, e = s.Execute(context.Background(), q, lookup); e != nil {
		t.Fatal(e)
	}
	if executor.calls.Load() != 4 {
		t.Fatal("argument collision")
	}
	changedConnection := func(id string) (Dataset, error) { d, e := lookup(id); d.ConnectionID = "different"; return d, e }
	if _, e = s.Execute(context.Background(), q, changedConnection); e != nil {
		t.Fatal(e)
	}
	if executor.calls.Load() != 5 {
		t.Fatal("connection collision")
	}
	now = now.Add(31 * time.Second)
	if _, e = s.Execute(context.Background(), countQuery(), lookup); e != nil {
		t.Fatal(e)
	}
	if executor.calls.Load() != 6 {
		t.Fatal("expired cache reused")
	}
}
func TestQueryCacheBoundsAndDoesNotCacheErrorsOrLargeResults(t *testing.T) {
	e := &cacheExecutor{}
	s := NewQueryService(e)
	for i := 0; i < queryCacheEntries+3; i++ {
		q := countQuery()
		q.Filters = []Filter{{FieldID: "city", Operator: "eq", Values: []any{i}}}
		if _, err := s.Execute(context.Background(), q, fixtureLookup); err != nil {
			t.Fatal(err)
		}
	}
	if len(s.cache.entries) != queryCacheEntries {
		t.Fatal("unbounded cache")
	}
	failed := &cacheExecutor{fail: true}
	service := NewQueryService(failed)
	for range 2 {
		if _, err := service.Execute(context.Background(), countQuery(), fixtureLookup); err == nil {
			t.Fatal("error lost")
		}
	}
	if failed.calls.Load() != 2 || len(service.cache.entries) != 0 {
		t.Fatal("error cached")
	}
	large := &cacheExecutor{large: true}
	service = NewQueryService(large)
	for range 2 {
		if _, err := service.Execute(context.Background(), countQuery(), fixtureLookup); err != nil {
			t.Fatal(err)
		}
	}
	if large.calls.Load() != 2 || len(service.cache.entries) != 0 {
		t.Fatal("oversize result cached")
	}
}
func TestQueryDedupCancellationKeepsOtherWaiterAlive(t *testing.T) {
	e := &cacheExecutor{gate: make(chan struct{})}
	s := NewQueryService(e)
	ctx, cancel := context.WithCancel(context.Background())
	first := make(chan error, 1)
	second := make(chan error, 1)
	go func() { _, err := s.Execute(ctx, countQuery(), fixtureLookup); first <- err }()
	go func() { _, err := s.Execute(context.Background(), countQuery(), fixtureLookup); second <- err }()
	deadline := time.Now().Add(time.Second)
	for {
		waiters := 0
		s.cache.mu.Lock()
		for _, flight := range s.cache.flights {
			waiters = flight.waiters
		}
		s.cache.mu.Unlock()
		if waiters == 2 && e.calls.Load() == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("queries did not deduplicate")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	if err := <-first; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	close(e.gate)
	if err := <-second; err != nil {
		t.Fatalf("first waiter canceled second: %v", err)
	}
	if e.calls.Load() != 1 {
		t.Fatal("duplicate DB execution")
	}
	if _, err := s.Execute(context.Background(), countQuery(), fixtureLookup); err != nil {
		t.Fatal(err)
	}
	if e.calls.Load() != 1 {
		t.Fatal("successful shared result not cached")
	}
}

func TestManualRefreshBypassesCache(t *testing.T) {
	e := &cacheExecutor{}
	s := NewQueryService(e)
	for range 2 {
		if _, err := s.Execute(context.Background(), countQuery(), fixtureLookup); err != nil {
			t.Fatal(err)
		}
	}
	if e.calls.Load() != 1 {
		t.Fatal("normal query not cached")
	}
	if _, err := s.ExecuteScopedFresh(context.Background(), countQuery(), fixtureLookup, "editor", true); err != nil {
		t.Fatal(err)
	}
	if e.calls.Load() != 2 {
		t.Fatal("manual refresh reused cached data")
	}
}
