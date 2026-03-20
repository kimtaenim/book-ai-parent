"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";

// ── Types ──
interface Stats {
  total: number;
  edited: number;
  pending: number;
  updated: number;
}

interface QAItem {
  id: string;
  global_idx: number;
  chapter_num: number;
  chapter_title: string;
  chapter_theme: string;
  category: string;
  label: string;
  emoji: string;
  source_url: string;
  five_w: Record<string, string>;
  narrative: string;
  expert_reactions: string[];
  related_cases: string[];
  status: string;
  factcheck_result?: string;
  [key: string]: any;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "⬜",
  edited: "✏️",
  updated: "🟠",
  deleted: "🗑️",
};

const CATEGORY_BADGE: Record<string, string> = {
  original: "📖 원본",
  existing_supplement: "📎 기존보충",
  supplementary: "📌 웹보충",
};

const FIVE_W_LABELS: Record<string, string> = {
  who: "누가",
  what: "무엇을",
  when: "언제",
  where: "어디서",
  why: "왜",
  how: "어떻게",
  result: "결과",
};

// ── Spinner ──
function Spinner() {
  return (
    <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
  );
}

export default function ReviewPage() {
  const [entry, setEntry] = useState<QAItem | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats>({ total: 0, edited: 0, pending: 0, updated: 0 });
  const [loading, setLoading] = useState(true);
  const [navigating, setNavigating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editedNarrative, setEditedNarrative] = useState("");
  const [pageInput, setPageInput] = useState("");
  const [loadError, setLoadError] = useState("");
  const [factchecking, setFactchecking] = useState(false);
  const [factcheckResult, setFactcheckResult] = useState("");
  const [showFiveW, setShowFiveW] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Fetch single item ──
  const fetchItem = useCallback(async (idx: number, opts?: { silent?: boolean }) => {
    try {
      const res = await fetch(`/api/data?idx=${idx}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      const json = await res.json();
      setEntry(json.item);
      setCurrentIdx(idx);
      setTotal(json.total);
      if (json.stats) setStats(json.stats);
      setLoadError("");
      return json;
    } catch (e: any) {
      console.error("Fetch failed:", e);
      setLoadError(e.message || String(e));
      if (!opts?.silent) alert("데이터 로드 실패");
      return null;
    }
  }, []);

  // ── Initial load ──
  useEffect(() => {
    (async () => {
      try {
        const posRes = await fetch("/api/data?action=position", { cache: "no-store" });
        const pos = posRes.ok ? await posRes.json() : { idx: 0 };
        await fetchItem(pos.idx, { silent: true });
      } catch {
        await fetchItem(0, { silent: true });
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchItem]);

  // ── Auto-pull on tab focus ──
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        fetchItem(currentIdx, { silent: true });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchItem, currentIdx]);

  // ── Sync state when entry changes ──
  useEffect(() => {
    if (entry) {
      setEditedNarrative(entry.narrative || "");
      setFactcheckResult("");
      setPageInput(String(currentIdx + 1));
      setShowFiveW(false);
    }
  }, [entry?.id, currentIdx]);

  // ── Auto-resize textarea ──
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(Math.max(textareaRef.current.scrollHeight, 200), 700) + "px";
    }
  }, [editedNarrative]);

  // ── Navigate ──
  const navigateTo = useCallback(
    async (idx: number) => {
      if (idx < 0 || idx >= total || idx === currentIdx) return;
      setNavigating(true);
      await fetchItem(idx, { silent: true });
      setNavigating(false);
    },
    [fetchItem, total, currentIdx]
  );

  // ── Save ──
  const handleSave = useCallback(
    async (factcheck?: string) => {
      if (!entry) return;
      setSyncing(true);

      const newStatus = factcheck ? "updated" : "edited";
      const editedEntry = {
        ...entry,
        narrative: editedNarrative,
        status: newStatus,
        ...(factcheck ? { factcheck_result: factcheck } : {}),
      };

      setEntry(editedEntry);
      const nextIdx = Math.min(currentIdx + 1, total - 1);

      try {
        const res = await fetch("/api/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save",
            entry: editedEntry,
            reviewIdx: nextIdx,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        await fetchItem(nextIdx, { silent: true });
      } catch (e: any) {
        console.error("Save failed:", e);
        alert(`저장 실패: ${e.message}`);
      } finally {
        setSyncing(false);
      }
    },
    [entry, editedNarrative, currentIdx, total, fetchItem]
  );

  // ── Factcheck ──
  const handleFactcheck = useCallback(async () => {
    if (!entry) return;
    setFactchecking(true);
    setFactcheckResult("");

    try {
      const res = await fetch("/api/factcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: entry.label || "",
          narrative: editedNarrative,
          source_url: entry.source_url || "",
        }),
      });

      if (!res.ok) {
        setFactcheckResult(`오류: ${res.status}`);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const { text } = JSON.parse(payload);
            if (text) {
              accumulated += text;
              setFactcheckResult(accumulated);
            }
          } catch {
            // skip
          }
        }
      }

      if (accumulated) {
        handleSave(accumulated);
      }
    } catch (e) {
      setFactcheckResult(`팩트체크 실패: ${e}`);
    } finally {
      setFactchecking(false);
    }
  }, [entry, editedNarrative, handleSave]);

  // ── Page jump ──
  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(pageInput);
    if (!isNaN(num) && num >= 1 && num <= total) {
      navigateTo(num - 1);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center gap-3">
        <Spinner />
        <div className="text-lg text-gray-500">로드 중...</div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4">
        <div className="text-lg text-gray-500">데이터가 없습니다.</div>
        {loadError && (
          <div className="text-sm text-red-500 max-w-lg break-all">{loadError}</div>
        )}
      </div>
    );
  }

  const fiveW = entry.five_w || {};
  const hasFiveW = Object.keys(FIVE_W_LABELS).some((k) => fiveW[k]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation overlay */}
      {navigating && (
        <div className="fixed inset-0 z-50 bg-white/60 flex items-center justify-center">
          <Spinner />
        </div>
      )}

      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <h1 className="font-bold text-lg">AI시대 부모 검수</h1>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>전체 {stats.total}</span>
          <span className="text-green-700">✏️ {stats.edited}</span>
          <span className="text-gray-500">⬜ {stats.pending}</span>
          <span className="text-orange-500">🟠 {stats.updated}</span>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Status + Meta */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xl">{STATUS_BADGE[entry.status || "pending"]}</span>
          <span className="font-bold text-lg">
            {entry.emoji} {entry.label || "제목없음"}
          </span>
          <span className="bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full">
            {entry.chapter_num}장: {entry.chapter_title}
          </span>
          <span className="bg-gray-100 text-gray-600 text-xs px-2.5 py-1 rounded-full">
            {CATEGORY_BADGE[entry.category] || entry.category}
          </span>
        </div>

        {/* Chapter theme */}
        {entry.chapter_theme && (
          <div className="text-sm text-gray-500">
            테마: {entry.chapter_theme}
          </div>
        )}

        {/* Source URL */}
        {entry.source_url && (
          <a
            href={entry.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
          >
            🔗 원문
          </a>
        )}

        {/* Narrative (editable) */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Narrative
          </label>
          <textarea
            ref={textareaRef}
            value={editedNarrative}
            onChange={(e) => setEditedNarrative(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm leading-relaxed
                       focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            style={{ minHeight: "200px" }}
          />
        </div>

        {/* Five-W collapsible */}
        {hasFiveW && (
          <div className="border border-gray-200 rounded-lg">
            <button
              onClick={() => setShowFiveW(!showFiveW)}
              className="w-full px-4 py-2.5 text-left text-sm font-medium text-gray-700
                         hover:bg-gray-50 flex items-center justify-between"
            >
              <span>육하원칙 상세</span>
              <span>{showFiveW ? "▼" : "▶"}</span>
            </button>
            {showFiveW && (
              <div className="px-4 pb-3">
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(FIVE_W_LABELS).map(([key, kor]) => {
                      const val = fiveW[key];
                      if (!val) return null;
                      return (
                        <tr key={key} className="border-t border-gray-100">
                          <td className="py-2 pr-3 font-medium text-gray-600 whitespace-nowrap align-top w-20">
                            {kor}
                          </td>
                          <td className="py-2 text-gray-800">{val}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Expert reactions */}
        {entry.expert_reactions && entry.expert_reactions.length > 0 && (
          <details className="border border-gray-200 rounded-lg">
            <summary className="px-4 py-2.5 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
              전문가 반응 ({entry.expert_reactions.length})
            </summary>
            <div className="px-4 pb-3 space-y-1.5">
              {entry.expert_reactions.map((r, i) => (
                <div key={i} className="text-sm text-gray-700 bg-gray-50 rounded p-2">
                  {typeof r === "string" ? r : JSON.stringify(r)}
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Related cases */}
        {entry.related_cases && entry.related_cases.length > 0 && (
          <details className="border border-gray-200 rounded-lg">
            <summary className="px-4 py-2.5 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
              관련 사례 ({entry.related_cases.length})
            </summary>
            <div className="px-4 pb-3 space-y-1.5">
              {entry.related_cases.map((c, i) => (
                <div key={i} className="text-sm text-gray-700 bg-gray-50 rounded p-2">
                  {typeof c === "string" ? c : JSON.stringify(c)}
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => handleSave()}
            disabled={syncing}
            className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            {syncing ? (
              <span className="inline-flex items-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                저장 중...
              </span>
            ) : (
              "저장 + 다음"
            )}
          </button>
          <button
            onClick={handleFactcheck}
            disabled={factchecking}
            className="flex-1 bg-gray-100 text-gray-800 py-3 rounded-lg font-medium hover:bg-gray-200 transition disabled:opacity-50"
          >
            {factchecking ? "검색 중..." : "🔍 팩트체크"}
          </button>
        </div>

        {/* Factcheck result */}
        {factcheckResult && (
          <div className="bg-white border border-gray-200 rounded-lg p-4 prose prose-sm max-w-none">
            <ReactMarkdown>{factcheckResult}</ReactMarkdown>
          </div>
        )}

        {/* Previous factcheck */}
        {entry.factcheck_result && !factcheckResult && (
          <details className="border border-gray-200 rounded-lg">
            <summary className="px-4 py-2.5 text-sm font-medium text-blue-600 cursor-pointer hover:bg-gray-50">
              이전 팩트체크 결과
            </summary>
            <div className="px-4 pb-3 prose prose-sm max-w-none">
              <ReactMarkdown>{entry.factcheck_result}</ReactMarkdown>
            </div>
          </details>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-3 pt-2 border-t border-gray-200">
          <button
            onClick={() => navigateTo(currentIdx - 1)}
            disabled={currentIdx === 0 || navigating}
            className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-sm"
          >
            ← 이전
          </button>

          <form onSubmit={handlePageSubmit} className="flex items-center gap-1">
            <input
              type="number"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              min={1}
              max={total}
              className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center"
            />
            <span className="text-sm text-gray-500">/ {total}</span>
          </form>

          <button
            onClick={() => navigateTo(currentIdx + 1)}
            disabled={currentIdx >= total - 1 || navigating}
            className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-sm"
          >
            다음 →
          </button>
        </div>
      </main>
    </div>
  );
}
