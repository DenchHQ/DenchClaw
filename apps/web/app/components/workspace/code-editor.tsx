"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { DiffCard } from "../diff-viewer";
import { fileWriteUrl } from "@/lib/workspace-paths";

const EXT_TO_MONACO_LANG: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	rb: "ruby",
	go: "go",
	rs: "rust",
	java: "java",
	kt: "kotlin",
	swift: "swift",
	c: "c",
	cpp: "cpp",
	h: "c",
	hpp: "cpp",
	cs: "csharp",
	css: "css",
	scss: "scss",
	less: "less",
	html: "html",
	htm: "html",
	xml: "xml",
	svg: "xml",
	json: "json",
	jsonc: "json",
	yaml: "yaml",
	yml: "yaml",
	toml: "plaintext",
	md: "markdown",
	mdx: "markdown",
	sh: "shell",
	bash: "shell",
	zsh: "shell",
	fish: "shell",
	ps1: "powershell",
	sql: "sql",
	graphql: "graphql",
	gql: "graphql",
	dockerfile: "dockerfile",
	docker: "dockerfile",
	makefile: "plaintext",
	cmake: "plaintext",
	r: "r",
	lua: "lua",
	php: "php",
	vue: "html",
	svelte: "html",
	diff: "plaintext",
	patch: "plaintext",
	ini: "ini",
	env: "ini",
	tf: "plaintext",
	proto: "protobuf",
	zig: "plaintext",
	elixir: "plaintext",
	ex: "plaintext",
	erl: "plaintext",
	hs: "plaintext",
	scala: "scala",
	clj: "clojure",
	dart: "dart",
};

export function extFromFilename(filename: string): string {
	const lower = filename.toLowerCase();
	if (lower === "dockerfile" || lower.startsWith("dockerfile.")) {return "dockerfile";}
	if (lower === "makefile" || lower === "gnumakefile") {return "makefile";}
	if (lower === "cmakelists.txt") {return "cmake";}
	return lower.split(".").pop() ?? "";
}

export function monacoLangFromFilename(filename: string): string {
	const ext = extFromFilename(filename);
	return EXT_TO_MONACO_LANG[ext] ?? "plaintext";
}

export function displayLang(filename: string): string {
	const lang = monacoLangFromFilename(filename);
	if (lang === "plaintext") {
		const ext = extFromFilename(filename);
		return ext || "TEXT";
	}
	return lang;
}

let themesRegistered = false;

function registerThemes(monaco: typeof import("monaco-editor")) {
	if (themesRegistered) {return;}
	themesRegistered = true;

	monaco.editor.defineTheme("denchclaw-light", {
		base: "vs",
		inherit: true,
		rules: [],
		colors: {
			"editor.background": "#ffffff",
			"editor.foreground": "#1c1c1a",
			"editor.lineHighlightBackground": "#f5f4f1",
			"editor.selectionBackground": "#2563eb20",
			"editor.inactiveSelectionBackground": "#2563eb10",
			"editorLineNumber.foreground": "#8a8a82",
			"editorLineNumber.activeForeground": "#44443e",
			"editorIndentGuide.background": "#00000010",
			"editorIndentGuide.activeBackground": "#00000020",
			"editor.selectionHighlightBackground": "#2563eb12",
			"editorCursor.foreground": "#2563eb",
			"editorWhitespace.foreground": "#00000010",
			"editorBracketMatch.background": "#2563eb15",
			"editorBracketMatch.border": "#2563eb40",
			"editorGutter.background": "#ffffff",
			"editorWidget.background": "#ffffff",
			"editorWidget.border": "#00000014",
			"editorSuggestWidget.background": "#ffffff",
			"editorSuggestWidget.border": "#00000014",
			"editorSuggestWidget.selectedBackground": "#f5f4f1",
			"editorHoverWidget.background": "#ffffff",
			"editorHoverWidget.border": "#00000014",
			"input.background": "#f5f5f4",
			"input.border": "#00000014",
			"input.foreground": "#1c1c1a",
			"minimap.background": "#ffffff",
			"scrollbarSlider.background": "#00000012",
			"scrollbarSlider.hoverBackground": "#00000020",
			"scrollbarSlider.activeBackground": "#0000002a",
		},
	});

	monaco.editor.defineTheme("denchclaw-dark", {
		base: "vs-dark",
		inherit: true,
		rules: [],
		colors: {
			"editor.background": "#0c0c0b",
			"editor.foreground": "#ececea",
			"editor.lineHighlightBackground": "#1e1e1c",
			"editor.selectionBackground": "#3b82f630",
			"editor.inactiveSelectionBackground": "#3b82f618",
			"editorLineNumber.foreground": "#78776f",
			"editorLineNumber.activeForeground": "#b8b8b0",
			"editorIndentGuide.background": "#ffffff08",
			"editorIndentGuide.activeBackground": "#ffffff14",
			"editor.selectionHighlightBackground": "#3b82f618",
			"editorCursor.foreground": "#3b82f6",
			"editorWhitespace.foreground": "#ffffff08",
			"editorBracketMatch.background": "#3b82f620",
			"editorBracketMatch.border": "#3b82f650",
			"editorGutter.background": "#0c0c0b",
			"editorWidget.background": "#161615",
			"editorWidget.border": "#ffffff14",
			"editorSuggestWidget.background": "#161615",
			"editorSuggestWidget.border": "#ffffff14",
			"editorSuggestWidget.selectedBackground": "#1e1e1c",
			"editorHoverWidget.background": "#161615",
			"editorHoverWidget.border": "#ffffff14",
			"input.background": "#1e1e1c",
			"input.border": "#ffffff14",
			"input.foreground": "#ececea",
			"minimap.background": "#0c0c0b",
			"scrollbarSlider.background": "#ffffff12",
			"scrollbarSlider.hoverBackground": "#ffffff20",
			"scrollbarSlider.activeBackground": "#ffffff2a",
		},
	});
}

