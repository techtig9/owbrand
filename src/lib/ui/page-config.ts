export interface PageConfig {
  id: string;
  title: string;
  description: string;
  primaryAction?: string;
  sections: string[];
}

export const PAGE_CONFIGS: PageConfig[] = [
  { id: "dashboard", title: "Dashboard", description: "Your brand command center.", primaryAction: "Create campaign", sections: ["Brand health", "Upcoming content", "Approvals", "Performance", "AI recommendations", "Usage"] },
  { id: "brand", title: "Brand Brain", description: "Your brand's source of truth.", primaryAction: "Edit brand", sections: ["Identity", "Voice", "Audience", "Visual rules", "Products", "Guardrails"] },
  { id: "products", title: "Products", description: "Manage products and approved facts.", primaryAction: "Add product", sections: ["Product library", "Product facts", "Source images", "Creative history"] },
  { id: "creative", title: "Creative Studio", description: "Turn ordinary product photos into marketing assets.", primaryAction: "Create creative", sections: ["Source", "Generate", "Variations", "Copy", "Export"] },
  { id: "campaigns", title: "Campaigns", description: "Plan, create and manage campaigns.", primaryAction: "New campaign", sections: ["Active", "Drafts", "Scheduled", "Completed"] },
  { id: "calendar", title: "Content Calendar", description: "See and manage everything scheduled.", primaryAction: "Schedule content", sections: ["Month", "Week", "Day", "Filters"] },
  { id: "approvals", title: "Approval Inbox", description: "Review content before it goes live.", sections: ["Needs review", "Approved", "Rejected", "Requested edits"] },
  { id: "social", title: "Social Accounts", description: "Connect and monitor publishing channels.", primaryAction: "Connect account", sections: ["Connected", "Disconnected", "Permissions", "Health"] },
  { id: "analytics", title: "Analytics", description: "Understand what is working.", sections: ["Overview", "Content", "Platforms", "Conversions", "Revenue"] },
  { id: "recommendations", title: "AI Recommendations", description: "Actionable improvements from your data.", sections: ["Priority actions", "Creative insights", "Audience insights", "Campaign insights"] },
  { id: "team", title: "Team", description: "Manage people and permissions.", primaryAction: "Invite member", sections: ["Members", "Roles", "Invitations", "Activity"] },
  { id: "billing", title: "Billing", description: "Manage your plan and usage.", primaryAction: "Change plan", sections: ["Current plan", "Usage", "Invoices", "Payment method"] },
  { id: "settings", title: "Settings", description: "Configure OwBrand.", sections: ["Workspace", "Automation", "Notifications", "Security", "Integrations"] },
  { id: "help", title: "Help & Support", description: "Get help when you need it.", primaryAction: "Contact support", sections: ["Help center", "Guides", "Support tickets", "System status"] },
];
