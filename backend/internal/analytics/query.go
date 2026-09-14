package analytics

import (
	"fmt"
	"strings"
	"time"
)

// DatasetLookup must resolve the appropriate revision (live editor or pinned publication).
type DatasetLookup func(string) (Dataset, error)
type CompiledQuery struct {
	SQL          string
	Args         []any
	Limit        int
	ConnectionID string
}

func quote(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }
func datasetSQL(d Dataset) (string, error) {
	if strings.TrimSpace(d.SQL) != "" {
		return strings.TrimSuffix(strings.TrimSpace(d.SQL), ";"), nil
	}
	if d.Schema == "" || d.Table == "" {
		return "", fmt.Errorf("dataset requires SQL or schema/table")
	}
	return "SELECT * FROM " + quote(d.Schema) + "." + quote(d.Table), nil
}
func fieldExpression(d Dataset, id string) (string, error) {
	for _, f := range d.Fields {
		if f.ID == id {
			if f.Expression != "" {
				return "(" + f.Expression + ")", nil
			}
			return quote(f.Name), nil
		}
	}
	return "", fmt.Errorf("unknown field %q", id)
}
func datasetRelation(d Dataset) (string, error) {
	sql, err := datasetSQL(d)
	if err != nil {
		return "", err
	}
	// Calculated fields are exposed under their physical names for metric expressions.
	computed := []string{}
	for _, f := range d.Fields {
		if f.Expression != "" {
			computed = append(computed, "("+f.Expression+") AS "+quote(f.Name))
		}
	}
	if len(computed) > 0 {
		sql = "SELECT __base.*, " + strings.Join(computed, ", ") + " FROM (" + sql + ") AS __base"
	}
	return "(" + sql + ")", nil
}
func resolvedField(d Dataset, id, alias string) (string, error) {
	for _, f := range d.Fields {
		if f.ID == id {
			return alias + "." + quote(f.Name), nil
		}
	}
	return "", fmt.Errorf("unknown field %q", id)
}

