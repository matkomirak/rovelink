import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

interface Pipeline {
  id: string;
  name: string;
  version: number;
  enabled: boolean;
  scheduleCron: string | null;
}

export default function PipelineDetail() {
  const { id } = useParams();

  const { data: pipeline, isLoading } = useQuery<Pipeline>({
    queryKey: ["/api/pipelines", id],
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Pipeline not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/pipelines">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">{pipeline.name}</h1>
          <p className="text-muted-foreground">v{pipeline.version}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Full pipeline detail page coming soon with tabs (Mappings, Runs, Settings)
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
