package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type failingTokenContractStore struct{}

func (failingTokenContractStore) Create(context.Context, APITokenCreateRequest) (APIToken, error) {
	return APIToken{}, errors.New("database details must not leak")
}

func (failingTokenContractStore) List(context.Context, string) ([]APIToken, error) {
	return nil, errors.New("database details must not leak")
}

func (failingTokenContractStore) RevokeWorkspace(context.Context, string, string) error {
	return errors.New("database details must not leak")
}

func (failingTokenContractStore) RotateWorkspace(context.Context, string, string, string) (APIToken, error) {
	return APIToken{}, errors.New("database details must not leak")
}

func tokenContractHandler(store APITokenManager, roles map[string]WorkspaceRole, principal Principal) http.Handler {
	authenticator := AuthenticatorFunc(func(request *http.Request) (Principal, error) {
		if request.Header.Get("Authorization") != "Bearer contract" {
			return Principal{}, ErrUnauthenticated
		}
		return principal, nil
	})
	return NewHTTPHandlerWithTokens(&fakeBrowserHandler{}, authenticator, store, tokenHTTPTestAuthz{roles: roles})
}

func serveTokenContract(handler http.Handler, method, target, body string, authenticated bool) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	if authenticated {
		request.Header.Set("Authorization", "Bearer contract")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestTokenAPIWorkspaceRoleMatrix(t *testing.T) {
	expiresAt := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	tests := []struct {
		role                 WorkspaceRole
		list, create, revoke int
	}{
		{WorkspaceAdmin, http.StatusOK, http.StatusCreated, http.StatusNoContent},
		{WorkspaceEditor, http.StatusOK, http.StatusForbidden, http.StatusForbidden},
		{WorkspacePublisher, http.StatusOK, http.StatusForbidden, http.StatusForbidden},
		{WorkspaceViewer, http.StatusOK, http.StatusForbidden, http.StatusForbidden},
	}

	for _, test := range tests {
		t.Run(string(test.role), func(t *testing.T) {
			principal := Principal{Subject: "member", Scopes: map[string]bool{
				"auth:tokens:read":  true,
				"auth:tokens:write": true,
			}}
			handler := tokenContractHandler(
				&tokenHTTPTestStore{},
				map[string]WorkspaceRole{"member/workspace-a": test.role},
				principal,
			)

			requests := []struct {
				name, method, target, body string
				want                       int
			}{
				{"list", http.MethodGet, "/api/v1/auth/tokens?workspace_id=workspace-a", "", test.list},
				{"create", http.MethodPost, "/api/v1/auth/tokens?workspace_id=workspace-a", `{"scopes":{"analytics:read":true},"expires_at":"` + expiresAt + `"}`, test.create},
				{"revoke", http.MethodDelete, "/api/v1/auth/tokens/token-1?workspace_id=workspace-a", "", test.revoke},
			}
			for _, request := range requests {
				t.Run(request.name, func(t *testing.T) {
					response := serveTokenContract(handler, request.method, request.target, request.body, true)
					if response.Code != request.want {
						t.Fatalf("status = %d, want %d; body=%q", response.Code, request.want, response.Body.String())
					}
				})
			}
		})
	}
}

func TestTokenAPIDeniesNonMemberAndCrossWorkspaceToken(t *testing.T) {
	tests := []struct {
		name      string
		principal Principal
		roles     map[string]WorkspaceRole
		target    string
	}{
		{
			name:      "non-member session",
			principal: Principal{Subject: "outsider", Scopes: map[string]bool{"auth:tokens:read": true}},
			roles:     map[string]WorkspaceRole{},
			target:    "/api/v1/auth/tokens?workspace_id=workspace-a",
		},
		{
			name:      "API token cannot select another workspace despite membership",
			principal: Principal{Subject: "member", Workspace: "workspace-a", Scopes: map[string]bool{"auth:tokens:read": true}},
			roles: map[string]WorkspaceRole{
				"member/workspace-a": WorkspaceAdmin,
				"member/workspace-b": WorkspaceAdmin,
			},
			target: "/api/v1/auth/tokens?workspace_id=workspace-b",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler := tokenContractHandler(&tokenHTTPTestStore{}, test.roles, test.principal)
			response := serveTokenContract(handler, http.MethodGet, test.target, "", true)
			assertTokenContractError(t, response, http.StatusForbidden, `{"code":"forbidden","message":"forbidden"}`+"\n")
		})
	}
}

