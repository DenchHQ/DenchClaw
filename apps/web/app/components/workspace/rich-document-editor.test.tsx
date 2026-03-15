// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import htmlToDocx from "html-to-docx";

import {
	RichDocumentEditor,
	isDocxFile,
	isTxtFile,
	textToHtml,
} from "./rich-document-editor";

type EditorOptions = {
	onUpdate?: () => void;
};

type MockChain = {
	focus: ReturnType<typeof vi.fn>;
	run: ReturnType<typeof vi.fn>;
	undo: ReturnType<typeof vi.fn>;
	redo: ReturnType<typeof vi.fn>;
	toggleBold: ReturnType<typeof vi.fn>;
	toggleItalic: ReturnType<typeof vi.fn>;
	toggleUnderline: ReturnType<typeof vi.fn>;
	toggleStrike: ReturnType<typeof vi.fn>;
	toggleSuperscript: ReturnType<typeof vi.fn>;
	toggleSubscript: ReturnType<typeof vi.fn>;
	setTextAlign: ReturnType<typeof vi.fn>;
	toggleBulletList: ReturnType<typeof vi.fn>;
	toggleOrderedList: ReturnType<typeof vi.fn>;
	toggleTaskList: ReturnType<typeof vi.fn>;
	toggleBlockquote: ReturnType<typeof vi.fn>;
	toggleCodeBlock: ReturnType<typeof vi.fn>;
	setHorizontalRule: ReturnType<typeof vi.fn>;
	setLink: ReturnType<typeof vi.fn>;
	unsetLink: ReturnType<typeof vi.fn>;
	setImage: ReturnType<typeof vi.fn>;
	insertTable: ReturnType<typeof vi.fn>;
	toggleHeading: ReturnType<typeof vi.fn>;
	setParagraph: ReturnType<typeof vi.fn>;
	setColor: ReturnType<typeof vi.fn>;
	unsetColor: ReturnType<typeof vi.fn>;
	toggleHighlight: ReturnType<typeof vi.fn>;
	unsetHighlight: ReturnType<typeof vi.fn>;
};

type MockEditor = {
	chain: ReturnType<typeof vi.fn>;
	can: ReturnType<typeof vi.fn>;
	isActive: ReturnType<typeof vi.fn>;
	getAttributes: ReturnType<typeof vi.fn>;
	getText: ReturnType<typeof vi.fn>;
	getHTML: ReturnType<typeof vi.fn>;
	storage: { characterCount: { words: ReturnType<typeof vi.fn>; characters: ReturnType<typeof vi.fn> } };
	view: { dom: HTMLDivElement };
};

let lastEditorOptions: EditorOptions | null = null;
let currentEditor: MockEditor;
let currentChain: MockChain;

const useEditorMock = vi.fn((options: EditorOptions) => {
	lastEditorOptions = options;
	return currentEditor;
});

vi.mock("@tiptap/react", () => ({
	useEditor: (options: EditorOptions) => useEditorMock(options),
	EditorContent: () => <div data-testid="editor-content" />,
}));

vi.mock("@tiptap/react/menus", () => ({
	BubbleMenu: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="bubble-menu">{children}</div>
	),
}));

vi.mock("html-to-docx", () => ({
	default: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })),
}));

function createMockChain(): MockChain {
	const chain = {} as MockChain;
	const passthrough = [
		"focus",
		"undo",
		"redo",
		"toggleBold",
		"toggleItalic",
		"toggleUnderline",
		"toggleStrike",
		"toggleSuperscript",
		"toggleSubscript",
		"setTextAlign",
		"toggleBulletList",
		"toggleOrderedList",
		"toggleTaskList",
		"toggleBlockquote",
		"toggleCodeBlock",
		"setHorizontalRule",
		"setLink",
		"unsetLink",
		"setImage",
		"insertTable",
		"toggleHeading",
		"setParagraph",
		"setColor",
		"unsetColor",
		"toggleHighlight",
		"unsetHighlight",
	] as const;

	for (const method of passthrough) {
		(chain[method] as unknown as ReturnType<typeof vi.fn>) = vi.fn(() => chain);
	}
	chain.run = vi.fn(() => true);
	return chain;
}

