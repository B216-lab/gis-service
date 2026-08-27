package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
var ErrConstraintViolation = errors.New("database constraint violation")
var ErrInvalidWriteRequest = errors.New("invalid write request")
var ErrWriteConflict = errors.New("database write conflict")

const LayerVectorTileName = "features"

const tilePoolTTL = 12 * time.Hour

var forbiddenSQLWherePattern = regexp.MustCompile(
	`(?i)\b(select|insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|execute|call|do|merge|vacuum|analyze|refresh|attach|detach)\b`,
)

type Service struct {
	timeout               time.Duration
	registeredConnections map[string]ConnectionTestRequest
	tilePools             map[string]tilePoolEntry
	tilePoolsMux          sync.Mutex
}

type tilePoolEntry struct {
	pool       *pgxpool.Pool
	lastUsedAt time.Time
}

type ConnectionTestRequest struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     string `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password"`
	RawQuery string `json:"-"`
}

type RegisteredConnectionSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type ListRegisteredConnectionsResult struct {
	Connections []RegisteredConnectionSummary `json:"connections"`
}

type ConnectionTestResult struct {
	Success         bool   `json:"success"`
	Message         string `json:"message"`
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
	ForeignKeys     []ForeignKeyMeta     `json:"foreignKeys"`
}

type TableDisplayConfig struct {
	Schema        string            `json:"schema"`
	Table         string            `json:"table"`
	TableAlias    string            `json:"tableAlias"`
	ColumnLabels  map[string]string `json:"columnLabels"`
	HiddenColumns []string          `json:"hiddenColumns"`
}

type ListTablesResult struct {
	Tables []TableSummary `json:"tables"`
}

type ListTableDisplayConfigsResult struct {
	Configs []TableDisplayConfig `json:"configs"`
}

type SchemaSummary struct {
	Name    string `json:"name"`
	Alias   string `json:"alias"`
	Visible bool   `json:"visible"`
}

type ListSchemasResult struct {
	Schemas []SchemaSummary `json:"schemas"`
}

type SchemaTablesRequest struct {
	ConnectionTestRequest
	Schema string `json:"schema"`
}

type SchemaDisplayConfig struct {
	Schema  string `json:"schema"`
	Alias   string `json:"alias"`
	Visible bool   `json:"visible"`
}

type SaveSchemaDisplayConfigsRequest struct {
	ConnectionTestRequest
	Configs []SchemaDisplayConfig `json:"configs"`
}

type TableMetadataRequest struct {
	ConnectionTestRequest
	Schema string `json:"schema"`
	Table  string `json:"table"`
}

