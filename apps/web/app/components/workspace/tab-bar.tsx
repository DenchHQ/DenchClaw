"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { type Tab, HOME_TAB_ID } from "@/lib/tab-state";
import { appServeUrl } from "./app-viewer";

type TabBarProps = {
  tabs: Tab[];
  activeTabId: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCloseOthers: (tabId: string) => void;
  onCloseToRight: (tabId: string) => void;
  onCloseAll: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onTogglePin: (tabId: string) => void;
  onNewTab?: () => void;
  leftContent?: React.ReactNode;
  rightContent?: React.ReactNode;
};

type ContextMenuState = {
  tabId: string;
  x: number;
  y: number;
} | null;

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
  onNewTab,
  leftContent,
  rightContent,
}: TabBarProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ tabId, x: e.clientX, y: e.clientY });
  }, []);

  const handleMiddleClick = useCallback((e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      onClose(tabId);
    }
  }, [onClose]);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== toIndex) {
      onReorder(dragIndex, toIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex, onReorder]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  if (tabs.length === 0) return null;

  const contextTab = contextMenu ? tabs.find((t) => t.id === contextMenu.tabId) : null;

  return (
    <>
      <div
        className="flex items-stretch shrink-0 h-[36px] relative"
        style={{
          background: "var(--color-bg)",
        }}
      >
        <div
          ref={scrollRef}
          className="flex items-stretch overflow-x-auto flex-1 min-w-0"
          style={{ scrollbarWidth: "none" }}
        >
        {leftContent && (
          <div className="flex items-center px-1.5 shrink-0">
            {leftContent}
          </div>
        )}
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isDragOver = dragOverIndex === index && dragIndex !== index;
          const isHome = tab.id === HOME_TAB_ID;
          return (
            <button
              key={tab.id}
              type="button"
              draggable={!isHome}
              onClick={() => onActivate(tab.id)}
              onMouseDown={isHome ? undefined : (e) => handleMiddleClick(e, tab.id)}
              onContextMenu={isHome ? undefined : (e) => handleContextMenu(e, tab.id)}
              onDragStart={isHome ? undefined : (e) => handleDragStart(e, index)}
              onDragOver={isHome ? undefined : (e) => handleDragOver(e, index)}
              onDrop={isHome ? undefined : (e) => handleDrop(e, index)}
              onDragEnd={isHome ? undefined : handleDragEnd}
              className={`group flex items-center gap-1.5 text-[12.5px] font-medium cursor-pointer shrink-0 relative transition-colors duration-75 select-none border-none outline-none ${isHome ? "px-2.5" : "pl-3 pr-1.5"} ${isActive ? "chrome-tab-active rounded-t-[8px] z-2" : "z-1"}`}
              style={{
                color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
                background: isActive ? "var(--color-surface)" : "transparent",
                borderLeft: isDragOver && !isHome ? "2px solid var(--color-accent)" : undefined,
                opacity: dragIndex === index ? 0.5 : 1,
                maxWidth: isHome ? undefined : 200,
              }}
              title={isHome ? "Home (New Chat)" : undefined}
            >
              {isHome ? (
                <HomeIcon />
              ) : (
                <>
                  {tab.pinned && <PinIcon />}
                  <TabIcon type={tab.type} icon={tab.icon} appPath={tab.path} />
                  <span className="truncate max-w-[140px]">{tab.title}</span>
                  {!tab.pinned && (
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onClose(tab.id); } }}
                      className="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      style={{ color: "var(--color-text-muted)" }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                      }}
                    >
                      <CloseIcon />
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
        {onNewTab && (
          <button
            type="button"
            onClick={onNewTab}
            className="flex items-center justify-center w-7 h-7 rounded-md shrink-0 self-center cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "var(--color-text-muted)" }}
            title="New chat"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" /><path d="M5 12h14" />
            </svg>
          </button>
        )}
        </div>
        {rightContent && (
          <div className="relative flex items-center gap-0.5 px-2 shrink-0">
            {rightContent}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && contextTab && (
        <div
          className="fixed z-[9999] min-w-[180px] rounded-2xl p-1 bg-neutral-100/[0.67] dark:bg-neutral-900/[0.67] border border-white dark:border-white/10 backdrop-blur-md shadow-[0_0_25px_0_rgba(0,0,0,0.16)]"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          <ContextMenuItem
            label={contextTab.pinned ? "Unpin Tab" : "Pin Tab"}
            onClick={() => { onTogglePin(contextMenu.tabId); setContextMenu(null); }}
          />
          <div className="h-px my-0.5 mx-1 bg-neutral-400/15" />
          <ContextMenuItem
            label="Close"
            shortcut="⌘W"
            disabled={contextTab.pinned}
            onClick={() => { onClose(contextMenu.tabId); setContextMenu(null); }}
          />
          <ContextMenuItem
            label="Close Others"
            onClick={() => { onCloseOthers(contextMenu.tabId); setContextMenu(null); }}
          />
          <ContextMenuItem
            label="Close to the Right"
            onClick={() => { onCloseToRight(contextMenu.tabId); setContextMenu(null); }}
          />
          <ContextMenuItem
            label="Close All"
            onClick={() => { onCloseAll(); setContextMenu(null); }}
          />
        </div>
      )}
    </>
  );
}

function ContextMenuItem({
  label,
  shortcut,
  disabled,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full flex items-center justify-between px-2.5 py-1.5 text-[12.5px] text-left rounded-xl transition-all disabled:opacity-40 hover:bg-neutral-400/15"
      style={{ color: "var(--color-text)" }}
    >
      <span>{label}</span>
      {shortcut && (
        <span className="ml-4 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          {shortcut}
        </span>
      )}
    </button>
  );
}

function TabIcon({ type, icon, appPath }: { type: string; icon?: string; appPath?: string }) {
  if (icon && appPath && (icon.endsWith(".png") || icon.endsWith(".svg") || icon.endsWith(".jpg") || icon.endsWith(".jpeg") || icon.endsWith(".webp"))) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={appServeUrl(appPath, icon)}
        alt=""
        width={14}
        height={14}
        className="rounded-sm flex-shrink-0"
        style={{ objectFit: "cover" }}
      />
    );
  }

  switch (type) {
    case "home":
      return <HomeIcon />;
    case "app":
      return <AppIcon />;
    case "chat":
      return <ChatIcon />;
    case "cron":
      return <CronIcon />;
    case "object":
      return <ObjectIcon />;
    default:
      return <FileIcon />;
  }
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="flex-shrink-0" style={{ opacity: 0.5 }}>
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0" style={{ opacity: 0.7 }}>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0" style={{ opacity: 0.6 }}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

function AppIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0" style={{ opacity: 0.6 }}>
      <rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0" style={{ opacity: 0.6 }}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CronIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0" style={{ opacity: 0.6 }}>
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ObjectIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0" style={{ opacity: 0.6 }}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" /><path d="M9 21V9" />
    </svg>
  );
}
