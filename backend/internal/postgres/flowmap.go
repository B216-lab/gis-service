package postgres

import (
	"context"
	"fmt"
	"slices"
	"strings"
)

func (service *Service) ListFlowmapData(
	ctx context.Context,
	request ListFlowmapDataRequest,
) (*ListFlowmapDataResult, error) {
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

	columnDefinitions, err := service.listColumnDefinitions(
		timeoutCtx,
		conn,
		request.Schema,
		request.Table,
	)
	if err != nil {
		return nil, err
	}

	requiredColumns := request.flowmapColumnNames()
	if err := validateColumnNames(columnDefinitions, requiredColumns); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
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
	for _, column := range columnDefinitions {
		columnByName[column.Name] = column
	}

	startLonExpression, startLatExpression := flowmapPointExpressions(
		request.StartMode,
		request.StartLonColumn,
		request.StartLatColumn,
		request.StartGeometryColumn,
	)
	endLonExpression, endLatExpression := flowmapPointExpressions(
		request.EndMode,
		request.EndLonColumn,
		request.EndLatColumn,
		request.EndGeometryColumn,
	)
	startNotNullColumns := flowmapRequiredPointColumns(
		request.StartMode,
		request.StartLonColumn,
		request.StartLatColumn,
		request.StartGeometryColumn,
	)
	endNotNullColumns := flowmapRequiredPointColumns(
		request.EndMode,
		request.EndLonColumn,
		request.EndLatColumn,
		request.EndGeometryColumn,
	)
	notNullColumns := append(startNotNullColumns, endNotNullColumns...)
	if request.MagnitudeColumn != "" {
		notNullColumns = append(notNullColumns, request.MagnitudeColumn)
	}
	notNullPredicates := make([]string, 0, len(notNullColumns))
	for _, columnName := range notNullColumns {
		notNullPredicates = append(
			notNullPredicates,
			fmt.Sprintf("source_row.%s is not null", quoteIdentifier(columnName)),
		)
	}

	magnitudeExpression := fmt.Sprintf("%f::double precision", request.DefaultMagnitude)
	if request.MagnitudeColumn != "" {
		magnitudeExpression = fmt.Sprintf(
			"source_row.%s::double precision",
			quoteIdentifier(request.MagnitudeColumn),
		)
	}

	selectExpressions := []string{
		fmt.Sprintf("%s as start_lon", startLonExpression),
		fmt.Sprintf("%s as start_lat", startLatExpression),
		fmt.Sprintf("%s as end_lon", endLonExpression),
		fmt.Sprintf("%s as end_lat", endLatExpression),
		fmt.Sprintf("%s as magnitude", magnitudeExpression),
	}
	for _, columnName := range primaryKey {
		selectExpressions = append(
			selectExpressions,
			fmt.Sprintf("source_row.%s as %s", quoteIdentifier(columnName), quoteIdentifier(columnName)),
		)
	}
	startPointExpression := fmt.Sprintf(
		"ST_SetSRID(ST_MakePoint(%s, %s), 4326)",
		startLonExpression,
		startLatExpression,
	)
	endPointExpression := fmt.Sprintf(
		"ST_SetSRID(ST_MakePoint(%s, %s), 4326)",
		endLonExpression,
		endLatExpression,
	)
	filterClause, parameters, err := buildQueryFilterClause(columnDefinitions, request.Filter, 0)
	if err != nil {
		return nil, err
	}
	if filterClause != "" {
		notNullPredicates = append(notNullPredicates, fmt.Sprintf("(%s)", filterClause))
	}
	if request.RowKey != nil {
		if err := validateRowKey(request.RowKey, primaryKey); err != nil {
			return nil, err
		}

		rowKeyClause, rowKeyParameters, err := buildPrimaryKeyFilter(
			columnByName,
			primaryKey,
			request.RowKey,
			len(parameters),
		)
		if err != nil {
			return nil, err
		}

		parameters = append(parameters, rowKeyParameters...)
		notNullPredicates = append(
			notNullPredicates,
			fmt.Sprintf("(%s)", rowKeyClause),
		)
	}

	spatialClause, err := service.buildFlowmapSpatialFilterClause(
		timeoutCtx,
		conn,
		request.SpatialFilter,
		startPointExpression,
		endPointExpression,
		len(parameters),
	)
	if err != nil {
		return nil, err
	}
	withClauses := make([]string, 0, 1)
	if spatialClause != nil {
		withClauses = append(withClauses, spatialClause.CTE)
		notNullPredicates = append(notNullPredicates, fmt.Sprintf("(%s)", spatialClause.Clause))
		parameters = append(parameters, spatialClause.Parameters...)
	}
	parameters = append(parameters, request.Limit)
	limitPlaceholder := fmt.Sprintf("$%d", len(parameters))
	withPrefix := ""
	if len(withClauses) > 0 {
		withPrefix = fmt.Sprintf("with %s\n", strings.Join(withClauses, ",\n"))
	}

	query := fmt.Sprintf(
		`
		%s
		select
		  %s
		from %s.%s as source_row
		where %s
		limit %s
		`,
		withPrefix,
		strings.Join(selectExpressions, ",\n          "),
		quoteIdentifier(request.Schema),
		quoteIdentifier(request.Table),
		strings.Join(notNullPredicates, " and "),
		limitPlaceholder,
	)

	rows, err := conn.Query(timeoutCtx, query, parameters...)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	defer rows.Close()

	locationsByID := make(map[string]FlowmapLocation)
	flows := make([]FlowmapFlow, 0)

	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
		}

		startLon, ok := valueToFloat64(values[0])
		if !ok {
			continue
		}
		startLat, ok := valueToFloat64(values[1])
		if !ok {
			continue
		}
		endLon, ok := valueToFloat64(values[2])
		if !ok {
			continue
		}
		endLat, ok := valueToFloat64(values[3])
		if !ok {
			continue
		}
		magnitude, ok := valueToFloat64(values[4])
		if !ok {
			continue
		}

		if !isFiniteFloat(startLon) ||
			!isFiniteFloat(startLat) ||
			!isFiniteFloat(endLon) ||
			!isFiniteFloat(endLat) ||
			!isFiniteFloat(magnitude) ||
			magnitude <= 0 {
			continue
		}

		record := make(map[string]interface{}, len(primaryKey))
		for index, columnName := range primaryKey {
			record[columnName] = normalizeValue(values[index+5])
		}

		rowRef := buildRowReference(record, primaryKey)

		originID := makeFlowmapLocationID(startLon, startLat)
		destID := makeFlowmapLocationID(endLon, endLat)

		originLocation, exists := locationsByID[originID]
		if !exists {
			originLocation = FlowmapLocation{
				ID:   originID,
				Lat:  startLat,
				Lon:  startLon,
				Name: fmt.Sprintf("%.6f, %.6f", startLat, startLon),
			}
		}
		originLocation.RowRefs = appendRowReference(originLocation.RowRefs, rowRef)
		locationsByID[originID] = originLocation

		destLocation, exists := locationsByID[destID]
		if !exists {
			destLocation = FlowmapLocation{
				ID:   destID,
				Lat:  endLat,
				Lon:  endLon,
				Name: fmt.Sprintf("%.6f, %.6f", endLat, endLon),
			}
		}
		destLocation.RowRefs = appendRowReference(destLocation.RowRefs, rowRef)
		locationsByID[destID] = destLocation

		flows = append(flows, FlowmapFlow{
			OriginID:  originID,
			DestID:    destID,
			Magnitude: magnitude,
			RowRef:    rowRef,
		})
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	locations := make([]FlowmapLocation, 0, len(locationsByID))
	for _, location := range locationsByID {
		locations = append(locations, location)
	}

	slices.SortFunc(locations, func(left, right FlowmapLocation) int {
		return strings.Compare(left.ID, right.ID)
	})

	return &ListFlowmapDataResult{
		Schema:        request.Schema,
		Table:         request.Table,
		FlowCount:     len(flows),
		LocationCount: len(locations),
		Locations:     locations,
		Flows:         flows,
	}, nil
}

