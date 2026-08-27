package postgres

import (
	"context"
	"fmt"
	"strings"
)

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
	searchExpressions := make([]string, 0, len(columnDefinitions))

	for _, column := range columnDefinitions {
		selectExpressions = append(selectExpressions, columnSelectExpression(column))
		columns = append(columns, ColumnMeta{
			Name: column.Name,
			Type: displayColumnType(column),
		})
		if isColumnSearchable(column) {
			searchExpressions = append(searchExpressions, columnSearchExpression(column))
		}
	}

	parameters := make([]interface{}, 0, 3)
	whereClauses := make([]string, 0, 2)
	if request.Search != "" && len(searchExpressions) > 0 {
		parameters = append(parameters, "%"+request.Search+"%")
		searchPlaceholder := fmt.Sprintf("$%d", len(parameters))
		searchTerms := make([]string, 0, len(searchExpressions))

		for _, expression := range searchExpressions {
			searchTerms = append(
				searchTerms,
				fmt.Sprintf("%s ILIKE %s", expression, searchPlaceholder),
			)
		}

		whereClauses = append(
			whereClauses,
			fmt.Sprintf("(%s)", strings.Join(searchTerms, " or ")),
		)
	}

	filterClause, filterParameters, err := buildQueryFilterClause(
		columnDefinitions,
		request.Filter,
		len(parameters),
	)
	if err != nil {
		return nil, err
	}
	if filterClause != "" {
		parameters = append(parameters, filterParameters...)
		whereClauses = append(whereClauses, fmt.Sprintf("(%s)", filterClause))
	}

	whereClause := ""
	if len(whereClauses) > 0 {
		whereClause = fmt.Sprintf(" where %s", strings.Join(whereClauses, " and "))
	}

	var totalRows int64
	countQuery := fmt.Sprintf(
		`select count(*) from %s.%s as source_row%s`,
		quoteIdentifier(request.Schema),
		quoteIdentifier(request.Table),
		whereClause,
	)
	if err := conn.QueryRow(timeoutCtx, countQuery, parameters...).Scan(&totalRows); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	orderByClause := ""
	if len(primaryKey) > 0 {
		orderedPrimaryKey := make([]string, 0, len(primaryKey))
		for _, columnName := range primaryKey {
			orderedPrimaryKey = append(orderedPrimaryKey, quoteIdentifier(columnName))
		}
		orderByClause = fmt.Sprintf(" order by %s", strings.Join(orderedPrimaryKey, ", "))
	}

	parameters = append(parameters, request.Limit+1, request.Offset)
	limitPlaceholder := fmt.Sprintf("$%d", len(parameters)-1)
	offsetPlaceholder := fmt.Sprintf("$%d", len(parameters))

	query := fmt.Sprintf(
		`select %s from %s.%s as source_row%s%s limit %s offset %s`,
		strings.Join(selectExpressions, ", "),
		quoteIdentifier(request.Schema),
		quoteIdentifier(request.Table),
		whereClause,
		orderByClause,
		limitPlaceholder,
		offsetPlaceholder,
	)

	rows, err := conn.Query(timeoutCtx, query, parameters...)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	defer rows.Close()

	records := make([]RowRecord, 0, request.Limit+1)
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
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
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
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
		TotalRows:  totalRows,
		HasMore:    hasMore,
		PrimaryKey: primaryKey,
		IsEditable: isEditableTable(access, primaryKey),
		Columns:    columns,
		Rows:       records,
	}, nil
}

func (service *Service) LookupRows(
	ctx context.Context,
	request LookupRowsRequest,
) (*LookupRowsResult, error) {
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

	columnByName := make(map[string]columnDefinition, len(columnDefinitions))
	selectExpressions := make([]string, 0, len(columnDefinitions))
	columns := make([]ColumnMeta, 0, len(columnDefinitions))
	for _, column := range columnDefinitions {
		columnByName[column.Name] = column
		selectExpressions = append(selectExpressions, columnSelectExpression(column))
		columns = append(columns, ColumnMeta{
			Name: column.Name,
			Type: displayColumnType(column),
		})
	}

	whereClauses := make([]string, 0, len(request.RowKeys))
	parameters := make([]interface{}, 0, len(request.RowKeys)*max(1, len(primaryKey)))
	for _, rowKey := range request.RowKeys {
		if err := validateRowKey(rowKey, primaryKey); err != nil {
			return nil, err
		}

		whereClause, whereParameters, err := buildPrimaryKeyFilter(
			columnByName,
			primaryKey,
			rowKey,
			len(parameters),
		)
		if err != nil {
			return nil, err
		}

		whereClauses = append(whereClauses, fmt.Sprintf("(%s)", whereClause))
		parameters = append(parameters, whereParameters...)
	}

	query := fmt.Sprintf(
		`select %s from %s.%s where %s`,
		strings.Join(selectExpressions, ", "),
		quoteIdentifier(request.Schema),
		quoteIdentifier(request.Table),
		strings.Join(whereClauses, " or "),
	)

	rows, err := conn.Query(timeoutCtx, query, parameters...)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	defer rows.Close()

	recordsByToken := make(map[string]RowRecord, len(request.RowKeys))
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
		}

		record := make(map[string]interface{}, len(columns))
		for index, column := range columns {
			record[column.Name] = normalizeValue(values[index])
		}

		rowRecord := RowRecord{
			RowKey: buildRowKey(record, primaryKey),
			Values: record,
		}
		recordsByToken[rowKeyToken(rowRecord.RowKey, primaryKey)] = rowRecord
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	orderedRows := make([]RowRecord, 0, len(recordsByToken))
	for _, rowKey := range request.RowKeys {
		record, ok := recordsByToken[rowKeyToken(rowKey, primaryKey)]
		if !ok {
			continue
		}
		orderedRows = append(orderedRows, record)
	}

	return &LookupRowsResult{
		Schema:            request.Schema,
		Table:             request.Table,
		RequestedRowCount: len(request.RowKeys),
		MatchedRowCount:   len(orderedRows),
		PrimaryKey:        primaryKey,
		Columns:           columns,
		Rows:              orderedRows,
	}, nil
}
