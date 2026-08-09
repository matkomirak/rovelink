import {
  Settings,
  LayoutDashboard,
  Server,
  FolderGit2,
  Key,
  FileText,
  PlayCircle,
  BarChart3,
  Bell,
  Cloud,
  Boxes,
  GitBranch,
  ClipboardCheck,
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
import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { BrandLogo } from "@/components/brand-logo";

const navigationSections = [
  {
    label: "Navigation",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "Runs", url: "/runs", icon: PlayCircle },
      { title: "Reports", url: "/reports", icon: BarChart3 },
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
      { title: "Automation Inventories", url: "/automation-inventories", icon: Server },
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

function isActiveRoute(location: string, url: string) {
  if (url === "/") return location === "/";
  return location === url || location.startsWith(`${url}/`);
}

export function AppSidebar() {
  const [location] = useLocation();
  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/me"],
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
                        isActive={isActiveRoute(location, item.url)}
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
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                {user.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">{user.username}</p>
              <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
            </div>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
