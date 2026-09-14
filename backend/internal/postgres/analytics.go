package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// ExecuteAnalytics only resolves server-registered sources. SQL is compiled by
// the analytics service from editor-owned metadata; filter values remain args.
func (service *Service) ExecuteAnalytics(ctx context.Context, sourceID, sql string, args []any, limit int) ([]map[string]any, []ColumnMeta, bool, error) {
	if _, ok := service.registeredConnections[sourceID]; !ok {
		return nil, nil, false, errors.New("unknown analytics source")
	}
	if limit < 1 || limit > 10000 {
		return nil, nil, false, errors.New("invalid analytics row limit")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	conn, err := service.connect(ctx, ConnectionTestRequest{ID: sourceID})
	if err != nil {
		return nil, nil, false, err
	}
	defer conn.Close(context.Background())
	tx, err := conn.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, nil, false, err
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, "SET LOCAL statement_timeout = '15s'"); err != nil {
		return nil, nil, false, err
	}
	if _, err = tx.Exec(ctx, "SET LOCAL TIME ZONE 'UTC'"); err != nil {
		return nil, nil, false, err
	}
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return nil, nil, false, err
	}
	defer rows.Close()
	fields := rows.FieldDescriptions()
	columns := make([]ColumnMeta, len(fields))
	for i, field := range fields {
		typ := "unknown"
		if t, ok := conn.TypeMap().TypeForOID(field.DataTypeOID); ok {
			typ = t.Name
		}
		columns[i] = ColumnMeta{Name: field.Name, Type: typ}
	}
	records := make([]map[string]any, 0)
	truncated := false
	for rows.Next() {
		if len(records) == limit {
			truncated = true
			break
		}
		values, err := rows.Values()
		if err != nil {
			return nil, nil, false, err
		}
		record := make(map[string]any, len(fields))
		for i, value := range values {
			record[fields[i].Name] = value
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, false, err
	}
	// Rollback intentionally: analytics never needs to commit a transaction.
	return records, columns, truncated, nil
}