function createMockEditor(opts?: {
	isActive?: (name: unknown, attrs?: unknown) => boolean;
	getText?: string;
	getHTML?: string;
}) {
	const chain = createMockChain();
	const dom = document.createElement("div");
	document.body.appendChild(dom);
	const editor: MockEditor = {
		chain: vi.fn(() => chain),
		can: vi.fn(() => ({ undo: () => true, redo: () => true })),
		isActive: vi.fn(opts?.isActive ?? (() => false)),
		getAttributes: vi.fn(() => ({ color: undefined })),
		getText: vi.fn(() => opts?.getText ?? "plain txt content"),
		getHTML: vi.fn(() => opts?.getHTML ?? "<p>DOCX body</p>"),
		storage: {
			characterCount: {
				words: vi.fn(() => 2),
				characters: vi.fn(() => 12),
			},
		},
		view: { dom },
	};
	return { editor, chain, dom };
}

function markDirty() {
	act(() => {
		lastEditorOptions?.onUpdate?.();
	});
}

describe("rich-document-editor helpers", () => {
	it("detects .doc and .docx regardless of case (prevents wrong renderer selection)", () => {
		expect(isDocxFile("proposal.docx")).toBe(true);
		expect(isDocxFile("proposal.DOCX")).toBe(true);
		expect(isDocxFile("legacy.doc")).toBe(true);
		expect(isDocxFile("notes.txt")).toBe(false);
		expect(isDocxFile("archive.docx.bak")).toBe(false);
	});

	it("detects .txt regardless of case (routes plain text to text-safe mode)", () => {
		expect(isTxtFile("notes.txt")).toBe(true);
		expect(isTxtFile("NOTES.TXT")).toBe(true);
		expect(isTxtFile("notes.md")).toBe(false);
		expect(isTxtFile("notes.txt.bak")).toBe(false);
	});

	it("converts plain text to paragraph HTML and escapes HTML-sensitive characters", () => {
		const html = textToHtml("line <a>\n\nTom & Jerry");
		expect(html).toContain("<p>line &lt;a&gt;</p>");
		expect(html).toContain("<p><br></p>");
		expect(html).toContain("<p>Tom &amp; Jerry</p>");
	});

	it("returns a single empty paragraph for blank content (keeps editor mount stable)", () => {
		expect(textToHtml("   ")).toBe("<p></p>");
	});
});

