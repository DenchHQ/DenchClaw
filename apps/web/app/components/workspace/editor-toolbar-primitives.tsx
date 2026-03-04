"use client";

import type React from "react";

export function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="editor-toolbar-group">{children}</div>;
}

export function ToolbarDivider() {
  return <div className="editor-toolbar-divider" />;
}

export function ToolbarButton({
  active,
  onClick,
  title,
  children,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`editor-toolbar-btn ${active ? "editor-toolbar-btn-active" : ""}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function BubbleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`bubble-menu-btn ${active ? "bubble-menu-btn-active" : ""}`}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
