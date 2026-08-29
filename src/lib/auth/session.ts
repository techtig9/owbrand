export interface AppSession {
  userId: string;
  workspaceId: string;
  role: "owner" | "admin" | "editor" | "approver" | "viewer";
}

export function requireSession(session: AppSession | null): AppSession {
  if (!session) throw new Error("Authentication required");
  return session;
}
