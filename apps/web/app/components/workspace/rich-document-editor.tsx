"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import CharacterCount from "@tiptap/extension-character-count";
import { useState, useCallback, useEffect, useRef } from "react";
import { fileWriteUrl } from "@/lib/workspace-paths";

import {
  ToolbarGroup,
  ToolbarDivider,
  ToolbarButton,
  BubbleButton,
} from "./editor-toolbar-primitives";

// --- Types ---

export type RichDocumentEditorProps = {
  mode: "docx" | "txt";
  initialHtml: string;
  filePath: string;
  onSave?: () => void;
  onDirty?: () => void;
  /** Compact mode for sidebar preview rendering */
  compact?: boolean;
};

// --- Helpers ---

function isDocxFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "docx" || ext === "doc";
}

function isTxtFile(name: string): boolean {
  return name.split(".").pop()?.toLowerCase() === "txt";
}

export { isDocxFile, isTxtFile };

/** Convert plain text into simple HTML paragraphs for Tiptap */
export function textToHtml(text: string): string {
  if (!text.trim()) {return "<p></p>";}
  return text
    .split("\n")
    .map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "<br>"}</p>`)
    .join("");
}

// --- Main component ---

export function RichDocumentEditor({
  mode,
  initialHtml,
  filePath,
  onSave,
  onDirty,
  compact,
}: RichDocumentEditorProps) {
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [isDirty, setIsDirty] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const filename = filePath.split("/").pop() ?? filePath;
  const isTxt = mode === "txt";

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: "code-block" } },
      }),
      Underline,
      Superscript,
      Subscript,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: "editor-image" },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: "editor-link", rel: "noopener" },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: isTxt
          ? "Start typing..."
          : "Start writing your document...",
      }),
      CharacterCount,
    ],
    content: initialHtml,
    immediatelyRender: false,
    onUpdate: () => {
      setIsDirty(true);
      setSaveStatus("idle");
      onDirty?.();
    },
  });

  // --- Image upload ---
  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/workspace/upload", { method: "POST", body: form });
      if (!res.ok) {return null;}
      const data = await res.json();
      return `/api/workspace/assets/${(data.path as string).replace(/^assets\//, "")}`;
    } catch {
      return null;
    }
  }, []);

  const insertUploadedImages = useCallback(
    async (files: File[]) => {
      if (!editor) {return;}
      for (const file of files) {
        const url = await uploadImage(file);
        if (url) {editor.chain().focus().setImage({ src: url, alt: file.name }).run();}
      }
    },
    [editor, uploadImage],
  );

  // --- Drop & paste handlers for images ---
  useEffect(() => {
    if (!editor) {return;}
    const dom = editor.view.dom;

    const handleDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) {return;}
      const imgs = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
      if (imgs.length === 0) {return;}
      e.preventDefault();
      e.stopPropagation();
      void insertUploadedImages(imgs);
    };

    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {e.preventDefault();}
    };

    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) {return;}
      const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
      if (imgs.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        void insertUploadedImages(imgs);
      }
    };

    dom.addEventListener("drop", handleDrop);
    dom.addEventListener("dragover", handleDragOver);
    dom.addEventListener("paste", handlePaste);
    return () => {
      dom.removeEventListener("drop", handleDrop);
      dom.removeEventListener("dragover", handleDragOver);
      dom.removeEventListener("paste", handlePaste);
    };
  }, [editor, insertUploadedImages]);

  // --- Save ---
  const handleSave = useCallback(async () => {
    if (!editor || saving) {return;}
    setSaving(true);
    setSaveStatus("idle");

    try {
      if (isTxt) {
        const text = editor.getText();
        const res = await fetch(fileWriteUrl(filePath), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: filePath, content: text }),
        });
        if (!res.ok) {throw new Error("Save failed");}
      } else {
        const html = editor.getHTML();
        const { default: htmlToDocx } = await import("html-to-docx");
        const docxBlob = await htmlToDocx(html, undefined, {
          table: { row: { cantSplit: true } },
          footer: true,
          pageNumber: true,
        });

        const formData = new FormData();
        formData.append("file", docxBlob);
        formData.append("path", filePath);
        const res = await fetch("/api/workspace/write-binary", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {throw new Error("Save failed");}
      }

      setSaveStatus("saved");
      setIsDirty(false);
      onSave?.();
      if (saveTimerRef.current) {clearTimeout(saveTimerRef.current);}
      saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  }, [editor, filePath, saving, isTxt, onSave]);

  // Cmd/Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  if (!editor) {
    return (
      <div className="animate-pulse space-y-3 py-4 px-6">
        <div className="h-4 rounded" style={{ background: "var(--color-surface)", width: "80%" }} />
        <div className="h-4 rounded" style={{ background: "var(--color-surface)", width: "60%" }} />
        <div className="h-4 rounded" style={{ background: "var(--color-surface)", width: "70%" }} />
      </div>
    );
  }

  const wordCount = editor.storage.characterCount?.words() ?? 0;
  const charCount = editor.storage.characterCount?.characters() ?? 0;

  return (
    <div className={`rich-doc-editor ${compact ? "rich-doc-editor--compact" : ""}`}>
      {/* Top bar */}
      <div className="rich-doc-topbar">
        <div className="rich-doc-topbar-left">
          <DocIcon mode={mode} />
          <span className="rich-doc-filename">{filename}</span>
          {isDirty && <span className="editor-save-indicator editor-save-unsaved">Unsaved changes</span>}
          {saveStatus === "saved" && !isDirty && (
            <span className="editor-save-indicator editor-save-saved">Saved</span>
          )}
          {saveStatus === "error" && (
            <span className="editor-save-indicator editor-save-error">Save failed</span>
          )}
        </div>
        <div className="rich-doc-topbar-right">
          <span className="editor-save-hint">
            {typeof navigator !== "undefined" && navigator.platform?.includes("Mac") ? "\u2318" : "Ctrl"}+S
          </span>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !isDirty}
            className="editor-save-button"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Toolbar (hidden for TXT in compact) */}
      {!isTxt && (
        <RichToolbar editor={editor} onUploadImages={insertUploadedImages} imageInputRef={imageInputRef} />
      )}
      {isTxt && !compact && (
        <div className="editor-toolbar rich-doc-toolbar-minimal">
          <ToolbarGroup>
            <ToolbarButton active={false} onClick={() => editor.chain().focus().undo().run()} title="Undo" disabled={!editor.can().undo()}>
              <UndoIcon />
            </ToolbarButton>
            <ToolbarButton active={false} onClick={() => editor.chain().focus().redo().run()} title="Redo" disabled={!editor.can().redo()}>
              <RedoIcon />
            </ToolbarButton>
          </ToolbarGroup>
          <div className="flex-1" />
          <span className="rich-doc-txt-hint">Plain text &mdash; formatting not preserved on save</span>
        </div>
      )}

      {/* Bubble menu */}
      {!isTxt && (
        <BubbleMenu editor={editor}>
          <div className="bubble-menu">
            <BubbleButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
              <strong>B</strong>
            </BubbleButton>
            <BubbleButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
              <em>I</em>
            </BubbleButton>
            <BubbleButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
              <span style={{ textDecoration: "underline" }}>U</span>
            </BubbleButton>
            <BubbleButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
              <s>S</s>
            </BubbleButton>
            <BubbleButton active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code">
              {"<>"}
            </BubbleButton>
            <BubbleButton
              active={editor.isActive("link")}
              onClick={() => {
                if (editor.isActive("link")) {
                  editor.chain().focus().unsetLink().run();
                } else {
                  const url = window.prompt("URL:");
                  if (url) {editor.chain().focus().setLink({ href: url }).run();}
                }
              }}
              title="Link"
            >
              <LinkIcon size={14} />
            </BubbleButton>
          </div>
        </BubbleMenu>
      )}

      {/* Editor content area -- page-like layout */}
      <div className="rich-doc-scroll">
        <div className={`rich-doc-page ${isTxt ? "rich-doc-page--txt" : ""}`}>
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Status bar */}
      {!compact && (
        <div className="rich-doc-statusbar">
          <span>{wordCount.toLocaleString()} word{wordCount !== 1 ? "s" : ""}</span>
          <span className="rich-doc-statusbar-sep" />
          <span>{charCount.toLocaleString()} character{charCount !== 1 ? "s" : ""}</span>
          <div className="flex-1" />
          <span className="rich-doc-statusbar-mode">{mode === "docx" ? "DOCX" : "TXT"}</span>
        </div>
      )}

      {/* Hidden file input for image upload */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) {void insertUploadedImages(files);}
          e.target.value = "";
        }}
      />
    </div>
  );
}

