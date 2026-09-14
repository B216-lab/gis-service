package analytics

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

const queryCacheEntries = 64
const queryCacheEntryBytes = 512 << 10
const queryFlightLimit = 64

type queryCacheEntry struct {
	data    []byte
	expires time.Time
}
type queryFlight struct {
	done    chan struct{}
	cancel  context.CancelFunc
	waiters int
	data    []byte
	err     error
}
type queryCache struct {
	mu      sync.Mutex
	entries map[string]queryCacheEntry
	flights map[string]*queryFlight
	ttl     time.Duration
	now     func() time.Time
}

func newQueryCache() *queryCache {
	return &queryCache{entries: map[string]queryCacheEntry{}, flights: map[string]*queryFlight{}, ttl: 30 * time.Second, now: time.Now}
}

// ExecuteScoped partitions public snapshots/shares from editor results. Authorization
// and revocation must be checked before calling; the cache never grants access.
func (s *QueryService) ExecuteScoped(ctx context.Context, q Query, lookup DatasetLookup, scope string) (QueryResult, error) {
	return s.ExecuteScopedFresh(ctx, q, lookup, scope, false)
}

// ExecuteScopedFresh bypasses cached results for manual refresh, while retaining deduplication.
func (s *QueryService) ExecuteScopedFresh(ctx context.Context, q Query, lookup DatasetLookup, scope string, refresh bool) (QueryResult, error) {
	if e := ctx.Err(); e != nil {
		return QueryResult{}, e
	}
	revisions := map[string]int{}
	compiled, e := CompileQuery(q, func(id string) (Dataset, error) {
		d, e := lookup(id)
		if e == nil {
			revisions[id] = d.Revision
		}
		return d, e
	})
	if e != nil {
		return QueryResult{}, e
	}
	keyData, e := json.Marshal(struct {
		Scope     string
		Compiled  CompiledQuery
		Revisions map[string]int
	}{scope, compiled, revisions})
	if e != nil {
		return QueryResult{}, e
	}
	sum := sha256.Sum256(keyData)
	key := hex.EncodeToString(sum[:])
	cache := s.cache
	cache.mu.Lock()
	now := cache.now()
	for k, entry := range cache.entries {
		if !now.Before(entry.expires) {
			delete(cache.entries, k)
		}
	}
	if hit, ok := cache.entries[key]; ok && !refresh {
		cache.mu.Unlock()
		return decodeCachedResult(hit.data)
	}
	flight, ok := cache.flights[key]
	if !ok {
		if len(cache.flights) >= queryFlightLimit {
			cache.mu.Unlock()
			return QueryResult{}, fmt.Errorf("analytics query queue full")
		}
		workCtx, cancel := context.WithCancel(context.Background())
		flight = &queryFlight{done: make(chan struct{}), cancel: cancel}
		cache.flights[key] = flight
		go s.runFlight(workCtx, key, compiled, flight)
	}
	flight.waiters++
	cache.mu.Unlock()
	select {
	case <-ctx.Done():
		cache.mu.Lock()
		flight.waiters--
		if flight.waiters == 0 {
			flight.cancel()
			if cache.flights[key] == flight {
				delete(cache.flights, key)
			}
		}
		cache.mu.Unlock()
		return QueryResult{}, ctx.Err()
	case <-flight.done:
		if e := ctx.Err(); e != nil {
			return QueryResult{}, e
		}
		if flight.err != nil {
			return QueryResult{}, flight.err
		}
		return decodeCachedResult(flight.data)
	}
}
func (s *QueryService) runFlight(ctx context.Context, key string, compiled CompiledQuery, flight *queryFlight) {
	defer flight.cancel()
	result, e := s.execute(ctx, compiled)
	var data []byte
	if e == nil {
		data, e = json.Marshal(result)
	}
	cache := s.cache
	cache.mu.Lock()
	defer cache.mu.Unlock()
	flight.data, flight.err = data, e
	if cache.flights[key] == flight {
		delete(cache.flights, key)
		if e == nil && ctx.Err() == nil && len(data) <= queryCacheEntryBytes {
			if len(cache.entries) >= queryCacheEntries {
				oldest := ""
				var expiry time.Time
				for k, entry := range cache.entries {
					if oldest == "" || entry.expires.Before(expiry) {
						oldest = k
						expiry = entry.expires
					}
				}
				delete(cache.entries, oldest)
			}
			cache.entries[key] = queryCacheEntry{data: data, expires: cache.now().Add(cache.ttl)}
		}
	}
	close(flight.done)
}
func decodeCachedResult(data []byte) (QueryResult, error) {
	var result QueryResult
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	e := d.Decode(&result)
	return result, e
}
