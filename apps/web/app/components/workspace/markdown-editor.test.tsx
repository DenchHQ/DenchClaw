// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MarkdownEditor } from "./markdown-editor";

type EditorOptions = {
  onUpdate?: () => void;
};

let lastEditorOptions: EditorOptions | null = null;
let currentEditor: {
  view: { dom: HTMLDivElement };
  commands: { setContent: ReturnType<typeof vi.fn> };
  isActive: ReturnType<typeof vi.fn>;
  getHTML: ReturnType<typeof vi.fn>;
  getMarkdown: ReturnType<typeof vi.fn>;
  chain: ReturnType<typeof vi.fn>;
};

function createMockChain() {
  const chain = {
    focus: vi.fn(() => chain),
    toggleBold: vi.fn(() => chain),
    toggleItalic: vi.fn(() => chain),
    toggleStrike: vi.fn(() => chain),
    toggleCode: vi.fn(() => chain),
    unsetLink: vi.fn(() => chain),
    setLink: vi.fn(() => chain),
    toggleHeading: vi.fn(() => chain),
    toggleBulletList: vi.fn(() => chain),
    toggleOrderedList: vi.fn(() => chain),
    toggleTaskList: vi.fn(() => chain),
    toggleBlockquote: vi.fn(() => chain),
    toggleCodeBlock: vi.fn(() => chain),
    setImage: vi.fn(() => chain),
    insertTable: vi.fn(() => chain),
    setHorizontalRule: vi.fn(() => chain),
    run: vi.fn(() => true),
  };
  return chain;
}

vi.mock("@tiptap/react", () => ({
  useEditor: (options: EditorOptions) => {
    lastEditorOptions = options;
    return currentEditor;
  },
  EditorContent: () => <div data-testid="editor-content" />,
}));

vi.mock("@tiptap/react/menus", () => ({
  BubbleMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bubble-menu">{children}</div>
  ),
}));

vi.mock("@tiptap/starter-kit", () => ({ default: { configure: () => ({}) } }));
vi.mock("@tiptap/markdown", () => ({ Markdown: { configure: () => ({}) } }));
vi.mock("@tiptap/extension-image", () => ({ default: { configure: () => ({}) } }));
vi.mock("@tiptap/extension-link", () => ({ default: { configure: () => ({}) } }));
vi.mock("@tiptap/extension-table", () => ({ Table: { configure: () => ({}) } }));
vi.mock("@tiptap/extension-table-row", () => ({ default: {} }));
vi.mock("@tiptap/extension-table-cell", () => ({ default: {} }));
vi.mock("@tiptap/extension-table-header", () => ({ default: {} }));
vi.mock("@tiptap/extension-task-list", () => ({ default: {} }));
vi.mock("@tiptap/extension-task-item", () => ({ default: { configure: () => ({}) } }));
vi.mock("@tiptap/extension-placeholder", () => ({ default: { configure: () => ({}) } }));

vi.mock("./report-block-node", () => ({
  ReportBlockNode: {},
  preprocessReportBlocks: (value: string) => value,
  postprocessReportBlocks: (value: string) => value,
}));

vi.mock("./slash-command", () => ({
  createSlashCommand: () => ({}),
  createWorkspaceMention: () => ({}),
  createFileMention: () => ({}),
}));

vi.mock("./editor-toolbar-primitives", () => ({
  ToolbarGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ToolbarDivider: () => <div data-testid="toolbar-divider" />,
  ToolbarButton: ({
    children,
    onClick,
    title,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    title?: string;
  }) => (
    <button type="button" onClick={onClick} title={title}>
      {children}
    </button>
  ),
  BubbleButton: ({
    children,
    onClick,
    title,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    title?: string;
  }) => (
    <button type="button" onClick={onClick} title={title}>
      {children}
    </button>
  ),
}));

vi.mock("@/lib/workspace-links", () => ({
  isWorkspaceLink: () => false,
}));

describe("MarkdownEditor", () => {
  beforeEach(() => {
    const chain = createMockChain();
    currentEditor = {
      view: { dom: document.createElement("div") },
      commands: { setContent: vi.fn() },
      isActive: vi.fn(() => false),
      getHTML: vi.fn(() => "<p>fallback</p>"),
      getMarkdown: vi.fn(() => "# updated markdown"),
      chain: vi.fn(() => chain),
    };
    lastEditorOptions = null;
  });

  function markDirty() {
    act(() => {
      lastEditorOptions?.onUpdate?.();
    });
  }

  it("saves home-relative markdown files through the real file API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    global.fetch = fetchMock;
    const user = userEvent.setup();

    render(
      <MarkdownEditor
        content="# initial"
        filePath="~/notes/daily.md"
        tree={[]}
      />,
    );

    markDirty();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/workspace/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "~/notes/daily.md", content: "# updated markdown" }),
    });
  });

  it("keeps virtual markdown paths on the virtual-file API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    global.fetch = fetchMock;
    const user = userEvent.setup();

    render(
      <MarkdownEditor
        content="# initial"
        filePath="~skills/demo/SKILL.md"
        tree={[]}
      />,
    );

    markDirty();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/workspace/virtual-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "~skills/demo/SKILL.md", content: "# updated markdown" }),
    });
  });
});
