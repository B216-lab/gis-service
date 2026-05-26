package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var ErrConnectionFailed = errors.New("database connection failed")
var ErrInvalidWriteRequest = errors.New("invalid write request")
var ErrWriteConflict = errors.New("database write conflict")

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
	PrimaryKey      []string             `json:"primaryKey"`
	IsEditable      bool                 `json:"isEditable"`
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

type CommitTableChangesRequest struct {
	ConnectionTestRequest
	Schema     string           `json:"schema"`
	Table      string           `json:"table"`
	Operations []TableOperation `json:"operations"`
}

type TableOperation struct {
	Type    string                 `json:"type"`
	RowKey  map[string]interface{} `json:"rowKey"`
	Changes map[string]interface{} `json:"changes"`
	Values  map[string]interface{} `json:"values"`
}

type ListLayerFeaturesRequest struct {
	ConnectionTestRequest
	Schema         string `json:"schema"`
	Table          string `json:"table"`
	GeometryColumn string `json:"geometryColumn"`
	Limit          int    `json:"limit"`
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
	Schema     string       `json:"schema"`
	Table      string       `json:"table"`
	Limit      int          `json:"limit"`
	Offset     int          `json:"offset"`
	HasMore    bool         `json:"hasMore"`
	PrimaryKey []string     `json:"primaryKey"`
	IsEditable bool         `json:"isEditable"`
	Columns    []ColumnMeta `json:"columns"`
	Rows       []RowRecord  `json:"rows"`
}

type RowRecord struct {
	RowKey map[string]interface{} `json:"rowKey"`
	Values map[string]interface{} `json:"values"`
}

type CommitTableChangesResult struct {
	Schema  string `json:"schema"`
	Table   string `json:"table"`
	Applied int    `json:"applied"`
}

type GeoJSONFeatureCollection struct {
	Type     string                   `json:"type"`
	Features []map[string]interface{} `json:"features"`
}

