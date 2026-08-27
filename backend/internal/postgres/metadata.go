package postgres

import (
	"context"
	"fmt"
	"slices"
	"strings"
)

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
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	defer rows.Close()

	definitions := make([]columnDefinition, 0)
	for rows.Next() {
		var definition columnDefinition
		if err := rows.Scan(&definition.Name, &definition.Type, &definition.UdtName); err != nil {
			return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
		}
		definitions = append(definitions, definition)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
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
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
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
			return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
		}
		definitions = append(definitions, definition)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return definitions, nil
}

func (service *Service) listForeignKeys(
	ctx context.Context,
	runner queryRunner,
	schema string,
	table string,
) ([]ForeignKeyMeta, error) {
	rows, err := runner.Query(
		ctx,
		`
		select
		  source_attribute.attname as column_name,
		  target_namespace.nspname as target_schema,
		  target_class.relname as target_table,
		  target_attribute.attname as target_column
		from pg_constraint constraint_row
		join pg_class source_class on source_class.oid = constraint_row.conrelid
		join pg_namespace source_namespace on source_namespace.oid = source_class.relnamespace
		join pg_class target_class on target_class.oid = constraint_row.confrelid
		join pg_namespace target_namespace on target_namespace.oid = target_class.relnamespace
		join pg_attribute source_attribute
		  on source_attribute.attrelid = source_class.oid
		  and source_attribute.attnum = constraint_row.conkey[1]
		join pg_attribute target_attribute
		  on target_attribute.attrelid = target_class.oid
		  and target_attribute.attnum = constraint_row.confkey[1]
		where constraint_row.contype = 'f'
		  and array_length(constraint_row.conkey, 1) = 1
		  and array_length(constraint_row.confkey, 1) = 1
		  and source_namespace.nspname = $1
		  and source_class.relname = $2
		order by source_attribute.attnum
		`,
		schema,
		table,
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	relations := make([]ForeignKeyMeta, 0)
	for rows.Next() {
		var relation ForeignKeyMeta
		if err := rows.Scan(
			&relation.ColumnName,
			&relation.TargetSchema,
			&relation.TargetTable,
			&relation.TargetColumn,
		); err != nil {
			return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
		}
		relations = append(relations, relation)
	}

	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	rows.Close()

	for index := range relations {
		labelColumns, defaultLabelColumn, err := service.relationLabelColumns(
			ctx,
			runner,
			relations[index].TargetSchema,
			relations[index].TargetTable,
			relations[index].TargetColumn,
		)
		if err != nil {
			return nil, err
		}
		relations[index].LabelColumns = labelColumns
		relations[index].DefaultLabelColumn = defaultLabelColumn
	}

	return relations, nil
}

func (service *Service) listReferencingForeignKeys(
	ctx context.Context,
	runner queryRunner,
	schema string,
	table string,
) ([]ForeignKeyMeta, error) {
	rows, err := runner.Query(
		ctx,
		`
		select
		  source_attribute.attname as column_name,
		  source_namespace.nspname as source_schema,
		  source_class.relname as source_table,
		  target_attribute.attname as target_column
		from pg_constraint constraint_row
		join pg_class source_class on source_class.oid = constraint_row.conrelid
		join pg_namespace source_namespace on source_namespace.oid = source_class.relnamespace
		join pg_class target_class on target_class.oid = constraint_row.confrelid
		join pg_namespace target_namespace on target_namespace.oid = target_class.relnamespace
		join pg_attribute source_attribute
		  on source_attribute.attrelid = source_class.oid
		  and source_attribute.attnum = constraint_row.conkey[1]
		join pg_attribute target_attribute
		  on target_attribute.attrelid = target_class.oid
		  and target_attribute.attnum = constraint_row.confkey[1]
		where constraint_row.contype = 'f'
		  and array_length(constraint_row.conkey, 1) = 1
		  and array_length(constraint_row.confkey, 1) = 1
		  and target_namespace.nspname = $1
		  and target_class.relname = $2
		order by source_namespace.nspname, source_class.relname, source_attribute.attnum
		`,
		schema,
		table,
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	defer rows.Close()

	relations := make([]ForeignKeyMeta, 0)
	for rows.Next() {
		var relation ForeignKeyMeta
		if err := rows.Scan(
			&relation.ColumnName,
			&relation.TargetSchema,
			&relation.TargetTable,
			&relation.TargetColumn,
		); err != nil {
			return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
		}
		relations = append(relations, relation)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return relations, nil
}

func (service *Service) relationLabelColumns(
	ctx context.Context,
	runner queryRunner,
	schema string,
	table string,
	targetColumn string,
) ([]string, string, error) {
	definitions, err := service.listColumnDefinitions(ctx, runner, schema, table)
	if err != nil {
		return nil, "", err
	}

	preferredNames := []string{"name", "title", "label", "display_name", "code"}
	labelColumns := make([]string, 0)
	for _, preferredName := range preferredNames {
		for _, definition := range definitions {
			if definition.Name == targetColumn || definition.Name != preferredName {
				continue
			}
			if isTextLikeColumn(definition) {
				labelColumns = append(labelColumns, definition.Name)
			}
		}
	}
	for _, definition := range definitions {
		if len(labelColumns) >= 6 {
			break
		}
		if definition.Name == targetColumn || !isTextLikeColumn(definition) {
			continue
		}
		if !slices.Contains(labelColumns, definition.Name) {
			labelColumns = append(labelColumns, definition.Name)
		}
	}

	defaultLabelColumn := ""
	if len(labelColumns) > 0 {
		defaultLabelColumn = labelColumns[0]
	}

	return labelColumns, defaultLabelColumn, nil
}

func (service *Service) prepareRelationLookup(
	ctx context.Context,
	runner queryRunner,
	schema string,
	table string,
	column string,
	requestedLabelColumns []string,
) (ForeignKeyMeta, columnDefinition, []columnDefinition, error) {
	relations, err := service.listForeignKeys(ctx, runner, schema, table)
	if err != nil {
		return ForeignKeyMeta{}, columnDefinition{}, nil, err
	}

	var relation *ForeignKeyMeta
	for index := range relations {
		if relations[index].ColumnName == column {
			relation = &relations[index]
			break
		}
	}
	if relation == nil {
		return ForeignKeyMeta{}, columnDefinition{}, nil, fmt.Errorf("%w: selected column is not a foreign key", ErrInvalidWriteRequest)
	}

	definitions, err := service.listColumnDefinitions(ctx, runner, relation.TargetSchema, relation.TargetTable)
	if err != nil {
		return ForeignKeyMeta{}, columnDefinition{}, nil, err
	}
	var targetColumn *columnDefinition
	definitionByName := make(map[string]columnDefinition, len(definitions))
	for index := range definitions {
		definitionByName[definitions[index].Name] = definitions[index]
		if definitions[index].Name == relation.TargetColumn {
			targetColumn = &definitions[index]
		}
	}
	if targetColumn == nil {
		return ForeignKeyMeta{}, columnDefinition{}, nil, fmt.Errorf("%w: foreign key target column not found", ErrConnectionFailed)
	}

	labelNames := requestedLabelColumns
	if len(labelNames) == 0 && relation.DefaultLabelColumn != "" {
		labelNames = []string{relation.DefaultLabelColumn}
	}
	labelColumns := make([]columnDefinition, 0, len(labelNames))
	for _, labelName := range labelNames {
		definition, ok := definitionByName[labelName]
		if !ok || definition.Name == relation.TargetColumn || !isTextLikeColumn(definition) {
			continue
		}
		labelColumns = append(labelColumns, definition)
	}

	return *relation, *targetColumn, labelColumns, nil
}

func queryRelationOptions(
	ctx context.Context,
	runner queryRunner,
	relation ForeignKeyMeta,
	targetColumn columnDefinition,
	labelColumns []columnDefinition,
	whereClause string,
	limitClause string,
	parameters []interface{},
) ([]RelationOption, error) {
	selectExpressions := []string{
		fmt.Sprintf("source_row.%s", quoteIdentifier(relation.TargetColumn)),
	}
	for _, labelColumn := range labelColumns {
		selectExpressions = append(
			selectExpressions,
			fmt.Sprintf("source_row.%s", quoteIdentifier(labelColumn.Name)),
		)
	}
	queryWhereClause := ""
	if whereClause != "" {
		queryWhereClause = " where " + whereClause
	}

	orderParts := make([]string, 0, len(labelColumns)+1)
	for _, labelColumn := range labelColumns {
		orderParts = append(orderParts, fmt.Sprintf("source_row.%s", quoteIdentifier(labelColumn.Name)))
	}
	orderParts = append(orderParts, fmt.Sprintf("source_row.%s", quoteIdentifier(relation.TargetColumn)))

	query := fmt.Sprintf(
		`select %s from %s.%s as source_row%s order by %s %s`,
		strings.Join(selectExpressions, ", "),
		quoteIdentifier(relation.TargetSchema),
		quoteIdentifier(relation.TargetTable),
		queryWhereClause,
		strings.Join(orderParts, ", "),
		limitClause,
	)

	rows, err := runner.Query(ctx, query, parameters...)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	defer rows.Close()

	options := make([]RelationOption, 0)
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
		}

		rawValue := normalizeValue(values[0])
		labelValues := make(map[string]interface{}, len(labelColumns))
		labelParts := make([]string, 0, len(labelColumns))
		for index, labelColumn := range labelColumns {
			value := normalizeValue(values[index+1])
			labelValues[labelColumn.Name] = value
			if value != nil && fmt.Sprint(value) != "" {
				labelParts = append(labelParts, fmt.Sprint(value))
			}
		}
		label := strings.Join(labelParts, " · ")
		if label == "" {
			label = fmt.Sprintf("#%v", rawValue)
		}
		options = append(options, RelationOption{
			Value:  normalizeValueForColumn(targetColumn, rawValue),
			Label:  label,
			Values: labelValues,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return options, nil
}

func normalizeValueForColumn(_ columnDefinition, value interface{}) interface{} {
	return value
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
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	defer rows.Close()

	primaryKey := make([]string, 0)
	for rows.Next() {
		var columnName string
		if err := rows.Scan(&columnName); err != nil {
			return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
		}
		primaryKey = append(primaryKey, columnName)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
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
		return tableAccess{}, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return access, nil
}
