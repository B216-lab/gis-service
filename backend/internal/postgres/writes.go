package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

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
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && postgresError.Code == "23503" {
			return fmt.Errorf(
				"%w: deletion blocked because related records still reference this row",
				ErrConstraintViolation,
			)
		}
		return fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	if commandTag.RowsAffected() != 1 {
		return fmt.Errorf("%w: delete target no longer matches current rows", ErrWriteConflict)
	}

	return nil
}