// --- Rich toolbar ---

function RichToolbar({
  editor,
  onUploadImages,
  imageInputRef,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  onUploadImages?: (files: File[]) => void;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const colorRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  // Close popups on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) {setShowColorPicker(false);}
      if (highlightRef.current && !highlightRef.current.contains(e.target as Node)) {setShowHighlightPicker(false);}
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div className="editor-toolbar rich-doc-toolbar">
      {/* Undo / Redo */}
      <ToolbarGroup>
        <ToolbarButton active={false} onClick={() => editor.chain().focus().undo().run()} title="Undo" disabled={!editor.can().undo()}>
          <UndoIcon />
        </ToolbarButton>
        <ToolbarButton active={false} onClick={() => editor.chain().focus().redo().run()} title="Redo" disabled={!editor.can().redo()}>
          <RedoIcon />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Paragraph style */}
      <ToolbarGroup>
        <ParagraphStyleDropdown editor={editor} />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Inline formatting */}
      <ToolbarGroup>
        <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (Cmd+B)">
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (Cmd+I)">
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (Cmd+U)">
          <span style={{ textDecoration: "underline" }}>U</span>
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
          <s>S</s>
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("superscript")} onClick={() => editor.chain().focus().toggleSuperscript().run()} title="Superscript">
          <span>X<sup style={{ fontSize: "0.6em" }}>2</sup></span>
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("subscript")} onClick={() => editor.chain().focus().toggleSubscript().run()} title="Subscript">
          <span>X<sub style={{ fontSize: "0.6em" }}>2</sub></span>
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Text color / Highlight */}
      <ToolbarGroup>
        <div className="relative" ref={colorRef}>
          <ToolbarButton
            active={showColorPicker}
            onClick={() => { setShowColorPicker(!showColorPicker); setShowHighlightPicker(false); }}
            title="Text color"
          >
            <TextColorIcon color={editor.getAttributes("textStyle").color ?? "currentColor"} />
          </ToolbarButton>
          {showColorPicker && (
            <ColorPalette
              onSelect={(c) => {
                if (c) {editor.chain().focus().setColor(c).run();}
                else {editor.chain().focus().unsetColor().run();}
                setShowColorPicker(false);
              }}
            />
          )}
        </div>
        <div className="relative" ref={highlightRef}>
          <ToolbarButton
            active={showHighlightPicker}
            onClick={() => { setShowHighlightPicker(!showHighlightPicker); setShowColorPicker(false); }}
            title="Highlight color"
          >
            <HighlightColorIcon />
          </ToolbarButton>
          {showHighlightPicker && (
            <ColorPalette
              onSelect={(c) => {
                if (c) {editor.chain().focus().toggleHighlight({ color: c }).run();}
                else {editor.chain().focus().unsetHighlight().run();}
                setShowHighlightPicker(false);
              }}
            />
          )}
        </div>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Alignment */}
      <ToolbarGroup>
        <ToolbarButton active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Align left">
          <AlignLeftIcon />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Align center">
          <AlignCenterIcon />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Align right">
          <AlignRightIcon />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()} title="Justify">
          <AlignJustifyIcon />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Lists */}
      <ToolbarGroup>
        <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
          <BulletListIcon />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Ordered list">
          <OrderedListIcon />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} title="Task list">
          <TaskListIcon />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Blocks */}
      <ToolbarGroup>
        <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">
          <BlockquoteIcon />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code block">
          <CodeBlockIcon />
        </ToolbarButton>
        <ToolbarButton
          active={false}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal rule"
        >
          <HorizontalRuleIcon />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Insert: link, image, table */}
      <ToolbarGroup>
        <ToolbarButton
          active={editor.isActive("link")}
          onClick={() => {
            if (editor.isActive("link")) {
              editor.chain().focus().unsetLink().run();
            } else {
              const url = window.prompt("Link URL:");
              if (url) {editor.chain().focus().setLink({ href: url }).run();}
            }
          }}
          title="Insert link"
        >
          <LinkIcon />
        </ToolbarButton>
        <ToolbarButton
          active={false}
          onClick={() => {
            if (onUploadImages) {imageInputRef.current?.click();}
            else {
              const url = window.prompt("Image URL:");
              if (url) {editor.chain().focus().setImage({ src: url }).run();}
            }
          }}
          title="Insert image"
        >
          <ImageIcon />
        </ToolbarButton>
        <ToolbarButton
          active={false}
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          title="Insert table"
        >
          <TableIcon />
        </ToolbarButton>
      </ToolbarGroup>
    </div>
  );
}