// CompileQuery accepts field IDs and parameter values, never caller SQL fragments.
// SQL/metric expressions come exclusively from editor-owned dataset definitions.
func CompileQuery(q Query, lookup DatasetLookup) (CompiledQuery, error) {
	d, err := lookup(q.DatasetID)
	if err != nil {
		return CompiledQuery{}, err
	}
	source, err := datasetRelation(d)
	if err != nil {
		return CompiledQuery{}, err
	}
	limit := q.Limit
	if limit == 0 {
		limit = 1000
	}
	if limit < 1 || limit > 10000 {
		return CompiledQuery{}, fmt.Errorf("limit must be 1..10000")
	}
	if len(q.Dimensions)+len(q.Metrics) > 100 || len(q.Filters) > 100 || len(q.Having) > 100 {
		return CompiledQuery{}, fmt.Errorf("query exceeds complexity limit")
	}
	out := CompiledQuery{ConnectionID: d.ConnectionID, Limit: limit}
	selections := []string{}
	groups := []string{}
	selected := map[string]bool{}
	for _, id := range q.Dimensions {
		if selected[id] {
			return out, fmt.Errorf("duplicate selection %q", id)
		}
		expr, err := resolvedField(d, id, "__data")
		if err != nil {
			return out, err
		}
		if id == q.TimeFieldID && q.TimeGrain != "" {
			switch q.TimeGrain {
			case "hour", "day", "week", "month", "quarter", "year":
				expr = "date_trunc('" + q.TimeGrain + "', " + expr + ")"
			case "hour_of_day":
				expr = "EXTRACT(HOUR FROM " + expr + ")"
			case "day_of_week":
				expr = "EXTRACT(ISODOW FROM " + expr + ")"
			default:
				return out, fmt.Errorf("unsupported time grain")
			}
		}
		selections = append(selections, expr+" AS "+quote(id))
		groups = append(groups, expr)
		selected[id] = true
	}
	if q.TimeFieldID != "" && !selected[q.TimeFieldID] {
		return out, fmt.Errorf("time field must be selected as dimension")
	}
	for _, id := range q.Metrics {
		if selected[id] {
			return out, fmt.Errorf("duplicate selection %q", id)
		}
		found := false
		for _, m := range d.Metrics {
			if m.ID == id {
				selections = append(selections, "("+m.Expression+") AS "+quote(id))
				found = true
				break
			}
		}
		if !found {
			return out, fmt.Errorf("unknown metric %q", id)
		}
		selected[id] = true
	}
	if len(selections) == 0 {
		return out, fmt.Errorf("select at least one dimension or metric")
	}
	clauses := []string{}
	// Filters from the same related dataset share one EXISTS, requiring a single
	// matching row to satisfy every predicate and preserving the root row grain.
	related := map[string][]Filter{}
	relatedOrder := []string{}
	for _, f := range q.Filters {
		if f.DatasetID != "" && f.DatasetID != d.ID {
			if _, ok := related[f.DatasetID]; !ok {
				relatedOrder = append(relatedOrder, f.DatasetID)
			}
			related[f.DatasetID] = append(related[f.DatasetID], f)
			continue
		}
		clause, e := compileDatasetFilter(d, "__data", f, &out.Args, 0)
		if e != nil {
			return out, e
		}
		clauses = append(clauses, clause)
	}
	for _, targetID := range relatedOrder {
		var relation *Relationship
		for i := range d.Relationships {
			r := &d.Relationships[i]
			if r.TargetDatasetID == targetID && r.AllowFiltering {
				if relation != nil {
					return out, fmt.Errorf("ambiguous dataset relationship")
				}
				relation = r
			}
		}
		if relation == nil {
			return out, fmt.Errorf("no filter relationship to %q", targetID)
		}
		target, e := lookup(targetID)
		if e != nil {
			return out, e
		}
		if target.ConnectionID != d.ConnectionID {
			return out, fmt.Errorf("cross-connection filters unsupported")
		}
		targetSQL, e := datasetRelation(target)
		if e != nil {
			return out, e
		}
		local, e := resolvedField(d, relation.SourceFieldID, "__data")
		if e != nil {
			return out, e
		}
		remote, e := resolvedField(target, relation.TargetFieldID, "__related")
		if e != nil {
			return out, e
		}
		predicates := []string{local + " = " + remote}
		for _, f := range related[targetID] {
			c, e := compileDatasetFilter(target, "__related", f, &out.Args, 0)
			if e != nil {
				return out, e
			}
			predicates = append(predicates, c)
		}
		clauses = append(clauses, "EXISTS (SELECT 1 FROM "+targetSQL+" AS __related WHERE "+strings.Join(predicates, " AND ")+")")
	}
	out.SQL = "SELECT " + strings.Join(selections, ", ") + " FROM " + source + " AS __data"
	if len(clauses) > 0 {
		out.SQL += " WHERE " + strings.Join(clauses, " AND ")
	}
	if len(q.Metrics) > 0 && len(groups) > 0 {
		out.SQL += " GROUP BY " + strings.Join(groups, ", ")
	}

	having := []string{}
	for _, filter := range q.Having {
		if len(q.Metrics) == 0 || len(filter.AnyOf) > 0 || filter.DatasetID != "" && filter.DatasetID != d.ID || filter.SourceWidgetID != "" || len(filter.TargetWidgetIDs) > 0 {
			return out, fmt.Errorf("HAVING requires selected metrics without dataset/widget scopes")
		}
		expression := ""
		for _, id := range q.Metrics {
			if id == filter.FieldID {
				for _, metric := range d.Metrics {
					if metric.ID == id {
						expression = metric.Expression
					}
				}
			}
		}
		if expression == "" {
			return out, fmt.Errorf("HAVING field must be a selected metric")
		}
		clause, e := compileFilter("("+expression+")", filter, &out.Args)
		if e != nil {
			return out, e
		}
		having = append(having, clause)
	}
	if len(having) > 0 {
		out.SQL += " HAVING " + strings.Join(having, " AND ")
	}

	// Dimension-only queries retain duplicate records for geographic points/arcs.
	order := []string{}
	for _, s := range q.Sort {
		if !selected[s.FieldID] {
			return out, fmt.Errorf("sort field must be selected")
		}
		direction := " ASC"
		if s.Desc {
			direction = " DESC"
		}
		order = append(order, quote(s.FieldID)+direction+" NULLS LAST")
	}
	if len(order) > 0 {
		out.SQL += " ORDER BY " + strings.Join(order, ", ")
	}
	out.SQL += fmt.Sprintf(" LIMIT %d", limit+1)
	return out, nil
}

