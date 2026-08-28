package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

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

	propertyExpression := "to_jsonb(source_row)"
	for _, geometryColumn := range geometryColumns {
		propertyExpression += fmt.Sprintf(" - %s", quoteLiteral(geometryColumn.Name))
	}

	rowRefExpression := "'null'::jsonb"
	if len(primaryKey) > 0 {
		rowKeyParts := make([]string, 0, len(primaryKey)*2)
		primaryKeyLiterals := make([]string, 0, len(primaryKey))
		for _, columnName := range primaryKey {
			rowKeyParts = append(
				rowKeyParts,
				quoteLiteral(columnName),
				fmt.Sprintf("to_jsonb(source_row.%s)", quoteIdentifier(columnName)),
			)
			primaryKeyLiterals = append(primaryKeyLiterals, quoteLiteral(columnName))
		}

		rowRefExpression = fmt.Sprintf(
			"jsonb_build_object('rowRef', jsonb_build_object('primaryKey', jsonb_build_array(%s), 'rowKey', jsonb_build_object(%s)))",
			strings.Join(primaryKeyLiterals, ", "),
			strings.Join(rowKeyParts, ", "),
		)
	}

	geometryExpression := geometryColumnWGS84Expression(
		request.GeometryColumn,
		selectedGeometryColumn.StorageType,
		selectedGeometryColumn.SRID,
	)
	renderGeometryExpression := simplifiedGeometryExpression(
		geometryExpression,
		request.Zoom,
	)

	whereClauses := []string{request.whereClauseForGeometry(geometryExpression)}
	filterClause, parameters, err := buildQueryFilterClause(
		columnDefinitions,
		request.Filter,
		0,
	)
	if err != nil {
		return nil, err
	}
	if filterClause != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("(%s)", filterClause))
	}
	spatialClause, err := service.buildSpatialFilterClause(
		timeoutCtx,
		conn,
		request.SpatialFilter,
		geometryExpression,
		len(parameters),
	)
	if err != nil {
		return nil, err
	}
	withClauses := make([]string, 0, 2)
	if spatialClause != nil {
		withClauses = append(withClauses, spatialClause.CTE)
		whereClauses = append(whereClauses, fmt.Sprintf("(%s)", spatialClause.Clause))
		parameters = append(parameters, spatialClause.Parameters...)
	}
	parameters = append(parameters, request.Limit)
	limitPlaceholder := fmt.Sprintf("$%d", len(parameters))
	withClauses = append(
		withClauses,
		fmt.Sprintf(
			`source_features as (
		  select json_build_object(
		    'type', 'Feature',
		    'geometry', ST_AsGeoJSON(%s)::json,
		    'properties', %s || jsonb_build_object('__geopanel', %s)
		  ) as feature
		  from %s.%s as source_row
		  where %s
		  limit %s
		)`,
			renderGeometryExpression,
			propertyExpression,
			rowRefExpression,
			quoteIdentifier(request.Schema),
			quoteIdentifier(request.Table),
			strings.Join(whereClauses, " and "),
			limitPlaceholder,
		),
	)

	query := fmt.Sprintf(
		`
		with %s
		select coalesce(json_agg(feature), '[]'::json)
		from source_features
		`,
		strings.Join(withClauses, ",\n\t\t"),
	)

	var rawFeatures []byte
	if err := conn.QueryRow(timeoutCtx, query, parameters...).Scan(&rawFeatures); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	features := make([]map[string]interface{}, 0)
	if err := json.Unmarshal(rawFeatures, &features); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return &ListLayerFeaturesResult{
		Schema:         request.Schema,
		Table:          request.Table,
		GeometryColumn: request.GeometryColumn,
		GeometryType:   selectedGeometryColumn.GeometryType,
		SRID:           4326,
		FeatureCount:   len(features),
		Data: GeoJSONFeatureCollection{
			Type:     "FeatureCollection",
			Features: features,
		},
	}, nil
}