type SaveTableDisplayConfigRequest struct {
	ConnectionTestRequest
	Schema        string            `json:"schema"`
	Table         string            `json:"table"`
	TableAlias    string            `json:"tableAlias"`
	ColumnLabels  map[string]string `json:"columnLabels"`
	HiddenColumns []string          `json:"hiddenColumns"`
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

type RelatedRowsRequest struct {
	ConnectionTestRequest
	Schema string                 `json:"schema"`
	Table  string                 `json:"table"`
	RowKey map[string]interface{} `json:"rowKey"`
	Limit  int                    `json:"limit"`
}

type RelationLabelsRequest struct {
	ConnectionTestRequest
	Schema       string        `json:"schema"`
	Table        string        `json:"table"`
	Column       string        `json:"column"`
	LabelColumns []string      `json:"labelColumns"`
	Values       []interface{} `json:"values"`
}

type RelationOptionsRequest struct {
	ConnectionTestRequest
	Schema       string   `json:"schema"`
	Table        string   `json:"table"`
	Column       string   `json:"column"`
	LabelColumns []string `json:"labelColumns"`
	Search       string   `json:"search"`
	Limit        int      `json:"limit"`
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
	Schema              string                 `json:"schema"`
	Table               string                 `json:"table"`
	StartMode           string                 `json:"startMode"`
	StartLonColumn      string                 `json:"startLonColumn"`
	StartLatColumn      string                 `json:"startLatColumn"`
	StartGeometryColumn string                 `json:"startGeometryColumn"`
	EndMode             string                 `json:"endMode"`
	EndLonColumn        string                 `json:"endLonColumn"`
	EndLatColumn        string                 `json:"endLatColumn"`
	EndGeometryColumn   string                 `json:"endGeometryColumn"`
	MagnitudeColumn     string                 `json:"magnitudeColumn"`
	DefaultMagnitude    float64                `json:"defaultMagnitude"`
	SpatialFilter       *SpatialFilter         `json:"spatialFilter"`
	RowKey              map[string]interface{} `json:"rowKey"`
	Limit               int                    `json:"limit"`
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

type ForeignKeyMeta struct {
	ColumnName         string   `json:"columnName"`
	TargetSchema       string   `json:"targetSchema"`
	TargetTable        string   `json:"targetTable"`
	TargetColumn       string   `json:"targetColumn"`
	LabelColumns       []string `json:"labelColumns"`
	DefaultLabelColumn string   `json:"defaultLabelColumn"`
}

type RelationOption struct {
	Value  interface{}            `json:"value"`
	Label  string                 `json:"label"`
	Values map[string]interface{} `json:"values"`
}

type RelationLabelsResult struct {
	Options []RelationOption `json:"options"`
}

type RelationOptionsResult struct {
	Options []RelationOption `json:"options"`
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

type RelatedRowsGroup struct {
	Label           string               `json:"label"`
	Schema          string               `json:"schema"`
	Table           string               `json:"table"`
	SourceColumn    string               `json:"sourceColumn"`
	TargetColumn    string               `json:"targetColumn"`
	PrimaryKey      []string             `json:"primaryKey"`
	IsEditable      bool                 `json:"isEditable"`
	Columns         []ColumnMeta         `json:"columns"`
	GeometryColumns []GeometryColumnMeta `json:"geometryColumns"`
	Rows            []RowRecord          `json:"rows"`
}

type RelatedRowsResult struct {
	Groups []RelatedRowsGroup `json:"groups"`
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

func NewService(
	timeout time.Duration,
	registeredConnections ...ConnectionTestRequest,
) *Service {
	connectionByID := make(map[string]ConnectionTestRequest, len(registeredConnections))
	for _, connection := range registeredConnections {
		connection.TrimSpaces()
		if connection.ID == "" {
			continue
		}
		connectionByID[connection.ID] = connection
	}

	return &Service{
		timeout:               timeout,
		registeredConnections: connectionByID,
		tilePools:             make(map[string]tilePoolEntry),
	}
}

func (request *ConnectionTestRequest) TrimSpaces() {
	request.ID = strings.TrimSpace(request.ID)
	request.Name = strings.TrimSpace(request.Name)
	request.Host = strings.TrimSpace(request.Host)
	request.Port = strings.TrimSpace(request.Port)
	request.Database = strings.TrimSpace(request.Database)
	request.User = strings.TrimSpace(request.User)
	request.RawQuery = strings.TrimSpace(request.RawQuery)
}

func (request ConnectionTestRequest) Validate() error {
	if request.ID != "" && !request.hasDirectCredentials() {
		return nil
	}

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

func (request ConnectionTestRequest) hasDirectCredentials() bool {
	return request.Host != "" ||
		request.Port != "" ||
		request.Database != "" ||
		request.User != "" ||
		request.Password != ""
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

func (request *RelatedRowsRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
}

func (request *RelationLabelsRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
	request.Column = strings.TrimSpace(request.Column)
	for index := range request.LabelColumns {
		request.LabelColumns[index] = strings.TrimSpace(request.LabelColumns[index])
	}
}

func (request *RelationOptionsRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
	request.Column = strings.TrimSpace(request.Column)
	request.Search = strings.TrimSpace(request.Search)
	for index := range request.LabelColumns {
		request.LabelColumns[index] = strings.TrimSpace(request.LabelColumns[index])
	}
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

func (request *SaveSchemaDisplayConfigsRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	for index := range request.Configs {
		request.Configs[index].Schema = strings.TrimSpace(request.Configs[index].Schema)
		request.Configs[index].Alias = strings.TrimSpace(request.Configs[index].Alias)
	}
}

func (request *TableMetadataRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
}

func (request *SaveTableDisplayConfigRequest) TrimSpaces() {
	request.ConnectionTestRequest.TrimSpaces()
	request.Schema = strings.TrimSpace(request.Schema)
	request.Table = strings.TrimSpace(request.Table)
	request.TableAlias = strings.TrimSpace(request.TableAlias)
	for column, label := range request.ColumnLabels {
		trimmedColumn := strings.TrimSpace(column)
		trimmedLabel := strings.TrimSpace(label)
		if trimmedColumn == "" || trimmedLabel == "" {
			delete(request.ColumnLabels, column)
			continue
		}
		if trimmedColumn != column || trimmedLabel != label {
			delete(request.ColumnLabels, column)
			request.ColumnLabels[trimmedColumn] = trimmedLabel
		}
	}
	for index := range request.HiddenColumns {
		request.HiddenColumns[index] = strings.TrimSpace(request.HiddenColumns[index])
	}
	request.HiddenColumns = slices.DeleteFunc(request.HiddenColumns, func(column string) bool {
		return column == ""
	})
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
}

func (request *RelationLabelsRequest) Normalize() {
	if len(request.LabelColumns) > 3 {
		request.LabelColumns = request.LabelColumns[:3]
	}
	if len(request.Values) > 200 {
		request.Values = request.Values[:200]
	}
}

func (request *RelationOptionsRequest) Normalize() {
	if len(request.LabelColumns) > 3 {
		request.LabelColumns = request.LabelColumns[:3]
	}
	if request.Limit <= 0 {
		request.Limit = 25
	}
	if request.Limit > 50 {
		request.Limit = 50
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

func (request RelatedRowsRequest) Validate() error {
	if err := request.ConnectionTestRequest.Validate(); err != nil {
		return err
	}

	if request.Schema == "" {
		return errors.New("Schema is required.")
	}

	if request.Table == "" {
		return errors.New("Table is required.")
	}

	if len(request.RowKey) == 0 {
		return errors.New("Row key is required.")
	}

	return nil
}

func (request RelationLabelsRequest) Validate() error {
	if err := request.ConnectionTestRequest.Validate(); err != nil {
		return err
	}

	if request.Schema == "" {
		return errors.New("Schema is required.")
	}
	if request.Table == "" {
		return errors.New("Table is required.")
	}
	if request.Column == "" {
		return errors.New("Column is required.")
	}
	if len(request.Values) == 0 {
		return errors.New("At least one value is required.")
	}

	return nil
}

func (request RelationOptionsRequest) Validate() error {
	if err := request.ConnectionTestRequest.Validate(); err != nil {
		return err
	}

	if request.Schema == "" {
		return errors.New("Schema is required.")
	}
	if request.Table == "" {
		return errors.New("Table is required.")
	}
	if request.Column == "" {
		return errors.New("Column is required.")
	}
	if request.Limit < 1 || request.Limit > 50 {
		return errors.New("Limit must be between 1 and 50.")
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

func (request SaveSchemaDisplayConfigsRequest) Validate() error {
	if err := request.ConnectionTestRequest.Validate(); err != nil {
		return err
	}

	if len(request.Configs) == 0 {
		return errors.New("At least one schema config is required.")
	}

	for _, config := range request.Configs {
		if config.Schema == "" {
			return errors.New("Schema is required.")
		}
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

func (request SaveTableDisplayConfigRequest) Validate() error {
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
