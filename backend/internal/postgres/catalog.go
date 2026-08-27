package postgres

import (
	"context"
	"encoding/json"
	"fmt"
)

func (service *Service) ListSchemas(
	ctx context.Context,
	request ConnectionTestRequest,
) (*ListSchemasResult, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, request)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	if err := service.ensureSchemaDisplayConfigStore(timeoutCtx, conn); err != nil {
		return nil, err
	}

	rows, err := conn.Query(
		timeoutCtx,
		`
		select
		  n.nspname as schema_name,
		  coalesce(config.alias, '') as alias,
		  coalesce(config.visible, true) as visible
		from pg_namespace n
		left join _geopanel.schema_display_configs config
		  on config.schema_name = n.nspname
		where n.nspname not in ('pg_catalog', 'information_schema')
		  and n.nspname not like 'pg_toast%'
		  and n.nspname not like 'pg_temp_%'
		  and exists (
		    select 1
		    from pg_class c
		    where c.relnamespace = n.oid
		      and c.relkind in ('r', 'p', 'v', 'm')
		      and has_table_privilege(format('%I.%I', n.nspname, c.relname), 'SELECT')
		  )
		order by n.nspname
		`,
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	defer rows.Close()

	schemas := make([]SchemaSummary, 0)
	for rows.Next() {
		var schema SchemaSummary
		if err := rows.Scan(&schema.Name, &schema.Alias, &schema.Visible); err != nil {
			return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
		}
		schemas = append(schemas, schema)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return &ListSchemasResult{
		Schemas: schemas,
	}, nil
}

func (service *Service) SaveSchemaDisplayConfigs(
	ctx context.Context,
	request SaveSchemaDisplayConfigsRequest,
) ([]SchemaDisplayConfig, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, request.ConnectionTestRequest)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	tx, err := conn.Begin(timeoutCtx)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	defer tx.Rollback(context.Background())

	if err := service.ensureSchemaDisplayConfigStore(timeoutCtx, tx); err != nil {
		return nil, err
	}

	for _, config := range request.Configs {
		_, err = tx.Exec(
			timeoutCtx,
			`insert into _geopanel.schema_display_configs (schema_name, alias, visible)
			 values ($1, $2, $3)
			 on conflict (schema_name) do update set
			   alias = excluded.alias,
			   visible = excluded.visible,
			   updated_at = now()`,
			config.Schema,
			config.Alias,
			config.Visible,
		)
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
		}
	}

	if err := tx.Commit(timeoutCtx); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return request.Configs, nil
}

func (service *Service) ListSchemaTables(
	ctx context.Context,
	request SchemaTablesRequest,
) (*ListTablesResult, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, request.ConnectionTestRequest)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	return service.listTableSummaries(timeoutCtx, conn, request.Schema)
}

func (service *Service) GetTableMetadata(
	ctx context.Context,
	request TableMetadataRequest,
) (*TableSummary, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, request.ConnectionTestRequest)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	return service.getTableMetadata(timeoutCtx, conn, request.Schema, request.Table)
}

func (service *Service) ListTableDisplayConfigs(
	ctx context.Context,
	request ConnectionTestRequest,
) (*ListTableDisplayConfigsResult, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, request)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	if err := service.ensureTableDisplayConfigStore(timeoutCtx, conn); err != nil {
		return nil, err
	}

	rows, err := conn.Query(
		timeoutCtx,
		`
		select schema_name, table_name, table_alias, column_labels, hidden_columns
		from _geopanel.table_display_configs
		order by schema_name, table_name
		`,
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	defer rows.Close()

	configs := make([]TableDisplayConfig, 0)
	for rows.Next() {
		config := TableDisplayConfig{}
		var columnLabelsJSON []byte
		if err := rows.Scan(
			&config.Schema,
			&config.Table,
			&config.TableAlias,
			&columnLabelsJSON,
			&config.HiddenColumns,
		); err != nil {
			return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
		}

		if len(columnLabelsJSON) > 0 {
			if err := json.Unmarshal(columnLabelsJSON, &config.ColumnLabels); err != nil {
				return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
			}
		}
		if config.ColumnLabels == nil {
			config.ColumnLabels = map[string]string{}
		}
		if config.HiddenColumns == nil {
			config.HiddenColumns = []string{}
		}
		configs = append(configs, config)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return &ListTableDisplayConfigsResult{
		Configs: configs,
	}, nil
}

func (service *Service) SaveTableDisplayConfig(
	ctx context.Context,
	request SaveTableDisplayConfigRequest,
) (*TableDisplayConfig, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, request.ConnectionTestRequest)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	if err := service.ensureTableDisplayConfigStore(timeoutCtx, conn); err != nil {
		return nil, err
	}

	columnLabelsJSON, err := json.Marshal(request.ColumnLabels)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidWriteRequest, err)
	}

	config := TableDisplayConfig{
		Schema:        request.Schema,
		Table:         request.Table,
		TableAlias:    request.TableAlias,
		ColumnLabels:  request.ColumnLabels,
		HiddenColumns: request.HiddenColumns,
	}
	if config.ColumnLabels == nil {
		config.ColumnLabels = map[string]string{}
	}
	if config.HiddenColumns == nil {
		config.HiddenColumns = []string{}
	}

	_, err = conn.Exec(
		timeoutCtx,
		`
		insert into _geopanel.table_display_configs (
		  schema_name,
		  table_name,
		  table_alias,
		  column_labels,
		  hidden_columns
		)
		values ($1, $2, $3, $4::jsonb, $5)
		on conflict (schema_name, table_name) do update set
		  table_alias = excluded.table_alias,
		  column_labels = excluded.column_labels,
		  hidden_columns = excluded.hidden_columns,
		  updated_at = now()
		`,
		request.Schema,
		request.Table,
		request.TableAlias,
		string(columnLabelsJSON),
		request.HiddenColumns,
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return &config, nil
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

	result, err := service.listTableSummaries(timeoutCtx, conn, "")
	if err != nil {
		return nil, err
	}

	tables := result.Tables
	for index := range tables {
		metadata, err := service.getTableMetadata(
			timeoutCtx,
			conn,
			tables[index].Schema,
			tables[index].Name,
		)
		if err != nil {
			return nil, err
		}
		metadata.RowEstimate = tables[index].RowEstimate
		tables[index] = *metadata
	}

	return &ListTablesResult{
		Tables: tables,
	}, nil
}