func TestTokenAPISecretReturnedOnlyOnCreation(t *testing.T) {
	created := APIToken{
		ID: "token-1", Token: "gp_one_time_secret", Prefix: "gp_one_time", Subject: "member",
		Workspace: "workspace-a", Scopes: map[string]bool{"analytics:read": true},
		ExpiresAt: time.Now().Add(time.Hour).UTC(), CreatedBy: "member",
	}
	store := &tokenHTTPTestStore{items: []APIToken{created}}
	principal := Principal{Subject: "member", Scopes: map[string]bool{"auth:tokens:read": true, "auth:tokens:write": true}}
	handler := tokenContractHandler(store, map[string]WorkspaceRole{"member/workspace-a": WorkspaceAdmin}, principal)

	createBody := `{"scopes":{"analytics:read":true},"expires_at":"` + created.ExpiresAt.Format(time.RFC3339Nano) + `"}`
	createResponse := serveTokenContract(handler, http.MethodPost, "/api/v1/auth/tokens?workspace_id=workspace-a", createBody, true)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d; body=%q", createResponse.Code, createResponse.Body.String())
	}
	var creation tokenJSON
	if err := json.Unmarshal(createResponse.Body.Bytes(), &creation); err != nil {
		t.Fatal(err)
	}
	if creation.Token != "gp_plaintext" {
		t.Fatalf("creation token = %q, want one-time plaintext", creation.Token)
	}

	listResponse := serveTokenContract(handler, http.MethodGet, "/api/v1/auth/tokens?workspace_id=workspace-a", "", true)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d; body=%q", listResponse.Code, listResponse.Body.String())
	}
	if strings.Contains(listResponse.Body.String(), created.Token) || strings.Contains(listResponse.Body.String(), `"token"`) {
		t.Fatalf("list leaked plaintext token: %q", listResponse.Body.String())
	}
}

func TestTokenAPIStableErrorContract(t *testing.T) {
	principal := Principal{Subject: "member", Scopes: map[string]bool{"auth:tokens:read": true}}
	handler := tokenContractHandler(&tokenHTTPTestStore{}, map[string]WorkspaceRole{"member/workspace-a": WorkspaceAdmin}, principal)

	tests := []struct {
		name, method, target, body, wantBody string
		authenticated                        bool
		wantStatus                           int
	}{
		{
			name: "anonymous", method: http.MethodGet, target: "/api/v1/auth/tokens?workspace_id=workspace-a",
			wantStatus: http.StatusUnauthorized, wantBody: `{"code":"unauthorized","message":"unauthorized"}` + "\n",
		},
		{
			name: "missing create scope", method: http.MethodPost, target: "/api/v1/auth/tokens?workspace_id=workspace-a", body: `{}`,
			authenticated: true, wantStatus: http.StatusForbidden, wantBody: `{"code":"forbidden","message":"forbidden"}` + "\n",
		},
		{
			name: "missing revoke scope", method: http.MethodDelete, target: "/api/v1/auth/tokens/token-1?workspace_id=workspace-a",
			authenticated: true, wantStatus: http.StatusForbidden, wantBody: `{"code":"forbidden","message":"forbidden"}` + "\n",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := serveTokenContract(handler, test.method, test.target, test.body, test.authenticated)
			assertTokenContractError(t, response, test.wantStatus, test.wantBody)
			if test.wantStatus == http.StatusUnauthorized && response.Header().Get("WWW-Authenticate") != "Bearer" {
				t.Fatalf("WWW-Authenticate = %q, want Bearer", response.Header().Get("WWW-Authenticate"))
			}
		})
	}

	fullScopePrincipal := Principal{Subject: "member", Scopes: map[string]bool{
		"auth:tokens:read": true, "auth:tokens:write": true,
	}}
	fullScopeHandler := tokenContractHandler(&tokenHTTPTestStore{}, map[string]WorkspaceRole{"member/workspace-a": WorkspaceAdmin}, fullScopePrincipal)
	invalid := serveTokenContract(fullScopeHandler, http.MethodPost, "/api/v1/auth/tokens?workspace_id=workspace-a", `{}`, true)
	assertTokenContractError(t, invalid, http.StatusBadRequest, `{"code":"invalid_json","message":"invalid token request"}`+"\n")

	failingHandler := tokenContractHandler(failingTokenContractStore{}, map[string]WorkspaceRole{"member/workspace-a": WorkspaceAdmin}, fullScopePrincipal)
	internal := serveTokenContract(failingHandler, http.MethodGet, "/api/v1/auth/tokens?workspace_id=workspace-a", "", true)
	assertTokenContractError(t, internal, http.StatusInternalServerError, `{"code":"internal_error","message":"internal error"}`+"\n")
}

func assertTokenContractError(t *testing.T, response *httptest.ResponseRecorder, status int, body string) {
	t.Helper()
	if response.Code != status || response.Body.String() != body {
		t.Fatalf("response = (%d, %q), want (%d, %q)", response.Code, response.Body.String(), status, body)
	}
	if response.Header().Get("Content-Type") != "application/json" || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("unstable error headers: %v", response.Header())
	}
}