describe("RichDocumentEditor rendering modes", () => {
	beforeEach(() => {
		const { editor, chain } = createMockEditor();
		currentEditor = editor;
		currentChain = chain;
		lastEditorOptions = null;
		useEditorMock.mockClear();
		vi.restoreAllMocks();
		global.fetch = vi.fn();
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("renders DOCX mode with full formatting toolbar (critical authoring controls stay available)", () => {
		render(
			<RichDocumentEditor
				mode="docx"
				initialHtml="<p>Hello</p>"
				filePath="docs/spec.docx"
			/>,
		);
		expect(screen.getByText("spec.docx")).toBeInTheDocument();
		expect(screen.getByTitle("Paragraph style")).toBeInTheDocument();
		expect(screen.getByTitle("Text color")).toBeInTheDocument();
		expect(screen.getByTitle("Insert table")).toBeInTheDocument();
		expect(screen.getByText("DOCX")).toBeInTheDocument();
		expect(screen.getByText("2 words")).toBeInTheDocument();
	});

	it("renders TXT mode with minimal controls and preservation warning", () => {
		render(
			<RichDocumentEditor
				mode="txt"
				initialHtml="<p>hello</p>"
				filePath="notes/today.txt"
			/>,
		);
		expect(screen.getByText("today.txt")).toBeInTheDocument();
		expect(screen.getByText("Plain text — formatting not preserved on save")).toBeInTheDocument();
		expect(screen.queryByTitle("Paragraph style")).not.toBeInTheDocument();
		expect(screen.getByText("TXT")).toBeInTheDocument();
	});

	it("hides status bar in compact mode (prevents sidebar overcrowding)", () => {
		render(
			<RichDocumentEditor
				mode="docx"
				initialHtml="<p>Hello</p>"
				filePath="docs/spec.docx"
				compact
			/>,
		);
		expect(screen.queryByText("2 words")).not.toBeInTheDocument();
		expect(screen.queryByText("DOCX")).not.toBeInTheDocument();
	});
});

describe("RichDocumentEditor save flows", () => {
	beforeEach(() => {
		const { editor, chain } = createMockEditor({
			getText: "Updated plain text",
			getHTML: "<p>Updated DOCX body</p>",
		});
		currentEditor = editor;
		currentChain = chain;
		lastEditorOptions = null;
		useEditorMock.mockClear();
		vi.restoreAllMocks();
		global.fetch = vi.fn();
	});

	afterEach(() => {
		document.body.innerHTML = "";
		vi.useRealTimers();
	});

	it("keeps save disabled until editor reports changes (prevents redundant writes)", () => {
		render(
			<RichDocumentEditor mode="txt" initialHtml="<p>hello</p>" filePath="notes/today.txt" />,
		);
		expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
		markDirty();
		expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
		expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
	});

	it("saves TXT via /api/workspace/file with exact path and plain text body", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
		);
		global.fetch = fetchMock;
		const onSave = vi.fn();
		const user = userEvent.setup();

		render(
			<RichDocumentEditor
				mode="txt"
				initialHtml="<p>hello</p>"
				filePath="notes/today.txt"
				onSave={onSave}
			/>,
		);
		markDirty();
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(fetchMock).toHaveBeenCalledWith("/api/workspace/file", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ path: "notes/today.txt", content: "Updated plain text" }),
		});
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(screen.getByText("Saved")).toBeInTheDocument();
	});

	it("preserves absolute browse-mode paths when saving TXT files", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
		);
		global.fetch = fetchMock;
		const user = userEvent.setup();

		render(
			<RichDocumentEditor
				mode="txt"
				initialHtml="<p>hello</p>"
				filePath="/tmp/today.txt"
			/>,
		);
		markDirty();
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(fetchMock).toHaveBeenCalledWith("/api/workspace/file", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ path: "/tmp/today.txt", content: "Updated plain text" }),
		});
	});

	it("saves DOCX via html-to-docx and /api/workspace/write-binary", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
		);
		global.fetch = fetchMock;
		const user = userEvent.setup();

		render(
			<RichDocumentEditor mode="docx" initialHtml="<p>hello</p>" filePath="docs/spec.docx" />,
		);
		markDirty();
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(vi.mocked(htmlToDocx)).toHaveBeenCalledWith(
			"<p>Updated DOCX body</p>",
			undefined,
			expect.objectContaining({
				table: { row: { cantSplit: true } },
				footer: true,
				pageNumber: true,
			}),
		);

		const reqInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/workspace/write-binary");
		expect(reqInit.method).toBe("POST");
		expect(reqInit.body).toBeInstanceOf(FormData);
		const form = reqInit.body as FormData;
		expect(form.get("path")).toBe("docs/spec.docx");
		expect(form.get("file")).toBeInstanceOf(Blob);
	});

	it("handles HTTP failure responses by surfacing Save failed", async () => {
		global.fetch = vi.fn().mockResolvedValue(new Response("fail", { status: 500 }));
		const user = userEvent.setup();
		render(
			<RichDocumentEditor mode="txt" initialHtml="<p>hello</p>" filePath="notes/today.txt" />,
		);
		markDirty();
		await user.click(screen.getByRole("button", { name: "Save" }));
		expect(screen.getByText("Save failed")).toBeInTheDocument();
	});

	it("handles network exceptions by surfacing Save failed", async () => {
		global.fetch = vi.fn().mockRejectedValue(new TypeError("Network error"));
		const user = userEvent.setup();
		render(
			<RichDocumentEditor mode="txt" initialHtml="<p>hello</p>" filePath="notes/today.txt" />,
		);
		markDirty();
		await user.click(screen.getByRole("button", { name: "Save" }));
		expect(screen.getByText("Save failed")).toBeInTheDocument();
	});

	it("supports Cmd/Ctrl+S shortcut for save (keyboard-first editing flow)", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
		);
		global.fetch = fetchMock;
		render(
			<RichDocumentEditor mode="txt" initialHtml="<p>hello</p>" filePath="notes/today.txt" />,
		);
		markDirty();

		fireEvent.keyDown(document, { key: "s", ctrlKey: true });
		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
	});

	it("clears saved indicator after timeout (status feedback resets correctly)", async () => {
		vi.useFakeTimers();
		global.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
		);

		render(
			<RichDocumentEditor mode="txt" initialHtml="<p>hello</p>" filePath="notes/today.txt" />,
		);
		markDirty();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Save" }));
		});
		expect(screen.getByText("Saved")).toBeInTheDocument();

		act(() => {
			vi.advanceTimersByTime(2000);
		});
		expect(screen.queryByText("Saved")).not.toBeInTheDocument();
	});
});

