import {
  Settings, LayoutDashboard, Server, FolderGit2, Key, FileText, PlayCircle,
  BarChart3, GitCompareArrows, Bell, Cloud, Boxes, GitBranch, ClipboardCheck,
} from "lucide-react";

export interface SidebarNavigationItem {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  activeUrls?: string[];
  excludeUrls?: string[];
  exact?: boolean;
}

export const navigationSections: Array<{ label: string; items: SidebarNavigationItem[] }> = [
  { label: "Navigation", items: [
    { title: "Dashboard", url: "/", icon: LayoutDashboard },
  ] },
  { label: "Reports", items: [
    { title: "Governance Readiness", url: "/reports/governance", activeUrls: ["/reports"], exact: true, icon: BarChart3 },
    { title: "Automation Readiness", url: "/reports/automation", exact: true, icon: PlayCircle },
  ] },
  { label: "Drift", items: [
    { title: "Drift Reports", url: "/reports/drift", icon: GitCompareArrows },
  ] },
  { label: "Inputs", items: [
    { title: "Providers", url: "/providers", icon: Cloud },
    { title: "CMDBs", url: "/cmdbs", icon: Boxes },
    { title: "Sync Flows", url: "/pipelines", icon: GitBranch },
  ] },
  { label: "Governance", items: [
    { title: "Blueprints", url: "/governance", excludeUrls: ["/governance/evaluation-runs"], icon: ClipboardCheck },
    { title: "Evaluation Runs", url: "/governance/evaluation-runs", icon: ClipboardCheck },
  ] },
  { label: "Automation", items: [
    { title: "Automation Inventories", url: "/automation-inventories", activeUrls: ["/inventories"], icon: Server },
    { title: "Templates", url: "/templates", icon: FileText },
    { title: "Credentials", url: "/credentials", icon: Key },
    { title: "Projects", url: "/projects", icon: FolderGit2 },
    { title: "Automation Runs", url: "/runs", icon: PlayCircle },
  ] },
  { label: "System", items: [
    { title: "Notifications", url: "/notifications", icon: Bell },
    { title: "Settings", url: "/settings", icon: Settings },
  ] },
];

function matchesPath(location: string, candidate: string) {
  return location === candidate || (candidate !== "/" && location.startsWith(`${candidate}/`));
}

export function navItemIsActive(location: string, item: SidebarNavigationItem) {
  if (item.excludeUrls?.some(url => matchesPath(location, url))) return false;
  return [item.url, ...(item.activeUrls ?? [])].some(url => item.exact ? location === url : matchesPath(location, url));
}

export function reportsVisibleSections(location: string) {
  return { governance: location !== "/reports/automation", automation: location !== "/reports/governance" };
}
