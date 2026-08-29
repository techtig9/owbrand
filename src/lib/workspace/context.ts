export interface WorkspaceContext {
  workspaceId: string;
  brandId?: string;
  planId: "free" | "starter" | "growth" | "agency" | "enterprise";
  role: "owner" | "admin" | "editor" | "approver" | "viewer";
}

export function assertWorkspaceAccess(
  context: WorkspaceContext,
  requestedWorkspaceId: string,
) {
  if (context.workspaceId !== requestedWorkspaceId) {
    throw new Error("Workspace access denied");
  }
}
