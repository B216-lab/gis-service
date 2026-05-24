package postgres

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrConnectionFailed = errors.New("database connection failed")

type Service struct {
	timeout time.Duration
}

type ConnectionTestRequest struct {
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     string `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password"`
}

type ConnectionTestResult struct {
	Success         bool   `json:"success"`
	Message         string `json:"message"`
	Database        string `json:"database"`
	Host            string `json:"host"`
	Port            string `json:"port"`
	PostgresVersion string `json:"postgresVersion"`
	PostgisVersion  string `json:"postgisVersion"`
}

type TableSummary struct {
	Schema          string               `json:"schema"`
	Name            string               `json:"name"`
	FullName        string               `json:"fullName"`
	Kind            string               `json:"kind"`
	RowEstimate     int64                `json:"rowEstimate"`
	Columns         []ColumnMeta         `json:"columns"`
	GeometryColumns []GeometryColumnMeta `json:"geometryColumns"`
}

type ListTablesResult struct {
	Tables []TableSummary `json:"tables"`
}

type ListRowsRequest struct {
	ConnectionTestRequest
	Schema string `json:"schema"`
	Table  string `json:"table"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}

type ColumnMeta struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type GeometryColumnMeta struct {
	Name         string `json:"name"`
	StorageType  string `json:"storageType"`
	GeometryType string `json:"geometryType"`
	SRID         int    `json:"srid"`
}

type ListRowsResult struct {
	Schema  string                   `json:"schema"`
	Table   string                   `json:"table"`
	Limit   int                      `json:"limit"`
	Offset  int                      `json:"offset"`
	HasMore bool                     `json:"hasMore"`
	Columns []ColumnMeta             `json:"columns"`
	Rows    []map[string]interface{} `json:"rows"`
}

type columnDefinition struct {
	Name    string
	Type    string
	UdtName string
}

type geometryColumnDefinition struct {
	Name         string
	StorageType  string
	GeometryType string
	SRID         int
}

func NewService(timeout time.Duration) *Service {
	return &Service{
		timeout: timeout,
	}
}

func (request *ConnectionTestRequest) TrimSpaces() {
	request.Name = strings.TrimSpace(request.Name)
	request.Host = strings.TrimSpace(request.Host)
	request.Port = strings.TrimSpace(request.Port)
	request.Database = strings.TrimSpace(request.Database)
	request.User = strings.TrimSpace(request.User)
}

func (request ConnectionTestRequest) Validate() error {
	if request.Name == "" {
		return errors.New("Connection name is required.")
	}

	if request.Host == "" {
		return errors.New("Host is required.")
	}

	if request.Port == "" {
		return errors.New("Port is required.")
	}

	port, err := strconv.Atoi(request.Port)
	if err != nil || port < 1 || port > 65535 {
		return errors.New("Port must be a valid TCP port.")
	}

	if request.Database == "" {
		return errors.New("Database name is required.")
	}

	if request.User == "" {
		return errors.New("User is required.")
	}

	return nil
}

func (request *ListRowsRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
}

func (request *ListRowsRequest) Normalize() {
	if request.Limit <= 0 {
		request.Limit = 100
	}
	if request.Limit > 200 {
		request.Limit = 200
	}
	if request.Offset < 0 {
		request.Offset = 0
	}
}

func (request ListRowsRequest) Validate() error {
	if err := request.ConnectionTestRequest.Validate(); err != nil {
		return err
	}

	if request.Schema == "" {
		return errors.New("Schema is required.")
	}

	if request.Table == "" {
		return errors.New("Table is required.")
	}

	if request.Limit < 1 || request.Limit > 200 {
		return errors.New("Limit must be between 1 and 200.")
	}

	if request.Offset < 0 {
		return errors.New("Offset must be zero or greater.")
	}

	return nil
}

func (service *Service) TestConnection(
	ctx context.Context,
	request ConnectionTestRequest,
) (*ConnectionTestResult, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, request)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	var postgresVersion string
	if err := conn.QueryRow(timeoutCtx, "select version()").Scan(&postgresVersion); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	var postgisVersion string
	if err := conn.QueryRow(timeoutCtx, "select postgis_version()").Scan(&postgisVersion); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	return &ConnectionTestResult{
		Success:         true,
		Message:         "Connection test passed.",
		Database:        request.Database,
		Host:            request.Host,
		Port:            request.Port,
		PostgresVersion: postgresVersion,
		PostgisVersion:  postgisVersion,
	}, nil
}

func (service *Service) ListTables(
	ctx context.Context,
	request ConnectionTestRequest,
) (*ListTablesResult, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, request)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	rows, err := conn.Query(
		timeoutCtx,
		`
		select
		  n.nspname as schema_name,
		  c.relname as table_name,
		  case c.relkind
		    when 'r' then 'table'
		    when 'p' then 'partitioned table'
		    when 'v' then 'view'
		    when 'm' then 'materialized view'
		    else c.relkind::text
		  end as kind,
		  greatest(c.reltuples::bigint, 0) as row_estimate
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		where c.relkind in ('r', 'p', 'v', 'm')
		  and n.nspname not in ('pg_catalog', 'information_schema')
		  and n.nspname not like 'pg_toast%'
		  and n.nspname not like 'pg_temp_%'
		  and not (
		    n.nspname = 'public'
		    and c.relname in ('spatial_ref_sys', 'geometry_columns', 'geography_columns')
		  )
		  and has_table_privilege(format('%I.%I', n.nspname, c.relname), 'SELECT')
		order by n.nspname, c.relname
		`,
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}
	defer rows.Close()

	tables := make([]TableSummary, 0)
	for rows.Next() {
		var table TableSummary
		if err := rows.Scan(
			&table.Schema,
			&table.Name,
			&table.Kind,
			&table.RowEstimate,
		); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
		}
		table.FullName = fmt.Sprintf("%s.%s", table.Schema, table.Name)
		tables = append(tables, table)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}
	rows.Close()

	for index := range tables {
		columnDefinitions, err := service.listColumnDefinitions(
			timeoutCtx,
			conn,
			tables[index].Schema,
			tables[index].Name,
		)
		if err != nil {
			return nil, err
		}
		tables[index].Columns = make([]ColumnMeta, 0, len(columnDefinitions))
		for _, column := range columnDefinitions {
			tables[index].Columns = append(tables[index].Columns, ColumnMeta{
				Name: column.Name,
				Type: column.Type,
			})
		}

		geometryDefinitions, err := service.listGeometryColumns(
			timeoutCtx,
			conn,
			tables[index].Schema,
			tables[index].Name,
		)
		if err != nil {
			return nil, err
		}
		tables[index].GeometryColumns = make(
			[]GeometryColumnMeta,
			0,
			len(geometryDefinitions),
		)
		for _, geometryColumn := range geometryDefinitions {
			tables[index].GeometryColumns = append(
				tables[index].GeometryColumns,
				GeometryColumnMeta{
					Name:         geometryColumn.Name,
					StorageType:  geometryColumn.StorageType,
					GeometryType: geometryColumn.GeometryType,
					SRID:         geometryColumn.SRID,
				},
			)
		}
	}

	return &ListTablesResult{
		Tables: tables,
	}, nil
}

func (service *Service) ListRows(
	ctx context.Context,
	request ListRowsRequest,
) (*ListRowsResult, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, request.ConnectionTestRequest)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	columnDefinitions, err := service.listColumnDefinitions(
		timeoutCtx,
		conn,
		request.Schema,
		request.Table,
	)
	if err != nil {
		return nil, err
	}

	if len(columnDefinitions) == 0 {
		return nil, fmt.Errorf("%w: no columns found for selected table", ErrConnectionFailed)
	}

	selectExpressions := make([]string, 0, len(columnDefinitions))
	columns := make([]ColumnMeta, 0, len(columnDefinitions))

	for _, column := range columnDefinitions {
		selectExpressions = append(selectExpressions, columnSelectExpression(column))
		columns = append(columns, ColumnMeta{
			Name: column.Name,
			Type: column.Type,
		})
	}

	query := fmt.Sprintf(
		`select %s from %s.%s limit $1 offset $2`,
		strings.Join(selectExpressions, ", "),
		quoteIdentifier(request.Schema),
		quoteIdentifier(request.Table),
	)

	rows, err := conn.Query(timeoutCtx, query, request.Limit+1, request.Offset)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}
	defer rows.Close()

	records := make([]map[string]interface{}, 0, request.Limit+1)
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
		}

		record := make(map[string]interface{}, len(columns))
		for index, column := range columns {
			record[column.Name] = normalizeValue(values[index])
		}
		records = append(records, record)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	hasMore := false
	if len(records) > request.Limit {
		hasMore = true
		records = records[:request.Limit]
	}

	return &ListRowsResult{
		Schema:  request.Schema,
		Table:   request.Table,
		Limit:   request.Limit,
		Offset:  request.Offset,
		HasMore: hasMore,
		Columns: columns,
		Rows:    records,
	}, nil
}

func (service *Service) listColumnDefinitions(
	ctx context.Context,
	conn *pgx.Conn,
	schema string,
	table string,
) ([]columnDefinition, error) {
	rows, err := conn.Query(
		ctx,
		`
		select column_name, data_type, udt_name
		from information_schema.columns
		where table_schema = $1 and table_name = $2
		order by ordinal_position
		`,
		schema,
		table,
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}
	defer rows.Close()

	definitions := make([]columnDefinition, 0)
	for rows.Next() {
		var definition columnDefinition
		if err := rows.Scan(&definition.Name, &definition.Type, &definition.UdtName); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
		}
		definitions = append(definitions, definition)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	return definitions, nil
}

func (service *Service) listGeometryColumns(
	ctx context.Context,
	conn *pgx.Conn,
	schema string,
	table string,
) ([]geometryColumnDefinition, error) {
	rows, err := conn.Query(
		ctx,
		`
		select
		  a.attname as column_name,
		  t.typname as storage_type,
		  coalesce(nullif(postgis_typmod_type(a.atttypmod), ''), 'GEOMETRY') as geometry_type,
		  coalesce(nullif(postgis_typmod_srid(a.atttypmod), 0), 4326) as srid
		from pg_attribute a
		join pg_class c on c.oid = a.attrelid
		join pg_namespace n on n.oid = c.relnamespace
		join pg_type t on t.oid = a.atttypid
		where n.nspname = $1
		  and c.relname = $2
		  and a.attnum > 0
		  and not a.attisdropped
		  and t.typname in ('geometry', 'geography')
		order by a.attnum
		`,
		schema,
		table,
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}
	defer rows.Close()

	definitions := make([]geometryColumnDefinition, 0)
	for rows.Next() {
		var definition geometryColumnDefinition
		if err := rows.Scan(
			&definition.Name,
			&definition.StorageType,
			&definition.GeometryType,
			&definition.SRID,
		); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
		}
		definitions = append(definitions, definition)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	return definitions, nil
}

func (service *Service) connect(
	ctx context.Context,
	request ConnectionTestRequest,
) (*pgx.Conn, error) {
	databaseURL := fmt.Sprintf(
		"postgres://%s:%s@%s:%s/%s",
		request.User,
		request.Password,
		request.Host,
		request.Port,
		request.Database,
	)

	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	return conn, nil
}

func columnSelectExpression(column columnDefinition) string {
	quotedName := quoteIdentifier(column.Name)

	if column.UdtName == "geometry" || column.UdtName == "geography" {
		return fmt.Sprintf("ST_AsText(%s) as %s", quotedName, quotedName)
	}

	return quotedName
}

func quoteIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func normalizeValue(value interface{}) interface{} {
	switch typed := value.(type) {
	case nil:
		return nil
	case time.Time:
		return typed.Format(time.RFC3339)
	case []byte:
		return string(typed)
	default:
		return typed
	}
}