type ListLayerFeaturesResult struct {
	Schema         string                   `json:"schema"`
	Table          string                   `json:"table"`
	GeometryColumn string                   `json:"geometryColumn"`
	GeometryType   string                   `json:"geometryType"`
	SRID           int                      `json:"srid"`
	FeatureCount   int                      `json:"featureCount"`
	Data           GeoJSONFeatureCollection `json:"data"`
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

type tableAccess struct {
	Kind      string
	CanRead   bool
	CanInsert bool
	CanUpdate bool
	CanDelete bool
}

type queryRunner interface {
	Query(context.Context, string, ...interface{}) (pgx.Rows, error)
	QueryRow(context.Context, string, ...interface{}) pgx.Row
	Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error)
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

func (request *ListLayerFeaturesRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
	request.GeometryColumn = strings.TrimSpace(request.GeometryColumn)
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

func (request *ListLayerFeaturesRequest) Normalize() {
	if request.Limit <= 0 {
		request.Limit = 1000
	}
	if request.Limit > 5000 {
		request.Limit = 5000
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

func (request *CommitTableChangesRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
}

func (request CommitTableChangesRequest) Validate() error {
	if err := request.ConnectionTestRequest.Validate(); err != nil {
		return err
	}

	if request.Schema == "" {
		return errors.New("Schema is required.")
	}

	if request.Table == "" {
		return errors.New("Table is required.")
	}

	if len(request.Operations) == 0 {
		return errors.New("At least one operation is required.")
	}

	for index, operation := range request.Operations {
		if err := operation.Validate(); err != nil {
			return fmt.Errorf("Operation %d: %w", index+1, err)
		}
	}

	return nil
}

func (request ListLayerFeaturesRequest) Validate() error {
	if err := request.ConnectionTestRequest.Validate(); err != nil {
		return err
	}

	if request.Schema == "" {
		return errors.New("Schema is required.")
	}

	if request.Table == "" {
		return errors.New("Table is required.")
	}

	if request.GeometryColumn == "" {
		return errors.New("Geometry column is required.")
	}

	if request.Limit < 1 || request.Limit > 5000 {
		return errors.New("Limit must be between 1 and 5000.")
	}

	return nil
}

func (operation TableOperation) Validate() error {
	switch operation.Type {
	case "insert":
		if len(operation.Values) == 0 {
			return errors.New("Insert operation requires values.")
		}
	case "update":
		if len(operation.RowKey) == 0 {
			return errors.New("Update operation requires row key.")
		}
		if len(operation.Changes) == 0 {
			return errors.New("Update operation requires changes.")
		}
	case "delete":
		if len(operation.RowKey) == 0 {
			return errors.New("Delete operation requires row key.")
		}
	default:
		return errors.New("Operation type must be insert, update or delete.")
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
		access, err := service.getTableAccess(
			timeoutCtx,
			conn,
			tables[index].Schema,
			tables[index].Name,
		)
		if err != nil {
			return nil, err
		}

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

		primaryKey, err := service.listPrimaryKeyColumns(
			timeoutCtx,
			conn,
			tables[index].Schema,
			tables[index].Name,
		)
		if err != nil {
			return nil, err
		}
		tables[index].PrimaryKey = primaryKey
		tables[index].IsEditable = isEditableTable(access, primaryKey)

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

	primaryKey, err := service.listPrimaryKeyColumns(
		timeoutCtx,
		conn,
		request.Schema,
		request.Table,
	)
	if err != nil {
		return nil, err
	}

	access, err := service.getTableAccess(
		timeoutCtx,
		conn,
		request.Schema,
		request.Table,
	)
	if err != nil {
		return nil, err
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

	orderByClause := ""
	if len(primaryKey) > 0 {
		orderedPrimaryKey := make([]string, 0, len(primaryKey))
		for _, columnName := range primaryKey {
			orderedPrimaryKey = append(orderedPrimaryKey, quoteIdentifier(columnName))
		}
		orderByClause = fmt.Sprintf(" order by %s", strings.Join(orderedPrimaryKey, ", "))
	}

	query := fmt.Sprintf(
		`select %s from %s.%s%s limit $1 offset $2`,
		strings.Join(selectExpressions, ", "),
		quoteIdentifier(request.Schema),
		quoteIdentifier(request.Table),
		orderByClause,
	)

	rows, err := conn.Query(timeoutCtx, query, request.Limit+1, request.Offset)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}
	defer rows.Close()

	records := make([]RowRecord, 0, request.Limit+1)
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
		}

		record := make(map[string]interface{}, len(columns))
		for index, column := range columns {
			record[column.Name] = normalizeValue(values[index])
		}
		records = append(
			records,
			RowRecord{
				RowKey: buildRowKey(record, primaryKey),
				Values: record,
			},
		)
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
		Schema:     request.Schema,
		Table:      request.Table,
		Limit:      request.Limit,
		Offset:     request.Offset,
		HasMore:    hasMore,
		PrimaryKey: primaryKey,
		IsEditable: isEditableTable(access, primaryKey),
		Columns:    columns,
		Rows:       records,
	}, nil
}

func (service *Service) CommitTableChanges(
	ctx context.Context,
	request CommitTableChangesRequest,
) (*CommitTableChangesResult, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, request.ConnectionTestRequest)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	access, err := service.getTableAccess(
		timeoutCtx,
		conn,
		request.Schema,
		request.Table,
	)
	if err != nil {
		return nil, err
	}

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
		return nil, fmt.Errorf("%w: no columns found for selected table", ErrInvalidWriteRequest)
	}

	primaryKey, err := service.listPrimaryKeyColumns(
		timeoutCtx,
		conn,
		request.Schema,
		request.Table,
	)
	if err != nil {
		return nil, err
	}

	if !isEditableTable(access, primaryKey) {
		return nil, fmt.Errorf(
			"%w: selected table does not support transactional editing",
			ErrInvalidWriteRequest,
		)
	}

	columnByName := make(map[string]columnDefinition, len(columnDefinitions))
	primaryKeySet := make(map[string]struct{}, len(primaryKey))
	for _, definition := range columnDefinitions {
		columnByName[definition.Name] = definition
	}
	for _, columnName := range primaryKey {
		primaryKeySet[columnName] = struct{}{}
	}

	transaction, err := conn.Begin(timeoutCtx)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	committed := false
	defer func() {
		if !committed {
			_ = transaction.Rollback(context.Background())
		}
	}()

	applied := 0
	for _, operation := range request.Operations {
		if err := service.applyTableOperation(
			timeoutCtx,
			transaction,
			request.Schema,
			request.Table,
			columnByName,
			primaryKey,
			primaryKeySet,
			operation,
		); err != nil {
			return nil, err
		}
		applied++
	}

	if err := transaction.Commit(timeoutCtx); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}
	committed = true

	return &CommitTableChangesResult{
		Schema:  request.Schema,
		Table:   request.Table,
		Applied: applied,
	}, nil
}

