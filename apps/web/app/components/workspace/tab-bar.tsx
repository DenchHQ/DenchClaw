"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { type Tab, HOME_TAB_ID } from "@/lib/tab-state";
import dynamic from "next/dynamic";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "../ui/context-menu";

const Tabs = dynamic(
  () => import("@sinm/react-chrome-tabs").then((mod) => mod.Tabs),
  { ssr: false },
);

import { appServeUrl } from "./app-viewer";

type TabBarProps = {
  tabs: Tab[];
  activeTabId: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCloseOthers: (tabId: string) => void;
  onCloseToRight: (tabId: string) => void;
  onCloseAll: () => void;
  onReorder: (tabId: string, fromIndex: number, toIndex: number) => void;
  onTogglePin: (tabId: string) => void;
  onMakePermanent?: (tabId: string) => void;
  liveChatTabIds?: Set<string>;
  onStopTab?: (tabId: string) => void;
  onNewTab?: () => void;
  leftContent?: React.ReactNode;
  rightContent?: React.ReactNode;
};

function tabToFaviconClass(tab: Tab, isLive: boolean): string | undefined {
  switch (tab.type) {
    case "home": return "dench-favicon-home";
    case "chat": return isLive ? "dench-favicon-chat-live" : "dench-favicon-chat";
    case "app": return "dench-favicon-app";
    case "cron": return "dench-favicon-cron";
    case "object": return "dench-favicon-object";
    default: return "dench-favicon-file";
  }
}

function tabToFavicon(tab: Tab): string | boolean | undefined {
  if (tab.icon && tab.path && /\.(png|svg|jpe?g|webp)$/i.test(tab.icon)) {
    return appServeUrl(tab.path, tab.icon);
  }
  return false;
}

