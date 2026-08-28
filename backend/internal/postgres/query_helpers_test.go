package postgres

import (
	"fmt"
	"strings"
	"testing"
)

func TestMVTInlinePropertyExpressions(t *testing.T) {
	columns := []columnDefinition{
		{Name: "name", UdtName: "text"},
		{Name: "population", UdtName: "int8"},
		{Name: "geom", UdtName: "geometry"},
		{Name: "geog", UdtName: "geography"},
		{Name: "image", UdtName: "raster"},
		{Name: "payload", UdtName: "bytea"},
		{Name: "Geom", UdtName: "text"},
		{Name: "_geopanel_internal", UdtName: "text"},
		{Name: `odd"name`, UdtName: "text"},
	}

	got := mvtInlinePropertyExpressions(columns)
	want := []string{
		`left(source_row."name"::text, 512) as "name"`,
		`left(source_row."population"::text, 512) as "population"`,
		`left(source_row."odd""name"::text, 512) as "odd""name"`,
	}

	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("unexpected expressions:\n got: %q\nwant: %q", got, want)
	}
}

func TestMVTInlinePropertyExpressionsLimitsColumnCount(t *testing.T) {
	columns := make([]columnDefinition, maxMVTInlinePropertyColumns+3)
	for index := range columns {
		columns[index] = columnDefinition{
			Name:    fmt.Sprintf("column_%d", index),
			UdtName: "text",
		}
	}

	got := mvtInlinePropertyExpressions(columns)
	if len(got) != maxMVTInlinePropertyColumns {
		t.Fatalf("got %d expressions, want %d", len(got), maxMVTInlinePropertyColumns)
	}
	if strings.Contains(strings.Join(got, " "), "column_16") {
		t.Fatal("expressions include a column after the configured limit")
	}
}
