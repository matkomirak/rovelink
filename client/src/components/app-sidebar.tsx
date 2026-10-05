import {
  Settings,
  LayoutDashboard,
  Server,
  FolderGit2,
  Key,
  FileText,
  PlayCircle,
  BarChart3,
  GitCompareArrows,
  Bell,
  Cloud,
  Boxes,
  GitBranch,
  ClipboardCheck,
  ChevronsUpDown,
  LogOut,
  UserCog,
} from "lucide-react";
import { Link, useLocation } from "wouter";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { BrandLogo } from "@/components/brand-logo";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const navigationSections = [
  {
    label: "Navigation",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "Runs", url: "/runs", icon: PlayCircle },
      { title: "Reports", url: "/reports", exact: true, icon: BarChart3 },
      { title: "Drift Reports", url: "/reports/drift", icon: GitCompareArrows },
    ],
  },
  {
    label: "Inputs",
    items: [
      { title: "Providers", url: "/providers", icon: Cloud },
      { title: "CMDBs", url: "/cmdbs", icon: Boxes },
      { title: "Sync Flows", url: "/pipelines", icon: GitBranch },
    ],
  },
  {
    label: "Governance",
    items: [
      { title: "Governance", url: "/governance", icon: ClipboardCheck },
    ],
  },
  {
    label: "Automation",
    items: [
      { title: "Automation Inventories", url: "/automation-inventories", activeUrls: ["/inventories"], icon: Server },
      { title: "Templates", url: "/templates", icon: FileText },
      { title: "Credentials", url: "/credentials", icon: Key },
      { title: "Projects", url: "/projects", icon: FolderGit2 },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Notifications", url: "/notifications", icon: Bell },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];

function isActiveRoute(location: string, url: string, activeUrls: string[] = []) {
  const urls = [url, ...activeUrls];
  return urls.some((candidate) => {
    if (candidate === "/") return location === "/";
    return location === candidate || location.startsWith(`${candidate}/`);
  });
}

function navItemIsActive(location: string, item: { url: string; activeUrls?: string[]; exact?: boolean }) {
  if (item.exact) return location === item.url;
  return isActiveRoute(location, item.url, item.activeUrls);
}

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/me"],
  });
  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/logout"),
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setLocation("/login");
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Logout failed",
        description: error.message || "Could not log out. Please try again.",
      });
    },
  });

  return (
    <Sidebar>
      <SidebarHeader className="h-20 border-b border-sidebar-border p-0 overflow-hidden bg-sidebar">
        <div className="flex h-full items-center px-4">
          <BrandLogo className="text-[1.65rem] text-sidebar-foreground" />
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-1 py-2">
        {navigationSections.map((section, index) => (
          <div key={section.label}>
            {index > 0 && <SidebarSeparator className="my-1" />}
            <SidebarGroup className="py-1">
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={navItemIsActive(location, item)}
                        data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <Link href={item.url}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-4">
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-md p-2 text-left outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-60 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
                disabled={logoutMutation.isPending}
                data-testid="button-account-menu"
                aria-label="Open account menu"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {user.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 overflow-hidden group-data-[collapsible=icon]:hidden">
                  <p className="text-sm font-medium truncate">{user.username}</p>
                  <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                </div>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={8}
              className="w-56"
              data-testid="menu-account"
            >
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="truncate">{user.username}</span>
                  <span className="text-xs font-normal text-muted-foreground capitalize">{user.role}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild data-testid="menu-item-account-settings">
                <Link href="/settings">
                  <UserCog className="h-4 w-4" />
                  <span>Account settings</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  logoutMutation.mutate();
                }}
                disabled={logoutMutation.isPending}
                data-testid="menu-item-logout"
              >
                <LogOut className="h-4 w-4" />
                <span>{logoutMutation.isPending ? "Logging out..." : "Log out"}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
