package analytics

import (
	"context"
	"geopanel/backend/internal/postgres"
	"sync/atomic"
	"testing"
	"time"
)

type blockingExecutor struct {
	active atomic.Int32
	max    atomic.Int32
}

func (e *blockingExecutor) ExecuteAnalytics(ctx context.Context, _ string, _ string, _ []any, _ int) ([]map[string]any, []postgres.ColumnMeta, bool, error) {
	n := e.active.Add(1)
	defer e.active.Add(-1)
	for {
		m := e.max.Load()
		if n <= m || e.max.CompareAndSwap(m, n) {
			break
		}
	}
	<-ctx.Done()
	return nil, nil, false, ctx.Err()
}
func TestQueryServiceBoundsConcurrencyAndCancels(t *testing.T) {
	e := &blockingExecutor{}
	s := NewQueryService(e)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{}, 8)
	for i := 0; i < 8; i++ {
		go func() {
			s.Execute(ctx, Query{DatasetID: "submissions", Metrics: []string{"count"}, Filters: []Filter{{FieldID: "city", Operator: "eq", Values: []any{i}}}}, fixtureLookup)
			done <- struct{}{}
		}()
	}
	deadline := time.After(time.Second)
	for e.active.Load() != 4 {
		select {
		case <-deadline:
			cancel()
			t.Fatal("executor did not fill slots")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	for i := 0; i < 8; i++ {
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("cancellation did not release queued/executing query")
		}
	}
	deadline = time.After(time.Second)
	for e.active.Load() != 0 {
		select {
		case <-deadline:
			t.Fatal("executor did not stop after final waiter canceled")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	if e.max.Load() > 4 || len(s.slots) != 0 {
		t.Fatalf("bad concurrency: max=%d slots=%d", e.max.Load(), len(s.slots))
	}
}
