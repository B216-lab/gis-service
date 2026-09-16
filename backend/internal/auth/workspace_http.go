package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

type workspaceHTTPHandler struct {
	store WorkspaceStore
}

type workspaceInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type memberInput struct {
	Subject string        `json:"subject"`
	Role    WorkspaceRole `json:"role"`
}

type groupRoleInput struct {
	Group string        `json:"group"`
	Role  WorkspaceRole `json:"role"`
}

type workspaceGroupStore interface {
	ListGroupRoles(context.Context, string) ([]WorkspaceGroupRole, error)
	PutGroupRole(context.Context, string, string, WorkspaceRole) (WorkspaceGroupRole, error)
	RemoveGroupRole(context.Context, string, string) error
}

func registerWorkspaceRoutes(mux *http.ServeMux, authenticator Authenticator, store WorkspaceStore) {
	handler := &workspaceHTTPHandler{store: store}
	protected := func(next http.HandlerFunc) http.Handler { return Middleware(authenticator, Require(next)) }
	mux.Handle("GET /api/v1/auth/workspaces", protected(handler.listWorkspaces))
	mux.Handle("POST /api/v1/auth/workspaces", protected(handler.createWorkspace))
	mux.Handle("GET /api/v1/auth/workspaces/{workspace}", protected(handler.getWorkspace))
	mux.Handle("PATCH /api/v1/auth/workspaces/{workspace}", protected(handler.updateWorkspace))
	mux.Handle("GET /api/v1/auth/workspaces/{workspace}/members", protected(handler.listMembers))
	mux.Handle("POST /api/v1/auth/workspaces/{workspace}/members", protected(handler.addMember))
	mux.Handle("PATCH /api/v1/auth/workspaces/{workspace}/members/{subject}", protected(handler.updateMember))
	mux.Handle("DELETE /api/v1/auth/workspaces/{workspace}/members/{subject}", protected(handler.removeMember))
	if _, ok := store.(workspaceGroupStore); ok {
		mux.Handle("GET /api/v1/auth/workspaces/{workspace}/groups", protected(handler.listGroups))
		mux.Handle("POST /api/v1/auth/workspaces/{workspace}/groups", protected(handler.addGroup))
		mux.Handle("PATCH /api/v1/auth/workspaces/{workspace}/groups/{group}", protected(handler.updateGroup))
		mux.Handle("DELETE /api/v1/auth/workspaces/{workspace}/groups/{group}", protected(handler.removeGroup))
	}
}

func (handler *workspaceHTTPHandler) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromRequest(r)
	items, err := handler.store.ListWorkspaces(r.Context(), principal)
	if err != nil {
		writeAuthError(w, http.StatusInternalServerError, "internal_error", "internal error")
		return
	}
	writeAuthJSON(w, http.StatusOK, map[string]any{"workspaces": items})
}

func (handler *workspaceHTTPHandler) createWorkspace(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromRequest(r)
	if !principal.Scopes["auth:workspaces:create"] {
		Forbidden(w)
		return
	}
	var input workspaceInput
	if !decodeAuthJSON(r, &input) || strings.TrimSpace(input.Name) == "" {
		writeAuthError(w, http.StatusBadRequest, "invalid_request", "invalid workspace request")
		return
	}
	item, err := handler.store.CreateWorkspace(r.Context(), input.Name, input.Description, principal.Subject)
	if err != nil {
		handleWorkspaceError(w, err)
		return
	}
	writeAuthJSON(w, http.StatusCreated, item)
}

func (handler *workspaceHTTPHandler) getWorkspace(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromRequest(r)
	workspace, _, ok := handler.authorize(w, r, principal, false)
	if !ok {
		return
	}
	item, err := handler.store.GetWorkspace(r.Context(), workspace)
	if err != nil {
		handleWorkspaceError(w, err)
		return
	}
	item.Role, _ = roleForPrincipal(r.Context(), handler.store, principal, workspace)
	writeAuthJSON(w, http.StatusOK, item)
}

func (handler *workspaceHTTPHandler) updateWorkspace(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromRequest(r)
	workspace, _, ok := handler.authorize(w, r, principal, true)
	if !ok {
		return
	}
	var input workspaceInput
	if !decodeAuthJSON(r, &input) || strings.TrimSpace(input.Name) == "" {
		writeAuthError(w, http.StatusBadRequest, "invalid_request", "invalid workspace request")
		return
	}
	item, err := handler.store.UpdateWorkspace(r.Context(), workspace, input.Name, input.Description)
	if err != nil {
		handleWorkspaceError(w, err)
		return
	}
	item.Role = WorkspaceAdmin
	writeAuthJSON(w, http.StatusOK, item)
}

func (handler *workspaceHTTPHandler) listMembers(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromRequest(r)
	workspace, _, ok := handler.authorize(w, r, principal, true)
	if !ok {
		return
	}
	items, err := handler.store.ListMembers(r.Context(), workspace)
	if err != nil {
		handleWorkspaceError(w, err)
		return
	}
	writeAuthJSON(w, http.StatusOK, map[string]any{"members": items})
}

func (handler *workspaceHTTPHandler) addMember(w http.ResponseWriter, r *http.Request) {
	handler.putMember(w, r, "", http.StatusCreated)
}

func (handler *workspaceHTTPHandler) updateMember(w http.ResponseWriter, r *http.Request) {
	handler.putMember(w, r, r.PathValue("subject"), http.StatusOK)
}