describe("RichDocumentEditor interaction details", () => {
	beforeEach(() => {
		const { editor, chain } = createMockEditor();
		currentEditor = editor;
		currentChain = chain;
		lastEditorOptions = null;
		useEditorMock.mockClear();
		vi.restoreAllMocks();
		global.fetch = vi.fn();
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("runs paragraph style command for selected heading level", async () => {
		const user = userEvent.setup();
		render(
			<RichDocumentEditor mode="docx" initialHtml="<p>hello</p>" filePath="docs/spec.docx" />,
		);
		await user.click(screen.getByTitle("Paragraph style"));
		await user.click(screen.getByRole("button", { name: "Heading 2" }));
		expect(currentChain.toggleHeading).toHaveBeenCalledWith({ level: 2 });
	});

	it("toggles rich formatting commands when toolbar buttons are clicked", async () => {
		const user = userEvent.setup();
		render(
			<RichDocumentEditor mode="docx" initialHtml="<p>hello</p>" filePath="docs/spec.docx" />,
		);

		await user.click(screen.getByTitle("Bold (Cmd+B)"));
		await user.click(screen.getByTitle("Italic (Cmd+I)"));
		await user.click(screen.getByTitle("Underline (Cmd+U)"));
		await user.click(screen.getByTitle("Align center"));
		await user.click(screen.getByTitle("Bullet list"));
		await user.click(screen.getByTitle("Blockquote"));
		await user.click(screen.getByTitle("Insert table"));

		expect(currentChain.toggleBold).toHaveBeenCalled();
		expect(currentChain.toggleItalic).toHaveBeenCalled();
		expect(currentChain.toggleUnderline).toHaveBeenCalled();
		expect(currentChain.setTextAlign).toHaveBeenCalledWith("center");
		expect(currentChain.toggleBulletList).toHaveBeenCalled();
		expect(currentChain.toggleBlockquote).toHaveBeenCalled();
		expect(currentChain.insertTable).toHaveBeenCalledWith({
			rows: 3,
			cols: 3,
			withHeaderRow: true,
		});
	});

	it("applies text color and removes color from palette actions", async () => {
		const user = userEvent.setup();
		render(
			<RichDocumentEditor mode="docx" initialHtml="<p>hello</p>" filePath="docs/spec.docx" />,
		);

		await user.click(screen.getByTitle("Text color"));
		await user.click(screen.getByTitle("#ff0000"));
		expect(currentChain.setColor).toHaveBeenCalledWith("#ff0000");

		await user.click(screen.getByTitle("Text color"));
		await user.click(screen.getByTitle("Remove color"));
		expect(currentChain.unsetColor).toHaveBeenCalled();
	});

	it("applies highlight color and allows unsetting highlight", async () => {
		const user = userEvent.setup();
		render(
			<RichDocumentEditor mode="docx" initialHtml="<p>hello</p>" filePath="docs/spec.docx" />,
		);

		await user.click(screen.getByTitle("Highlight color"));
		await user.click(screen.getByTitle("#ffd966"));
		expect(currentChain.toggleHighlight).toHaveBeenCalledWith({ color: "#ffd966" });

		await user.click(screen.getByTitle("Highlight color"));
		await user.click(screen.getByTitle("Remove color"));
		expect(currentChain.unsetHighlight).toHaveBeenCalled();
	});

	it("closes open palette when clicking outside (prevents stuck overlays)", async () => {
		const user = userEvent.setup();
		render(
			<RichDocumentEditor mode="docx" initialHtml="<p>hello</p>" filePath="docs/spec.docx" />,
		);
		await user.click(screen.getByTitle("Text color"));
		expect(screen.getByTitle("Remove color")).toBeInTheDocument();

		fireEvent.mouseDown(document.body);
		expect(screen.queryByTitle("Remove color")).not.toBeInTheDocument();
	});

	it("inserts a link when prompt returns URL (primary link UX path)", async () => {
		const user = userEvent.setup();
		vi.spyOn(window, "prompt").mockReturnValue("https://docs.openclaw.ai");

		render(
			<RichDocumentEditor mode="docx" initialHtml="<p>hello</p>" filePath="docs/spec.docx" />,
		);
		await user.click(screen.getByTitle("Insert link"));
		expect(currentChain.setLink).toHaveBeenCalledWith({ href: "https://docs.openclaw.ai" });
	});

	it("removes existing link when link is active (prevents duplicate nested link marks)", async () => {
		const { editor, chain } = createMockEditor({
			isActive: (name) => name === "link",
		});
		currentEditor = editor;
		currentChain = chain;
		useEditorMock.mockClear();
		const user = userEvent.setup();

		render(
			<RichDocumentEditor mode="docx" initialHtml="<p>hello</p>" filePath="docs/spec.docx" />,
		);
		await user.click(screen.getByTitle("Insert link"));
		expect(currentChain.unsetLink).toHaveBeenCalled();
	});

	it("uploads image files and inserts resulting asset URL into editor", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ path: "assets/uploads/screenshot.png" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		global.fetch = fetchMock;
		const user = userEvent.setup();
		const { container } = render(
			<RichDocumentEditor mode="docx" initialHtml="<p>hello</p>" filePath="docs/spec.docx" />,
		);

		const input = container.querySelector("input[type=\"file\"]") as HTMLInputElement;
		expect(input).toBeTruthy();
		const file = new File(["img"], "screenshot.png", { type: "image/png" });

		await user.upload(input, file);
		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith("/api/workspace/upload", {
				method: "POST",
				body: expect.any(FormData),
			});
		});
		expect(currentChain.setImage).toHaveBeenCalledWith({
			src: "/api/workspace/assets/uploads/screenshot.png",
			alt: "screenshot.png",
		});
	});

	it("handles dropped image files by uploading and inserting them (drag-drop flow)", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ path: "assets/uploads/drop.png" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		global.fetch = fetchMock;

		render(
			<RichDocumentEditor mode="docx" initialHtml="<p>hello</p>" filePath="docs/spec.docx" />,
		);

		const dropFile = new File(["img"], "drop.png", { type: "image/png" });
		const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(dropEvent, "dataTransfer", {
			value: { files: [dropFile], types: ["Files"] },
			configurable: true,
		});

		currentEditor.view.dom.dispatchEvent(dropEvent);
		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalled();
		});
		expect(currentChain.setImage).toHaveBeenCalledWith({
			src: "/api/workspace/assets/uploads/drop.png",
			alt: "drop.png",
		});
	});
});
