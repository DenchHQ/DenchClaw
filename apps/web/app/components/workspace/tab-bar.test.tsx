// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_TAB_ID, type Tab } from "@/lib/tab-state";

vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: () => function DynamicTabsMock(props: {
      tabs?: Array<{ id: string; title: string }>;
      onTabReorder?: (tabId: string, fromIndex: number, toIndex: number) => void;
    }) {
      return (
        <div data-testid="tabs-root">
          {(props.tabs ?? []).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="chrome-tab"
              data-tab-id={tab.id}
            >
              <span className="chrome-tab-title">{tab.title}</span>
            </button>
          ))}
          <button
            type="button"
            data-testid="reorder-trigger"
            onClick={() => props.onTabReorder?.(props.tabs?.[0]?.id ?? "", 0, 2)}
          >
            reorder
          </button>
        </div>
      );
    },
  };
});

import { TabBar } from "./tab-bar";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

function renderTabBar(tabs: Tab[], opts?: {
  onMakePermanent?: (tabId: string) => void;
  onReorder?: (tabId: string, fromIndex: number, toIndex: number) => void;
}) {
  render(
    <TabBar
      tabs={tabs}
      activeTabId={tabs[1]?.id ?? HOME_TAB_ID}
      onActivate={() => {}}
      onClose={() => {}}
      onCloseOthers={() => {}}
      onCloseToRight={() => {}}
      onCloseAll={() => {}}
      onReorder={opts?.onReorder ?? (() => {})}
      onTogglePin={() => {}}
      onMakePermanent={opts?.onMakePermanent}
    />,
  );
}

describe("TabBar preview interactions", () => {
  it("promotes a preview tab on double click", () => {
    const onMakePermanent = vi.fn();
    renderTabBar([
      { id: HOME_TAB_ID, type: "home", title: "Home", pinned: true },
      { id: "preview-1", type: "file", title: "Preview", path: "preview.md", preview: true },
    ], { onMakePermanent });

    fireEvent.doubleClick(screen.getByText("Preview"));

    expect(onMakePermanent).toHaveBeenCalledWith("preview-1");
  });

  it("does not promote permanent tabs on double click", () => {
    const onMakePermanent = vi.fn();
    renderTabBar([
      { id: HOME_TAB_ID, type: "home", title: "Home", pinned: true },
      { id: "perm-1", type: "file", title: "Permanent", path: "perm.md" },
    ], { onMakePermanent });

    fireEvent.doubleClick(screen.getByText("Permanent"));

    expect(onMakePermanent).not.toHaveBeenCalled();
  });

  it("reports the dragged tab id when reordering", () => {
    const onReorder = vi.fn();
    renderTabBar([
      { id: HOME_TAB_ID, type: "home", title: "Home", pinned: true },
      { id: "preview-1", type: "file", title: "Preview", path: "preview.md", preview: true },
      { id: "perm-1", type: "file", title: "Permanent", path: "perm.md" },
    ], { onReorder });

    fireEvent.click(screen.getByTestId("reorder-trigger"));

    expect(onReorder).toHaveBeenCalledWith("preview-1", 1, 2);
  });
});
