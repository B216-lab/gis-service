package postgres

import (
	"context"
	"fmt"
	"strings"
)

func (service *Service) ListRelatedRows(
	ctx context.Context,
	request RelatedRowsRequest,
) (*RelatedRowsResult, error) {
	if err := request.Validate(); err != nil {
		return nil, err
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, request.ConnectionTestRequest)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	primaryKey, err := service.listPrimaryKeyColumns(
		timeoutCtx,
		conn,
		request.Schema,
		request.Table,
	)
	if err != nil {
		return nil, err
	}
	if err := validateRowKey(request.RowKey, primaryKey); err != nil {
		return nil, err
	}

	referencingRelations, err := service.listReferencingForeignKeys(
		timeoutCtx,
		conn,
		request.Schema,
		request.Table,
	)
	if err != nil {
		return nil, err
	}
	foreignKeys, err := service.listForeignKeys(
		timeoutCtx,
		conn,
		request.Schema,
		request.Table,
	)
	if err != nil {
		return nil, err
	}
	foreignKeyValues, err := service.loadRowColumnValues(
		timeoutCtx,
		conn,
		request.Schema,
		request.Table,
		primaryKey,
		request.RowKey,
		foreignKeys,
	)
	if err != nil {
		return nil, err
	}

	limit := request.Limit
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	groups := make([]RelatedRowsGroup, 0, len(referencingRelations)+len(foreignKeys))
	for _, relation := range referencingRelations {
		sourceValue, ok := request.RowKey[relation.TargetColumn]
		if !ok || sourceValue == nil {
			continue
		}

		group, err := service.listRelatedRowsForRelation(
			timeoutCtx,
			conn,
			relation,
			sourceValue,
			limit,
		)
		if err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	for _, foreignKey := range foreignKeys {
		sourceValue := foreignKeyValues[foreignKey.ColumnName]
		if sourceValue == nil {
			continue
		}

		relation := ForeignKeyMeta{
			ColumnName:   foreignKey.TargetColumn,
			TargetSchema: foreignKey.TargetSchema,
			TargetTable:  foreignKey.TargetTable,
			TargetColumn: foreignKey.ColumnName,
		}
		group, err := service.listRelatedRowsForRelation(
			timeoutCtx,
			conn,
			relation,
			sourceValue,
			limit,
		)
		if err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}

	return &RelatedRowsResult{
		Groups: groups,
	}, nil
}

func (service *Service) loadRowColumnValues(
	ctx context.Context,
	runner queryRunner,
	schema string,
	table string,
	primaryKey []string,
	rowKey map[string]interface{},
	foreignKeys []ForeignKeyMeta,
) (map[string]interface{}, error) {
	if len(foreignKeys) == 0 {
		return map[string]interface{}{}, nil
	}

	columnDefinitions, err := service.listColumnDefinitions(ctx, runner, schema, table)
	if err != nil {
		return nil, err
	}
	columnByName := make(map[string]columnDefinition, len(columnDefinitions))
	for _, definition := range columnDefinitions {
		columnByName[definition.Name] = definition
	}

	columnNames := make([]string, 0, len(foreignKeys))
	seenColumns := make(map[string]struct{}, len(foreignKeys))
	for _, foreignKey := range foreignKeys {
		if _, seen := seenColumns[foreignKey.ColumnName]; seen {
			continue
		}
		seenColumns[foreignKey.ColumnName] = struct{}{}
		columnNames = append(columnNames, foreignKey.ColumnName)
	}

	whereClause, parameters, err := buildPrimaryKeyFilter(
		columnByName,
		primaryKey,
		rowKey,
		0,
	)
	if err != nil {
		return nil, err
	}
	selectExpressions := make([]string, 0, len(columnNames))
	for _, columnName := range columnNames {
		selectExpressions = append(selectExpressions, quoteIdentifier(columnName))
	}
	query := fmt.Sprintf(
		`select %s from %s.%s where %s`,
		strings.Join(selectExpressions, ", "),
		quoteIdentifier(schema),
		quoteIdentifier(table),
		whereClause,
	)

	values := make([]interface{}, len(columnNames))
	destinations := make([]interface{}, len(columnNames))
	for index := range values {
		destinations[index] = &values[index]
	}
	if err := runner.QueryRow(ctx, query, parameters...).Scan(destinations...); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	result := make(map[string]interface{}, len(columnNames))
	for index, columnName := range columnNames {
		result[columnName] = normalizeValue(values[index])
	}
	return result, nil
}

func (service *Service) listRelatedRowsForRelation(
	ctx context.Context,
	runner queryRunner,
	relation ForeignKeyMeta,
	sourceValue interface{},
	limit int,
) (RelatedRowsGroup, error) {
	columnDefinitions, err := service.listColumnDefinitions(
		ctx,
		runner,
		relation.TargetSchema,
		relation.TargetTable,
	)
	if err != nil {
		return RelatedRowsGroup{}, err
	}

	access, err := service.getTableAccess(
		ctx,
		runner,
		relation.TargetSchema,
		relation.TargetTable,
	)
	if err != nil {
		return RelatedRowsGroup{}, err
	}

	primaryKey, err := service.listPrimaryKeyColumns(
		ctx,
		runner,
		relation.TargetSchema,
		relation.TargetTable,
	)
	if err != nil {
		return RelatedRowsGroup{}, err
	}

	geometryDefinitions, err := service.listGeometryColumns(
		ctx,
		runner,
		relation.TargetSchema,
		relation.TargetTable,
	)
	if err != nil {
		return RelatedRowsGroup{}, err
	}

	selectExpressions := make([]string, 0, len(columnDefinitions))
	columns := make([]ColumnMeta, 0, len(columnDefinitions))
	for _, column := range columnDefinitions {
		selectExpressions = append(selectExpressions, columnSelectExpression(column))
		columns = append(columns, ColumnMeta{
			Name: column.Name,
			Type: displayColumnType(column),
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
		`select %s from %s.%s as source_row where %s = $1%s limit $2`,
		strings.Join(selectExpressions, ", "),
		quoteIdentifier(relation.TargetSchema),
		quoteIdentifier(relation.TargetTable),
		quoteIdentifier(relation.ColumnName),
		orderByClause,
	)

	rows, err := runner.Query(ctx, query, sourceValue, limit)
	if err != nil {
		return RelatedRowsGroup{}, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	defer rows.Close()

	records := make([]RowRecord, 0, limit)
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return RelatedRowsGroup{}, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
		}

		record := make(map[string]interface{}, len(columns))
		for index, column := range columns {
			record[column.Name] = normalizeValue(values[index])
		}
		records = append(records, RowRecord{
			RowKey: buildRowKey(record, primaryKey),
			Values: record,
		})
	}
	if err := rows.Err(); err != nil {
		return RelatedRowsGroup{}, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
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

	return RelatedRowsGroup{
		Label:           relation.TargetTable,
		Schema:          relation.TargetSchema,
		Table:           relation.TargetTable,
		SourceColumn:    relation.TargetColumn,
		TargetColumn:    relation.ColumnName,
		PrimaryKey:      primaryKey,
		IsEditable:      isEditableTable(access, primaryKey),
		Columns:         columns,
		GeometryColumns: geometryColumns,
		Rows:            records,
	}, nil
}

func (service *Service) ListRelationLabels(
	ctx context.Context,
	request RelationLabelsRequest,
) (*RelationLabelsResult, error) {
	if err := request.Validate(); err != nil {
		return nil, err
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, request.ConnectionTestRequest)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	relation, targetColumn, labelColumns, err := service.prepareRelationLookup(
		timeoutCtx,
		conn,
		request.Schema,
		request.Table,
		request.Column,
		request.LabelColumns,
	)
	if err != nil {
		return nil, err
	}

	parameters := make([]interface{}, 0, len(request.Values))
	placeholders := make([]string, 0, len(request.Values))
	for _, value := range request.Values {
		convertedValue, err := convertColumnValue(targetColumn, value)
		if err != nil {
			continue
		}
		parameters = append(parameters, convertedValue)
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(parameters)))
	}
	if len(parameters) == 0 {
		return &RelationLabelsResult{Options: []RelationOption{}}, nil
	}

	options, err := queryRelationOptions(
		timeoutCtx,
		conn,
		relation,
		targetColumn,
		labelColumns,
		fmt.Sprintf(
			"source_row.%s in (%s)",
			quoteIdentifier(relation.TargetColumn),
			strings.Join(placeholders, ", "),
		),
		"",
		parameters,
	)
	if err != nil {
		return nil, err
	}

	return &RelationLabelsResult{Options: options}, nil
}

func (service *Service) ListRelationOptions(
	ctx context.Context,
	request RelationOptionsRequest,
) (*RelationOptionsResult, error) {
	if err := request.Validate(); err != nil {
		return nil, err
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, request.ConnectionTestRequest)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	relation, targetColumn, labelColumns, err := service.prepareRelationLookup(
		timeoutCtx,
		conn,
		request.Schema,
		request.Table,
		request.Column,
		request.LabelColumns,
	)
	if err != nil {
		return nil, err
	}

	parameters := make([]interface{}, 0, 2)
	whereClause := ""
	if request.Search != "" {
		parameters = append(parameters, "%"+request.Search+"%")
		searchPlaceholder := fmt.Sprintf("$%d", len(parameters))
		searchParts := []string{
			fmt.Sprintf(
				"source_row.%s::text ilike %s",
				quoteIdentifier(relation.TargetColumn),
				searchPlaceholder,
			),
		}
		for _, labelColumn := range labelColumns {
			searchParts = append(
				searchParts,
				fmt.Sprintf(
					"source_row.%s::text ilike %s",
					quoteIdentifier(labelColumn.Name),
					searchPlaceholder,
				),
			)
		}
		whereClause = fmt.Sprintf("(%s)", strings.Join(searchParts, " or "))
	}

	parameters = append(parameters, request.Limit)
	limitClause := fmt.Sprintf("limit $%d", len(parameters))
	options, err := queryRelationOptions(
		timeoutCtx,
		conn,
		relation,
		targetColumn,
		labelColumns,
		whereClause,
		limitClause,
		parameters,
	)
	if err != nil {
		return nil, err
	}

	return &RelationOptionsResult{Options: options}, nil
}