func (handler *workspaceHTTPHandler) putMember(w http.ResponseWriter, r *http.Request, pathSubject string, status int) {
	principal, _ := PrincipalFromRequest(r)
	workspace, _, ok := handler.authorize(w, r, principal, true)
	if !ok {
		return
	}
	var input memberInput
	if !decodeAuthJSON(r, &input) {
		writeAuthError(w, http.StatusBadRequest, "invalid_request", "invalid member request")
		return
	}
	if pathSubject != "" {
		if input.Subject != "" && input.Subject != pathSubject {
			writeAuthError(w, http.StatusBadRequest, "invalid_request", "subject does not match path")
			return
		}
		input.Subject = pathSubject
	}
	item, err := handler.store.PutMember(r.Context(), workspace, input.Subject, input.Role)
	if err != nil {
		handleWorkspaceError(w, err)
		return
	}
	writeAuthJSON(w, status, item)
}

func (handler *workspaceHTTPHandler) removeMember(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromRequest(r)
	workspace, _, ok := handler.authorize(w, r, principal, true)
	if !ok {
		return
	}
	if err := handler.store.RemoveMember(r.Context(), workspace, r.PathValue("subject")); err != nil {
		handleWorkspaceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler *workspaceHTTPHandler) listGroups(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromRequest(r)
	workspace, _, ok := handler.authorize(w, r, principal, true)
	if !ok {
		return
	}
	items, err := handler.store.(workspaceGroupStore).ListGroupRoles(r.Context(), workspace)
	if err != nil {
		handleWorkspaceError(w, err)
		return
	}
	writeAuthJSON(w, http.StatusOK, map[string]any{"groups": items})
}

func (handler *workspaceHTTPHandler) addGroup(w http.ResponseWriter, r *http.Request) {
	handler.putGroup(w, r, "", http.StatusCreated)
}

func (handler *workspaceHTTPHandler) updateGroup(w http.ResponseWriter, r *http.Request) {
	handler.putGroup(w, r, r.PathValue("group"), http.StatusOK)
}

func (handler *workspaceHTTPHandler) putGroup(w http.ResponseWriter, r *http.Request, pathGroup string, status int) {
	principal, _ := PrincipalFromRequest(r)
	workspace, _, ok := handler.authorize(w, r, principal, true)
	if !ok {
		return
	}
	var input groupRoleInput
	if !decodeAuthJSON(r, &input) {
		writeAuthError(w, http.StatusBadRequest, "invalid_request", "invalid group mapping request")
		return
	}
	if pathGroup != "" {
		if input.Group != "" && input.Group != pathGroup {
			writeAuthError(w, http.StatusBadRequest, "invalid_request", "group does not match path")
			return
		}
		input.Group = pathGroup
	}
	item, err := handler.store.(workspaceGroupStore).PutGroupRole(r.Context(), workspace, input.Group, input.Role)
	if err != nil {
		handleWorkspaceError(w, err)
		return
	}
	writeAuthJSON(w, status, item)
}

func (handler *workspaceHTTPHandler) removeGroup(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromRequest(r)
	workspace, _, ok := handler.authorize(w, r, principal, true)
	if !ok {
		return
	}
	if err := handler.store.(workspaceGroupStore).RemoveGroupRole(r.Context(), workspace, r.PathValue("group")); err != nil {
		handleWorkspaceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler *workspaceHTTPHandler) authorize(w http.ResponseWriter, r *http.Request, principal Principal, admin bool) (string, WorkspaceRole, bool) {
	workspace := strings.TrimSpace(r.PathValue("workspace"))
	if workspace == "" || (principal.Workspace != "" && principal.Workspace != workspace) {
		writeAuthError(w, http.StatusNotFound, "not_found", "not found")
		return "", "", false
	}
	role, err := roleForPrincipal(r.Context(), handler.store, principal, workspace)
	if err != nil || (admin && role != WorkspaceAdmin) {
		writeAuthError(w, http.StatusNotFound, "not_found", "not found")
		return "", "", false
	}
	return workspace, role, true
}

type principalWorkspaceAuthorizer interface {
	RoleForPrincipal(context.Context, Principal, string) (WorkspaceRole, error)
}

func roleForPrincipal(ctx context.Context, authz WorkspaceAuthorizer, principal Principal, workspace string) (WorkspaceRole, error) {
	if resolver, ok := authz.(principalWorkspaceAuthorizer); ok {
		return resolver.RoleForPrincipal(ctx, principal, workspace)
	}
	return authz.Role(ctx, principal.Subject, workspace)
}

func decodeAuthJSON(r *http.Request, target any) bool {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if decoder.Decode(target) != nil {
		return false
	}
	return decoder.Decode(&struct{}{}) == io.EOF
}

func handleWorkspaceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrWorkspaceNotFound), errors.Is(err, ErrWorkspaceMembership):
		writeAuthError(w, http.StatusNotFound, "not_found", "not found")
	case errors.Is(err, ErrInvalidWorkspace):
		writeAuthError(w, http.StatusBadRequest, "invalid_request", "invalid workspace request")
	default:
		writeAuthError(w, http.StatusInternalServerError, "internal_error", "internal error")
	}
}

func writeAuthError(w http.ResponseWriter, status int, code, message string) {
	writeAuthJSON(w, status, map[string]string{"code": code, "message": message})
}
