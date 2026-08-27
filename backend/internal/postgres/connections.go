package postgres

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func (service *Service) connect(
	ctx context.Context,
	request ConnectionTestRequest,
) (*pgx.Conn, error) {
	resolvedRequest, err := service.resolveConnectionRequest(request)
	if err != nil {
		return nil, err
	}

	databaseURL := databaseURLForRequest(resolvedRequest)

	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return conn, nil
}

func (service *Service) tilePool(
	ctx context.Context,
	request ConnectionTestRequest,
) (*pgxpool.Pool, error) {
	resolvedRequest, err := service.resolveConnectionRequest(request)
	if err != nil {
		return nil, err
	}

	databaseURL := databaseURLForRequest(resolvedRequest)
	now := time.Now()

	service.tilePoolsMux.Lock()
	defer service.tilePoolsMux.Unlock()

	for key, entry := range service.tilePools {
		if now.Sub(entry.lastUsedAt) > tilePoolTTL {
			entry.pool.Close()
			delete(service.tilePools, key)
		}
	}

	if entry, ok := service.tilePools[databaseURL]; ok {
		entry.lastUsedAt = now
		service.tilePools[databaseURL] = entry
		return entry.pool, nil
	}

	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	config.MaxConns = 8
	config.MinConns = 0
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	service.tilePools[databaseURL] = tilePoolEntry{
		pool:       pool,
		lastUsedAt: now,
	}
	return pool, nil
}

func (service *Service) resolveConnectionRequest(
	request ConnectionTestRequest,
) (ConnectionTestRequest, error) {
	request.TrimSpaces()
	if request.hasDirectCredentials() {
		return request, nil
	}

	if request.ID == "" {
		return ConnectionTestRequest{}, errors.New("Connection id is required.")
	}

	connection, ok := service.registeredConnections[request.ID]
	if !ok {
		return ConnectionTestRequest{}, fmt.Errorf("%w: registered connection not found", ErrConnectionFailed)
	}

	return connection, nil
}

func databaseURLForRequest(request ConnectionTestRequest) string {
	databaseURL := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(request.User, request.Password),
		Host:     net.JoinHostPort(request.Host, request.Port),
		Path:     "/" + request.Database,
		RawQuery: request.RawQuery,
	}

	return databaseURL.String()
}

func isEditableTable(access tableAccess, primaryKey []string) bool {
	if len(primaryKey) == 0 {
		return false
	}

	if access.Kind != "table" && access.Kind != "partitioned table" {
		return false
	}

	return access.CanInsert && access.CanUpdate && access.CanDelete
}

func buildRowKey(
	record map[string]interface{},
	primaryKey []string,
) map[string]interface{} {
	if len(primaryKey) == 0 {
		return nil
	}

	rowKey := make(map[string]interface{}, len(primaryKey))
	for _, columnName := range primaryKey {
		rowKey[columnName] = record[columnName]
	}

	return rowKey
}
