package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

type WorkspaceRole string

const (
	WorkspaceAdmin     WorkspaceRole = "admin"
	WorkspaceEditor    WorkspaceRole = "editor"
	WorkspacePublisher WorkspaceRole = "publisher"
	WorkspaceViewer    WorkspaceRole = "viewer"
)

var ErrWorkspaceMembership = errors.New("workspace membership denied")

type WorkspaceAuthorizer interface {
	Role(context.Context, string, string) (WorkspaceRole, error)
}

type PostgreSQLWorkspaceAuthorizer struct{ db SessionDB }

func NewPostgreSQLWorkspaceAuthorizer(db SessionDB) (*PostgreSQLWorkspaceAuthorizer, error) {
	if db == nil {
		return nil, errors.New("workspace database is required")
	}
	return &PostgreSQLWorkspaceAuthorizer{db: db}, nil
}

func (store *PostgreSQLWorkspaceAuthorizer) Role(ctx context.Context, subject, workspace string) (WorkspaceRole, error) {
	if strings.TrimSpace(subject) == "" || strings.TrimSpace(workspace) == "" {
		return "", ErrWorkspaceMembership
	}
	var role WorkspaceRole
	err := store.db.QueryRow(ctx, `SELECT role FROM auth_workspace_members WHERE workspace_id = $1 AND subject_id = $2`, workspace, subject).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrWorkspaceMembership
	}
	if err != nil {
		return "", fmt.Errorf("load workspace membership: %w", err)
	}
	if !validWorkspaceRole(role) {
		return "", ErrWorkspaceMembership
	}
	return role, nil
}

func validWorkspaceRole(role WorkspaceRole) bool {
	switch role {
	case WorkspaceAdmin, WorkspaceEditor, WorkspacePublisher, WorkspaceViewer:
		return true
	default:
		return false
	}
}

func roleAllowsToken(role WorkspaceRole, operation string) bool {
	switch operation {
	case "read":
		return validWorkspaceRole(role)
	case "write", "revoke":
		return role == WorkspaceAdmin || role == WorkspaceEditor
	default:
		return false
	}
}
