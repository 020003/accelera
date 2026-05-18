import { Component, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  /** Short label used in the fallback heading, e.g. "Overview" */
  name: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render-time exceptions inside a single tab so one broken
 *  panel doesn't white-screen the entire dashboard.  Logs to the
 *  browser console with a stable prefix for easier triage. */
export class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error(
      `[TabErrorBoundary:${this.props.name}]`,
      error,
      info?.componentStack,
    );
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <Card className="border-destructive/40">
        <CardContent className="py-10 flex flex-col items-center text-center gap-3">
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold">
              The {this.props.name} tab failed to render
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {this.state.error.message || "Unexpected error"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 cursor-pointer"
            onClick={this.reset}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </Button>
          <details className="text-[11px] text-muted-foreground max-w-2xl text-left w-full">
            <summary className="cursor-pointer select-none">
              Stack trace
            </summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-[10px] bg-muted/50 p-2 rounded">
              {this.state.error.stack || String(this.state.error)}
            </pre>
          </details>
        </CardContent>
      </Card>
    );
  }
}
