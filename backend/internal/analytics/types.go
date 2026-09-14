package analytics

import "encoding/json"

// Metadata identifies a mutable object. Updates must supply its current revision.
type Metadata struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Revision  int    `json:"revision"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}
type Field struct {
	Label      string `json:"label,omitempty"`
	ID         string `json:"id"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Expression string `json:"expression,omitempty"`
	SemanticID string `json:"semanticId,omitempty"`
	Role       string `json:"role,omitempty"`
	Format     string `json:"format,omitempty"`
}
type Metric struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Expression string `json:"expression"`
	Format     string `json:"format,omitempty"`
}
type Relationship struct {
	ID              string `json:"id"`
	TargetDatasetID string `json:"targetDatasetId"`
	SourceFieldID   string `json:"sourceFieldId"`
	TargetFieldID   string `json:"targetFieldId"`
	Cardinality     string `json:"cardinality"`
	AllowFiltering  bool   `json:"allowFiltering"`
}
type Dataset struct {
	Metadata
	ConnectionID       string         `json:"connectionId"`
	SQL                string         `json:"sql,omitempty"`
	Schema             string         `json:"schema,omitempty"`
	Table              string         `json:"table,omitempty"`
	Grain              string         `json:"grain,omitempty"`
	Fields             []Field        `json:"fields"`
	Metrics            []Metric       `json:"metrics"`
	Relationships      []Relationship `json:"relationships,omitempty"`
	DefaultTimeFieldID string         `json:"defaultTimeFieldId,omitempty"`
}
type Filter struct {
	AnyOf           [][]Filter `json:"anyOf,omitempty"`
	FieldID         string     `json:"fieldId"`
	Operator        string     `json:"operator"`
	Values          []any      `json:"values,omitempty"`
	DatasetID       string     `json:"datasetId,omitempty"`
	SourceWidgetID  string     `json:"sourceWidgetId,omitempty"`
	TargetWidgetIDs []string   `json:"targetWidgetIds,omitempty"`
}
type Sort struct {
	FieldID string `json:"fieldId"`
	Desc    bool   `json:"desc"`
}
type Query struct {
	Having      []Filter `json:"having,omitempty"`
	DatasetID   string   `json:"datasetId"`
	Dimensions  []string `json:"dimensions,omitempty"`
	Metrics     []string `json:"metrics,omitempty"`
	Filters     []Filter `json:"filters,omitempty"`
	Sort        []Sort   `json:"sort,omitempty"`
	Limit       int      `json:"limit,omitempty"`
	TimeFieldID string   `json:"timeFieldId,omitempty"`
	TimeGrain   string   `json:"timeGrain,omitempty"`
}
type Chart struct {
	Metadata
	DatasetID     string          `json:"datasetId"`
	Type          string          `json:"type"`
	Query         Query           `json:"query"`
	Options       json.RawMessage `json:"options,omitempty"`
	LayerChartIDs []string        `json:"layerChartIds,omitempty"`
}
type Widget struct {
	FilterTargetWidgetIDs []string `json:"filterTargetWidgetIds,omitempty"`
	ID                    string   `json:"id"`
	ChartID               string   `json:"chartId,omitempty"`
	Text                  string   `json:"text,omitempty"`
	X                     int      `json:"x"`
	Y                     int      `json:"y"`
	W                     int      `json:"w"`
	H                     int      `json:"h"`
}
type NativeFilter struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	DatasetID       string   `json:"datasetId"`
	FieldID         string   `json:"fieldId"`
	TargetWidgetIDs []string `json:"targetWidgetIds,omitempty"`
}
type Dashboard struct {
	RefreshIntervalSeconds int            `json:"refreshIntervalSeconds,omitempty"`
	NativeFilters          []NativeFilter `json:"nativeFilters,omitempty"`
	Metadata
	Widgets     []Widget `json:"widgets"`
	Filters     []Filter `json:"filters,omitempty"`
	Description string   `json:"description,omitempty"`
}

// Publication embeds immutable definitions, including transitive dependencies.
type Publication struct {
	Metadata
	Dashboard Dashboard `json:"dashboard"`
	Charts    []Chart   `json:"charts"`
	Datasets  []Dataset `json:"datasets"`
}
type Share struct {
	Metadata
	PublicationID string   `json:"publicationId"`
	TokenHash     string   `json:"-"`
	ExpiresAt     string   `json:"expiresAt,omitempty"`
	Revoked       bool     `json:"revoked"`
	Filters       []Filter `json:"filters,omitempty"`
}
