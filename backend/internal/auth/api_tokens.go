package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	apiTokenBytes  = 32
	apiTokenPrefix = "gp_"
	apiTokenMeta   = 12
	MaxAPITokenTTL = 90 * 24 * time.Hour
)

var ErrInvalidAPIToken = errors.New("invalid API token")

type APITokenDB interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type APITokenQueryDB interface {
	APITokenDB
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

type apiTokenTxDB interface {
	APITokenQueryDB
	Begin(context.Context) (pgx.Tx, error)
}

type APIToken struct {
	ID         string
	Name       string
	Token      string // populated only by Create; never persisted
	Prefix     string
	Subject    string
	Workspace  string
	Scopes     map[string]bool
	ExpiresAt  time.Time
	RevokedAt  *time.Time
	LastUsedAt *time.Time
	CreatedAt  time.Time
	CreatedBy  string
}

type APITokenCreateRequest struct {
	Name      string
	Subject   string
	Workspace string
	Scopes    map[string]bool
	ExpiresAt time.Time
	CreatedBy string
}

type PostgreSQLAPITokenStore struct {
	db  APITokenDB
	now func() time.Time
}

func NewPostgreSQLAPITokenStore(db APITokenDB) (*PostgreSQLAPITokenStore, error) {
	if db == nil {
		return nil, errors.New("API token database is required")
	}
	return &PostgreSQLAPITokenStore{db: db, now: time.Now}, nil
}

func NewAPIToken() (string, string, error) {
	raw := make([]byte, apiTokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", "", fmt.Errorf("generate API token: %w", err)
	}
	token := apiTokenPrefix + base64.RawURLEncoding.EncodeToString(raw)
	return token, token[:apiTokenMeta], nil
}

func parseTokenScopes(value []string) map[string]bool {
	result := make(map[string]bool, len(value))
	for _, scope := range value {
		if scope = strings.TrimSpace(scope); scope != "" {
			result[scope] = true
		}
	}
	return result
}

func (store *PostgreSQLAPITokenStore) Create(ctx context.Context, request APITokenCreateRequest) (APIToken, error) {
	return store.create(ctx, store.db, request)
}

func (store *PostgreSQLAPITokenStore) create(ctx context.Context, db APITokenDB, request APITokenCreateRequest) (APIToken, error) {
	now := store.now()
	request.Name = strings.TrimSpace(request.Name)
	if request.Name == "" {
		request.Name = "API token"
	}
	if strings.TrimSpace(request.Subject) == "" || strings.TrimSpace(request.Workspace) == "" || request.ExpiresAt.IsZero() || !request.ExpiresAt.After(now) || request.ExpiresAt.After(now.Add(MaxAPITokenTTL)) || !validTokenScopes(request.Scopes) {
		return APIToken{}, ErrInvalidAPIToken
	}
	token, prefix, err := NewAPIToken()
	if err != nil {
		return APIToken{}, err
	}
	idBytes := make([]byte, 16)
	if _, err = rand.Read(idBytes); err != nil {
		return APIToken{}, fmt.Errorf("generate API token ID: %w", err)
	}
	id := base64.RawURLEncoding.EncodeToString(idBytes)
	_, err = db.Exec(ctx, `INSERT INTO auth_api_tokens (id, name, token_hash, token_prefix, subject_id, workspace_id, scopes, expires_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, id, request.Name, apiTokenHash(token), prefix, request.Subject, request.Workspace, scopeList(request.Scopes), request.ExpiresAt, request.CreatedBy)
	if err != nil {
		return APIToken{}, fmt.Errorf("create API token: %w", err)
	}
	return APIToken{ID: id, Name: request.Name, Token: token, Prefix: prefix, Subject: request.Subject, Workspace: request.Workspace, Scopes: cloneScopes(request.Scopes), ExpiresAt: request.ExpiresAt, CreatedAt: now, CreatedBy: request.CreatedBy}, nil
}

func (store *PostgreSQLAPITokenStore) Authenticate(request *http.Request) (Principal, error) {
	if request == nil {
		return Principal{}, ErrUnauthenticated
	}
	parts := strings.Fields(request.Header.Get("Authorization"))
	if len(parts) == 0 {
		return Principal{}, ErrUnauthenticated
	}
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return Principal{}, ErrInvalidAPIToken
	}
	var token APIToken
	var scopes []string
	var role WorkspaceRole
	var revokedAt *time.Time
	err := store.db.QueryRow(request.Context(), `SELECT t.id, t.subject_id, t.workspace_id, t.scopes, t.expires_at, t.revoked_at, t.created_by, m.role
FROM auth_api_tokens t
JOIN auth_workspace_members m ON m.workspace_id = t.workspace_id AND m.subject_id = t.subject_id
WHERE t.token_hash = $1 AND t.expires_at > NOW() AND t.revoked_at IS NULL`, apiTokenHash(parts[1])).Scan(&token.ID, &token.Subject, &token.Workspace, &scopes, &token.ExpiresAt, &revokedAt, &token.CreatedBy, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, ErrInvalidAPIToken
	}
	if err != nil {
		return Principal{}, fmt.Errorf("lookup API token: %w", err)
	}
	token.Scopes = parseTokenScopes(scopes)
	if !token.ExpiresAt.After(store.now()) || revokedAt != nil || !roleAllowsScopes(role, token.Scopes) {
		return Principal{}, ErrInvalidAPIToken
	}
	_, err = store.db.Exec(request.Context(), `UPDATE auth_api_tokens SET last_used_at = NOW() WHERE id = $1`, token.ID)
	if err != nil {
		return Principal{}, fmt.Errorf("update API token use: %w", err)
	}
	return Principal{Subject: token.Subject, TokenID: token.ID, IsAPIToken: true, Workspace: token.Workspace, Scopes: token.Scopes}, nil
}

func (store *PostgreSQLAPITokenStore) Revoke(ctx context.Context, id string) error {
	if strings.TrimSpace(id) == "" {
		return ErrInvalidAPIToken
	}
	if _, err := store.db.Exec(ctx, `UPDATE auth_api_tokens SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`, id); err != nil {
		return fmt.Errorf("revoke API token: %w", err)
	}
	return nil
}

func (store *PostgreSQLAPITokenStore) List(ctx context.Context, workspace string) ([]APIToken, error) {
	db, ok := store.db.(APITokenQueryDB)
	if !ok {
		return nil, errors.New("API token database does not support listing")
	}
	rows, err := db.Query(ctx, `SELECT id, name, token_prefix, subject_id, workspace_id, scopes, expires_at, revoked_at, last_used_at, created_at, created_by FROM auth_api_tokens WHERE workspace_id = $1 ORDER BY created_at DESC, id`, workspace)
	if err != nil {
		return nil, fmt.Errorf("list API tokens: %w", err)
	}
	defer rows.Close()
	result := make([]APIToken, 0)
	for rows.Next() {
		var token APIToken
		var scopes []string
		if err := rows.Scan(&token.ID, &token.Name, &token.Prefix, &token.Subject, &token.Workspace, &scopes, &token.ExpiresAt, &token.RevokedAt, &token.LastUsedAt, &token.CreatedAt, &token.CreatedBy); err != nil {
			return nil, fmt.Errorf("scan API token: %w", err)
		}
		token.Scopes = parseTokenScopes(scopes)
		result = append(result, token)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate API tokens: %w", err)
	}
	return result, nil
}

func (store *PostgreSQLAPITokenStore) RotateWorkspace(ctx context.Context, workspace, id, createdBy string) (APIToken, error) {
	db, ok := store.db.(apiTokenTxDB)
	if !ok {
		return APIToken{}, errors.New("API token database does not support rotation")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return APIToken{}, fmt.Errorf("begin API token rotation: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var request APITokenCreateRequest
	var scopes []string
	err = tx.QueryRow(ctx, `SELECT name, subject_id, workspace_id, scopes, expires_at FROM auth_api_tokens WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL AND expires_at > NOW() FOR UPDATE`, id, workspace).Scan(&request.Name, &request.Subject, &request.Workspace, &scopes, &request.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return APIToken{}, ErrWorkspaceMembership
	}
	if err != nil {
		return APIToken{}, fmt.Errorf("load API token for rotation: %w", err)
	}
	request.Scopes, request.CreatedBy = parseTokenScopes(scopes), createdBy
	created, err := store.create(ctx, tx, request)
	if err != nil {
		return APIToken{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE auth_api_tokens SET revoked_at = NOW() WHERE id = $1`, id); err != nil {
		return APIToken{}, fmt.Errorf("revoke rotated API token: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return APIToken{}, fmt.Errorf("commit API token rotation: %w", err)
	}
	return created, nil
}

var tokenScopeRoles = map[string]WorkspaceRole{
	"read": WorkspaceViewer, "write": WorkspaceEditor,
	"analytics:read": WorkspaceViewer, "analytics:write": WorkspaceEditor,
	"dashboards:read": WorkspaceViewer, "dashboards:write": WorkspaceEditor,
	"datasets:read": WorkspaceViewer, "datasets:write": WorkspaceEditor,
	"publish:write": WorkspacePublisher, "shares:write": WorkspacePublisher,
	"auth:tokens:read": WorkspaceAdmin, "auth:tokens:write": WorkspaceAdmin,
	"auth:workspaces:read": WorkspaceAdmin, "auth:workspaces:write": WorkspaceAdmin,
	"auth:members:read": WorkspaceAdmin, "auth:members:write": WorkspaceAdmin,
}

func validTokenScopes(scopes map[string]bool) bool {
	if len(scopes) == 0 {
		return false
	}
	enabledCount := 0
	for scope, enabled := range scopes {
		if !enabled {
			continue
		}
		enabledCount++
		if _, ok := tokenScopeRoles[scope]; !ok {
			return false
		}
	}
	return enabledCount > 0
}

func roleAllowsScopes(role WorkspaceRole, scopes map[string]bool) bool {
	if !validWorkspaceRole(role) || !validTokenScopes(scopes) {
		return false
	}
	for scope, enabled := range scopes {
		if enabled && roleRank(role) < roleRank(tokenScopeRoles[scope]) {
			return false
		}
	}
	return true
}

func apiTokenHash(token string) []byte { digest := sha256.Sum256([]byte(token)); return digest[:] }
func scopeList(scopes map[string]bool) []string {
	result := make([]string, 0, len(scopes))
	for scope, enabled := range scopes {
		if enabled {
			result = append(result, scope)
		}
	}
	sort.Strings(result)
	return result
}
