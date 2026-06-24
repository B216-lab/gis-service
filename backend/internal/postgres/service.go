package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrConnectionFailed = errors.New("database connection failed")
var ErrInvalidWriteRequest = errors.New("invalid write request")
var ErrWriteConflict = errors.New("database write conflict")

const LayerVectorTileName = "features"

const tilePoolTTL = 12 * time.Hour

var forbiddenSQLWherePattern = regexp.MustCompile(
	`(?i)\b(select|insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|execute|call|do|merge|vacuum|analyze|refresh|attach|detach)\b`,
)

type Service struct {
	timeout      time.Duration
	tilePools    map[string]tilePoolEntry
	tilePoolsMux sync.Mutex
}

type tilePoolEntry struct {
	pool       *pgxpool.Pool
	lastUsedAt time.Time
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

type SchemaSummary struct {
	Name string `json:"name"`
}

type ListSchemasResult struct {
	Schemas []SchemaSummary `json:"schemas"`
}

type SchemaTablesRequest struct {
	ConnectionTestRequest
	Schema string `json:"schema"`
}

type TableMetadataRequest struct {
	ConnectionTestRequest
	Schema string `json:"schema"`
	Table  string `json:"table"`
}

type ListRowsRequest struct {
	ConnectionTestRequest
	Schema string       `json:"schema"`
	Table  string       `json:"table"`
	Search string       `json:"search"`
	Filter *QueryFilter `json:"filter"`
	Limit  int          `json:"limit"`
	Offset int          `json:"offset"`
}

type QueryFilter struct {
	Mode       string            `json:"mode"`
	Where      string            `json:"where"`
	Conditions []FilterCondition `json:"conditions"`
}

type FilterCondition struct {
	Column   string   `json:"column"`
	Operator string   `json:"operator"`
	Value    string   `json:"value"`
	Values   []string `json:"values"`
}

type LookupRowsRequest struct {
	ConnectionTestRequest
	Schema  string                   `json:"schema"`
	Table   string                   `json:"table"`
	RowKeys []map[string]interface{} `json:"rowKeys"`
}

type LocateFeatureRequest struct {
	ConnectionTestRequest
	Schema         string                 `json:"schema"`
	Table          string                 `json:"table"`
	GeometryColumn string                 `json:"geometryColumn"`
	RowKey         map[string]interface{} `json:"rowKey"`
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
	Schema         string         `json:"schema"`
	Table          string         `json:"table"`
	GeometryColumn string         `json:"geometryColumn"`
	Filter         *QueryFilter   `json:"filter"`
	SpatialFilter  *SpatialFilter `json:"spatialFilter"`
	Limit          int            `json:"limit"`
	Zoom           *float64       `json:"zoom"`
	West           *float64       `json:"west"`
	South          *float64       `json:"south"`
	East           *float64       `json:"east"`
	North          *float64       `json:"north"`
}

type LayerTileSourceRequest struct {
	ConnectionTestRequest
	Schema         string         `json:"schema"`
	Table          string         `json:"table"`
	GeometryColumn string         `json:"geometryColumn"`
	Filter         *QueryFilter   `json:"filter"`
	SpatialFilter  *SpatialFilter `json:"spatialFilter"`
}

type LayerVectorTileRequest struct {
	LayerTileSourceRequest
	Z int
	X int
	Y int
}

type LayerExtentRequest struct {
	ConnectionTestRequest
	Schema         string         `json:"schema"`
	Table          string         `json:"table"`
	GeometryColumn string         `json:"geometryColumn"`
	Filter         *QueryFilter   `json:"filter"`
	SpatialFilter  *SpatialFilter `json:"spatialFilter"`
}

type SpatialFilter struct {
	SourceSchema         string         `json:"sourceSchema"`
	SourceTable          string         `json:"sourceTable"`
	SourceGeometryColumn string         `json:"sourceGeometryColumn"`
	Predicate            string         `json:"predicate"`
	RowRefs              []RowReference `json:"rowRefs"`
}

type ListFlowmapDataRequest struct {
	ConnectionTestRequest
	Schema              string         `json:"schema"`
	Table               string         `json:"table"`
	StartMode           string         `json:"startMode"`
	StartLonColumn      string         `json:"startLonColumn"`
	StartLatColumn      string         `json:"startLatColumn"`
	StartGeometryColumn string         `json:"startGeometryColumn"`
	EndMode             string         `json:"endMode"`
	EndLonColumn        string         `json:"endLonColumn"`
	EndLatColumn        string         `json:"endLatColumn"`
	EndGeometryColumn   string         `json:"endGeometryColumn"`
	MagnitudeColumn     string         `json:"magnitudeColumn"`
	DefaultMagnitude    float64        `json:"defaultMagnitude"`
	SpatialFilter       *SpatialFilter `json:"spatialFilter"`
	Limit               int            `json:"limit"`
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
	TotalRows  int64        `json:"totalRows"`
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

type RowReference struct {
	PrimaryKey []string               `json:"primaryKey"`
	RowKey     map[string]interface{} `json:"rowKey"`
}

type LookupRowsResult struct {
	Schema            string       `json:"schema"`
	Table             string       `json:"table"`
	RequestedRowCount int          `json:"requestedRowCount"`
	MatchedRowCount   int          `json:"matchedRowCount"`
	PrimaryKey        []string     `json:"primaryKey"`
	Columns           []ColumnMeta `json:"columns"`
	Rows              []RowRecord  `json:"rows"`
}

type LocateFeatureResult struct {
	Schema         string                 `json:"schema"`
	Table          string                 `json:"table"`
	GeometryColumn string                 `json:"geometryColumn"`
	GeometryType   string                 `json:"geometryType"`
	SRID           int                    `json:"srid"`
	Feature        map[string]interface{} `json:"feature"`
	Bounds         *GeoBounds             `json:"bounds"`
	RowRef         RowReference           `json:"rowRef"`
	FeatureKey     string                 `json:"featureKey"`
}

type CommitTableChangesResult struct {
	Schema  string `json:"schema"`
	Table   string `json:"table"`
	Applied int    `json:"applied"`
}

type CreateFeatureRequest struct {
	ConnectionTestRequest
	Schema         string                 `json:"schema"`
	Table          string                 `json:"table"`
	GeometryColumn string                 `json:"geometryColumn"`
	Geometry       json.RawMessage        `json:"geometry"`
	Values         map[string]interface{} `json:"values"`
}

type CreateFeatureResult struct {
	Schema string `json:"schema"`
	Table  string `json:"table"`
}

type geoJSONGeometryHeader struct {
	Type string `json:"type"`
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

type GeoBounds struct {
	West  float64 `json:"west"`
	South float64 `json:"south"`
	East  float64 `json:"east"`
	North float64 `json:"north"`
}

type LayerExtentResult struct {
	Schema         string     `json:"schema"`
	Table          string     `json:"table"`
	GeometryColumn string     `json:"geometryColumn"`
	GeometryType   string     `json:"geometryType"`
	SRID           int        `json:"srid"`
	Bounds         *GeoBounds `json:"bounds"`
}

type FlowmapLocation struct {
	ID      string         `json:"id"`
	Lat     float64        `json:"lat"`
	Lon     float64        `json:"lon"`
	Name    string         `json:"name"`
	RowRefs []RowReference `json:"rowRefs"`
}

type FlowmapFlow struct {
	OriginID  string        `json:"originId"`
	DestID    string        `json:"destId"`
	Magnitude float64       `json:"magnitude"`
	RowRef    *RowReference `json:"rowRef"`
}

type ListFlowmapDataResult struct {
	Schema        string            `json:"schema"`
	Table         string            `json:"table"`
	FlowCount     int               `json:"flowCount"`
	LocationCount int               `json:"locationCount"`
	Locations     []FlowmapLocation `json:"locations"`
	Flows         []FlowmapFlow     `json:"flows"`
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

type spatialFilterClause struct {
	CTE        string
	Clause     string
	Parameters []interface{}
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
		timeout:   timeout,
		tilePools: make(map[string]tilePoolEntry),
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
	request.Search = strings.TrimSpace(request.Search)
	trimQueryFilter(request.Filter)
}

func (request *LookupRowsRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
}

func (request *LocateFeatureRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
	request.GeometryColumn = strings.TrimSpace(request.GeometryColumn)
}

func (request *LayerExtentRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
	request.GeometryColumn = strings.TrimSpace(request.GeometryColumn)
	trimQueryFilter(request.Filter)
	trimSpatialFilter(request.SpatialFilter)
}

func (request *SchemaTablesRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
}

func (request *TableMetadataRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
}

func (request *ListLayerFeaturesRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
	request.GeometryColumn = strings.TrimSpace(request.GeometryColumn)
	trimQueryFilter(request.Filter)
	trimSpatialFilter(request.SpatialFilter)
}

func (request *LayerTileSourceRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
	request.GeometryColumn = strings.TrimSpace(request.GeometryColumn)
	trimQueryFilter(request.Filter)
	trimSpatialFilter(request.SpatialFilter)
}

func (request *ListFlowmapDataRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
	request.StartMode = strings.TrimSpace(request.StartMode)
	request.StartLonColumn = strings.TrimSpace(request.StartLonColumn)
	request.StartLatColumn = strings.TrimSpace(request.StartLatColumn)
	request.StartGeometryColumn = strings.TrimSpace(request.StartGeometryColumn)
	request.EndMode = strings.TrimSpace(request.EndMode)
	request.EndLonColumn = strings.TrimSpace(request.EndLonColumn)
	request.EndLatColumn = strings.TrimSpace(request.EndLatColumn)
	request.EndGeometryColumn = strings.TrimSpace(request.EndGeometryColumn)
	request.MagnitudeColumn = strings.TrimSpace(request.MagnitudeColumn)
	trimSpatialFilter(request.SpatialFilter)
}

func trimQueryFilter(filter *QueryFilter) {
	if filter == nil {
		return
	}

	filter.Mode = strings.TrimSpace(filter.Mode)
	filter.Where = strings.TrimSpace(filter.Where)

	for index := range filter.Conditions {
		filter.Conditions[index].Column = strings.TrimSpace(
			filter.Conditions[index].Column,
		)
		filter.Conditions[index].Operator = strings.TrimSpace(
			filter.Conditions[index].Operator,
		)
		filter.Conditions[index].Value = strings.TrimSpace(
			filter.Conditions[index].Value,
		)
		for valueIndex := range filter.Conditions[index].Values {
			filter.Conditions[index].Values[valueIndex] = strings.TrimSpace(
				filter.Conditions[index].Values[valueIndex],
			)
		}
	}
}

func trimSpatialFilter(filter *SpatialFilter) {
	if filter == nil {
		return
	}

	filter.SourceSchema = strings.TrimSpace(filter.SourceSchema)
	filter.SourceTable = strings.TrimSpace(filter.SourceTable)
	filter.SourceGeometryColumn = strings.TrimSpace(filter.SourceGeometryColumn)
	filter.Predicate = strings.TrimSpace(filter.Predicate)
	for index := range filter.RowRefs {
		for valueIndex := range filter.RowRefs[index].PrimaryKey {
			filter.RowRefs[index].PrimaryKey[valueIndex] = strings.TrimSpace(
				filter.RowRefs[index].PrimaryKey[valueIndex],
			)
		}
	}
}

func validateQueryFilter(filter *QueryFilter) error {
	if filter == nil {
		return nil
	}

	switch queryFilterMode(filter) {
	case "sql":
		return validateSQLWhereFragment(filter.Where)
	case "builder":
	default:
		return fmt.Errorf("Unsupported filter mode %q.", filter.Mode)
	}

	if len(filter.Conditions) == 0 {
		return errors.New("Filter must contain at least one condition.")
	}

	if len(filter.Conditions) > 10 {
		return errors.New("Filter must contain 10 conditions or fewer.")
	}

	for index, condition := range filter.Conditions {
		if condition.Column == "" {
			return fmt.Errorf("Filter condition %d must specify a column.", index+1)
		}

		switch condition.Operator {
		case "eq":
			if condition.Value == "" {
				return fmt.Errorf("Filter condition %d requires a value.", index+1)
			}
		case "in":
			if len(condition.Values) == 0 {
				return fmt.Errorf("Filter condition %d requires one or more values.", index+1)
			}
		default:
			return fmt.Errorf(
				"Filter condition %d uses unsupported operator %q.",
				index+1,
				condition.Operator,
			)
		}
	}

	return nil
}

func validateSpatialFilter(filter *SpatialFilter) error {
	if filter == nil {
		return nil
	}

	if filter.SourceSchema == "" {
		return errors.New("Spatial filter source schema is required.")
	}
	if filter.SourceTable == "" {
		return errors.New("Spatial filter source table is required.")
	}
	if filter.SourceGeometryColumn == "" {
		return errors.New("Spatial filter source geometry column is required.")
	}
	if len(filter.RowRefs) == 0 {
		return errors.New("Spatial filter requires at least one source row.")
	}
	if len(filter.RowRefs) > 25 {
		return errors.New("Spatial filter supports 25 source rows or fewer.")
	}

	switch filter.Predicate {
	case "intersects", "within":
		return nil
	default:
		return fmt.Errorf("Unsupported spatial filter predicate %q.", filter.Predicate)
	}
}

func queryFilterMode(filter *QueryFilter) string {
	if filter == nil {
		return "builder"
	}

	mode := strings.ToLower(strings.TrimSpace(filter.Mode))
	if mode == "" {
		return "builder"
	}

	return mode
}

func validateSQLWhereFragment(where string) error {
	where = strings.TrimSpace(where)
	if where == "" {
		return errors.New("WHERE filter must not be empty.")
	}
	if len(where) > 5000 {
		return errors.New("WHERE filter must be 5000 characters or fewer.")
	}
	if strings.ContainsRune(where, 0) {
		return errors.New("WHERE filter must not contain NUL bytes.")
	}
	for _, forbidden := range []string{";", "--", "/*", "*/", "$", "?"} {
		if strings.Contains(where, forbidden) {
			return fmt.Errorf("WHERE filter must not contain %q.", forbidden)
		}
	}
	if forbiddenSQLWherePattern.MatchString(where) {
		return errors.New("WHERE filter must not contain SQL statements or subqueries.")
	}

	return nil
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
	if request.Filter != nil && len(request.Filter.Conditions) > 10 {
		request.Filter.Conditions = request.Filter.Conditions[:10]
	}
}

func (request *LookupRowsRequest) Normalize() {
	if len(request.RowKeys) > 50 {
		request.RowKeys = request.RowKeys[:50]
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

func (request *ListFlowmapDataRequest) Normalize() {
	if request.StartMode == "" {
		request.StartMode = "coordinates"
	}
	if request.EndMode == "" {
		request.EndMode = "coordinates"
	}
	if request.DefaultMagnitude <= 0 {
		request.DefaultMagnitude = 1
	}
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

	if err := validateQueryFilter(request.Filter); err != nil {
		return err
	}

	return nil
}

func (request LookupRowsRequest) Validate() error {
	if err := request.ConnectionTestRequest.Validate(); err != nil {
		return err
	}

	if request.Schema == "" {
		return errors.New("Schema is required.")
	}

	if request.Table == "" {
		return errors.New("Table is required.")
	}

	if len(request.RowKeys) == 0 {
		return errors.New("At least one row key is required.")
	}

	return nil
}

func (request LocateFeatureRequest) Validate() error {
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

	if len(request.RowKey) == 0 {
		return errors.New("Row key is required.")
	}

	return nil
}

func (request LayerExtentRequest) Validate() error {
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

	if err := validateQueryFilter(request.Filter); err != nil {
		return err
	}

	return validateSpatialFilter(request.SpatialFilter)
}

func (request SchemaTablesRequest) Validate() error {
	if err := request.ConnectionTestRequest.Validate(); err != nil {
		return err
	}

	if request.Schema == "" {
		return errors.New("Schema is required.")
	}

	return nil
}

func (request TableMetadataRequest) Validate() error {
	if err := request.ConnectionTestRequest.Validate(); err != nil {
		return err
	}

	if request.Schema == "" {
		return errors.New("Schema is required.")
	}

	if request.Table == "" {
		return errors.New("Table is required.")
	}

	return nil
}

func (request *CommitTableChangesRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
}

func (request *CreateFeatureRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
	request.GeometryColumn = strings.TrimSpace(request.GeometryColumn)
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

func (request CreateFeatureRequest) Validate() error {
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

	if len(request.Geometry) == 0 {
		return errors.New("Geometry is required.")
	}

	var geometryHeader geoJSONGeometryHeader
	if err := json.Unmarshal(request.Geometry, &geometryHeader); err != nil {
		return errors.New("Geometry must be valid GeoJSON.")
	}

	if geometryHeader.Type != "Polygon" && geometryHeader.Type != "MultiPolygon" {
		return errors.New("Geometry must be Polygon or MultiPolygon.")
	}

	return nil
}

func (request ListLayerFeaturesRequest) Validate() error {
	if err := request.layerSourceFields().Validate(); err != nil {
		return err
	}

	if request.Limit < 1 || request.Limit > 5000 {
		return errors.New("Limit must be between 1 and 5000.")
	}

	if request.Zoom != nil && (*request.Zoom < 0 || *request.Zoom > 24) {
		return errors.New("Zoom must be between 0 and 24.")
	}

	if request.hasViewportBounds() {
		if request.West == nil ||
			request.South == nil ||
			request.East == nil ||
			request.North == nil {
			return errors.New("Viewport bounds must include west, south, east, and north.")
		}

		if *request.West < -180 || *request.West > 180 ||
			*request.East < -180 || *request.East > 180 ||
			*request.South < -90 || *request.South > 90 ||
			*request.North < -90 || *request.North > 90 {
			return errors.New("Viewport bounds must be valid longitude and latitude values.")
		}
	}

	return nil
}

func (request ListLayerFeaturesRequest) layerSourceFields() LayerTileSourceRequest {
	return LayerTileSourceRequest{
		ConnectionTestRequest: request.ConnectionTestRequest,
		Schema:                request.Schema,
		Table:                 request.Table,
		GeometryColumn:        request.GeometryColumn,
		Filter:                request.Filter,
		SpatialFilter:         request.SpatialFilter,
	}
}

func (request LayerTileSourceRequest) Validate() error {
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

	if err := validateQueryFilter(request.Filter); err != nil {
		return err
	}

	return validateSpatialFilter(request.SpatialFilter)
}

func (request LayerVectorTileRequest) Validate() error {
	if err := request.LayerTileSourceRequest.Validate(); err != nil {
		return err
	}

	if request.Z < 0 || request.Z > 24 {
		return errors.New("Tile zoom must be between 0 and 24.")
	}

	maxCoordinate := 1 << request.Z
	if request.X < 0 || request.X >= maxCoordinate ||
		request.Y < 0 || request.Y >= maxCoordinate {
		return errors.New("Tile coordinates are outside zoom range.")
	}

	return nil
}

func (request ListFlowmapDataRequest) Validate() error {
	if err := request.ConnectionTestRequest.Validate(); err != nil {
		return err
	}

	if request.Schema == "" {
		return errors.New("Schema is required.")
	}

	if request.Table == "" {
		return errors.New("Table is required.")
	}

	switch request.StartMode {
	case "coordinates":
		if request.StartLonColumn == "" {
			return errors.New("Start longitude column is required.")
		}
		if request.StartLatColumn == "" {
			return errors.New("Start latitude column is required.")
		}
	case "geometry":
		if request.StartGeometryColumn == "" {
			return errors.New("Start geometry column is required.")
		}
	default:
		return errors.New("Start mode must be coordinates or geometry.")
	}

	switch request.EndMode {
	case "coordinates":
		if request.EndLonColumn == "" {
			return errors.New("End longitude column is required.")
		}
		if request.EndLatColumn == "" {
			return errors.New("End latitude column is required.")
		}
	case "geometry":
		if request.EndGeometryColumn == "" {
			return errors.New("End geometry column is required.")
		}
	default:
		return errors.New("End mode must be coordinates or geometry.")
	}

	if request.Limit < 1 || request.Limit > 5000 {
		return errors.New("Limit must be between 1 and 5000.")
	}

	return validateSpatialFilter(request.SpatialFilter)
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
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	var postgisVersion string
	if err := conn.QueryRow(timeoutCtx, "select postgis_version()").Scan(&postgisVersion); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
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

	rows, err := conn.Query(
		timeoutCtx,
		`
		select n.nspname as schema_name
		from pg_namespace n
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
		if err := rows.Scan(&schema.Name); err != nil {
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

	return &TableSummary{
		Schema:          schema,
		Name:            table,
		FullName:        fmt.Sprintf("%s.%s", schema, table),
		Kind:            access.Kind,
		PrimaryKey:      primaryKey,
		IsEditable:      isEditableTable(access, primaryKey),
		Columns:         columns,
		GeometryColumns: geometryColumns,
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
	spatialClause, err := service.buildFlowmapSpatialFilterClause(
		timeoutCtx,
		conn,
		request.SpatialFilter,
		startPointExpression,
		endPointExpression,
		0,
	)
	if err != nil {
		return nil, err
	}
	parameters := []interface{}{}
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
		return fmt.Errorf("%w: %w", ErrConnectionFailed, err)
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
		return fmt.Errorf("%w: %w", ErrConnectionFailed, err)
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
		return fmt.Errorf("%w: %w", ErrConnectionFailed, err)
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

func (service *Service) connect(
	ctx context.Context,
	request ConnectionTestRequest,
) (*pgx.Conn, error) {
	databaseURL := databaseURLForRequest(request)

	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return conn, nil
}

func (service *Service) tilePool(
	ctx context.Context,
	request ConnectionTestRequest,
) (*pgxpool.Pool, error) {
	databaseURL := databaseURLForRequest(request)
	now := time.Now()

	service.tilePoolsMux.Lock()
	defer service.tilePoolsMux.Unlock()

	for key, entry := range service.tilePools {
		if now.Sub(entry.lastUsedAt) > tilePoolTTL {
			entry.pool.Close()
			delete(service.tilePools, key)
		}
	}

	if entry, ok := service.tilePools[databaseURL]; ok {
		entry.lastUsedAt = now
		service.tilePools[databaseURL] = entry
		return entry.pool, nil
	}

	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}
	config.MaxConns = 8
	config.MinConns = 0
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	service.tilePools[databaseURL] = tilePoolEntry{
		pool:       pool,
		lastUsedAt: now,
	}
	return pool, nil
}

func databaseURLForRequest(request ConnectionTestRequest) string {
	databaseURL := url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(request.User, request.Password),
		Host:   net.JoinHostPort(request.Host, request.Port),
		Path:   "/" + request.Database,
	}

	return databaseURL.String()
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
		return fmt.Sprintf("ST_AsText(%s) as %s", quotedName, quotedName)
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
