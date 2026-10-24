import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import ComparisonTable from "@/components/fitgap/ComparisonTable";
import CoverageSummary from "@/components/fitgap/CoverageSummary";
import { portfoliosApi } from "@/services/portfolios";
import { sessionsApi } from "@/services/sessions";
import { useFitGapReport } from "@/hooks/useFitGapReport";
import { AlertCircle, ArrowLeft, Download, Info, Loader2, RefreshCw, Zap } from "lucide-react";
import type { Portfolio } from "@/types";

export default function FitGapReportPage() {
  const { id, sessionId, vacancyId } = useParams<{ id: string; sessionId: string; vacancyId: string }>();

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioError, setPortfolioError] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "json" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    setPortfolioLoading(true);
    setPortfolioError(false);
    sessionsApi
      .getPortfolio(Number(sessionId))
      .then((res) => {
        const data = res.data as { portfolio?: Portfolio };
        if (data.portfolio) setPortfolio(data.portfolio);
      })
      .catch(() => setPortfolioError(true))
      .finally(() => setPortfolioLoading(false));
  }, [sessionId]);

  const { status, report, error, regenerate, retry } = useFitGapReport(portfolio?.id ?? null, Number(vacancyId));

  const handleExport = async (format: "pdf" | "json") => {
    if (!portfolio) return;
    setExporting(format);
    setExportError(null);
    try {
      const res = await portfoliosApi.exportPortfolio(portfolio.id, format, Number(vacancyId));
      const blob =
        format === "pdf"
          ? new Blob([res.data as BlobPart], { type: "application/pdf" })
          : new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fitgap-${sessionId}-${vacancyId}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(`Couldn't export the ${format.toUpperCase()}. Please try again.`);
    } finally {
      setExporting(null);
    }
  };

  if (portfolioLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4" aria-busy="true" aria-label="Loading report">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const backLink = `/assessments/${id}/sessions/${sessionId}/portfolio`;
  const busy = status === "loading" || status === "generating";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <Link to={backLink} className="text-muted-foreground hover:text-foreground" aria-label="Back to portfolio">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-lg font-semibold">Fit/Gap Report</h1>
        </div>

        {portfolio && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={regenerate} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Regenerate
            </Button>
            {report && (
              <>
                <Button variant="outline" size="sm" onClick={() => handleExport("pdf")} disabled={!!exporting}>
                  {exporting === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                  PDF
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleExport("json")} disabled={!!exporting}>
                  {exporting === "json" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                  JSON
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {exportError && (
        <p role="alert" className="text-sm text-destructive">{exportError}</p>
      )}

      {/* Portfolio could not be loaded / does not exist yet */}
      {!portfolio && (
        <div role="alert" className="border rounded-lg p-8 text-center space-y-3">
          <AlertCircle className="h-6 w-6 text-muted-foreground mx-auto" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {portfolioError
              ? "We couldn't load this candidate's portfolio."
              : "This session doesn't have a finished portfolio yet, so there's nothing to compare."}
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to={backLink}>Back to portfolio</Link>
          </Button>
        </div>
      )}

      {/* First load / generating with nothing to show yet */}
      {portfolio && busy && !report && (
        <div className="border rounded-lg p-12 text-center space-y-3" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {status === "loading" ? "Loading report…" : "Generating fit/gap report… this usually takes under a minute."}
          </p>
        </div>
      )}

      {/* Failure states */}
      {portfolio && (status === "error" || status === "timeout") && (
        <div role="alert" className="border border-destructive/30 rounded-lg p-6 text-center space-y-3">
          <AlertCircle className="h-6 w-6 text-destructive mx-auto" aria-hidden="true" />
          <p className="text-sm">
            {status === "timeout"
              ? "This is taking longer than expected. The report may still finish in the background."
              : error}
          </p>
          <Button size="sm" onClick={retry}>Try again</Button>
        </div>
      )}

      {/* Report (also shown, dimmed, while a regeneration is running) */}
      {report && (
        <div className={busy ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={busy}>
          {busy && (
            <p role="status" className="mb-3 text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Updating report — showing the previous version for now.
            </p>
          )}
          <div className="space-y-6">
            <CoverageSummary report={report} />

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Skill Comparison</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <ComparisonTable comparisons={report.skill_comparisons ?? []} />
              </CardContent>
            </Card>

            <Separator />

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Culture &amp; Competency Fit</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {report.narrative_source === "fallback" && (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground rounded bg-muted/50 p-2">
                    <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                    The AI summary was unavailable, so this is an automatic summary of the numbers above. Regenerate to try again.
                  </p>
                )}
                {report.culture_narrative || report.overall_narrative ? (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {report.culture_narrative || report.overall_narrative}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No narrative is available for this report.</p>
                )}
                {report.culture_narrative && report.overall_narrative && (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words border-t pt-3">
                    {report.overall_narrative}
                  </p>
                )}
              </CardContent>
            </Card>

            {portfolio && portfolio.skills.some((s) => s.is_discovered) && (
              <>
                <Separator />
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                      <Zap className="h-4 w-4 text-amber-500" aria-hidden="true" />
                      Discovered Skills (not in vacancy requirements)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-2">
                    {portfolio.skills
                      .filter((s) => s.is_discovered)
                      .map((s) => (
                        <div key={s.id} className="text-sm flex flex-wrap items-center gap-x-2">
                          <span className="font-medium break-words">{s.skill_label}</span>
                          <span className="text-muted-foreground">
                            L{s.ai_level} ({s.ai_confidence?.toLowerCase() === "low" ? "low confidence" : "confirmed"})
                          </span>
                          <span className="text-xs text-muted-foreground">— Not required for this role, may be additive.</span>
                        </div>
                      ))}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