func (service *Service) ListLayerFeatures(
	ctx context.Context,
	request ListLayerFeaturesRequest,
) (*ListLayerFeaturesResult, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, request.ConnectionTestRequest)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	geometryColumns, err := service.listGeometryColumns(
		timeoutCtx,
		conn,
		request.Schema,
		request.Table,
	)
	if err != nil {
		return nil, err
	}

	var selectedGeometryColumn *geometryColumnDefinition
	for index := range geometryColumns {
		if geometryColumns[index].Name == request.GeometryColumn {
			selectedGeometryColumn = &geometryColumns[index]
			break
		}
	}

	if selectedGeometryColumn == nil {
		return nil, fmt.Errorf(
			"%w: selected geometry column not found on table",
			ErrConnectionFailed,
		)
	}

	propertyExpression := "to_jsonb(source_row)"
	for _, geometryColumn := range geometryColumns {
		propertyExpression += fmt.Sprintf(" - %s", quoteLiteral(geometryColumn.Name))
	}

	query := fmt.Sprintf(
		`
		with source_features as (
		  select json_build_object(
		    'type', 'Feature',
		    'geometry', ST_AsGeoJSON(%s)::json,
		    'properties', %s
		  ) as feature
		  from %s.%s as source_row
		  where %s is not null
		  limit $1
		)
		select coalesce(json_agg(feature), '[]'::json)
		from source_features
		`,
		quoteIdentifier(request.GeometryColumn),
		propertyExpression,
		quoteIdentifier(request.Schema),
		quoteIdentifier(request.Table),
		quoteIdentifier(request.GeometryColumn),
	)

	var rawFeatures []byte
	if err := conn.QueryRow(timeoutCtx, query, request.Limit).Scan(&rawFeatures); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	features := make([]map[string]interface{}, 0)
	if err := json.Unmarshal(rawFeatures, &features); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	return &ListLayerFeaturesResult{
		Schema:         request.Schema,
		Table:          request.Table,
		GeometryColumn: request.GeometryColumn,
		GeometryType:   selectedGeometryColumn.GeometryType,
		SRID:           selectedGeometryColumn.SRID,
		FeatureCount:   len(features),
		Data: GeoJSONFeatureCollection{
			Type:     "FeatureCollection",
			Features: features,
		},
	}, nil
}

func (service *Service) applyTableOperation(
	ctx context.Context,
	transaction pgx.Tx,
	schema string,
	table string,
	columnByName map[string]columnDefinition,
	primaryKey []string,
	primaryKeySet map[string]struct{},
	operation TableOperation,
) error {
	switch operation.Type {
	case "insert":
		return service.applyInsertOperation(
			ctx,
			transaction,
			schema,
			table,
			columnByName,
			primaryKeySet,
			operation,
		)
	case "update":
		return service.applyUpdateOperation(
			ctx,
			transaction,
			schema,
			table,
			columnByName,
			primaryKey,
			primaryKeySet,
			operation,
		)
	case "delete":
		return service.applyDeleteOperation(
			ctx,
			transaction,
			schema,
			table,
			columnByName,
			primaryKey,
			operation,
		)
	default:
		return fmt.Errorf("%w: unsupported operation type %q", ErrInvalidWriteRequest, operation.Type)
	}
}

