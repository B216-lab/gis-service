package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"
)

func (service *Service) LocateFeature(
	ctx context.Context,
	request LocateFeatureRequest,
) (*LocateFeatureResult, error) {
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
		return nil, fmt.Errorf("%w: selected geometry column not found on table", ErrConnectionFailed)
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
	if err := validateRowKey(request.RowKey, primaryKey); err != nil {
		return nil, err
	}

	columnByName := make(map[string]columnDefinition, len(columnDefinitions))
	for _, definition := range columnDefinitions {
		columnByName[definition.Name] = definition
	}

	whereClause, parameters, err := buildPrimaryKeyFilter(
		columnByName,
		primaryKey,
		request.RowKey,
		0,
	)
	if err != nil {
		return nil, err
	}

	geometryExpression := geometryColumnWGS84Expression(
		request.GeometryColumn,
		selectedGeometryColumn.StorageType,
		selectedGeometryColumn.SRID,
	)
	propertyExpression := "to_jsonb(source_row)"
	for _, geometryColumn := range geometryColumns {
		propertyExpression += fmt.Sprintf(" - %s", quoteLiteral(geometryColumn.Name))
	}

	query := fmt.Sprintf(
		`
		with located_feature as (
		  select
		    %s as geom,
		    %s as properties,
		    %s as feature_key
		  from %s.%s as source_row
		  where (%s) and %s is not null
		  limit 1
		)
		select
		  ST_AsGeoJSON(geom)::json,
		  properties,
		  feature_key,
		  ST_XMin(geom::box3d),
		  ST_YMin(geom::box3d),
		  ST_XMax(geom::box3d),
		  ST_YMax(geom::box3d)
		from located_feature
		`,
		geometryExpression,
		propertyExpression,
		rowKeyJSONExpression(primaryKey),
		quoteIdentifier(request.Schema),
		quoteIdentifier(request.Table),
		whereClause,
		geometryExpression,
	)

	var rawGeometry []byte
	var rawProperties []byte
	var featureKey string
	var west sql.NullFloat64
	var south sql.NullFloat64
	var east sql.NullFloat64
	var north sql.NullFloat64
	if err := conn.QueryRow(timeoutCtx, query, parameters...).Scan(
		&rawGeometry,
		&rawProperties,
		&featureKey,
		&west,
		&south,
		&east,
		&north,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: row has no feature geometry in selected layer", ErrInvalidWriteRequest)
		}

		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	var geometry map[string]interface{}
	if err := json.Unmarshal(rawGeometry, &geometry); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	var properties map[string]interface{}
	if err := json.Unmarshal(rawProperties, &properties); err != nil {
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

	rowRef := RowReference{
		PrimaryKey: slices.Clone(primaryKey),
		RowKey:     request.RowKey,
	}

	return &LocateFeatureResult{
		Schema:         request.Schema,
		Table:          request.Table,
		GeometryColumn: request.GeometryColumn,
		GeometryType:   selectedGeometryColumn.GeometryType,
		SRID:           4326,
		Feature: map[string]interface{}{
			"type":       "Feature",
			"geometry":   geometry,
			"properties": properties,
		},
		Bounds:     bounds,
		RowRef:     rowRef,
		FeatureKey: featureKey,
	}, nil
}