function isDarkMode(): boolean {
	if (typeof document === "undefined") {return false;}
	return document.documentElement.classList.contains("dark");
}

type CodeEditorProps = {
	content: string;
	filename: string;
	filePath?: string;
	className?: string;
	onDirty?: () => void;
};

export function MonacoCodeEditor({ content, filename, filePath, className, onDirty }: CodeEditorProps) {
	const ext = extFromFilename(filename);

	if (ext === "diff" || ext === "patch") {
		return (
			<div className="max-w-4xl mx-auto px-6 py-8">
				<DiffCard diff={content} />
			</div>
		);
	}

	return <EditorInner content={content} filename={filename} filePath={filePath} className={className} onDirty={onDirty} />;
}

type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";

function EditorInner({ content, filename, filePath, className, onDirty }: CodeEditorProps) {
	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
	const [theme, setTheme] = useState<string>(isDarkMode() ? "denchclaw-dark" : "denchclaw-light");
	const [saveState, setSaveState] = useState<SaveState>("clean");
	const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
	const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const currentContentRef = useRef(content);

	const language = monacoLangFromFilename(filename);
	const canSave = !!filePath;

	useEffect(() => {
		currentContentRef.current = content;
	}, [content]);

	// Watch for theme changes via MutationObserver on <html> class
	useEffect(() => {
		const html = document.documentElement;
		const update = () => setTheme(isDarkMode() ? "denchclaw-dark" : "denchclaw-light");
		const observer = new MutationObserver(update);
		observer.observe(html, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);

	const saveFile = useCallback(async () => {
		if (!filePath || !editorRef.current) {return;}
		const value = editorRef.current.getValue();
		setSaveState("saving");
		try {
			const res = await fetch(fileWriteUrl(filePath), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path: filePath, content: value }),
			});
			if (!res.ok) {throw new Error("Save failed");}
			currentContentRef.current = value;
			setSaveState("saved");
			if (saveTimeoutRef.current) {clearTimeout(saveTimeoutRef.current);}
			saveTimeoutRef.current = setTimeout(() => setSaveState("clean"), 2000);
		} catch {
			setSaveState("error");
			if (saveTimeoutRef.current) {clearTimeout(saveTimeoutRef.current);}
			saveTimeoutRef.current = setTimeout(() => setSaveState("dirty"), 3000);
		}
	}, [filePath]);

	const handleMount: OnMount = useCallback((ed, monaco) => {
		editorRef.current = ed;
		monacoRef.current = monaco;
		registerThemes(monaco);
		monaco.editor.setTheme(isDarkMode() ? "denchclaw-dark" : "denchclaw-light");

		// Cmd+S / Ctrl+S save
		ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
			void saveFile();
		});

		// Track cursor position
		ed.onDidChangeCursorPosition((e) => {
			setCursorPos({ line: e.position.lineNumber, col: e.position.column });
		});

		// Track dirty state
		ed.onDidChangeModelContent(() => {
			const current = ed.getValue();
			if (current !== currentContentRef.current) {
				setSaveState("dirty");
				onDirty?.();
			} else {
				setSaveState("clean");
			}
		});

		ed.focus();
	}, [saveFile, onDirty]);

	// Apply theme when it changes
	useEffect(() => {
		if (monacoRef.current) {
			monacoRef.current.editor.setTheme(theme);
		}
	}, [theme]);

	const lang = displayLang(filename);
	const lineCount = content.split("\n").length;

	return (
		<div className={`flex flex-col h-full ${className ?? ""}`}>
			{/* Header bar */}
			<div
				className="flex items-center gap-2 px-4 py-2 flex-shrink-0"
				style={{
					background: "var(--color-surface)",
					borderBottom: "1px solid var(--color-border)",
				}}
			>
				<svg
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					style={{ color: "var(--color-text-muted)", flexShrink: 0 }}
				>
					<polyline points="16 18 22 12 16 6" />
					<polyline points="8 6 2 12 8 18" />
				</svg>
				<span
					className="text-sm font-medium truncate"
					style={{ color: "var(--color-text)" }}
				>
					{filename}
				</span>

				{/* Dirty indicator */}
				{saveState === "dirty" && (
					<span
						className="w-2 h-2 rounded-full flex-shrink-0"
						style={{ background: "var(--color-text-muted)" }}
						title="Unsaved changes"
					/>
				)}

				<div className="flex-1" />

				{/* Language badge */}
				<span
					className="text-[11px] px-1.5 py-0.5 rounded font-medium"
					style={{
						background: "var(--color-surface-hover)",
						color: "var(--color-text-muted)",
					}}
				>
					{lang.toUpperCase()}
				</span>

				{/* Line count */}
				<span
					className="text-[11px] tabular-nums"
					style={{ color: "var(--color-text-muted)" }}
				>
					{lineCount} lines
				</span>

				{/* Cursor position */}
				<span
					className="text-[11px] tabular-nums"
					style={{ color: "var(--color-text-muted)" }}
				>
					Ln {cursorPos.line}, Col {cursorPos.col}
				</span>

				{/* Save status / button */}
				{canSave && (
					<>
						{saveState === "saving" && (
							<span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
								Saving...
							</span>
						)}
						{saveState === "saved" && (
							<span className="text-[11px]" style={{ color: "var(--color-success)" }}>
								Saved
							</span>
						)}
						{saveState === "error" && (
							<span className="text-[11px]" style={{ color: "var(--color-error)" }}>
								Save failed
							</span>
						)}
						<button
							type="button"
							onClick={() => void saveFile()}
							disabled={saveState !== "dirty"}
							className="text-[11px] px-2 py-0.5 rounded transition-colors"
							style={{
								background: saveState === "dirty" ? "var(--color-accent)" : "var(--color-surface-hover)",
								color: saveState === "dirty" ? "#fff" : "var(--color-text-muted)",
								cursor: saveState === "dirty" ? "pointer" : "default",
								opacity: saveState === "dirty" ? 1 : 0.5,
							}}
						>
							{saveState === "dirty" ? "Save" : "Save"}
						</button>
					</>
				)}
			</div>

			{/* Monaco Editor */}
			<div className="flex-1 min-h-0">
				<Editor
					defaultValue={content}
					language={language}
					theme={theme}
					onMount={handleMount}
					loading={
						<div
							className="flex items-center justify-center h-full"
							style={{ background: "var(--color-bg)" }}
						>
							<span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
								Loading editor...
							</span>
						</div>
					}
					options={{
						readOnly: !canSave,
						fontSize: 13,
						lineHeight: 20,
						fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
						fontLigatures: true,
						minimap: { enabled: true, scale: 1, showSlider: "mouseover" },
						scrollBeyondLastLine: true,
						smoothScrolling: true,
						cursorBlinking: "smooth",
						cursorSmoothCaretAnimation: "on",
						renderLineHighlight: "all",
						renderWhitespace: "selection",
						bracketPairColorization: { enabled: true },
						guides: {
							bracketPairs: true,
							indentation: true,
							highlightActiveIndentation: true,
						},
						stickyScroll: { enabled: true },
						folding: true,
						foldingHighlight: true,
						showFoldingControls: "mouseover",
						links: true,
						wordWrap: "off",
						padding: { top: 8, bottom: 8 },
						scrollbar: {
							verticalScrollbarSize: 10,
							horizontalScrollbarSize: 10,
							verticalSliderSize: 10,
							horizontalSliderSize: 10,
						},
						overviewRulerBorder: false,
						hideCursorInOverviewRuler: true,
						automaticLayout: true,
						tabSize: 2,
						insertSpaces: false,
						detectIndentation: true,
						formatOnPaste: false,
						formatOnType: false,
						suggestOnTriggerCharacters: true,
						quickSuggestions: true,
						contextmenu: true,
						mouseWheelZoom: true,
						find: {
							addExtraSpaceOnTop: false,
							autoFindInSelection: "multiline",
							seedSearchStringFromSelection: "selection",
						},
					}}
				/>
			</div>
		</div>
	);
}
