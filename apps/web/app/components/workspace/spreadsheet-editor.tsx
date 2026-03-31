"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type CSSProperties,
} from "react";
import Spreadsheet, {
  type CellBase,
  type Matrix,
  type Selection,
  type Point,
  RangeSelection,
  PointRange,
  createEmptyMatrix,
} from "react-spreadsheet";
import { read, utils, write } from "xlsx";
import {
  fileExt,
  isTextSpreadsheet,
  columnLabel,
  cellRef,
  sheetToMatrix,
  matrixToSheet,
  matrixToCsv,
  selectionStats,
} from "./spreadsheet-utils";
import { fileWriteUrl } from "@/lib/workspace-paths";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SpreadsheetEditorProps = {
  url: string;
  filename: string;
  filePath: string;
  compact?: boolean;
  onDirty?: () => void;
};

type SheetState = {
  data: Matrix<CellBase>;
  name: string;
};

type UndoEntry = {
  sheetIdx: number;
  data: Matrix<CellBase>;
};

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

type ContextMenuState = {
  x: number;
  y: number;
  row: number;
  col: number;
} | null;

function ContextMenu({
  state,
  onClose,
  onInsertRowAbove,
  onInsertRowBelow,
  onInsertColLeft,
  onInsertColRight,
  onDeleteRow,
  onDeleteCol,
  onClearCells,
}: {
  state: ContextMenuState;
  onClose: () => void;
  onInsertRowAbove: () => void;
  onInsertRowBelow: () => void;
  onInsertColLeft: () => void;
  onInsertColRight: () => void;
  onDeleteRow: () => void;
  onDeleteCol: () => void;
  onClearCells: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) {return;}
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {onClose();}
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [state, onClose]);

  if (!state) {return null;}

  const itemStyle: CSSProperties = {
    padding: "6px 12px",
    fontSize: "12px",
    cursor: "pointer",
    color: "var(--color-text)",
    borderRadius: "4px",
  };

  const items: { label: string; action: () => void; danger?: boolean }[] = [
    { label: "Insert row above", action: onInsertRowAbove },
    { label: "Insert row below", action: onInsertRowBelow },
    { label: "Insert column left", action: onInsertColLeft },
    { label: "Insert column right", action: onInsertColRight },
    { label: "Delete row", action: onDeleteRow, danger: true },
    { label: "Delete column", action: onDeleteCol, danger: true },
    { label: "Clear cells", action: onClearCells, danger: true },
  ];

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: state.y,
        left: state.x,
        zIndex: 9999,
        background: "var(--color-surface-raised)",
        border: "1px solid var(--color-border)",
        borderRadius: "8px",
        padding: "4px",
        boxShadow: "var(--shadow-lg)",
        minWidth: "180px",
      }}
    >
      {items.map((item, i) => (
        <div key={i}>
          {i === 4 && (
            <div
              style={{
                height: "1px",
                background: "var(--color-border)",
                margin: "4px 0",
              }}
            />
          )}
          <button
            type="button"
            onClick={() => {
              item.action();
              onClose();
            }}
            style={{
              ...itemStyle,
              color: item.danger ? "var(--color-error)" : "var(--color-text)",
              display: "block",
              width: "100%",
              textAlign: "left",
              background: "transparent",
              border: "none",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "var(--color-surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search bar
// ---------------------------------------------------------------------------

function SearchBar({
  data,
  onNavigate,
  onClose,
}: {
  data: Matrix<CellBase>;
  onNavigate: (point: Point) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Point[]>([]);
  const [currentMatch, setCurrentMatch] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      setCurrentMatch(0);
      return;
    }
    const q = query.toLowerCase();
    const found: Point[] = [];
    data.forEach((row, r) => {
      row?.forEach((cell, c) => {
        if (cell && String(cell.value).toLowerCase().includes(q)) {
          found.push({ row: r, column: c });
        }
      });
    });
    setMatches(found);
    setCurrentMatch(0);
    if (found.length > 0) {onNavigate(found[0]);}
  }, [query, data, onNavigate]);

  const goTo = useCallback(
    (idx: number) => {
      if (matches.length === 0) {return;}
      const wrapped = ((idx % matches.length) + matches.length) % matches.length;
      setCurrentMatch(wrapped);
      onNavigate(matches[wrapped]);
    },
    [matches, onNavigate],
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 12px",
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-text-muted)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {onClose();}
          if (e.key === "Enter") {
            e.preventDefault();
            goTo(e.shiftKey ? currentMatch - 1 : currentMatch + 1);
          }
        }}
        placeholder="Find in sheet..."
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          fontSize: "12px",
          color: "var(--color-text)",
        }}
      />
      {query && (
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
          {matches.length > 0
            ? `${currentMatch + 1} of ${matches.length}`
            : "No results"}
        </span>
      )}
      <button
        type="button"
        onClick={() => goTo(currentMatch - 1)}
        disabled={matches.length === 0}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "2px",
          color: "var(--color-text-muted)",
          opacity: matches.length === 0 ? 0.3 : 1,
        }}
        title="Previous (Shift+Enter)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m18 15-6-6-6 6"/></svg>
      </button>
      <button
        type="button"
        onClick={() => goTo(currentMatch + 1)}
        disabled={matches.length === 0}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "2px",
          color: "var(--color-text-muted)",
          opacity: matches.length === 0 ? 0.3 : 1,
        }}
        title="Next (Enter)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <button
        type="button"
        onClick={onClose}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "2px",
          color: "var(--color-text-muted)",
        }}
        title="Close (Esc)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function ToolbarButton({
  onClick,
  title,
  disabled,
  children,
  accent,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "28px",
        height: "28px",
        borderRadius: "6px",
        border: "none",
        background: accent ? "var(--color-accent)" : "transparent",
        color: accent ? "#fff" : "var(--color-text-muted)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.35 : 1,
        flexShrink: 0,
        transition: "background 0.1s, color 0.1s",
      }}
      onMouseEnter={(e) => {
        if (!disabled && !accent)
          {(e.currentTarget as HTMLElement).style.background =
            "var(--color-surface-hover)";}
      }}
      onMouseLeave={(e) => {
        if (!accent)
          {(e.currentTarget as HTMLElement).style.background = "transparent";}
      }}
    >
      {children}
    </button>
  );
}

