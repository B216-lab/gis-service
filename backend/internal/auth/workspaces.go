package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

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
var ErrWorkspaceNotFound = errors.New("workspace not found")
var ErrInvalidWorkspace = errors.New("invalid workspace")

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

func (store *PostgreSQLWorkspaceAuthorizer) RoleForPrincipal(ctx context.Context, principal Principal, workspace string) (WorkspaceRole, error) {
	if strings.TrimSpace(principal.Subject) == "" || strings.TrimSpace(workspace) == "" {
		return "", ErrWorkspaceMembership
	}
	db, ok := store.db.(interface {
		Query(context.Context, string, ...any) (pgx.Rows, error)
	})
	if !ok {
		return "", errors.New("workspace database does not support group authorization")
	}
	rows, err := db.Query(ctx, `SELECT role FROM auth_workspace_members WHERE workspace_id = $1 AND subject_id = $2
UNION ALL
SELECT role FROM auth_workspace_group_roles WHERE workspace_id = $1 AND group_name = ANY($3)`, workspace, principal.Subject, principal.Groups)
	if err != nil {
		return "", fmt.Errorf("load workspace roles: %w", err)
	}
	defer rows.Close()
	var best WorkspaceRole
	for rows.Next() {
		var role WorkspaceRole
		if err := rows.Scan(&role); err != nil {
			return "", fmt.Errorf("scan workspace role: %w", err)
		}
		if roleRank(role) > roleRank(best) {
			best = role
		}
	}
	if err := rows.Err(); err != nil {
		return "", fmt.Errorf("iterate workspace roles: %w", err)
	}
	if !validWorkspaceRole(best) {
		return "", ErrWorkspaceMembership
	}
	return best, nil
}

func validWorkspaceRole(role WorkspaceRole) bool {
	switch role {
	case WorkspaceAdmin, WorkspaceEditor, WorkspacePublisher, WorkspaceViewer:
		return true
	default:
		return false
	}
}

func roleRank(role WorkspaceRole) int {
	switch role {
	case WorkspaceAdmin:
		return 4
	case WorkspacePublisher:
		return 3
	case WorkspaceEditor:
		return 2
	case WorkspaceViewer:
		return 1
	default:
		return 0
	}
}

func roleAllowsToken(role WorkspaceRole, operation string) bool {
	switch operation {
	case "read":
		return validWorkspaceRole(role)
	case "write":
		return role == WorkspaceAdmin || role == WorkspaceEditor
	case "revoke":
		return role == WorkspaceAdmin
	default:
		return false
	}
}

type Workspace struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Role        WorkspaceRole `json:"role"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
}

type WorkspaceMember struct {
	Subject string        `json:"subject"`
	Role    WorkspaceRole `json:"role"`
	Created time.Time     `json:"created_at"`
}

type WorkspaceGroupRole struct {
	Group   string        `json:"group"`
	Role    WorkspaceRole `json:"role"`
	Created time.Time     `json:"created_at"`
}

type WorkspaceStore interface {
	WorkspaceAuthorizer
	ListWorkspaces(context.Context, Principal) ([]Workspace, error)
	CreateWorkspace(context.Context, string, string, string) (Workspace, error)
	GetWorkspace(context.Context, string) (Workspace, error)
	UpdateWorkspace(context.Context, string, string, string) (Workspace, error)
	ListMembers(context.Context, string) ([]WorkspaceMember, error)
	PutMember(context.Context, string, string, WorkspaceRole) (WorkspaceMember, error)
	RemoveMember(context.Context, string, string) error
}

type workspaceQueryDB interface {
	SessionDB
	Query(context.Context, string, ...any) (pgx.Rows, error)
	Begin(context.Context) (pgx.Tx, error)
}

type PostgreSQLWorkspaceStore struct {
	db workspaceQueryDB
	*PostgreSQLWorkspaceAuthorizer
}

func NewPostgreSQLWorkspaceStore(db workspaceQueryDB) (*PostgreSQLWorkspaceStore, error) {
	if db == nil {
		return nil, errors.New("workspace database is required")
	}
	authz, _ := NewPostgreSQLWorkspaceAuthorizer(db)
	return &PostgreSQLWorkspaceStore{db: db, PostgreSQLWorkspaceAuthorizer: authz}, nil
}

func newWorkspaceID() (string, error) {
	value := make([]byte, 12)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return "ws_" + base64.RawURLEncoding.EncodeToString(value), nil
}

func (store *PostgreSQLWorkspaceStore) ListWorkspaces(ctx context.Context, principal Principal) ([]Workspace, error) {
	rows, err := store.db.Query(ctx, `SELECT w.id, w.name, w.description, roles.role, w.created_at, w.updated_at
