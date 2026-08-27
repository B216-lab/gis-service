package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"
)

func (request ListLayerFeaturesRequest) hasViewportBounds() bool {
	return request.West != nil ||
		request.South != nil ||
		request.East != nil ||
		request.North != nil
}

func (request ListLayerFeaturesRequest) whereClauseForGeometry(
	geometryExpression string,
) string {
	baseClause := fmt.Sprintf("%s is not null", geometryExpression)
	if !request.hasViewportBounds() ||
		request.West == nil ||
		request.South == nil ||
		request.East == nil ||
		request.North == nil {
		return baseClause
	}

	return fmt.Sprintf(
		"%s and ST_Intersects(%s, ST_MakeEnvelope(%f, %f, %f, %f, 4326))",
		baseClause,
		geometryExpression,
		*request.West,
		*request.South,
		*request.East,
		*request.North,
	)
}

func buildRowReference(
	record map[string]interface{},
	primaryKey []string,
) *RowReference {
	rowKey := buildRowKey(record, primaryKey)
	if rowKey == nil {
		return nil
	}

	return &RowReference{
		PrimaryKey: slices.Clone(primaryKey),
		RowKey:     rowKey,
	}
}

func appendRowReference(
	rowRefs []RowReference,
	rowRef *RowReference,
) []RowReference {
	if rowRef == nil {
		return rowRefs
	}

	token := rowKeyToken(rowRef.RowKey, rowRef.PrimaryKey)
	for _, existing := range rowRefs {
		if rowKeyToken(existing.RowKey, existing.PrimaryKey) == token {
			return rowRefs
		}
	}

	return append(rowRefs, *rowRef)
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

func rowKeyToken(
	rowKey map[string]interface{},
	primaryKey []string,
) string {
	values := make([]interface{}, 0, len(primaryKey))
	for _, columnName := range primaryKey {
		values = append(values, rowKey[columnName])
	}

	encoded, _ := json.Marshal(values)
	return string(encoded)
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

func displayColumnType(definition columnDefinition) string {
	if definition.Type == "USER-DEFINED" && definition.UdtName != "" {
		return definition.UdtName
	}

	return definition.Type
}

func isColumnSearchable(definition columnDefinition) bool {
	switch definition.UdtName {
	case "geometry", "geography", "bytea":
		return false
	default:
		return true
	}
}

func isTextLikeColumn(definition columnDefinition) bool {
	return definition.UdtName == "text" ||
		definition.UdtName == "varchar" ||
		definition.UdtName == "bpchar" ||
		strings.Contains(definition.Type, "character")
}

func isColumnFilterable(definition columnDefinition) bool {
	switch definition.UdtName {
	case "geometry", "geography", "bytea":
		return false
	default:
		return true
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

func convertFilterValue(
	definition columnDefinition,
	value string,
) (interface{}, error) {
	switch definition.UdtName {
	case "bool":
		parsed, err := strconv.ParseBool(value)
		if err != nil {
			return nil, fmt.Errorf("%w: column %q expects boolean filter value", ErrInvalidWriteRequest, definition.Name)
		}
		return parsed, nil
	default:
		return convertColumnValue(definition, value)
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

func validateColumnNames(
	definitions []columnDefinition,
	columnNames []string,
) error {
	definitionByName := make(map[string]struct{}, len(definitions))
	for _, definition := range definitions {
		definitionByName[definition.Name] = struct{}{}
	}

	for _, columnName := range columnNames {
		if _, ok := definitionByName[columnName]; !ok {
			return fmt.Errorf("column %q does not exist on selected table", columnName)
		}
	}

	return nil
}

func makeFlowmapLocationID(lon float64, lat float64) string {
	return fmt.Sprintf(
		"loc:%s:%s",
		strconv.FormatFloat(lon, 'f', 8, 64),
		strconv.FormatFloat(lat, 'f', 8, 64),
	)
}

func isFiniteFloat(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
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
		geometryExpression := fmt.Sprintf("%s::geometry", quotedName)
		wgs84Expression := fmt.Sprintf(
			"case when %s is null then null when ST_SRID(%s) in (0, 4326) then %s else ST_Transform(%s, 4326) end",
			quotedName,
			geometryExpression,
			geometryExpression,
			geometryExpression,
		)

		return fmt.Sprintf("ST_AsGeoJSON(%s)::json as %s", wgs84Expression, quotedName)
	}

	return quotedName
}

func columnSearchExpression(column columnDefinition) string {
	quotedName := quoteIdentifier(column.Name)

	return fmt.Sprintf("%s::text", quotedName)
}

func quoteIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func quoteLiteral(value string) string {
	return `'` + strings.ReplaceAll(value, `'`, `''`) + `'`
}

func geometryColumnWGS84Expression(
	columnName string,
	storageType string,
	srid int,
) string {
	geometryExpression := fmt.Sprintf("source_row.%s::geometry", quoteIdentifier(columnName))
	if storageType == "geography" || srid == 4326 || srid == 0 {
		return geometryExpression
	}

	return fmt.Sprintf("ST_Transform(%s, 4326)", geometryExpression)
}

func geometryColumnNativeExpression(columnName string, srid int) string {
	geometryExpression := fmt.Sprintf("source_row.%s::geometry", quoteIdentifier(columnName))
	if srid == 0 {
		return fmt.Sprintf("ST_SetSRID(%s, 4326)", geometryExpression)
	}

	return geometryExpression
}

func geometryColumnWebMercatorExpression(
	columnName string,
	storageType string,
	srid int,
) string {
	geometryExpression := geometryColumnNativeExpression(columnName, srid)
	if srid == 3857 {
		return geometryExpression
	}
	if storageType == "geography" || srid == 4326 || srid == 0 {
		return fmt.Sprintf("ST_Transform(%s, 3857)", geometryExpression)
	}

	return fmt.Sprintf("ST_Transform(%s, 3857)", geometryExpression)
}

func tileBoundsForGeometryColumn(storageType string, srid int) string {
	if srid == 3857 {
		return "tile_bounds.geom"
	}
	if storageType == "geography" || srid == 4326 || srid == 0 {
		return "ST_Transform(tile_bounds.geom, 4326)"
	}

	return fmt.Sprintf("ST_Transform(tile_bounds.geom, %d)", srid)
}

func geometryInsertExpression(parameterIndex int, storageType string, srid int) string {
	geometryExpression := fmt.Sprintf(
		"ST_SetSRID(ST_GeomFromGeoJSON($%d), 4326)",
		parameterIndex,
	)
	if storageType == "geography" {
		return fmt.Sprintf("%s::geography", geometryExpression)
	}
	if srid == 0 || srid == 4326 {
		return geometryExpression
	}

	return fmt.Sprintf("ST_Transform(%s, %d)", geometryExpression, srid)
}

func simplifiedGeometryExpression(expression string, zoom *float64) string {
	if zoom == nil || *zoom >= 12 {
		return expression
	}

	tolerance := 0.02
	switch {
	case *zoom >= 11:
		tolerance = 0.0005
	case *zoom >= 10:
		tolerance = 0.001
	case *zoom >= 9:
		tolerance = 0.0025
	case *zoom >= 8:
		tolerance = 0.005
	case *zoom >= 7:
		tolerance = 0.01
	}

	return fmt.Sprintf("ST_SimplifyPreserveTopology(%s, %f)", expression, tolerance)
}

func simplifiedMVTGeometryExpression(expression string, zoom int) string {
	if zoom >= 12 {
		return expression
	}

	const (
		webMercatorWorldWidthMeters = 40075016.68557849
		mvtExtent                   = 4096.0
		toleranceTileUnits          = 4.0
	)

	tileWidthMeters := webMercatorWorldWidthMeters / math.Pow(2, float64(zoom))
	toleranceMeters := tileWidthMeters / mvtExtent * toleranceTileUnits

	return fmt.Sprintf(
		"ST_SimplifyPreserveTopology(%s, %f)",
		expression,
		toleranceMeters,
	)
}

func primaryKeyJSONExpression(primaryKey []string) string {
	if len(primaryKey) == 0 {
		return "null::text"
	}

	primaryKeyLiterals := make([]string, 0, len(primaryKey))
	for _, columnName := range primaryKey {
		primaryKeyLiterals = append(primaryKeyLiterals, quoteLiteral(columnName))
	}

	return fmt.Sprintf(
		"jsonb_build_array(%s)::text",
		strings.Join(primaryKeyLiterals, ", "),
	)
}

func rowKeyJSONExpression(primaryKey []string) string {
	if len(primaryKey) == 0 {
		return "null::text"
	}

	rowKeyParts := make([]string, 0, len(primaryKey)*2)
	for _, columnName := range primaryKey {
		rowKeyParts = append(
			rowKeyParts,
			quoteLiteral(columnName),
			fmt.Sprintf("to_jsonb(source_row.%s)", quoteIdentifier(columnName)),
		)
	}

	return fmt.Sprintf(
		"jsonb_build_object(%s)::text",
		strings.Join(rowKeyParts, ", "),
	)
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

func buildQueryFilterClause(
	definitions []columnDefinition,
	filter *QueryFilter,
	startParameterIndex int,
) (string, []interface{}, error) {
	if filter == nil {
		return "", nil, nil
	}

	switch queryFilterMode(filter) {
	case "sql":
		if err := validateSQLWhereFragment(filter.Where); err != nil {
			return "", nil, fmt.Errorf("%w: %v", ErrInvalidWriteRequest, err)
		}

		return fmt.Sprintf("(%s)", strings.TrimSpace(filter.Where)), nil, nil
	case "builder":
	default:
		return "", nil, fmt.Errorf("%w: unsupported filter mode %q", ErrInvalidWriteRequest, filter.Mode)
	}

	if len(filter.Conditions) == 0 {
		return "", nil, nil
	}

	columnByName := make(map[string]columnDefinition, len(definitions))
	for _, definition := range definitions {
		columnByName[definition.Name] = definition
	}

	clauses := make([]string, 0, len(filter.Conditions))
	parameters := make([]interface{}, 0, len(filter.Conditions))

	for _, condition := range filter.Conditions {
		definition, ok := columnByName[condition.Column]
		if !ok {
			return "", nil, fmt.Errorf("%w: filter column %q does not exist on selected table", ErrInvalidWriteRequest, condition.Column)
		}

		if !isColumnFilterable(definition) {
			return "", nil, fmt.Errorf("%w: column %q does not support filtering in this first pass", ErrInvalidWriteRequest, condition.Column)
		}

		quotedColumnName := quoteIdentifier(condition.Column)

		switch condition.Operator {
		case "eq":
			convertedValue, err := convertFilterValue(definition, condition.Value)
			if err != nil {
				return "", nil, err
			}

			parameters = append(parameters, convertedValue)
			placeholder := fmt.Sprintf("$%d", startParameterIndex+len(parameters))
			clauses = append(clauses, fmt.Sprintf("%s = %s", quotedColumnName, placeholder))
		case "in":
			if len(condition.Values) == 0 {
				return "", nil, fmt.Errorf("%w: filter column %q requires one or more values", ErrInvalidWriteRequest, condition.Column)
			}

			placeholders := make([]string, 0, len(condition.Values))
			for _, rawValue := range condition.Values {
				convertedValue, err := convertFilterValue(definition, rawValue)
				if err != nil {
					return "", nil, err
				}

				parameters = append(parameters, convertedValue)
				placeholders = append(
					placeholders,
					fmt.Sprintf("$%d", startParameterIndex+len(parameters)),
				)
			}

			clauses = append(
				clauses,
				fmt.Sprintf("%s in (%s)", quotedColumnName, strings.Join(placeholders, ", ")),
			)
		default:
			return "", nil, fmt.Errorf("%w: unsupported filter operator %q", ErrInvalidWriteRequest, condition.Operator)
		}
	}

	return strings.Join(clauses, " and "), parameters, nil
}

func (service *Service) buildSpatialFilterClause(
	ctx context.Context,
	runner queryRunner,
	filter *SpatialFilter,
	targetGeometryExpression string,
	startParameterIndex int,
) (*spatialFilterClause, error) {
	if filter == nil {
		return nil, nil
	}

	sourceGeometryColumns, err := service.listGeometryColumns(
		ctx,
		runner,
		filter.SourceSchema,
		filter.SourceTable,
	)
	if err != nil {
		return nil, err
	}

	var sourceGeometryColumn *geometryColumnDefinition
	for index := range sourceGeometryColumns {
		if sourceGeometryColumns[index].Name == filter.SourceGeometryColumn {
			sourceGeometryColumn = &sourceGeometryColumns[index]
			break
		}
	}
	if sourceGeometryColumn == nil {
		return nil, fmt.Errorf("%w: spatial filter source geometry column not found", ErrConnectionFailed)
	}

	sourceColumnDefinitions, err := service.listColumnDefinitions(
		ctx,
		runner,
		filter.SourceSchema,
		filter.SourceTable,
	)
	if err != nil {
		return nil, err
	}
	sourcePrimaryKey, err := service.listPrimaryKeyColumns(
		ctx,
		runner,
		filter.SourceSchema,
		filter.SourceTable,
	)
	if err != nil {
		return nil, err
	}

	sourceColumnByName := make(map[string]columnDefinition, len(sourceColumnDefinitions))
	for _, definition := range sourceColumnDefinitions {
		sourceColumnByName[definition.Name] = definition
	}

	parameters := make([]interface{}, 0, len(filter.RowRefs)*max(1, len(sourcePrimaryKey)))
	rowClauses := make([]string, 0, len(filter.RowRefs))
	for _, rowRef := range filter.RowRefs {
		if err := validateRowKey(rowRef.RowKey, sourcePrimaryKey); err != nil {
			return nil, err
		}

		rowClause, rowParameters, err := buildPrimaryKeyFilter(
			sourceColumnByName,
			sourcePrimaryKey,
			rowRef.RowKey,
			startParameterIndex+len(parameters),
		)
		if err != nil {
			return nil, err
		}

		rowClauses = append(rowClauses, fmt.Sprintf("(%s)", rowClause))
		parameters = append(parameters, rowParameters...)
	}

	sourceGeometryExpression := geometryColumnWGS84Expression(
		filter.SourceGeometryColumn,
		sourceGeometryColumn.StorageType,
		sourceGeometryColumn.SRID,
	)
	areaExpression := "(select geom from spatial_filter_area)"
	predicate := fmt.Sprintf(
		"ST_Intersects(%s, %s)",
		targetGeometryExpression,
		areaExpression,
	)
	if filter.Predicate == "within" {
		predicate = fmt.Sprintf(
			"ST_Within(%s, %s)",
			targetGeometryExpression,
			areaExpression,
		)
	}

	return &spatialFilterClause{
		CTE: fmt.Sprintf(
			`spatial_filter_area as (
		  select ST_UnaryUnion(ST_Collect(%s)) as geom
		  from %s.%s as source_row
		  where %s
		)`,
			sourceGeometryExpression,
			quoteIdentifier(filter.SourceSchema),
			quoteIdentifier(filter.SourceTable),
			strings.Join(rowClauses, " or "),
		),
		Clause: fmt.Sprintf(
			"%s is not null and %s && %s and %s",
			areaExpression,
			targetGeometryExpression,
			areaExpression,
			predicate,
		),
		Parameters: parameters,
	}, nil
}

func (service *Service) buildFlowmapSpatialFilterClause(
	ctx context.Context,
	runner queryRunner,
	filter *SpatialFilter,
	startPointExpression string,
	endPointExpression string,
	startParameterIndex int,
) (*spatialFilterClause, error) {
	if filter == nil {
		return nil, nil
	}

	sourceGeometryColumns, err := service.listGeometryColumns(
		ctx,
		runner,
		filter.SourceSchema,
		filter.SourceTable,
	)
	if err != nil {
		return nil, err
	}

	var sourceGeometryColumn *geometryColumnDefinition
	for index := range sourceGeometryColumns {
		if sourceGeometryColumns[index].Name == filter.SourceGeometryColumn {
			sourceGeometryColumn = &sourceGeometryColumns[index]
			break
		}
	}
	if sourceGeometryColumn == nil {
		return nil, fmt.Errorf("%w: spatial filter source geometry column not found", ErrConnectionFailed)
	}

	sourceColumnDefinitions, err := service.listColumnDefinitions(
		ctx,
		runner,
		filter.SourceSchema,
		filter.SourceTable,
	)
	if err != nil {
		return nil, err
	}
	sourcePrimaryKey, err := service.listPrimaryKeyColumns(
		ctx,
		runner,
		filter.SourceSchema,
		filter.SourceTable,
	)
	if err != nil {
		return nil, err
	}

	sourceColumnByName := make(map[string]columnDefinition, len(sourceColumnDefinitions))
	for _, definition := range sourceColumnDefinitions {
		sourceColumnByName[definition.Name] = definition
	}

	parameters := make([]interface{}, 0, len(filter.RowRefs)*max(1, len(sourcePrimaryKey)))
	rowClauses := make([]string, 0, len(filter.RowRefs))
	for _, rowRef := range filter.RowRefs {
		if err := validateRowKey(rowRef.RowKey, sourcePrimaryKey); err != nil {
			return nil, err
		}

		rowClause, rowParameters, err := buildPrimaryKeyFilter(
			sourceColumnByName,
			sourcePrimaryKey,
			rowRef.RowKey,
			startParameterIndex+len(parameters),
		)
		if err != nil {
			return nil, err
		}

		rowClauses = append(rowClauses, fmt.Sprintf("(%s)", rowClause))
		parameters = append(parameters, rowParameters...)
	}

	sourceGeometryExpression := geometryColumnWGS84Expression(
		filter.SourceGeometryColumn,
		sourceGeometryColumn.StorageType,
		sourceGeometryColumn.SRID,
	)
	areaExpression := "(select geom from spatial_filter_area)"
	lineExpression := fmt.Sprintf("ST_MakeLine(%s, %s)", startPointExpression, endPointExpression)
	predicate := fmt.Sprintf(
		"(ST_Intersects(%s, %s) or ST_Intersects(%s, %s))",
		startPointExpression,
		areaExpression,
		endPointExpression,
		areaExpression,
	)
	if filter.Predicate == "within" {
		predicate = fmt.Sprintf(
			"ST_Within(%s, %s)",
			lineExpression,
			areaExpression,
		)
	}

	return &spatialFilterClause{
		CTE: fmt.Sprintf(
			`spatial_filter_area as (
		  select ST_UnaryUnion(ST_Collect(%s)) as geom
		  from %s.%s as source_row
		  where %s
		)`,
			sourceGeometryExpression,
			quoteIdentifier(filter.SourceSchema),
			quoteIdentifier(filter.SourceTable),
			strings.Join(rowClauses, " or "),
		),
		Clause: fmt.Sprintf(
			"%s is not null and %s && %s and %s",
			areaExpression,
			lineExpression,
			areaExpression,
			predicate,
		),
		Parameters: parameters,
	}, nil
}

func valueToFloat64(value interface{}) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int16:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case uint:
		return float64(typed), true
	case uint16:
		return float64(typed), true
	case uint32:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	default:
		return 0, false
	}
}