function ToolbarSep() {
  return (
    <div
      style={{
        width: "1px",
        height: "18px",
        background: "var(--color-border)",
        margin: "0 4px",
        flexShrink: 0,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SpreadsheetEditor({
  url,
  filename,
  filePath,
  compact = false,
  onDirty,
}: SpreadsheetEditorProps) {
  const [sheets, setSheets] = useState<SheetState[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [activeCell, setActiveCell] = useState<Point | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [showSearch, setShowSearch] = useState(false);
  const spreadsheetRef = useRef<{ activate: (p: Point) => void } | null>(null);

  // Undo stack (simple: stores full sheet snapshots)
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);

  // -------------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setActiveSheet(0);
    setError(null);
    setDirty(false);
    setUndoStack([]);
    setRedoStack([]);

    fetch(url)
      .then((res) => {
        if (!res.ok) {throw new Error(`Failed to load file (${res.status})`);}
        return res.arrayBuffer();
      })
      .then((buf) => {
        if (cancelled) {return;}
        const wb = read(buf, { type: "array" });
        const loaded: SheetState[] = wb.SheetNames.map((name) => ({
          name,
          data: sheetToMatrix(wb.Sheets[name]),
        }));
        if (loaded.length === 0) {
          loaded.push({
            name: "Sheet1",
            data: createEmptyMatrix<CellBase>(50, 26),
          });
        }
        setSheets(loaded);
      })
      .catch((err) => {
        if (!cancelled) {setError(String(err));}
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  // -------------------------------------------------------------------------
  // Current sheet helpers
  // -------------------------------------------------------------------------

  const currentData = sheets?.[activeSheet]?.data ?? [];

  const colCount = useMemo(() => {
    let max = 0;
    for (const row of currentData) {
      if (row) {max = Math.max(max, row.length);}
    }
    return max;
  }, [currentData]);

  const columnLabels = useMemo(
    () => Array.from({ length: colCount }, (_, i) => columnLabel(i)),
    [colCount],
  );

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const pushUndo = useCallback(() => {
    if (!sheets) {return;}
    setUndoStack((prev) => [
      ...prev.slice(-49),
      { sheetIdx: activeSheet, data: sheets[activeSheet].data },
    ]);
    setRedoStack([]);
  }, [sheets, activeSheet]);

  const updateCurrentSheet = useCallback(
    (newData: Matrix<CellBase>) => {
      setSheets((prev) => {
        if (!prev) {return prev;}
        const next = [...prev];
        next[activeSheet] = { ...next[activeSheet], data: newData };
        return next;
      });
      setDirty(true);
      onDirty?.();
    },
    [activeSheet, onDirty],
  );

  const handleChange = useCallback(
    (newData: Matrix<CellBase>) => {
      pushUndo();
      updateCurrentSheet(newData);
    },
    [pushUndo, updateCurrentSheet],
  );

  const undo = useCallback(() => {
    if (undoStack.length === 0 || !sheets) {return;}
    const entry = undoStack[undoStack.length - 1];
    setRedoStack((prev) => [
      ...prev,
      { sheetIdx: activeSheet, data: sheets[activeSheet].data },
    ]);
    setUndoStack((prev) => prev.slice(0, -1));
    setSheets((prev) => {
      if (!prev) {return prev;}
      const next = [...prev];
      next[entry.sheetIdx] = { ...next[entry.sheetIdx], data: entry.data };
      return next;
    });
    if (entry.sheetIdx !== activeSheet) {setActiveSheet(entry.sheetIdx);}
  }, [undoStack, sheets, activeSheet]);

  const redo = useCallback(() => {
    if (redoStack.length === 0 || !sheets) {return;}
    const entry = redoStack[redoStack.length - 1];
    setUndoStack((prev) => [
      ...prev,
      { sheetIdx: activeSheet, data: sheets[activeSheet].data },
    ]);
    setRedoStack((prev) => prev.slice(0, -1));
    setSheets((prev) => {
      if (!prev) {return prev;}
      const next = [...prev];
      next[entry.sheetIdx] = { ...next[entry.sheetIdx], data: entry.data };
      return next;
    });
    if (entry.sheetIdx !== activeSheet) {setActiveSheet(entry.sheetIdx);}
  }, [redoStack, sheets, activeSheet]);

  // Row/col operations
  const insertRow = useCallback(
    (at: number) => {
      pushUndo();
      const newRow = Array.from({ length: colCount }, () => ({ value: "" }) as CellBase);
      const next = [...currentData];
      next.splice(at, 0, newRow);
      updateCurrentSheet(next);
    },
    [pushUndo, updateCurrentSheet, currentData, colCount],
  );

  const deleteRow = useCallback(
    (at: number) => {
      if (currentData.length <= 1) {return;}
      pushUndo();
      const next = [...currentData];
      next.splice(at, 1);
      updateCurrentSheet(next);
    },
    [pushUndo, updateCurrentSheet, currentData],
  );

  const insertCol = useCallback(
    (at: number) => {
      pushUndo();
      const next = currentData.map((row) => {
        const r = [...(row ?? [])];
        r.splice(at, 0, { value: "" });
        return r;
      });
      updateCurrentSheet(next);
    },
    [pushUndo, updateCurrentSheet, currentData],
  );

  const deleteCol = useCallback(
    (at: number) => {
      if (colCount <= 1) {return;}
      pushUndo();
      const next = currentData.map((row) => {
        const r = [...(row ?? [])];
        r.splice(at, 1);
        return r;
      });
      updateCurrentSheet(next);
    },
    [pushUndo, updateCurrentSheet, currentData, colCount],
  );

  const clearSelection = useCallback(() => {
    if (!selection) {return;}
    const range = selection.toRange(currentData);
    if (!range) {return;}
    pushUndo();
    const next = currentData.map((row) => (row ? [...row] : []));
    for (const pt of range) {
      if (next[pt.row]) {
        next[pt.row][pt.column] = { value: "" };
      }
    }
    updateCurrentSheet(next);
  }, [selection, currentData, pushUndo, updateCurrentSheet]);

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  const save = useCallback(async () => {
    if (!sheets || saving) {return;}
    setSaving(true);
    try {
      if (isTextSpreadsheet(filename)) {
        const sep = fileExt(filename) === "tsv" ? "\t" : ",";
        const text = matrixToCsv(sheets[activeSheet].data, sep);
        const res = await fetch(fileWriteUrl(filePath), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: filePath, content: text }),
        });
        if (!res.ok) {throw new Error("Save failed");}
      } else {
        const wb = utils.book_new();
        for (const s of sheets) {
          utils.book_append_sheet(wb, matrixToSheet(s.data), s.name);
        }
        const buf = write(wb, { type: "array", bookType: fileExt(filename) as "xlsx" });
        const res = await fetch(
          `/api/workspace/raw-file?path=${encodeURIComponent(filePath)}`,
          { method: "POST", body: buf },
        );
        if (!res.ok) {throw new Error("Save failed");}
      }
      setDirty(false);
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 1500);
    } catch (err) {
      console.error("Spreadsheet save error:", err);
    } finally {
      setSaving(false);
    }
  }, [sheets, saving, filename, filePath, activeSheet]);

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "s") {
        e.preventDefault();
        void save();
      }
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (mod && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      }
      if (mod && e.key === "f") {
        e.preventDefault();
        setShowSearch((p) => !p);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [save, undo, redo]);

  // Context menu on spreadsheet area
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const target = e.target as HTMLElement;
      const td = target.closest("td");
      if (!td) {return;}
      const tr = td.closest("tr");
      if (!tr) {return;}
      const tbody = tr.closest("tbody");
      if (!tbody) {return;}
      const rowIdx = Array.from(tbody.children).indexOf(tr);
      const colIdx = Array.from(tr.children).indexOf(td) - 1; // subtract row indicator
      if (rowIdx < 0 || colIdx < 0) {return;}
      setContextMenu({ x: e.clientX, y: e.clientY, row: rowIdx, col: colIdx });
    },
    [],
  );

  // Navigate to cell (for search)
  const navigateToCell = useCallback((point: Point) => {
    setActiveCell(point);
    spreadsheetRef.current?.activate(point);
    setSelection(new RangeSelection(new PointRange(point, point)));
  }, []);

  // -------------------------------------------------------------------------
  // Formula bar value
  // -------------------------------------------------------------------------

  const activeCellValue = useMemo(() => {
    if (!activeCell) {return "";}
    const cell = currentData[activeCell.row]?.[activeCell.column];
    return cell ? String(cell.value) : "";
  }, [activeCell, currentData]);

  const handleFormulaChange = useCallback(
    (value: string) => {
      if (!activeCell) {return;}
      pushUndo();
      const next = currentData.map((row) => (row ? [...row] : []));
      if (!next[activeCell.row]) {next[activeCell.row] = [];}
      next[activeCell.row][activeCell.column] = { value };
      updateCurrentSheet(next);
    },
    [activeCell, currentData, pushUndo, updateCurrentSheet],
  );

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  const stats = useMemo(
    () => selectionStats(currentData, selection),
    [currentData, selection],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const ext = fileExt(filename).toUpperCase() || "SPREADSHEET";

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: "12px",
          padding: "24px",
        }}
      >
        <SpreadsheetIcon size={32} />
        <p style={{ color: "var(--color-text)", fontWeight: 500, fontSize: "14px" }}>
          Failed to load spreadsheet
        </p>
        <p style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>{error}</p>
      </div>
    );
  }

  if (!sheets) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: "12px",
        }}
      >
        <div
          className="animate-spin"
          style={{
            width: "20px",
            height: "20px",
            border: "2px solid var(--color-border)",
            borderTopColor: "var(--color-accent)",
            borderRadius: "50%",
          }}
        />
        <p style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>
          Loading spreadsheet...
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "var(--color-bg)",
        overflow: "hidden",
      }}
    >
      {/* -- Header / Toolbar -------------------------------------------- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: compact ? "6px 10px" : "8px 16px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          flexShrink: 0,
        }}
      >
        <SpreadsheetIcon size={16} />
        <span
          style={{
            fontSize: compact ? "12px" : "13px",
            fontWeight: 600,
            color: "var(--color-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {filename}
        </span>
        <span
          style={{
            fontSize: "10px",
            padding: "1px 6px",
            borderRadius: "4px",
            background: "var(--color-surface-hover)",
            color: "var(--color-text-muted)",
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {ext}
        </span>
        {dirty && (
          <span
            style={{
              fontSize: "10px",
              padding: "1px 6px",
              borderRadius: "4px",
              background: "var(--color-warning)",
              color: "#fff",
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            Unsaved
          </span>
        )}
        {saveFlash && (
          <span
            style={{
              fontSize: "10px",
              padding: "1px 6px",
              borderRadius: "4px",
              background: "var(--color-success)",
              color: "#fff",
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            Saved
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Toolbar buttons */}
        {!compact && (
          <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
            <ToolbarButton onClick={save} title="Save (⌘S)" disabled={!dirty || saving} accent={dirty}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>
                <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/>
                <path d="M7 3v4a1 1 0 0 0 1 1h7"/>
              </svg>
            </ToolbarButton>
            <ToolbarSep />
            <ToolbarButton onClick={undo} title="Undo (⌘Z)" disabled={undoStack.length === 0}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
              </svg>
            </ToolbarButton>
            <ToolbarButton onClick={redo} title="Redo (⌘⇧Z)" disabled={redoStack.length === 0}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>
              </svg>
            </ToolbarButton>
            <ToolbarSep />
            <ToolbarButton
              onClick={() => activeCell && insertRow(activeCell.row)}
              title="Insert row above"
              disabled={!activeCell}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14"/><path d="M5 12h14"/>
              </svg>
            </ToolbarButton>
            <ToolbarButton
              onClick={() => activeCell && insertCol(activeCell.column)}
              title="Insert column left"
              disabled={!activeCell}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M12 8v8"/><path d="M8 12h8"/>
              </svg>
            </ToolbarButton>
            <ToolbarSep />
            <ToolbarButton onClick={() => setShowSearch((p) => !p)} title="Find (⌘F)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
              </svg>
            </ToolbarButton>
          </div>
        )}

        {/* Compact save button */}
        {compact && dirty && (
          <ToolbarButton onClick={save} title="Save (⌘S)" disabled={saving} accent>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>
              <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/>
              <path d="M7 3v4a1 1 0 0 0 1 1h7"/>
            </svg>
          </ToolbarButton>
        )}
      </div>

      {/* -- Formula bar ------------------------------------------------- */}
      {!compact && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "4px 16px",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--color-text-muted)",
              minWidth: "36px",
              textAlign: "center",
              padding: "2px 6px",
              borderRadius: "4px",
              background: "var(--color-surface-hover)",
              fontFamily: "monospace",
            }}
          >
            {activeCell ? cellRef(activeCell) : "\u00A0"}
          </span>
          <div
            style={{
              width: "1px",
              height: "18px",
              background: "var(--color-border)",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: "11px",
              fontWeight: 500,
              color: "var(--color-text-muted)",
              flexShrink: 0,
            }}
          >
            fx
          </span>
          <input
            type="text"
            value={activeCellValue}
            onChange={(e) => handleFormulaChange(e.target.value)}
            placeholder="Select a cell"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: "12px",
              color: "var(--color-text)",
              fontFamily: "monospace",
            }}
          />
        </div>
      )}

      {/* -- Search bar -------------------------------------------------- */}
      {showSearch && (
        <SearchBar
          data={currentData}
          onNavigate={navigateToCell}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* -- Spreadsheet grid -------------------------------------------- */}
      <div
        style={{ flex: 1, overflow: "auto", position: "relative" }}
        onContextMenu={handleContextMenu}
      >
        <Spreadsheet
          ref={spreadsheetRef as React.Ref<unknown>}
          data={currentData}
          onChange={handleChange}
          columnLabels={columnLabels}
          onActivate={setActiveCell}
          onSelect={setSelection}
          darkMode={typeof document !== "undefined" && document.documentElement.classList.contains("dark")}
          className="spreadsheet-editor-grid"
        />
      </div>

      {/* -- Context menu ------------------------------------------------ */}
      <ContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(null)}
        onInsertRowAbove={() => contextMenu && insertRow(contextMenu.row)}
        onInsertRowBelow={() => contextMenu && insertRow(contextMenu.row + 1)}
        onInsertColLeft={() => contextMenu && insertCol(contextMenu.col)}
        onInsertColRight={() => contextMenu && insertCol(contextMenu.col + 1)}
        onDeleteRow={() => contextMenu && deleteRow(contextMenu.row)}
        onDeleteCol={() => contextMenu && deleteCol(contextMenu.col)}
        onClearCells={clearSelection}
      />

      {/* -- Sheet tabs -------------------------------------------------- */}
      {sheets.length > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 0,
            borderTop: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            overflow: "auto",
            flexShrink: 0,
          }}
        >
          {sheets.map((s, idx) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActiveSheet(idx)}
              style={{
                padding: compact ? "4px 10px" : "6px 16px",
                fontSize: compact ? "10px" : "11px",
                fontWeight: idx === activeSheet ? 600 : 400,
                color:
                  idx === activeSheet
                    ? "var(--color-text)"
                    : "var(--color-text-muted)",
                background:
                  idx === activeSheet
                    ? "var(--color-bg)"
                    : "transparent",
                border: "none",
                borderRight: "1px solid var(--color-border)",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "background 0.1s",
                position: "relative",
              }}
            >
              {s.name}
              {idx === activeSheet && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: "2px",
                    background: "var(--color-accent)",
                    borderRadius: "0 0 2px 2px",
                  }}
                />
              )}
            </button>
          ))}
        </div>
      )}

      {/* -- Status bar -------------------------------------------------- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: compact ? "3px 10px" : "4px 16px",
          borderTop: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          fontSize: compact ? "10px" : "11px",
          color: "var(--color-text-muted)",
          flexShrink: 0,
          gap: "12px",
        }}
      >
        <span>
          {currentData.length} row{currentData.length !== 1 ? "s" : ""}
          {" \u00d7 "}
          {colCount} col{colCount !== 1 ? "s" : ""}
          {sheets.length > 1
            ? ` \u00b7 ${sheets.length} sheets`
            : ""}
        </span>
        {stats && (
          <span style={{ textAlign: "right" }}>
            Count: {stats.count}
            {stats.numericCount > 0 && (
              <>
                {" \u00b7 "}Sum: {stats.sum.toLocaleString()}
                {" \u00b7 "}Avg: {stats.avg.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

function SpreadsheetIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "#22c55e", flexShrink: 0 }}
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M8 13h2" />
      <path d="M14 13h2" />
      <path d="M8 17h2" />
      <path d="M14 17h2" />
    </svg>
  );
}