FROM auth_workspaces w
JOIN LATERAL (
  SELECT role FROM auth_workspace_members WHERE workspace_id = w.id AND subject_id = $1
  UNION ALL SELECT role FROM auth_workspace_group_roles WHERE workspace_id = w.id AND group_name = ANY($2)
) roles ON TRUE
ORDER BY w.name, w.id`, principal.Subject, principal.Groups)
	if err != nil {
		return nil, fmt.Errorf("list workspaces: %w", err)
	}
	defer rows.Close()
	byID := map[string]Workspace{}
	order := []string{}
	for rows.Next() {
		var item Workspace
		if err := rows.Scan(&item.ID, &item.Name, &item.Description, &item.Role, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan workspace: %w", err)
		}
		current, exists := byID[item.ID]
		if !exists {
			byID[item.ID], order = item, append(order, item.ID)
		} else if roleRank(item.Role) > roleRank(current.Role) {
			current.Role = item.Role
			byID[item.ID] = current
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate workspaces: %w", err)
	}
	result := make([]Workspace, 0, len(order))
	for _, id := range order {
		result = append(result, byID[id])
	}
	return result, nil
}

func (store *PostgreSQLWorkspaceStore) CreateWorkspace(ctx context.Context, name, description, owner string) (Workspace, error) {
	name, owner = strings.TrimSpace(name), strings.TrimSpace(owner)
	if name == "" || owner == "" {
		return Workspace{}, ErrInvalidWorkspace
	}
	id, err := newWorkspaceID()
	if err != nil {
		return Workspace{}, fmt.Errorf("generate workspace ID: %w", err)
	}
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return Workspace{}, fmt.Errorf("begin workspace creation: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var item Workspace
	err = tx.QueryRow(ctx, `INSERT INTO auth_workspaces (id, name, description) VALUES ($1, $2, $3)
RETURNING id, name, description, created_at, updated_at`, id, name, strings.TrimSpace(description)).Scan(&item.ID, &item.Name, &item.Description, &item.CreatedAt, &item.UpdatedAt)
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO auth_workspace_members (workspace_id, subject_id, role) VALUES ($1, $2, 'admin')`, id, owner)
	}
	if err != nil {
		return Workspace{}, fmt.Errorf("create workspace: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Workspace{}, fmt.Errorf("commit workspace creation: %w", err)
	}
	item.Role = WorkspaceAdmin
	return item, nil
}

func (store *PostgreSQLWorkspaceStore) GetWorkspace(ctx context.Context, id string) (Workspace, error) {
	var item Workspace
	err := store.db.QueryRow(ctx, `SELECT id, name, description, created_at, updated_at FROM auth_workspaces WHERE id = $1`, id).Scan(&item.ID, &item.Name, &item.Description, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Workspace{}, ErrWorkspaceNotFound
	}
	if err != nil {
		return Workspace{}, fmt.Errorf("get workspace: %w", err)
	}
	return item, nil
}