func (service *Service) GetLayerVectorTile(
	ctx context.Context,
	request LayerVectorTileRequest,
) ([]byte, error) {
	if err := request.Validate(); err != nil {
		return nil, err
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	runner, err := service.tilePool(timeoutCtx, request.ConnectionTestRequest)
	if err != nil {
		return nil, err
	}

	geometryColumns, err := service.listGeometryColumns(
		timeoutCtx,
		runner,
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
			ErrConnectionFailed,
		)
	}

	columnDefinitions, err := service.listColumnDefinitions(
		timeoutCtx,
		runner,
		request.Schema,
		request.Table,
	)
	if err != nil {
		return nil, err
	}

	primaryKey, err := service.listPrimaryKeyColumns(
		timeoutCtx,
		runner,
		request.Schema,
		request.Table,
	)
	if err != nil {
		return nil, err
	}

	renderGeometryExpression := geometryColumnWebMercatorExpression(
		request.GeometryColumn,
		selectedGeometryColumn.StorageType,
		selectedGeometryColumn.SRID,
	)
	tileGeometryExpression := simplifiedMVTGeometryExpression(
		renderGeometryExpression,
		request.Z,
	)
	predicateGeometryExpression := geometryColumnNativeExpression(
		request.GeometryColumn,
		selectedGeometryColumn.SRID,
	)
	spatialTargetGeometryExpression := geometryColumnWGS84Expression(
		request.GeometryColumn,
		selectedGeometryColumn.StorageType,
		selectedGeometryColumn.SRID,
	)
	predicateTileBoundsExpression := tileBoundsForGeometryColumn(
		selectedGeometryColumn.StorageType,
		selectedGeometryColumn.SRID,
	)
	propertyExpressions := []string{
		fmt.Sprintf("%s as _geopanel_primary_key", primaryKeyJSONExpression(primaryKey)),
		fmt.Sprintf("%s as _geopanel_row_key", rowKeyJSONExpression(primaryKey)),
	}
	if len(primaryKey) == 0 {
		propertyExpressions = append(
			propertyExpressions,
			mvtInlinePropertyExpressions(columnDefinitions)...,
		)
	}

	whereClauses := []string{
		fmt.Sprintf("%s is not null", predicateGeometryExpression),
		fmt.Sprintf(
			"%s && %s",
			predicateGeometryExpression,
			predicateTileBoundsExpression,
		),
		fmt.Sprintf(
			"ST_Intersects(%s, %s)",
			predicateGeometryExpression,
			predicateTileBoundsExpression,
		),
	}
	filterClause, filterParameters, err := buildQueryFilterClause(
		columnDefinitions,
		request.Filter,
		3,
	)
	if err != nil {
		return nil, err
	}
	if filterClause != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("(%s)", filterClause))
	}

	parameters := []interface{}{request.Z, request.X, request.Y}
	parameters = append(parameters, filterParameters...)
	spatialClause, err := service.buildSpatialFilterClause(
		timeoutCtx,
		runner,
		request.SpatialFilter,
		spatialTargetGeometryExpression,
		len(parameters),
	)
	if err != nil {
		return nil, err
	}
	withClauses := []string{
		`tile_bounds as (
		  select ST_TileEnvelope($1, $2, $3) as geom
		)`,
	}
	if spatialClause != nil {
		withClauses = append(withClauses, spatialClause.CTE)
		whereClauses = append(whereClauses, fmt.Sprintf("(%s)", spatialClause.Clause))
		parameters = append(parameters, spatialClause.Parameters...)
	}

	query := fmt.Sprintf(
		`
		with %s,
		source_features as (
		  select
		    ST_AsMVTGeom(%s, tile_bounds.geom, 4096, 256, true) as geom,
		    %s
		  from %s.%s as source_row
		  cross join tile_bounds
		  where %s
		)
		select coalesce(ST_AsMVT(tile_rows, %s, 4096, 'geom'), ''::bytea)
		from (
		  select *
		  from source_features
		  where geom is not null
		) as tile_rows
		`,
		strings.Join(withClauses, ",\n\t\t"),
		tileGeometryExpression,
		strings.Join(propertyExpressions, ",\n\t\t    "),
		quoteIdentifier(request.Schema),
		quoteIdentifier(request.Table),
		strings.Join(whereClauses, " and "),
		quoteLiteral(LayerVectorTileName),
	)

	var tile []byte
	if err := runner.QueryRow(timeoutCtx, query, parameters...).Scan(&tile); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return tile, nil
}

func (service *Service) GetLayerExtent(
	ctx context.Context,
	request LayerExtentRequest,
) (*LayerExtentResult, error) {
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

	columnDefinitions, err := service.listColumnDefinitions(
		timeoutCtx,
		conn,
		request.Schema,
		request.Table,
	)
	if err != nil {
		return nil, err
	}

	geometryExpression := geometryColumnWGS84Expression(
		request.GeometryColumn,
		selectedGeometryColumn.StorageType,
		selectedGeometryColumn.SRID,
	)

	whereClauses := []string{fmt.Sprintf("%s is not null", geometryExpression)}
	filterClause, parameters, err := buildQueryFilterClause(
		columnDefinitions,
		request.Filter,
		0,
	)
	if err != nil {
		return nil, err
	}
	if filterClause != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("(%s)", filterClause))
	}
	spatialClause, err := service.buildSpatialFilterClause(
		timeoutCtx,
		conn,
		request.SpatialFilter,
		geometryExpression,
		len(parameters),
	)
	if err != nil {
		return nil, err
	}
	withClauses := make([]string, 0, 2)
	if spatialClause != nil {
		withClauses = append(withClauses, spatialClause.CTE)
		whereClauses = append(whereClauses, fmt.Sprintf("(%s)", spatialClause.Clause))
		parameters = append(parameters, spatialClause.Parameters...)
	}
	withClauses = append(
		withClauses,
		fmt.Sprintf(
			`extent as (
		  select ST_Extent(%s) as bbox
		  from %s.%s as source_row
		  where %s
		)`,
			geometryExpression,
			quoteIdentifier(request.Schema),
			quoteIdentifier(request.Table),
			strings.Join(whereClauses, " and "),
		),
	)

	query := fmt.Sprintf(
		`
		with %s
		select
		  ST_XMin(bbox::box2d),
		  ST_YMin(bbox::box2d),
		  ST_XMax(bbox::box2d),
		  ST_YMax(bbox::box2d)
		from extent
		`,
		strings.Join(withClauses, ",\n\t\t"),
	)

	var west sql.NullFloat64
	var south sql.NullFloat64
	var east sql.NullFloat64
	var north sql.NullFloat64
	if err := conn.QueryRow(timeoutCtx, query, parameters...).Scan(
		&west,
		&south,
		&east,
		&north,
	); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	var bounds *GeoBounds
	if west.Valid && south.Valid && east.Valid && north.Valid {
		bounds = &GeoBounds{
			West:  west.Float64,
			South: south.Float64,
			East:  east.Float64,
			North: north.Float64,
		}
	}

	return &LayerExtentResult{
		Schema:         request.Schema,
		Table:          request.Table,
		GeometryColumn: request.GeometryColumn,
		GeometryType:   selectedGeometryColumn.GeometryType,
		SRID:           4326,
		Bounds:         bounds,
	}, nil
}
