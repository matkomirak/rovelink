import { lazy, Suspense } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/lib/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import type { User } from "@shared/schema";

const Dashboard = lazy(() => import("@/pages/dashboard"));
const Inventory = lazy(() => import("@/pages/inventory"));
const Projects = lazy(() => import("@/pages/projects"));
const Credentials = lazy(() => import("@/pages/credentials"));
const Templates = lazy(() => import("@/pages/templates"));
const Runs = lazy(() => import("@/pages/runs"));
const RunDetail = lazy(() => import("@/pages/run-detail"));
const RunComparison = lazy(() => import("@/pages/run-comparison"));
const Reports = lazy(() => import("@/pages/reports"));
const Settings = lazy(() => import("@/pages/settings"));
const Notifications = lazy(() => import("@/pages/notifications"));
const Providers = lazy(() => import("@/pages/providers"));
const ProviderDetail = lazy(() => import("@/pages/provider-detail"));
const Cmdbs = lazy(() => import("@/pages/cmdbs"));
const CmdbDetail = lazy(() => import("@/pages/cmdb-detail"));
const Pipelines = lazy(() => import("@/pages/pipelines"));
const PipelineNew = lazy(() => import("@/pages/pipeline-new"));
const PipelineDetail = lazy(() => import("@/pages/pipeline-detail"));
const PipelineEdit = lazy(() => import("@/pages/pipeline-edit"));
const MappingEditor = lazy(() => import("@/pages/mapping-editor"));
const NetBoxInventory = lazy(() => import("@/pages/netbox-inventory"));
const AutomationInventories = lazy(() => import("@/pages/automation-inventories"));
const AutomationInventoryNew = lazy(() => import("@/pages/automation-inventory-new"));
const AutomationInventoryDetail = lazy(() => import("@/pages/automation-inventory-detail"));
const AutomationInventoryEdit = lazy(() => import("@/pages/automation-inventory-edit"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-48 text-muted-foreground">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

function AuthenticatedRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/inventory" component={Inventory} />
        <Route path="/netbox-inventory" component={NetBoxInventory} />
        <Route path="/automation-inventories" component={AutomationInventories} />
        <Route path="/inventories/new" component={AutomationInventoryNew} />
        <Route path="/inventories/:id/edit" component={AutomationInventoryEdit} />
        <Route path="/inventories/:id" component={AutomationInventoryDetail} />
        <Route path="/projects" component={Projects} />
        <Route path="/credentials" component={Credentials} />
        <Route path="/providers" component={Providers} />
        <Route path="/providers/:id" component={ProviderDetail} />
        <Route path="/cmdbs" component={Cmdbs} />
        <Route path="/cmdbs/:id" component={CmdbDetail} />
        <Route path="/pipelines" component={Pipelines} />
        <Route path="/pipelines/new" component={PipelineNew} />
        <Route path="/pipelines/:id/edit" component={PipelineEdit} />
        <Route path="/pipelines/:pipelineId/mappings/:mapId/edit" component={MappingEditor} />
        <Route path="/pipelines/:id" component={PipelineDetail} />
        <Route path="/templates" component={Templates} />
        <Route path="/runs" component={Runs} />
        <Route path="/runs/:id" component={RunDetail} />
        <Route path="/compare" component={RunComparison} />
        <Route path="/reports" component={Reports} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AppContent() {
  const [location, setLocation] = useLocation();
  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["/api/auth/me"],
  });

  if (!user && location !== "/login" && !isLoading) {
    setTimeout(() => setLocation("/login"), 0);
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1">
          <header className="flex items-center justify-between p-4 border-b border-border">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-auto p-6">
            <AuthenticatedRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <AppContent />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
