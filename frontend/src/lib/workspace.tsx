"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api } from "@/lib/api";
import type {
  ActivityEntry,
  EvidenceExtraction,
  ExtractionInput,
  LiteraturePaper,
  Review,
  ReviewMatrix,
  ScreeningStatus,
} from "@/lib/types";

const ACTIVE_REVIEW_KEY = "evidenceos:activeReviewId";
const ACTIVITY_KEY = "evidenceos:activity";
const MAX_ACTIVITY = 60;

function storageGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode, tests); never block the app on it.
  }
}

function storageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

/** Restore the persisted activity trail (survives reloads). */
function loadPersistedActivity(): ActivityEntry[] {
  const raw = storageGet(ACTIVITY_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ActivityEntry[]).slice(0, MAX_ACTIVITY) : [];
  } catch {
    return [];
  }
}

export type ApiStatus = "checking" | "online" | "offline";
export type WorkflowStage = "SEARCH" | "SELECT" | "ORGANIZE" | "SYNTHESIZE";

interface WorkspaceState {
  apiStatus: ApiStatus;
  reviews: Review[];
  activeReviewId: string | null;
  activeReview: Review | null;
  questionDraft: string;
  matrix: ReviewMatrix | null;
  matrixLoading: boolean;
  matrixError: string | null;
  query: string;
  searchResults: LiteraturePaper[];
  searchTotal: number;
  searchPage: number;
  searchLoading: boolean;
  searchError: string | null;
  detailPaper: LiteraturePaper | null;
  paperEvidence: EvidenceExtraction[];
  paperEvidenceLoading: boolean;
  paperEvidenceError: string | null;
  extracting: boolean;
  extractionError: string | null;
  activity: ActivityEntry[];
  reach: WorkflowStage;
  createReview: (title: string, researchQuestion: string | null) => Promise<boolean>;
  selectReview: (id: string) => void;
  deleteReview: (id: string) => Promise<void>;
  creatingReview: boolean;
  startCreateReview: () => void;
  cancelCreateReview: () => void;
  saveQuestion: (question: string) => Promise<void>;
  runSearch: (query: string) => Promise<void>;
  goToPage: (page: number) => Promise<void>;
  clearSearch: () => void;
  addPaperToReview: (paper: LiteraturePaper) => Promise<void>;
  removePaper: (paperId: string) => Promise<void>;
  setScreening: (paperId: string, status: ScreeningStatus) => Promise<void>;
  setNotes: (paperId: string, notes: string) => Promise<void>;
  addExtraction: (paperId: string, input: ExtractionInput) => Promise<void>;
  runExtraction: () => Promise<void>;
  openPaper: (paper: LiteraturePaper) => void;
  closePaper: () => void;
  refreshMatrix: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

let activitySeq = 0;
function nextId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  activitySeq += 1;
  return `activity-${activitySeq}-${Date.now()}`;
}

function stageFor(matrix: ReviewMatrix | null, resultsCount: number): WorkflowStage {
  const synthesize =
    matrix?.papers.some((p) => p.status === "included" && p.extractions.length > 0) ?? false;
  if (synthesize) return "SYNTHESIZE";
  if (matrix && matrix.total_papers > 0) return "ORGANIZE";
  if (resultsCount > 0) return "SELECT";
  return "SEARCH";
}