func (request ListFlowmapDataRequest) flowmapColumnNames() []string {
	columns := make([]string, 0, 5)
	if request.MagnitudeColumn != "" {
		columns = append(columns, request.MagnitudeColumn)
	}
	columns = append(
		columns,
		flowmapRequiredPointColumns(
			request.StartMode,
			request.StartLonColumn,
			request.StartLatColumn,
			request.StartGeometryColumn,
		)...,
	)
	columns = append(
		columns,
		flowmapRequiredPointColumns(
			request.EndMode,
			request.EndLonColumn,
			request.EndLatColumn,
			request.EndGeometryColumn,
		)...,
	)

	return columns
}

func flowmapRequiredPointColumns(
	mode string,
	lonColumn string,
	latColumn string,
	geometryColumn string,
) []string {
	if mode == "geometry" {
		return []string{geometryColumn}
	}

	return []string{lonColumn, latColumn}
}

func flowmapPointExpressions(
	mode string,
	lonColumn string,
	latColumn string,
	geometryColumn string,
) (string, string) {
	if mode == "geometry" {
		geometryExpression := fmt.Sprintf("source_row.%s::geometry", quoteIdentifier(geometryColumn))
		return fmt.Sprintf("ST_X(%s)::double precision", geometryExpression),
			fmt.Sprintf("ST_Y(%s)::double precision", geometryExpression)
	}

	return fmt.Sprintf("source_row.%s::double precision", quoteIdentifier(lonColumn)),
		fmt.Sprintf("source_row.%s::double precision", quoteIdentifier(latColumn))
}
