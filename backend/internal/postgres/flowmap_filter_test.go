package postgres

import "testing"

func TestFlowmapFilterValidation(t *testing.T) {
	request := ListFlowmapDataRequest{
		ConnectionTestRequest: ConnectionTestRequest{ID: "registered"},
		Schema:                "public", Table: "journeys", StartMode: "coordinates", EndMode: "coordinates",
		StartLonColumn: "start_lon", StartLatColumn: "start_lat", EndLonColumn: "end_lon", EndLatColumn: "end_lat", Limit: 100,
	}
	for _, filter := range []*QueryFilter{
		nil,
		{Conditions: []FilterCondition{{Column: "vehicle", Operator: "eq", Value: "bus"}}},
		{Mode: "sql", Where: `("vehicle" = 'bus') AND ("city" = 'Irkutsk')`},
	} {
		request.Filter = filter
		if err := request.Validate(); err != nil {
			t.Fatalf("valid filter rejected: %v", err)
		}
	}
	for _, filter := range []*QueryFilter{
		{Mode: "unknown"},
		{Conditions: []FilterCondition{{Column: "vehicle", Operator: "drop", Value: "bus"}}},
		{Mode: "sql", Where: `TRUE; DELETE FROM journeys`},
	} {
		request.Filter = filter
		if err := request.Validate(); err == nil {
			t.Fatal("invalid flow filter accepted")
		}
	}
}