function earliestReviewPref(reviews: Review[], persisted: string | null): string | null {
  if (persisted && reviews.some((r) => r.id === persisted)) return persisted;
  return reviews[0]?.id ?? null;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [creatingReview, setCreatingReview] = useState(false);
  const [questionDraft, setQuestionDraft] = useState("");
  const [matrix, setMatrix] = useState<ReviewMatrix | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LiteraturePaper[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchPage, setSearchPage] = useState(1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [detailPaper, setDetailPaper] = useState<LiteraturePaper | null>(null);
  const [evidenceRecord, setEvidenceRecord] = useState<{
    pmid: number;
    rows: EvidenceExtraction[];
  } | null>(null);
  const [paperEvidenceLoading, setPaperEvidenceLoading] = useState(false);
  const [paperEvidenceError, setPaperEvidenceError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>(loadPersistedActivity);

  const activeReviewIdRef = useRef<string | null>(null);
  const previousReviewIdRef = useRef<string | null>(null);
  const detailPaperRef = useRef<LiteraturePaper | null>(null);
  const searchControllerRef = useRef<AbortController | null>(null);
  const persisted = storageGet(ACTIVE_REVIEW_KEY);

  useEffect(() => {
    activeReviewIdRef.current = activeReviewId;
  }, [activeReviewId]);

  const pushActivity = useCallback((entry: Omit<ActivityEntry, "id" | "at">) => {
    const full: ActivityEntry = { ...entry, id: nextId(), at: new Date().toISOString() };
    setActivity((prev) => {
      const next = [full, ...prev].slice(0, MAX_ACTIVITY);
      storageSet(ACTIVITY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const loadMatrix = useCallback(async (reviewId: string) => {
    setMatrixLoading(true);
    setMatrixError(null);
    try {
      const data = await api.getReviewMatrix(reviewId);
      setMatrix(data);
    } catch {
      setMatrixError("Could not load the evidence matrix. The API may be offline.");
    } finally {
      setMatrixLoading(false);
    }
  }, []);

  const refreshMatrix = useCallback(async () => {
    const id = activeReviewIdRef.current;
    if (id) await loadMatrix(id);
  }, [loadMatrix]);

  // When a WebMCP tool (or any other writer) mutates data out-of-band, re-read
  // the reviews + matrix so the live UI reflects the change. If the active
  // review no longer exists (an agent deleted it), fall back to the first
  // remaining review so the workspace never points at a deleted context.
  useEffect(() => {
    const onDataChanged = async () => {
      try {
        const list = await api.listReviews();
        setReviews(list);
        let next = activeReviewIdRef.current;
        if (!next || !list.some((r) => r.id === next)) {
          next = list[0]?.id ?? null;
          setActiveReviewId(next);
          if (next) storageSet(ACTIVE_REVIEW_KEY, next);
          else storageRemove(ACTIVE_REVIEW_KEY);
        }
        const review = next ? list.find((r) => r.id === next) : null;
        setQuestionDraft(review?.research_question ?? "");
        if (next) void loadMatrix(next);
        else setMatrix(null);
      } catch {
        // API offline — the matrix refresh already surfaces the failure.
      }
    };

    // Mirror agent tool executions into the human "Agent activity" panel so
    // MCP-driven work stays visible in real time alongside manual actions.
    const onToolActivity = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          tool: string;
          status: "ok" | "error";
          detail: string | null;
        }>
      ).detail;
      if (!detail?.tool) return;
      pushActivity({
        kind: "tool",
        tone: detail.status === "ok" ? "neutral" : "warning",
        message:
          detail.status === "ok"
            ? `Agent tool ${detail.tool} succeeded.`
            : `Agent tool ${detail.tool} failed${detail.detail ? `: ${detail.detail}` : "."}`,
      });
    };

    window.addEventListener("evidenceos:data-changed", onDataChanged);
    window.addEventListener("evidenceos:tool-activity", onToolActivity);
    return () => {
      window.removeEventListener("evidenceos:data-changed", onDataChanged);
      window.removeEventListener("evidenceos:tool-activity", onToolActivity);
    };
  }, [pushActivity, loadMatrix]);

  const loadPaperEvidence = useCallback(async (pmid: number) => {
    setPaperEvidenceLoading(true);
    setPaperEvidenceError(null);
    try {
      const data = await api.getEvidence(pmid);
      setEvidenceRecord({ pmid, rows: data });
    } catch {
      setEvidenceRecord(null);
      setPaperEvidenceError("Could not load evidence for this paper.");
    } finally {
      setPaperEvidenceLoading(false);
    }
  }, []);

  // Boot: check API health, load reviews, restore the active review.
  useEffect(() => {
    let cancelled = false;
    let checkTimer: ReturnType<typeof setTimeout> | undefined;

    const checkHealth = async (attempt: number): Promise<void> => {
      try {
        await api.health();
        if (!cancelled) setApiStatus("online");
      } catch {
        if (cancelled) return;
        setApiStatus("offline");
        if (attempt < 8) {
          checkTimer = setTimeout(() => void checkHealth(attempt + 1), 10_000 + attempt * 5_000);
        }
      }
    };

    (async () => {
      void checkHealth(1);

      try {
        const list = await api.listReviews();
        if (cancelled) return;
        setReviews(list);
        const selected = earliestReviewPref(list, persisted);
        setActiveReviewId(selected);
        if (selected) {
          const review = list.find((r) => r.id === selected);
          setQuestionDraft(review?.research_question ?? "");
        }
        if (list.length === 0) {
          pushActivity({
            kind: "review",
            message: "Workspace ready. Create a review to begin.",
            tone: "neutral",
          });
        }
      } catch (error) {
        if (!cancelled) {
          pushActivity({
            kind: "review",
            message: error instanceof Error ? error.message : "Could not load reviews.",
            tone: "warning",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (checkTimer) clearTimeout(checkTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the matrix whenever the active review changes.
  useEffect(() => {
    const reviewId = activeReviewId;
    let cancelled = false;

    const load = async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!reviewId) {
        setMatrix(null);
        setMatrixError(null);
        return;
      }
      setMatrixLoading(true);
      setMatrixError(null);
      try {
        const data = await api.getReviewMatrix(reviewId);
        if (!cancelled) setMatrix(data);
      } catch {
        if (!cancelled) {
          setMatrixError("Could not load the evidence matrix. The API may be offline.");
        }
      } finally {
        if (!cancelled) setMatrixLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeReviewId]);

  // Load the paper's evidence whenever the detail drawer opens.
  useEffect(() => {
    detailPaperRef.current = detailPaper;
    if (!detailPaper) return;
    const pmid = detailPaper.pmid;
    let cancelled = false;

    const load = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setPaperEvidenceLoading(true);
      setPaperEvidenceError(null);
      try {
        const data = await api.getEvidence(pmid);
        if (!cancelled) setEvidenceRecord({ pmid, rows: data });
      } catch {
        if (!cancelled) {
          setEvidenceRecord(null);
          setPaperEvidenceError("Could not load evidence for this paper.");
        }
      } finally {
        if (!cancelled) setPaperEvidenceLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [detailPaper]);

  const createReview = useCallback(
    async (title: string, researchQuestion: string | null) => {
      try {
        const review = await api.createReview(title, researchQuestion);
        setReviews((prev) => [review, ...prev]);
        setActiveReviewId(review.id);
        storageSet(ACTIVE_REVIEW_KEY, review.id);
        setQuestionDraft(researchQuestion ?? "");
        setCreatingReview(false);
        previousReviewIdRef.current = null;
        pushActivity({
          kind: "review",
          message: `Created review "${title}".`,
          tone: "accent",
        });
        return true;
      } catch (error) {
        pushActivity({
          kind: "review",
          message: error instanceof Error ? error.message : "Could not create the review.",
          tone: "warning",
        });
        return false;
      }
    },
    [pushActivity],
  );

  const selectReview = useCallback(
    (id: string) => {
      setActiveReviewId(id);
      storageSet(ACTIVE_REVIEW_KEY, id);
      setCreatingReview(false);
      previousReviewIdRef.current = null;
      const review = reviews.find((r) => r.id === id);
      setQuestionDraft(review?.research_question ?? "");
      pushActivity({
        kind: "review",
        message: `Opened "${review?.title ?? "review"}".`,
        tone: "neutral",
      });
    },
    [reviews, pushActivity],
  );

  const startCreateReview = useCallback(() => {
    previousReviewIdRef.current = activeReviewId;
    setCreatingReview(true);
    setMatrix(null);
    setMatrixError(null);
  }, [activeReviewId]);

  const cancelCreateReview = useCallback(() => {
    setCreatingReview(false);
    const previous = previousReviewIdRef.current;
    previousReviewIdRef.current = null;
    if (!previous) return;
    setActiveReviewId(previous);
    storageSet(ACTIVE_REVIEW_KEY, previous);
    const review = reviews.find((r) => r.id === previous);
    setQuestionDraft(review?.research_question ?? "");
  }, [reviews]);

  // The WebMCP workflow selects its fresh review so the judge watches the
  // matrix fill up live instead of mutating an invisible throwaway workspace.
  useEffect(() => {
    const onSelectReview = (event: Event) => {
      const reviewId = (event as CustomEvent<{ reviewId?: string }>).detail?.reviewId;
      if (reviewId) selectReview(reviewId);
    };
    window.addEventListener("evidenceos:select-review", onSelectReview);
    return () => window.removeEventListener("evidenceos:select-review", onSelectReview);
  }, [selectReview]);

  const deleteReview = useCallback(
    async (id: string) => {
      try {
        await api.deleteReview(id);
        const remaining = reviews.filter((r) => r.id !== id);
        const next = remaining[0]?.id ?? null;
        setReviews(remaining);
        setCreatingReview(false);
        previousReviewIdRef.current = null;
        if (next) {
          const review = remaining.find((r) => r.id === next);
          setActiveReviewId(next);
          setQuestionDraft(review?.research_question ?? "");
          storageSet(ACTIVE_REVIEW_KEY, next);
          pushActivity({
            kind: "review",
            message: `Review deleted. Switched to "${review?.title ?? "next review"}".`,
            tone: "neutral",
          });
        } else {
          setActiveReviewId(null);
          setQuestionDraft("");
          setMatrix(null);
          storageRemove(ACTIVE_REVIEW_KEY);
          pushActivity({ kind: "review", message: "Review deleted.", tone: "neutral" });
        }
      } catch (error) {
        pushActivity({
          kind: "review",
          message: error instanceof Error ? error.message : "Could not delete the review.",
          tone: "warning",
        });
      }
    },
    [reviews, pushActivity],
  );

  const saveQuestion = useCallback(
    async (question: string) => {
      const id = activeReviewIdRef.current;
      if (!id) return;
      try {
        const updated = await api.updateReview(id, { research_question: question || null });
        setReviews((prev) => prev.map((r) => (r.id === id ? updated : r)));
        pushActivity({
          kind: "note",
          message: question.trim() ? "Research question saved." : "Research question cleared.",
          tone: "neutral",
        });
      } catch (error) {
        pushActivity({
          kind: "note",
          message: error instanceof Error ? error.message : "Could not save the question.",
          tone: "warning",
        });
      }
    },
    [pushActivity],
  );

  const runSearch = useCallback(
    async (searchQuery: string) => {
      const trimmed = searchQuery.trim();
      if (!trimmed) return;
      searchControllerRef.current?.abort();
      const controller = new AbortController();
      searchControllerRef.current = controller;
      setQuery(trimmed);
      setSearchLoading(true);
      setSearchError(null);
      try {
        const data = await api.searchLiterature(
          { q: trimmed, page: 1, page_size: 25 },
          controller.signal,
        );
        setSearchResults(data.items);
        setSearchTotal(data.total);
        setSearchPage(1);
        const message =
          data.total > 0
            ? `PubMed search "${trimmed}" — ${data.total.toLocaleString()} results, page 1.`
            : `PubMed search "${trimmed}" returned no results.`;
        pushActivity({
          kind: "search",
          message,
          tone: data.total > 0 ? "neutral" : "warning",
        });
      } catch (error) {
        if (controller.signal.aborted) {
          setSearchLoading(false);
          return;
        }
        setSearchResults([]);
        setSearchTotal(0);
        setSearchError(
          error instanceof Error ? error.message : "Search failed. The API may be offline.",
        );
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    },
    [pushActivity],
  );

  const goToPage = useCallback(
    async (page: number) => {
      searchControllerRef.current?.abort();
      const controller = new AbortController();
      searchControllerRef.current = controller;
      setSearchLoading(true);
      setSearchError(null);
      try {
        const data = await api.searchLiterature(
          { q: query, page, page_size: 25 },
          controller.signal,
        );
        setSearchResults(data.items);
        setSearchTotal(data.total);
        setSearchPage(page);
      } catch (error) {
        if (controller.signal.aborted) {
          setSearchLoading(false);
          return;
        }
        setSearchError(
          error instanceof Error ? error.message : "Could not load that page of results.",
        );
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    },
    [query],
  );

  const clearSearch = useCallback(() => {
    searchControllerRef.current?.abort();
    searchControllerRef.current = null;
    setQuery("");
    setSearchResults([]);
    setSearchTotal(0);
    setSearchPage(1);
    setSearchError(null);
    setSearchLoading(false);
  }, []);

  const addPaperToReview = useCallback(
    async (paper: LiteraturePaper) => {
      const id = activeReviewIdRef.current;
      if (!id) {
        pushActivity({
          kind: "add",
          message: "Create or select a review before adding papers.",
          tone: "warning",
        });
        return;
      }
      try {
        await api.attachPaper(id, paper.pmid);
        pushActivity({
          kind: "add",
          message: `Added "${truncateTitle(paper.title)}" to the review.`,
          tone: "positive",
        });
      } catch (error) {
        const already = error instanceof Error && error.message.includes("already attached");
        pushActivity({
          kind: "add",
          message: already
            ? `"${truncateTitle(paper.title)}" is already in the review.`
            : error instanceof Error
              ? error.message
              : "Could not add the paper.",
          tone: already ? "neutral" : "warning",
        });
      } finally {
        await loadMatrix(id);
      }
    },
    [pushActivity, loadMatrix],
  );

  const removePaper = useCallback(
    async (paperId: string) => {
      const id = activeReviewIdRef.current;
      if (!id) return;
      try {
        await api.removeReviewPaper(id, paperId);
        pushActivity({
          kind: "remove",
          message: "Removed a paper from the review.",
          tone: "neutral",
        });
        await loadMatrix(id);
      } catch (error) {
        pushActivity({
          kind: "remove",
          message: error instanceof Error ? error.message : "Could not remove the paper.",
          tone: "warning",
        });
        await loadMatrix(id);
      }
    },
    [pushActivity, loadMatrix],
  );

  const setScreening = useCallback(
    async (paperId: string, status: ScreeningStatus) => {
      const id = activeReviewIdRef.current;
      if (!id) return;
      try {
        await api.updateReviewPaper(id, paperId, { status });
        pushActivity({
          kind: "screen",
          message: `Marked a paper as ${status}.`,
          tone: status === "included" ? "positive" : "neutral",
        });
        await loadMatrix(id);
      } catch (error) {
        pushActivity({
          kind: "screen",
          message: error instanceof Error ? error.message : "Could not update screening status.",
          tone: "warning",
        });
        await loadMatrix(id);
      }
    },
    [pushActivity, loadMatrix],
  );

  const setNotes = useCallback(
    async (paperId: string, notes: string) => {
      const id = activeReviewIdRef.current;
      if (!id) return;
      try {
        await api.updateReviewPaper(id, paperId, { notes });
        pushActivity({
          kind: "note",
          message: notes.trim() ? "Notes updated on a paper." : "Notes cleared.",
          tone: "neutral",
        });
        await loadMatrix(id);
      } catch (error) {
        pushActivity({
          kind: "note",
          message: error instanceof Error ? error.message : "Could not save notes.",
          tone: "warning",
        });
        await loadMatrix(id);
      }
    },
    [pushActivity, loadMatrix],
  );

  const addExtraction = useCallback(
    async (paperId: string, input: ExtractionInput) => {
      const id = activeReviewIdRef.current;
      if (!id) return;
      try {
        await api.createExtraction(paperId, input);
        pushActivity({
          kind: "evidence",
          message: "Recorded a structured evidence extraction.",
          tone: "positive",
        });
        await loadMatrix(id);
      } catch (error) {
        pushActivity({
          kind: "evidence",
          message: error instanceof Error ? error.message : "Could not save the extraction.",
          tone: "warning",
        });
        await loadMatrix(id);
      }
      const open = detailPaperRef.current;
      if (open) await loadPaperEvidence(open.pmid);
    },
    [pushActivity, loadMatrix, loadPaperEvidence],
  );

  const runExtraction = useCallback(async () => {
    const paper = detailPaperRef.current;
    if (!paper || extracting) return;
    setExtracting(true);
    setExtractionError(null);
    try {
      const generated = await api.extractEvidence(paper.pmid);
      pushActivity({
        kind: "evidence",
        message: `LLM generated structured evidence from "${truncateTitle(paper.title)}" (${generated.model_name ?? "LLM"}). Verify against the source before relying on it.`,
        tone: "accent",
      });
      await loadPaperEvidence(paper.pmid);
      const reviewId = activeReviewIdRef.current;
      if (reviewId) await loadMatrix(reviewId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not extract evidence.";
      setExtractionError(message);
      pushActivity({ kind: "evidence", message, tone: "warning" });
    } finally {
      setExtracting(false);
    }
  }, [pushActivity, loadMatrix, loadPaperEvidence, extracting]);

  const openPaper = useCallback((paper: LiteraturePaper) => setDetailPaper(paper), []);
  const closePaper = useCallback(() => setDetailPaper(null), []);

  const activeReview = useMemo(
    () => reviews.find((r) => r.id === activeReviewId) ?? null,
    [reviews, activeReviewId],
  );

  // Only surface evidence that belongs to the paper currently in the drawer,
  // so switching papers never flashes the previous paper's rows.
  const paperEvidence = useMemo(
    () =>
      evidenceRecord && detailPaper && evidenceRecord.pmid === detailPaper.pmid
        ? evidenceRecord.rows
        : [],
    [evidenceRecord, detailPaper],
  );

  const reach = stageFor(matrix, searchResults.length);

  const value: WorkspaceState = {
    apiStatus,
    reviews,
    activeReviewId,
    activeReview,
    questionDraft,
    matrix,
    matrixLoading,
    matrixError,
    query,
    searchResults,
    searchTotal,
    searchPage,
    searchLoading,
    searchError,
    detailPaper,
    paperEvidence,
    paperEvidenceLoading,
    paperEvidenceError,
    extracting,
    extractionError,
    activity,
    reach,
    createReview,
    selectReview,
    deleteReview,
    creatingReview,
    startCreateReview,
    cancelCreateReview,
    saveQuestion,
    runSearch,
    goToPage,
    clearSearch,
    addPaperToReview,
    removePaper,
    setScreening,
    setNotes,
    addExtraction,
    runExtraction,
    openPaper,
    closePaper,
    refreshMatrix,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}

function truncateTitle(title: string): string {
  return title.length > 54 ? `${title.slice(0, 53).trimEnd()}…` : title;
}