func (store *PostgreSQLWorkspaceStore) UpdateWorkspace(ctx context.Context, id, name, description string) (Workspace, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Workspace{}, ErrInvalidWorkspace
	}
	var item Workspace
	err := store.db.QueryRow(ctx, `UPDATE auth_workspaces SET name = $2, description = $3, updated_at = NOW() WHERE id = $1
RETURNING id, name, description, created_at, updated_at`, id, name, strings.TrimSpace(description)).Scan(&item.ID, &item.Name, &item.Description, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Workspace{}, ErrWorkspaceNotFound
	}
	if err != nil {
		return Workspace{}, fmt.Errorf("update workspace: %w", err)
	}
	return item, nil
}

func (store *PostgreSQLWorkspaceStore) ListMembers(ctx context.Context, workspace string) ([]WorkspaceMember, error) {
	rows, err := store.db.Query(ctx, `SELECT subject_id, role, created_at FROM auth_workspace_members WHERE workspace_id = $1 ORDER BY subject_id`, workspace)
	if err != nil {
		return nil, fmt.Errorf("list workspace members: %w", err)
	}
	defer rows.Close()
	result := []WorkspaceMember{}
	for rows.Next() {
		var item WorkspaceMember
		if err := rows.Scan(&item.Subject, &item.Role, &item.Created); err != nil {
			return nil, fmt.Errorf("scan workspace member: %w", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (store *PostgreSQLWorkspaceStore) PutMember(ctx context.Context, workspace, subject string, role WorkspaceRole) (WorkspaceMember, error) {
	subject = strings.TrimSpace(subject)
	if subject == "" || !validWorkspaceRole(role) {
		return WorkspaceMember{}, ErrInvalidWorkspace
	}
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return WorkspaceMember{}, fmt.Errorf("begin member update: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var lockedWorkspace string
	if err := tx.QueryRow(ctx, `SELECT id FROM auth_workspaces WHERE id = $1 FOR UPDATE`, workspace).Scan(&lockedWorkspace); errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceMember{}, ErrWorkspaceNotFound
	} else if err != nil {
		return WorkspaceMember{}, fmt.Errorf("lock workspace: %w", err)
	}
	var current WorkspaceRole
	err = tx.QueryRow(ctx, `SELECT role FROM auth_workspace_members WHERE workspace_id = $1 AND subject_id = $2 FOR UPDATE`, workspace, subject).Scan(&current)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceMember{}, fmt.Errorf("load workspace member: %w", err)
	}
	if current == WorkspaceAdmin && role != WorkspaceAdmin {
		var admins int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM auth_workspace_members WHERE workspace_id = $1 AND role = 'admin'`, workspace).Scan(&admins); err != nil {
			return WorkspaceMember{}, fmt.Errorf("count workspace admins: %w", err)
		}
		if admins <= 1 {
			return WorkspaceMember{}, ErrInvalidWorkspace
		}
	}
	var item WorkspaceMember
	err = tx.QueryRow(ctx, `INSERT INTO auth_workspace_members (workspace_id, subject_id, role) VALUES ($1, $2, $3)
ON CONFLICT (workspace_id, subject_id) DO UPDATE SET role = EXCLUDED.role
RETURNING subject_id, role, created_at`, workspace, subject, role).Scan(&item.Subject, &item.Role, &item.Created)
	if err != nil {
		return WorkspaceMember{}, fmt.Errorf("put workspace member: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return WorkspaceMember{}, fmt.Errorf("commit member update: %w", err)
	}
	return item, nil
}

func (store *PostgreSQLWorkspaceStore) RemoveMember(ctx context.Context, workspace, subject string) error {
	var remainingAdmins int
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin member removal: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var lockedWorkspace string
	if err := tx.QueryRow(ctx, `SELECT id FROM auth_workspaces WHERE id = $1 FOR UPDATE`, workspace).Scan(&lockedWorkspace); errors.Is(err, pgx.ErrNoRows) {
		return ErrWorkspaceNotFound
	} else if err != nil {
		return fmt.Errorf("lock workspace: %w", err)
	}
	var role WorkspaceRole
	if err := tx.QueryRow(ctx, `SELECT role FROM auth_workspace_members WHERE workspace_id = $1 AND subject_id = $2 FOR UPDATE`, workspace, subject).Scan(&role); errors.Is(err, pgx.ErrNoRows) {
		return ErrWorkspaceNotFound
	} else if err != nil {
		return fmt.Errorf("load workspace member: %w", err)
	}
	if role == WorkspaceAdmin {
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM auth_workspace_members WHERE workspace_id = $1 AND role = 'admin'`, workspace).Scan(&remainingAdmins); err != nil {
			return fmt.Errorf("count workspace admins: %w", err)
		}
		if remainingAdmins <= 1 {
			return ErrInvalidWorkspace
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM auth_workspace_members WHERE workspace_id = $1 AND subject_id = $2`, workspace, subject); err != nil {
		return fmt.Errorf("remove workspace member: %w", err)
	}
	return tx.Commit(ctx)
}

func (store *PostgreSQLWorkspaceStore) ListGroupRoles(ctx context.Context, workspace string) ([]WorkspaceGroupRole, error) {
	rows, err := store.db.Query(ctx, `SELECT group_name, role, created_at FROM auth_workspace_group_roles WHERE workspace_id = $1 ORDER BY group_name`, workspace)
	if err != nil {
		return nil, fmt.Errorf("list workspace group roles: %w", err)
	}
	defer rows.Close()
	result := []WorkspaceGroupRole{}
	for rows.Next() {
		var item WorkspaceGroupRole
		if err := rows.Scan(&item.Group, &item.Role, &item.Created); err != nil {
			return nil, fmt.Errorf("scan workspace group role: %w", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (store *PostgreSQLWorkspaceStore) PutGroupRole(ctx context.Context, workspace, group string, role WorkspaceRole) (WorkspaceGroupRole, error) {
	group = strings.TrimSpace(group)
	if group == "" || !validWorkspaceRole(role) {
		return WorkspaceGroupRole{}, ErrInvalidWorkspace
	}
	var item WorkspaceGroupRole
	err := store.db.QueryRow(ctx, `INSERT INTO auth_workspace_group_roles (workspace_id, group_name, role) VALUES ($1, $2, $3)
ON CONFLICT (workspace_id, group_name) DO UPDATE SET role = EXCLUDED.role
RETURNING group_name, role, created_at`, workspace, group, role).Scan(&item.Group, &item.Role, &item.Created)
	if err != nil {
		return WorkspaceGroupRole{}, fmt.Errorf("put workspace group role: %w", err)
	}
	return item, nil
}

func (store *PostgreSQLWorkspaceStore) RemoveGroupRole(ctx context.Context, workspace, group string) error {
	tag, err := store.db.Exec(ctx, `DELETE FROM auth_workspace_group_roles WHERE workspace_id = $1 AND group_name = $2`, workspace, group)
	if err != nil {
		return fmt.Errorf("remove workspace group role: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrWorkspaceNotFound
	}
	return nil
}

// BootstrapWorkspace seeds only a brand-new configured workspace. Existing
// workspaces are never used to grant or upgrade membership during startup.
func BootstrapWorkspace(ctx context.Context, db workspaceQueryDB, id, name, subject string) error {
	id, name, subject = strings.TrimSpace(id), strings.TrimSpace(name), strings.TrimSpace(subject)
	if id == "" && subject == "" {
		return nil
	}
	if id == "" || subject == "" || name == "" {
		return ErrInvalidWorkspace
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin workspace bootstrap: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var created string
	err = tx.QueryRow(ctx, `INSERT INTO auth_workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id`, id, name).Scan(&created)
	if errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx)
	}
	if err != nil {
		return fmt.Errorf("create bootstrap workspace: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO auth_workspace_members (workspace_id, subject_id, role) VALUES ($1, $2, 'admin')`, id, subject); err != nil {
		return fmt.Errorf("create bootstrap admin: %w", err)
	}
	return tx.Commit(ctx)
}