export function TabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onReorder,
  onTogglePin,
  onMakePermanent,
  liveChatTabIds,
  onStopTab,
  onNewTab,
  leftContent,
  rightContent,
}: TabBarProps) {
  const [contextTabId, setContextTabId] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rightClickTimeRef = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDark(document.documentElement.classList.contains("dark") || mq.matches);
    const handler = () => setIsDark(document.documentElement.classList.contains("dark") || mq.matches);
    mq.addEventListener("change", handler);
    const obs = new MutationObserver(handler);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => { mq.removeEventListener("change", handler); obs.disconnect(); };
  }, []);

  useEffect(() => {
    const blockRightClick = (e: PointerEvent | MouseEvent) => {
      if (e.button === 2) {
        const tab = (e.target as Element).closest?.(".chrome-tab");
        if (tab && wrapperRef.current?.contains(tab)) {
          e.stopImmediatePropagation();
          e.preventDefault();
          rightClickTimeRef.current = Date.now();
        }
      }
    };
    document.addEventListener("pointerdown", blockRightClick, true);
    document.addEventListener("mousedown", blockRightClick, true);
    return () => {
      document.removeEventListener("pointerdown", blockRightClick, true);
      document.removeEventListener("mousedown", blockRightClick, true);
    };
  }, []);

  const nonHomeTabs = useMemo(() => tabs.filter((t) => t.id !== HOME_TAB_ID), [tabs]);
  const previewTabIds = useMemo(
    () => new Set(nonHomeTabs.filter((tab) => tab.preview).map((tab) => tab.id)),
    [nonHomeTabs],
  );

  const chromeTabs = useMemo(() => {
    return nonHomeTabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      active: tab.id === activeTabId,
      favicon: tabToFavicon(tab),
      faviconClass: tabToFaviconClass(tab, liveChatTabIds?.has(tab.id) ?? false),
      isCloseIconVisible: !tab.pinned,
    }));
  }, [nonHomeTabs, activeTabId, liveChatTabIds]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const applyPreviewState = () => {
      const tabEls = wrapper.querySelectorAll<HTMLElement>(".chrome-tab[data-tab-id]");
      tabEls.forEach((tabEl) => {
        const tabId = tabEl.getAttribute("data-tab-id");
        if (tabId && previewTabIds.has(tabId)) {
          tabEl.setAttribute("data-preview", "true");
        } else {
          tabEl.removeAttribute("data-preview");
        }
      });
    };
    applyPreviewState();
    const rafId = window.requestAnimationFrame(applyPreviewState);
    return () => window.cancelAnimationFrame(rafId);
  }, [chromeTabs, previewTabIds]);

  const handleActive = useCallback((id: string) => {
    if (Date.now() - rightClickTimeRef.current < 200) return;
    onActivate(id);
  }, [onActivate]);
  const handleClose = useCallback((id: string) => onClose(id), [onClose]);
  const handleReorder = useCallback(
    (tabId: string, _fromIndex: number, toIndex: number) => {
      const fromIndex = tabs.findIndex((t) => t.id === tabId);
      if (fromIndex >= 0 && fromIndex !== toIndex) onReorder(tabId, fromIndex, toIndex);
    },
    [tabs, onReorder],
  );

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const tabEl = (e.target as Element).closest?.(".chrome-tab");
    if (!tabEl || !onMakePermanent) {
      return;
    }
    const tabId = tabEl.getAttribute("data-tab-id");
    if (!tabId || !previewTabIds.has(tabId)) {
      return;
    }
    onMakePermanent(tabId);
  }, [onMakePermanent, previewTabIds]);

  const handleWrapperContextMenu = useCallback((e: React.MouseEvent) => {
    const tabEl = (e.target as Element).closest?.(".chrome-tab");
    if (tabEl) {
      const tabId = tabEl.getAttribute("data-tab-id");
      if (tabId && tabId !== HOME_TAB_ID) {
        tabEl.setAttribute("data-context", "true");
        setContextTabId(tabId);
        return;
      }
    }
    e.preventDefault();
  }, []);

  if (tabs.length === 0) return null;

  const contextTab = contextTabId ? tabs.find((t) => t.id === contextTabId) : null;

  return (
    <ContextMenu onOpenChange={(open) => {
      if (!open) {
        wrapperRef.current?.querySelector("[data-context]")?.removeAttribute("data-context");
        setContextTabId(null);
      }
    }}>
      <ContextMenuTrigger asChild>
        <div
          ref={wrapperRef}
          className="dench-chrome-tabs-wrapper flex items-center shrink-0 relative"
          onContextMenu={handleWrapperContextMenu}
          onDoubleClick={handleDoubleClick}
        >
          {leftContent && (
            <div className="flex items-center px-1.5 shrink-0 z-10">
              {leftContent}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <Tabs
              darkMode={isDark}
              tabs={chromeTabs}
              draggable
              onTabActive={handleActive}
              onTabClose={handleClose}
              onTabReorder={handleReorder}
              pinnedRight={onNewTab ? (
                <button
                  type="button"
                  onClick={onNewTab}
                  className="flex items-center justify-center w-7 h-7 rounded-full shrink-0 cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5 ml-2"
                  style={{ color: "var(--color-text-muted)" }}
                  title="New chat"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14" /><path d="M5 12h14" />
                  </svg>
                </button>
              ) : undefined}
            />
          </div>
          {rightContent && (
            <div className="flex items-center gap-0.5 px-2 shrink-0 z-10">
              {rightContent}
            </div>
          )}
        </div>
      </ContextMenuTrigger>

      {contextTab && (
        <ContextMenuContent className="min-w-[180px]">
          <ContextMenuItem onSelect={() => onTogglePin(contextTab.id)}>
            {contextTab.pinned ? "Unpin Tab" : "Pin Tab"}
          </ContextMenuItem>
          {contextTab.type === "chat" && liveChatTabIds?.has(contextTab.id) && onStopTab && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onStopTab(contextTab.id)}>
                Stop Session
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={contextTab.pinned}
            onSelect={() => onClose(contextTab.id)}
          >
            Close
            <ContextMenuShortcut>⌘W</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCloseOthers(contextTab.id)}>
            Close Others
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCloseToRight(contextTab.id)}>
            Close to the Right
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCloseAll()}>
            Close All
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}
