import { AlertCircle, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useState } from "react";

interface ErrorBannerProps {
  title?: string;
  message: string;
  traceId?: string;
  onRetry?: () => void;
}

export function ErrorBanner({ 
  title = "Error", 
  message, 
  traceId,
  onRetry 
}: ErrorBannerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const errorText = `${title}: ${message}${traceId ? `\nTrace ID: ${traceId}` : ''}`;
    navigator.clipboard.writeText(errorText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between">
        <span>{title}</span>
        <div className="flex gap-2">
          {traceId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-6 text-xs"
              data-testid="button-copy-error"
            >
              <Copy className="h-3 w-3 mr-1" />
              {copied ? "Copied!" : "Copy"}
            </Button>
          )}
          {onRetry && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              className="h-6 text-xs"
              data-testid="button-retry"
            >
              Retry
            </Button>
          )}
        </div>
      </AlertTitle>
      <AlertDescription className="mt-2">
        <div>{message}</div>
        {traceId && (
          <div className="mt-2 text-xs font-mono opacity-75">
            Trace ID: {traceId}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

interface FieldErrorProps {
  message: string;
}

export function FieldError({ message }: FieldErrorProps) {
  return (
    <div className="text-xs text-destructive mt-1" data-testid="field-error">
      {message}
    </div>
  );
}
