export type WorkspaceRole = "owner" | "admin" | "editor" | "approver" | "viewer";

const permissions = {
  owner: ["manage_billing", "manage_workspace", "manage_members", "manage_brand", "generate", "approve", "publish", "view_analytics"],
  admin: ["manage_workspace", "manage_members", "manage_brand", "generate", "approve", "publish", "view_analytics"],
  editor: ["manage_brand", "generate", "view_analytics"],
  approver: ["generate", "approve", "view_analytics"],
  viewer: ["view_analytics"],
} as const;

export function can(role: WorkspaceRole, permission: string) {
  return (permissions[role] as readonly string[]).includes(permission);
}