// --- Paragraph style dropdown ---

const HEADING_OPTIONS = [
  { label: "Normal text", level: 0 },
  { label: "Heading 1", level: 1 },
  { label: "Heading 2", level: 2 },
  { label: "Heading 3", level: 3 },
  { label: "Heading 4", level: 4 },
  { label: "Heading 5", level: 5 },
  { label: "Heading 6", level: 6 },
] as const;

function ParagraphStyleDropdown({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {setOpen(false);}
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const current =
    HEADING_OPTIONS.find((h) => h.level > 0 && editor.isActive("heading", { level: h.level }))
    ?? HEADING_OPTIONS[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="rich-doc-style-dropdown"
        onClick={() => setOpen(!open)}
        title="Paragraph style"
      >
        <span>{current.label}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="rich-doc-style-menu">
          {HEADING_OPTIONS.map((opt) => (
            <button
              key={opt.level}
              type="button"
              className={`rich-doc-style-option ${opt.level === current.level ? "rich-doc-style-option--active" : ""}`}
              onClick={() => {
                if (opt.level === 0) {
                  editor.chain().focus().setParagraph().run();
                } else {
                  editor.chain().focus().toggleHeading({ level: opt.level }).run();
                }
                setOpen(false);
              }}
            >
              <span
                style={{
                  fontSize: opt.level === 0 ? undefined : `${Math.max(0.75, 1.4 - opt.level * 0.1)}rem`,
                  fontWeight: opt.level > 0 ? 600 : 400,
                }}
              >
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Color palette popup ---

const COLORS = [
  null, "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#ffffff",
  "#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff",
  "#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc",
  "#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd",
  "#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0",
];

function ColorPalette({ onSelect }: { onSelect: (color: string | null) => void }) {
  return (
    <div className="rich-doc-color-palette">
      {COLORS.map((c) => (
        <button
          key={c ?? "none"}
          type="button"
          className="rich-doc-color-swatch"
          style={{
            background: c ?? "transparent",
            border: c ? "1px solid var(--color-border)" : "2px dashed var(--color-border)",
          }}
          onClick={() => onSelect(c)}
          title={c ?? "Remove color"}
        >
          {!c && <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>&times;</span>}
        </button>
      ))}
    </div>
  );
}

// --- SVG icons (inlined to avoid external deps) ---

function UndoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
    </svg>
  );
}

function AlignLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="17" x2="3" y1="10" y2="10" /><line x1="21" x2="3" y1="6" y2="6" /><line x1="21" x2="3" y1="14" y2="14" /><line x1="17" x2="3" y1="18" y2="18" />
    </svg>
  );
}

function AlignCenterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" x2="6" y1="10" y2="10" /><line x1="21" x2="3" y1="6" y2="6" /><line x1="21" x2="3" y1="14" y2="14" /><line x1="18" x2="6" y1="18" y2="18" />
    </svg>
  );
}

function AlignRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="21" x2="7" y1="10" y2="10" /><line x1="21" x2="3" y1="6" y2="6" /><line x1="21" x2="3" y1="14" y2="14" /><line x1="21" x2="7" y1="18" y2="18" />
    </svg>
  );
}

function AlignJustifyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="21" x2="3" y1="10" y2="10" /><line x1="21" x2="3" y1="6" y2="6" /><line x1="21" x2="3" y1="14" y2="14" /><line x1="21" x2="3" y1="18" y2="18" />
    </svg>
  );
}

function BulletListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" x2="21" y1="6" y2="6" /><line x1="8" x2="21" y1="12" y2="12" /><line x1="8" x2="21" y1="18" y2="18" />
      <line x1="3" x2="3.01" y1="6" y2="6" /><line x1="3" x2="3.01" y1="12" y2="12" /><line x1="3" x2="3.01" y1="18" y2="18" />
    </svg>
  );
}

function OrderedListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="10" x2="21" y1="6" y2="6" /><line x1="10" x2="21" y1="12" y2="12" /><line x1="10" x2="21" y1="18" y2="18" />
      <path d="M4 6h1v4" /><path d="M4 10h2" /><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </svg>
  );
}

function TaskListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="6" height="6" rx="1" /><path d="m3 17 2 2 4-4" /><line x1="13" x2="21" y1="6" y2="6" /><line x1="13" x2="21" y1="18" y2="18" />
    </svg>
  );
}

function BlockquoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z" />
    </svg>
  );
}

function CodeBlockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function HorizontalRuleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" x2="22" y1="12" y2="12" />
    </svg>
  );
}

function LinkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" /><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function TextColorIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h16" stroke={color} strokeWidth="3" />
      <path d="m8.5 3 3.5 11 3.5-11" />
    </svg>
  );
}

function HighlightColorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </svg>
  );
}

function DocIcon({ mode }: { mode: "docx" | "txt" }) {
  if (mode === "txt") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <path d="M14 2v6h6" /><line x1="8" x2="16" y1="13" y2="13" /><line x1="8" x2="16" y1="17" y2="17" /><line x1="8" x2="10" y1="9" y2="9" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2b579a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <path d="M14 2v6h6" /><line x1="8" x2="16" y1="13" y2="13" /><line x1="8" x2="16" y1="17" y2="17" /><line x1="8" x2="10" y1="9" y2="9" />
    </svg>
  );
}