func (service *Service) applyInsertOperation(
	ctx context.Context,
	transaction pgx.Tx,
	schema string,
	table string,
	columnByName map[string]columnDefinition,
	primaryKeySet map[string]struct{},
	operation TableOperation,
) error {
	columnNames := sortedMapKeys(operation.Values)
	if len(columnNames) == 0 {
		return fmt.Errorf("%w: insert operation requires values", ErrInvalidWriteRequest)
	}

	insertColumns := make([]string, 0, len(columnNames))
	placeholders := make([]string, 0, len(columnNames))
	parameters := make([]interface{}, 0, len(columnNames))

	for index, columnName := range columnNames {
		definition, ok := columnByName[columnName]
		if !ok {
			return fmt.Errorf("%w: column %q does not exist", ErrInvalidWriteRequest, columnName)
		}

		if !isColumnEditable(definition) {
			return fmt.Errorf("%w: column %q is read-only", ErrInvalidWriteRequest, columnName)
		}

		if _, isPrimaryKey := primaryKeySet[columnName]; isPrimaryKey {
			// Allow explicit PK insert values. No special handling required.
		}

		value, err := convertColumnValue(definition, operation.Values[columnName])
		if err != nil {
			return err
		}

		insertColumns = append(insertColumns, quoteIdentifier(columnName))
		placeholders = append(placeholders, fmt.Sprintf("$%d", index+1))
		parameters = append(parameters, value)
	}

	query := fmt.Sprintf(
		"insert into %s.%s (%s) values (%s)",
		quoteIdentifier(schema),
		quoteIdentifier(table),
		strings.Join(insertColumns, ", "),
		strings.Join(placeholders, ", "),
	)

	if _, err := transaction.Exec(ctx, query, parameters...); err != nil {
		return fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	return nil
}

func (service *Service) applyUpdateOperation(
	ctx context.Context,
	transaction pgx.Tx,
	schema string,
	table string,
	columnByName map[string]columnDefinition,
	primaryKey []string,
	primaryKeySet map[string]struct{},
	operation TableOperation,
) error {
	if err := validateRowKey(operation.RowKey, primaryKey); err != nil {
		return err
	}

	changeNames := sortedMapKeys(operation.Changes)
	if len(changeNames) == 0 {
		return fmt.Errorf("%w: update operation requires changes", ErrInvalidWriteRequest)
	}

	setClauses := make([]string, 0, len(changeNames))
	parameters := make([]interface{}, 0, len(changeNames)+len(primaryKey))

	for _, columnName := range changeNames {
		if _, isPrimaryKey := primaryKeySet[columnName]; isPrimaryKey {
			return fmt.Errorf("%w: primary key column %q cannot be edited", ErrInvalidWriteRequest, columnName)
		}

		definition, ok := columnByName[columnName]
		if !ok {
			return fmt.Errorf("%w: column %q does not exist", ErrInvalidWriteRequest, columnName)
		}

		if !isColumnEditable(definition) {
			return fmt.Errorf("%w: column %q is read-only", ErrInvalidWriteRequest, columnName)
		}

		value, err := convertColumnValue(definition, operation.Changes[columnName])
		if err != nil {
			return err
		}

		parameters = append(parameters, value)
		setClauses = append(
			setClauses,
			fmt.Sprintf("%s = $%d", quoteIdentifier(columnName), len(parameters)),
		)
	}

	whereClause, whereParameters, err := buildPrimaryKeyFilter(
		columnByName,
		primaryKey,
		operation.RowKey,
		len(parameters),
	)
	if err != nil {
		return err
	}
	parameters = append(parameters, whereParameters...)

	query := fmt.Sprintf(
		"update %s.%s set %s where %s",
		quoteIdentifier(schema),
		quoteIdentifier(table),
		strings.Join(setClauses, ", "),
		whereClause,
	)

	commandTag, err := transaction.Exec(ctx, query, parameters...)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	if commandTag.RowsAffected() != 1 {
		return fmt.Errorf("%w: update target no longer matches current rows", ErrWriteConflict)
	}

	return nil
}

func (service *Service) applyDeleteOperation(
	ctx context.Context,
	transaction pgx.Tx,
	schema string,
	table string,
	columnByName map[string]columnDefinition,
	primaryKey []string,
	operation TableOperation,
) error {
	if err := validateRowKey(operation.RowKey, primaryKey); err != nil {
		return err
	}

	whereClause, parameters, err := buildPrimaryKeyFilter(
		columnByName,
		primaryKey,
		operation.RowKey,
		0,
	)
	if err != nil {
		return err
	}

	query := fmt.Sprintf(
		"delete from %s.%s where %s",
		quoteIdentifier(schema),
		quoteIdentifier(table),
		whereClause,
	)

	commandTag, err := transaction.Exec(ctx, query, parameters...)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	if commandTag.RowsAffected() != 1 {
		return fmt.Errorf("%w: delete target no longer matches current rows", ErrWriteConflict)
	}

	return nil
}

func (service *Service) listColumnDefinitions(
	ctx context.Context,
	runner queryRunner,
	schema string,
	table string,
) ([]columnDefinition, error) {
	rows, err := runner.Query(
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
	runner queryRunner,
	schema string,
	table string,
) ([]geometryColumnDefinition, error) {
	rows, err := runner.Query(
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

func (service *Service) listPrimaryKeyColumns(
	ctx context.Context,
	runner queryRunner,
	schema string,
	table string,
) ([]string, error) {
	rows, err := runner.Query(
		ctx,
		`
		select attribute.attname
		from pg_index as idx
		join pg_class as class on class.oid = idx.indrelid
		join pg_namespace as namespace on namespace.oid = class.relnamespace
		join unnest(idx.indkey) with ordinality as key(attnum, position) on true
		join pg_attribute as attribute
		  on attribute.attrelid = class.oid
		 and attribute.attnum = key.attnum
		where namespace.nspname = $1
		  and class.relname = $2
		  and idx.indisprimary
		order by key.position
		`,
		schema,
		table,
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}
	defer rows.Close()

	primaryKey := make([]string, 0)
	for rows.Next() {
		var columnName string
		if err := rows.Scan(&columnName); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
		}
		primaryKey = append(primaryKey, columnName)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	return primaryKey, nil
}

func (service *Service) getTableAccess(
	ctx context.Context,
	runner queryRunner,
	schema string,
	table string,
) (tableAccess, error) {
	var access tableAccess

	if err := runner.QueryRow(
		ctx,
		`
		select
		  case c.relkind
		    when 'r' then 'table'
		    when 'p' then 'partitioned table'
		    when 'v' then 'view'
		    when 'm' then 'materialized view'
		    else c.relkind::text
		  end as kind,
		  has_table_privilege(format('%I.%I', n.nspname, c.relname), 'SELECT'),
		  has_table_privilege(format('%I.%I', n.nspname, c.relname), 'INSERT'),
		  has_table_privilege(format('%I.%I', n.nspname, c.relname), 'UPDATE'),
		  has_table_privilege(format('%I.%I', n.nspname, c.relname), 'DELETE')
		from pg_class as c
		join pg_namespace as n on n.oid = c.relnamespace
		where n.nspname = $1 and c.relname = $2
		`,
		schema,
		table,
	).Scan(
		&access.Kind,
		&access.CanRead,
		&access.CanInsert,
		&access.CanUpdate,
		&access.CanDelete,
	); err != nil {
		return tableAccess{}, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	return access, nil
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

func validateRowKey(
	rowKey map[string]interface{},
	primaryKey []string,
) error {
	if len(primaryKey) == 0 {
		return fmt.Errorf("%w: selected table has no primary key", ErrInvalidWriteRequest)
	}

	if len(rowKey) != len(primaryKey) {
		return fmt.Errorf("%w: row key must include full primary key", ErrInvalidWriteRequest)
	}

	for _, columnName := range primaryKey {
		if _, ok := rowKey[columnName]; !ok {
			return fmt.Errorf("%w: row key missing %q", ErrInvalidWriteRequest, columnName)
		}
	}

	return nil
}

func buildPrimaryKeyFilter(
	columnByName map[string]columnDefinition,
	primaryKey []string,
	rowKey map[string]interface{},
	parameterOffset int,
) (string, []interface{}, error) {
	parameters := make([]interface{}, 0, len(primaryKey))
	whereParts := make([]string, 0, len(primaryKey))

	for _, columnName := range primaryKey {
		definition, ok := columnByName[columnName]
		if !ok {
			return "", nil, fmt.Errorf("%w: primary key column %q does not exist", ErrInvalidWriteRequest, columnName)
		}

		value, err := convertColumnValue(definition, rowKey[columnName])
		if err != nil {
			return "", nil, err
		}

		parameters = append(parameters, value)
		whereParts = append(
			whereParts,
			fmt.Sprintf("%s = $%d", quoteIdentifier(columnName), parameterOffset+len(parameters)),
		)
	}

	return strings.Join(whereParts, " and "), parameters, nil
}

func isColumnEditable(definition columnDefinition) bool {
	if definition.UdtName == "geometry" || definition.UdtName == "geography" {
		return false
	}

	switch definition.UdtName {
	case "int2", "int4", "int8", "float4", "float8", "numeric", "bool", "text", "varchar", "bpchar", "uuid", "date", "timestamp", "timestamptz":
		return true
	default:
		return false
	}
}

func convertColumnValue(
	definition columnDefinition,
	value interface{},
) (interface{}, error) {
	if value == nil {
		return nil, nil
	}

	switch definition.UdtName {
	case "int2", "int4", "int8":
		return convertIntegerValue(definition.Name, value)
	case "float4", "float8", "numeric":
		return convertFloatValue(definition.Name, value)
	case "bool":
		typed, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("%w: column %q expects boolean value", ErrInvalidWriteRequest, definition.Name)
		}
		return typed, nil
	case "text", "varchar", "bpchar", "uuid", "date", "timestamp", "timestamptz":
		typed, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("%w: column %q expects string value", ErrInvalidWriteRequest, definition.Name)
		}
		return typed, nil
	default:
		return nil, fmt.Errorf("%w: column %q is not editable", ErrInvalidWriteRequest, definition.Name)
	}
}

func convertIntegerValue(columnName string, value interface{}) (int64, error) {
	switch typed := value.(type) {
	case float64:
		if math.Trunc(typed) != typed {
			return 0, fmt.Errorf("%w: column %q expects integer value", ErrInvalidWriteRequest, columnName)
		}
		return int64(typed), nil
	case int64:
		return typed, nil
	case int:
		return int64(typed), nil
	case string:
		parsed, err := strconv.ParseInt(typed, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("%w: column %q expects integer value", ErrInvalidWriteRequest, columnName)
		}
		return parsed, nil
	default:
		return 0, fmt.Errorf("%w: column %q expects integer value", ErrInvalidWriteRequest, columnName)
	}
}

func convertFloatValue(columnName string, value interface{}) (float64, error) {
	switch typed := value.(type) {
	case float64:
		return typed, nil
	case int64:
		return float64(typed), nil
	case int:
		return float64(typed), nil
	case string:
		parsed, err := strconv.ParseFloat(typed, 64)
		if err != nil {
			return 0, fmt.Errorf("%w: column %q expects numeric value", ErrInvalidWriteRequest, columnName)
		}
		return parsed, nil
	default:
		return 0, fmt.Errorf("%w: column %q expects numeric value", ErrInvalidWriteRequest, columnName)
	}
}

func sortedMapKeys(values map[string]interface{}) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
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

func quoteLiteral(value string) string {
	return `'` + strings.ReplaceAll(value, `'`, `''`) + `'`
}

func normalizeValue(value interface{}) interface{} {
	switch typed := value.(type) {
	case nil:
		return nil
	case time.Time:
		return typed.Format(time.RFC3339)
	case map[string]interface{}:
		normalized := make(map[string]interface{}, len(typed))
		for key, item := range typed {
			normalized[key] = normalizeValue(item)
		}
		return normalized
	case []interface{}:
		normalized := make([]interface{}, 0, len(typed))
		for _, item := range typed {
			normalized = append(normalized, normalizeValue(item))
		}
		return normalized
	case []byte:
		return string(typed)
	default:
		return typed
	}
}