func compileFilter(expr string, f Filter, args *[]any) (string, error) {
	if len(f.Values) > 1000 {
		return "", fmt.Errorf("filter exceeds value limit")
	}
	bind := func(v any) (string, error) {
		switch v.(type) {
		case string, float64, float32, int, int64, bool:
		default:
			return "", fmt.Errorf("filter values must be scalar and non-null")
		}
		*args = append(*args, v)
		return fmt.Sprintf("$%d", len(*args)), nil
	}
	switch f.Operator {
	case "is_null", "is_not_null":
		if len(f.Values) != 0 {
			return "", fmt.Errorf("null filter takes no values")
		}
		if f.Operator == "is_null" {
			return expr + " IS NULL", nil
		}
		return expr + " IS NOT NULL", nil
	case "in", "not_in":
		if len(f.Values) == 0 {
			if f.Operator == "in" {
				return "FALSE", nil
			}
			return "TRUE", nil
		}
		ps := []string{}
		for _, v := range f.Values {
			p, e := bind(v)
			if e != nil {
				return "", e
			}
			ps = append(ps, p)
		}
		op := " IN ("
		if f.Operator == "not_in" {
			op = " NOT IN ("
		}
		return expr + op + strings.Join(ps, ", ") + ")", nil
	case "between":
		if len(f.Values) != 2 {
			return "", fmt.Errorf("between requires two values")
		}
		a, e := bind(f.Values[0])
		if e != nil {
			return "", e
		}
		b, e := bind(f.Values[1])
		return expr + " BETWEEN " + a + " AND " + b, e
	case "eq", "ne", "gt", "gte", "lt", "lte", "contains":
		if len(f.Values) != 1 {
			return "", fmt.Errorf("comparison requires one value")
		}
		op := map[string]string{"eq": " = ", "ne": " <> ", "gt": " > ", "gte": " >= ", "lt": " < ", "lte": " <= "}[f.Operator]
		if f.Operator == "contains" {
			v, ok := f.Values[0].(string)
			if !ok {
				return "", fmt.Errorf("contains requires text")
			}
			v = strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(v)
			p, e := bind("%" + v + "%")
			return "CAST(" + expr + " AS text) ILIKE " + p, e
		}
		p, e := bind(f.Values[0])
		return expr + op + p, e
	default:
		return "", fmt.Errorf("unsupported filter operator %q", f.Operator)
	}
}

func compileDatasetFilter(d Dataset, alias string, f Filter, args *[]any, depth int) (string, error) {
	if len(f.AnyOf) > 0 {
		if depth > 0 || len(f.AnyOf) > 100 || f.FieldID != "" || f.Operator != "" {
			return "", fmt.Errorf("invalid filter alternatives")
		}
		alternatives := []string{}
		for _, group := range f.AnyOf {
			if len(group) == 0 || len(group) > 10 {
				return "", fmt.Errorf("invalid filter group")
			}
			terms := []string{}
			for _, child := range group {
				if child.DatasetID != "" && child.DatasetID != d.ID {
					return "", fmt.Errorf("filter group must share dataset")
				}
				c, e := compileDatasetFilter(d, alias, child, args, depth+1)
				if e != nil {
					return "", e
				}
				terms = append(terms, c)
			}
			alternatives = append(alternatives, "("+strings.Join(terms, " AND ")+")")
		}
		return "(" + strings.Join(alternatives, " OR ") + ")", nil
	}
	expr, e := resolvedField(d, f.FieldID, alias)
	if e != nil {
		return "", e
	}
	if f.Operator == "last_months" {
		if len(f.Values) != 1 {
			return "", fmt.Errorf("last_months requires month count")
		}
		var months int
		switch n := f.Values[0].(type) {
		case int:
			months = n
		case float64:
			months = int(n)
			if float64(months) != n {
				return "", fmt.Errorf("months must be integer")
			}
		default:
			return "", fmt.Errorf("months must be integer")
		}
		if months < 1 || months > 120 {
			return "", fmt.Errorf("months must be 1..120")
		}
		now := time.Now().UTC()
		f.Operator = "between"
		f.Values = []any{now.AddDate(0, -months, 0).Format(time.RFC3339Nano), now.Format(time.RFC3339Nano)}
	}
	return compileFilter(expr, f, args)
}
