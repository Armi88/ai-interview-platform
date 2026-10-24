import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFitGapReport, POLL_INTERVAL_MS, MAX_POLLS } from "./useFitGapReport";
import { portfoliosApi } from "@/services/portfolios";
import type { FitGapReport } from "@/types";

vi.mock("@/services/portfolios", () => ({
  portfoliosApi: { getFitGap: vi.fn(), triggerFitGap: vi.fn(), regenerateFitGap: vi.fn() },
}));

const api = vi.mocked(portfoliosApi);
const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const report = (generated_at: string): FitGapReport => ({
  id: 1, portfolio_id: 1, vacancy_id: 2, skill_comparisons: [],
  culture_narrative: null, overall_narrative: null, generated_at,
});
const ok = (r: FitGapReport) => ({ data: { report: r } }) as never;
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => vi.useRealTimers());

describe("useFitGapReport", () => {
  it("returns the report when it already exists and never triggers generation", async () => {
    api.getFitGap.mockResolvedValue(ok(report("t1")));
    const { result } = renderHook(() => useFitGapReport(1, 2));
    await flush();

    expect(result.current.status).toBe("ready");
    expect(api.triggerFitGap).not.toHaveBeenCalled();
  });

  it("triggers generation exactly ONCE while polling for a missing report (regression: it re-POSTed every poll)", async () => {
    api.getFitGap.mockRejectedValueOnce(http(404)).mockRejectedValueOnce(http(404)).mockRejectedValueOnce(http(404)).mockResolvedValue(ok(report("t1")));
    api.triggerFitGap.mockResolvedValue({ data: { status: "generating" } } as never);

    const { result } = renderHook(() => useFitGapReport(1, 2));
    await flush();
    expect(result.current.status).toBe("generating");

    await flush(POLL_INTERVAL_MS * 4);
    expect(result.current.status).toBe("ready");
    expect(api.triggerFitGap).toHaveBeenCalledTimes(1);
  });

  it("surfaces a server error instead of spinning forever", async () => {
    api.getFitGap.mockRejectedValue(http(500));
    const { result } = renderHook(() => useFitGapReport(1, 2));
    await flush();

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBeTruthy();
  });

  it("explains a 422 (portfolio not ready) distinctly", async () => {
    api.getFitGap.mockRejectedValue(http(422));
    const { result } = renderHook(() => useFitGapReport(1, 2));
    await flush();
    expect(result.current.error).toMatch(/isn't ready/i);
  });

  it("gives up after MAX_POLLS and reports a timeout", async () => {
    api.getFitGap.mockRejectedValue(http(404));
    api.triggerFitGap.mockResolvedValue({ data: { status: "generating" } } as never);
    const { result } = renderHook(() => useFitGapReport(1, 2));
    await flush();
    await flush(POLL_INTERVAL_MS * (MAX_POLLS + 2));

    expect(result.current.status).toBe("timeout");
  });

  it("keeps the old report visible while regenerating, then swaps when generated_at changes", async () => {
    api.getFitGap.mockResolvedValue(ok(report("old")));
    const { result } = renderHook(() => useFitGapReport(1, 2));
    await flush();
    expect(result.current.report?.generated_at).toBe("old");

    api.regenerateFitGap.mockResolvedValue({ data: { status: "generating" } } as never);
    act(() => result.current.regenerate());
    await flush();
    expect(result.current.status).toBe("generating");
    expect(result.current.report?.generated_at).toBe("old"); // still shown

    await flush(POLL_INTERVAL_MS); // server still returns "old" → not fresh yet
    expect(result.current.status).toBe("generating");

    api.getFitGap.mockResolvedValue(ok(report("new")));
    await flush(POLL_INTERVAL_MS);
    expect(result.current.status).toBe("ready");
    expect(result.current.report?.generated_at).toBe("new");
  });
});
