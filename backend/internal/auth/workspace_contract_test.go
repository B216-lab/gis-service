package auth

import (
	"context"
	"net/http"
	"testing"
	"time"
)

type workspaceContractStore struct {
	roles map[string]WorkspaceRole
}

func (store *workspaceContractStore) Role(_ context.Context, subject, workspace string) (WorkspaceRole, error) {
	role, ok := store.roles[subject+"/"+workspace]
	if !ok {
		return "", ErrWorkspaceMembership
	}
	return role, nil
}

func (*workspaceContractStore) ListWorkspaces(context.Context, Principal) ([]Workspace, error) {
	return []Workspace{{ID: "workspace-a", Name: "Workspace A", Role: WorkspaceViewer}}, nil
}

func (*workspaceContractStore) CreateWorkspace(_ context.Context, name, description, _ string) (Workspace, error) {
	return Workspace{ID: "workspace-new", Name: name, Description: description, Role: WorkspaceAdmin}, nil
}

func (*workspaceContractStore) GetWorkspace(_ context.Context, id string) (Workspace, error) {
	return Workspace{ID: id, Name: "Workspace A"}, nil
}

func (*workspaceContractStore) UpdateWorkspace(_ context.Context, id, name, description string) (Workspace, error) {
	return Workspace{ID: id, Name: name, Description: description}, nil
}

func (*workspaceContractStore) ListMembers(context.Context, string) ([]WorkspaceMember, error) {
	return []WorkspaceMember{{Subject: "member", Role: WorkspaceAdmin, Created: time.Unix(1, 0).UTC()}}, nil
}

func (*workspaceContractStore) PutMember(_ context.Context, _ string, subject string, role WorkspaceRole) (WorkspaceMember, error) {
	return WorkspaceMember{Subject: subject, Role: role}, nil
}

func (*workspaceContractStore) RemoveMember(context.Context, string, string) error { return nil }

func workspaceContractHandler(store WorkspaceStore, principal Principal) http.Handler {
	authenticator := AuthenticatorFunc(func(request *http.Request) (Principal, error) {
		if request.Header.Get("Authorization") != "Bearer contract" {
			return Principal{}, ErrUnauthenticated
		}
		return principal, nil
	})
	mux := http.NewServeMux()
	registerWorkspaceRoutes(mux, authenticator, store)
	return mux
}

func TestWorkspaceAndMemberAPIRoleMatrix(t *testing.T) {
	tests := []struct {
		role   WorkspaceRole
		get    int
		manage int
	}{
		{WorkspaceAdmin, http.StatusOK, http.StatusOK},
		{WorkspaceEditor, http.StatusOK, http.StatusNotFound},
		{WorkspacePublisher, http.StatusOK, http.StatusNotFound},
		{WorkspaceViewer, http.StatusOK, http.StatusNotFound},
	}

	for _, test := range tests {
		t.Run(string(test.role), func(t *testing.T) {
			store := &workspaceContractStore{roles: map[string]WorkspaceRole{"member/workspace-a": test.role}}
			handler := workspaceContractHandler(store, Principal{Subject: "member"})
			requests := []struct {
				name, method, target, body string
				adminSuccess               int
			}{
				{"get workspace", http.MethodGet, "/api/v1/auth/workspaces/workspace-a", "", http.StatusOK},
				{"update workspace", http.MethodPatch, "/api/v1/auth/workspaces/workspace-a", `{"name":"Renamed"}`, http.StatusOK},
				{"list members", http.MethodGet, "/api/v1/auth/workspaces/workspace-a/members", "", http.StatusOK},
				{"add member", http.MethodPost, "/api/v1/auth/workspaces/workspace-a/members", `{"subject":"new-member","role":"viewer"}`, http.StatusCreated},
				{"update member", http.MethodPatch, "/api/v1/auth/workspaces/workspace-a/members/existing", `{"role":"editor"}`, http.StatusOK},
				{"remove member", http.MethodDelete, "/api/v1/auth/workspaces/workspace-a/members/existing", "", http.StatusNoContent},
			}
			for index, request := range requests {
				t.Run(request.name, func(t *testing.T) {
					want := test.manage
					if index == 0 {
						want = test.get
					} else if test.role == WorkspaceAdmin {
						want = request.adminSuccess
					}
					response := serveTokenContract(handler, request.method, request.target, request.body, true)
					if response.Code != want {
						t.Fatalf("status = %d, want %d; body=%q", response.Code, want, response.Body.String())
					}
					if want == http.StatusNotFound {
						assertTokenContractError(t, response, want, `{"code":"not_found","message":"not found"}`+"\n")
					}
				})
			}
		})
	}
}

func TestWorkspaceAPICreateScope(t *testing.T) {
	store := &workspaceContractStore{roles: map[string]WorkspaceRole{
		"member/workspace-a": WorkspaceAdmin,
	}}

	creator := workspaceContractHandler(store, Principal{
		Subject: "member", Scopes: map[string]bool{"auth:workspaces:create": true},
	})
	created := serveTokenContract(creator, http.MethodPost, "/api/v1/auth/workspaces", `{"name":"New workspace"}`, true)
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want %d; body=%q", created.Code, http.StatusCreated, created.Body.String())
	}
}

func TestWorkspaceAPICrossWorkspaceIsolation(t *testing.T) {
	store := &workspaceContractStore{roles: map[string]WorkspaceRole{
		"member/workspace-a": WorkspaceAdmin,
		"member/workspace-b": WorkspaceAdmin,
	}}
	boundToken := workspaceContractHandler(store, Principal{Subject: "member", Workspace: "workspace-a"})
	crossWorkspace := serveTokenContract(boundToken, http.MethodGet, "/api/v1/auth/workspaces/workspace-b", "", true)
	assertTokenContractError(t, crossWorkspace, http.StatusNotFound, `{"code":"not_found","message":"not found"}`+"\n")
}