func (service *Service) listTableSummaries(
	ctx context.Context,
	runner queryRunner,
	schema string,
) (*ListTablesResult, error) {
	schemaFilter := ""
	parameters := make([]interface{}, 0, 1)
	if schema != "" {
		schemaFilter = " and n.nspname = $1"
		parameters = append(parameters, schema)
	}

	rows, err := runner.Query(
		ctx,
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
		`+schemaFilter+`
		order by n.nspname, c.relname
		`,
		parameters...,
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
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
			return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
		}
		table.FullName = fmt.Sprintf("%s.%s", table.Schema, table.Name)
		tables = append(tables, table)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return &ListTablesResult{
		Tables: tables,
	}, nil
}

func (service *Service) getTableMetadata(
	ctx context.Context,
	runner queryRunner,
	schema string,
	table string,
) (*TableSummary, error) {
	access, err := service.getTableAccess(ctx, runner, schema, table)
	if err != nil {
		return nil, err
	}

	columnDefinitions, err := service.listColumnDefinitions(ctx, runner, schema, table)
	if err != nil {
		return nil, err
	}

	columns := make([]ColumnMeta, 0, len(columnDefinitions))
	for _, column := range columnDefinitions {
		columns = append(columns, ColumnMeta{
			Name: column.Name,
			Type: displayColumnType(column),
		})
	}

	primaryKey, err := service.listPrimaryKeyColumns(ctx, runner, schema, table)
	if err != nil {
		return nil, err
	}

	geometryDefinitions, err := service.listGeometryColumns(ctx, runner, schema, table)
	if err != nil {
		return nil, err
	}

	geometryColumns := make([]GeometryColumnMeta, 0, len(geometryDefinitions))
	for _, geometryColumn := range geometryDefinitions {
		geometryColumns = append(geometryColumns, GeometryColumnMeta{
			Name:         geometryColumn.Name,
			StorageType:  geometryColumn.StorageType,
			GeometryType: geometryColumn.GeometryType,
			SRID:         geometryColumn.SRID,
		})
	}

	foreignKeys, err := service.listForeignKeys(ctx, runner, schema, table)
	if err != nil {
		return nil, err
	}

	return &TableSummary{
		Schema:          schema,
		Name:            table,
		FullName:        fmt.Sprintf("%s.%s", schema, table),
		Kind:            access.Kind,
		PrimaryKey:      primaryKey,
		IsEditable:      isEditableTable(access, primaryKey),
		Columns:         columns,
		GeometryColumns: geometryColumns,
		ForeignKeys:     foreignKeys,
	}, nil
}

func (service *Service) ensureTableDisplayConfigStore(
	ctx context.Context,
	runner queryRunner,
) error {
	_, err := runner.Exec(
		ctx,
		`
		create schema if not exists _geopanel;

		create table if not exists _geopanel.table_display_configs (
		  schema_name text not null,
		  table_name text not null,
		  table_alias text not null default '',
		  column_labels jsonb not null default '{}'::jsonb,
		  hidden_columns text[] not null default '{}'::text[],
		  updated_at timestamptz not null default now(),
		  primary key (schema_name, table_name)
		);
		`,
	)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return nil
}

func (service *Service) ensureSchemaDisplayConfigStore(
	ctx context.Context,
	runner queryRunner,
) error {
	_, err := runner.Exec(
		ctx,
		`
		create schema if not exists _geopanel;

		create table if not exists _geopanel.schema_display_configs (
		  schema_name text primary key,
		  alias text not null default '',
		  visible boolean not null default true,
		  updated_at timestamptz not null default now()
		);
		`,
	)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return nil
}
