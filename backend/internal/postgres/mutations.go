package postgres

import (
	"context"
	"fmt"
	"strings"
)

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
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
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
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	committed = true

	return &CommitTableChangesResult{
		Schema:  request.Schema,
		Table:   request.Table,
		Applied: applied,
	}, nil
}

func (service *Service) CreateFeature(
	ctx context.Context,
	request CreateFeatureRequest,
) (*CreateFeatureResult, error) {
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
		}
	}
	if selectedGeometryColumn == nil {
		return nil, fmt.Errorf(
			"%w: selected geometry column not found on table",
			ErrInvalidWriteRequest,
		)
	}

	columnByName := make(map[string]columnDefinition, len(columnDefinitions))
	for _, definition := range columnDefinitions {
		columnByName[definition.Name] = definition
	}

	insertColumns := make([]string, 0, len(request.Values)+1)
	placeholders := make([]string, 0, len(request.Values)+1)
	parameters := make([]interface{}, 0, len(request.Values)+1)

	for _, columnName := range sortedMapKeys(request.Values) {
		if columnName == request.GeometryColumn {
			return nil, fmt.Errorf(
				"%w: geometry column must be supplied as GeoJSON geometry",
				ErrInvalidWriteRequest,
			)
		}

		definition, ok := columnByName[columnName]
		if !ok {
			return nil, fmt.Errorf("%w: column %q does not exist", ErrInvalidWriteRequest, columnName)
		}
		if !isColumnEditable(definition) {
			return nil, fmt.Errorf("%w: column %q is read-only", ErrInvalidWriteRequest, columnName)
		}

		value, err := convertColumnValue(definition, request.Values[columnName])
		if err != nil {
			return nil, err
		}

		parameters = append(parameters, value)
		insertColumns = append(insertColumns, quoteIdentifier(columnName))
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(parameters)))
	}

	parameters = append(parameters, string(request.Geometry))
	insertColumns = append(insertColumns, quoteIdentifier(request.GeometryColumn))
	placeholders = append(
		placeholders,
		geometryInsertExpression(
			len(parameters),
			selectedGeometryColumn.StorageType,
			selectedGeometryColumn.SRID,
		),
	)

	query := fmt.Sprintf(
		"insert into %s.%s (%s) values (%s)",
		quoteIdentifier(request.Schema),
		quoteIdentifier(request.Table),
		strings.Join(insertColumns, ", "),
		strings.Join(placeholders, ", "),
	)

	if _, err := conn.Exec(timeoutCtx, query, parameters...); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return &CreateFeatureResult{
		Schema: request.Schema,
		Table:  request.Table,
	}, nil
}
