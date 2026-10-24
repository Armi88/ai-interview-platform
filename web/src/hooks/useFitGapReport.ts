import { useCallback, useEffect, useRef, useState } from "react";
import { portfoliosApi } from "@/services/portfolios";
import type { FitGapReport } from "@/types";

export type FitGapStatus = "loading" | "generating" | "ready" | "error" | "timeout";

export const POLL_INTERVAL_MS = 4000;
export const MAX_POLLS = 30; // ~2 minutes before we stop and offer a retry
const MAX_CONSECUTIVE_ERRORS = 3;

const httpStatus = (e: unknown): number | undefined => (e as { response?: { status?: number } })?.response?.status;

/**
 * Loads (and if needed triggers) a fit/gap report.
 *
 * Invariants that the previous inline implementation violated:
 *  - generation is triggered AT MOST once per load/regenerate; polling only GETs
 *    (it used to re-POST every 5s while the report was missing, queueing duplicate jobs)
 *  - a non-404 failure surfaces as an error instead of an endless blank screen
 *  - polling stops after MAX_POLLS and offers a retry
 *  - during regenerate the previous report stays visible until generated_at changes
 */
export function useFitGapReport(portfolioId: number | null, vacancyId: number) {
  const [status, setStatus] = useState<FitGapStatus>("loading");
  const [report, setReport] = useState<FitGapReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // bump to restart the effect
  const baselineRef = useRef<string | null>(null); // generated_at to move past (regenerate)
  const reportRef = useRef<FitGapReport | null>(null);
  reportRef.current = report;

  useEffect(() => {
    if (portfolioId == null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    let errors = 0;

    const isFresh = (r: FitGapReport) => baselineRef.current === null || r.generated_at !== baselineRef.current;

    const finish = (r: FitGapReport) => {
      baselineRef.current = null;
      setReport(r);
      setStatus("ready");
    };

    const poll = async () => {
      if (cancelled) return;
      polls += 1;
      try {
        const res = await portfoliosApi.getFitGap(portfolioId, vacancyId);
        errors = 0;
        if (cancelled) return;
        if (isFresh(res.data.report)) return finish(res.data.report);
      } catch (e) {
        if (cancelled) return;
        if (httpStatus(e) === 404) {
          await portfoliosApi.triggerFitGap(portfolioId, vacancyId);
        } else {
          errors += 1;
          if (errors >= MAX_CONSECUTIVE_ERRORS) {
            setError("We couldn't reach the server while generating the report.");
            return setStatus("error");
          }
        }
      }
      if (polls >= MAX_POLLS) return setStatus("timeout");
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    const start = async () => {
      setError(null);
      const regenerating = baselineRef.current !== null;
      try {
        if (regenerating) {
          await portfoliosApi.regenerateFitGap(portfolioId, vacancyId);
          if (cancelled) return;
          setStatus("generating");
          timer = setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }
        const res = await portfoliosApi.getFitGap(portfolioId, vacancyId);
        if (!cancelled) finish(res.data.report);
      } catch (e) {
        if (cancelled) return;
        if (!regenerating && httpStatus(e) === 404) {
          try {
            const trig = await portfoliosApi.triggerFitGap(portfolioId, vacancyId); // once
            if (cancelled) return;
            const data = trig.data as { report?: FitGapReport };
            if (data.report) return finish(data.report);
            setStatus("generating");
            timer = setTimeout(poll, POLL_INTERVAL_MS);
          } catch {
            if (!cancelled) {
              setError("We couldn't start generating the report.");
              setStatus("error");
            }
          }
          return;
        }
        setError(
          httpStatus(e) === 422
            ? "This portfolio isn't ready yet. Try again once it has finished generating."
            : "We couldn't load the report."
        );
        setStatus("error");
      }
    };

    setStatus(baselineRef.current !== null ? "generating" : "loading");
    void start();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [portfolioId, vacancyId, attempt]);

  /** Re-run generation. Keeps showing the current report until a newer one lands. */
  const regenerate = useCallback(() => {
    baselineRef.current = reportRef.current?.generated_at ?? "";
    setAttempt((n) => n + 1);
  }, []);

  /** Retry after an error/timeout without forcing regeneration of an existing report. */
  const retry = useCallback(() => {
    baselineRef.current = null;
    setAttempt((n) => n + 1);
  }, []);

  return { status, report, error, regenerate, retry };
}
