"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { IconType } from "react-icons";
import {
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiDatabase,
  FiLoader,
  FiMessageSquare,
  FiPlus,
  FiSearch,
  FiX,
  FiZap,
} from "react-icons/fi";
import { ComposioConnectModal } from "../integrations/composio-connect-modal";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import type {
  ComposioConnection,
  ComposioConnectionsResponse,
  ComposioToolkit,
} from "@/lib/composio";
import {
  extractComposioConnections,
  normalizeComposioConnections,
  normalizeComposioToolkitSlug,
} from "@/lib/composio-client";
import {
  createComposioToolkitPlaceholder,
  useComposioToolkitBrand,
} from "@/lib/composio-toolkit-brand";
import {
  SKILL_TEMPLATES,
  SKILL_TEMPLATE_CATEGORIES,
  type SkillTemplate,
  type SkillTemplateApp,
  type SkillTemplateCategory,
  type SkillTemplateId,
} from "@/lib/skill-templates";
import { SkillTemplateCard } from "./skill-template-card";

type SkillTemplateGalleryMode = "onboarding" | "dashboard";

type SkillTemplateGalleryProps = {
  selectedTemplateId?: SkillTemplateId;
  onSelectTemplate: (templateId: SkillTemplateId) => void;
  mode?: SkillTemplateGalleryMode;
  className?: string;
  title?: string;
  description?: string;
  actionLabel?: string;
};

function templateMatches(template: SkillTemplate, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    template.title,
    template.summary,
    template.category,
    template.outcome,
    template.autonomy,
    template.userUseCase,
    ...template.personas,
    ...template.triggerModes,
    ...template.requiredApps.map((app) => app.name),
    ...template.interviewQuestions.map((question) => question.prompt),
    ...template.interviewQuestions.flatMap((question) =>
      question.options?.map((option) => `${option.label} ${option.description ?? ""}`) ?? [],
    ),
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function badgeText(mode: SkillTemplate["triggerModes"][number]): string {
  return mode === "scheduled" ? "Cron" : "Manual";
}

type WorkflowPreviewStep = {
  id: string;
  eyebrow: string;
  label: string;
  Icon: IconType;
};

function DefaultHeader({ mode }: { mode: SkillTemplateGalleryMode }) {
  const copy =
    mode === "dashboard"
      ? {
          title: "Start from a template.",
          description:
            "Pick a proven workflow and DenchClaw will open a chat to shape it into your own reusable skill.",
        }
      : {
          title: "Choose your first skill.",
          description:
            "Pick one concrete workflow. DenchClaw will interview you, then turn your answers into a reusable skill.",
        };

  return (
    <div>
      <h1
        className="font-instrument text-[34px] leading-[1.1] tracking-tight"
        style={{ color: "var(--color-text)" }}
      >
        {copy.title}
      </h1>
      <p
        className="mt-3 max-w-2xl text-[13.5px] leading-relaxed"
        style={{ color: "var(--color-text-muted)" }}
      >
        {copy.description}
      </p>
    </div>
  );
}

function outputLabel(template: SkillTemplate): string {
  switch (template.autonomy) {
    case "Creates drafts":
      return "Draft ready";
    case "Updates CRM":
      return "CRM updated";
    case "Can automate":
      return "Guardrailed action";
  }
}

function contextLabel(template: SkillTemplate): string {
  switch (template.category) {
    case "Find Leads":
      return "ICP + lead source";
    case "Follow Up":
      return "Thread + timing";
    case "Keep CRM Clean":
      return "Records + gaps";
    case "Prep Meetings":
      return "Calendar + context";
    case "Research Anything":
      return "Signals + CRM";
    case "Hire People":
      return "Role + pipeline";
    case "Grow Customers":
      return "Accounts + risks";
    case "Run Founder Ops":
      return "Sources + cadence";
  }
}

function buildWorkflowPreviewSteps(template: SkillTemplate): WorkflowPreviewStep[] {
  const triggerLabel = template.triggerModes.includes("scheduled")
    ? "Cron or manual"
    : "Manual start";

  return [
    {
      id: "trigger",
      eyebrow: "Trigger",
      label: triggerLabel,
      Icon: template.triggerModes.includes("scheduled") ? FiClock : FiZap,
    },
    {
      id: "context",
      eyebrow: "Context",
      label: contextLabel(template),
      Icon: template.category === "Prep Meetings" ? FiCalendar : FiDatabase,
    },
    {
      id: "agent",
      eyebrow: "Agent",
      label: "Interview + enrich",
      Icon: FiMessageSquare,
    },
    {
      id: "output",
      eyebrow: "Output",
      label: outputLabel(template),
      Icon: FiCheckCircle,
    },
  ];
}

function WorkflowAnimationNode({
  step,
  index,
}: {
  step: WorkflowPreviewStep;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.08, duration: 0.28, ease: "easeOut" }}
      className="absolute flex w-[138px] items-center gap-2 rounded-2xl border p-2.5 shadow-sm backdrop-blur-sm"
      style={{
        left: `${index % 2 === 0 ? 6 : 47}%`,
        top: `${8 + index * 23}%`,
        borderColor: "var(--color-border)",
        background: "color-mix(in srgb, var(--color-surface-raised) 92%, transparent)",
        color: "var(--color-text)",
      }}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
        style={{
          background:
            index === 2
              ? "color-mix(in srgb, var(--color-accent) 15%, transparent)"
              : "color-mix(in srgb, var(--color-text) 8%, transparent)",
          color: index === 2 ? "var(--color-accent)" : "var(--color-text-muted)",
        }}
      >
        <step.Icon aria-hidden="true" className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span
          className="block text-[9px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: "var(--color-text-muted)" }}
        >
          {step.eyebrow}
        </span>
        <span className="block truncate text-[11.5px] font-medium leading-tight">
          {step.label}
        </span>
      </span>
    </motion.div>
  );
}

function WorkflowAnimation({
  template,
  className,
}: {
  template: SkillTemplate;
  className?: string;
}) {
  const shouldReduceMotion = useReducedMotion();
  const steps = useMemo(() => buildWorkflowPreviewSteps(template), [template]);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border ${
        className ?? "mt-5 h-[284px]"
      }`}
      aria-label={`${template.title} workflow preview`}
      role="img"
      style={{
        borderColor: "var(--color-border)",
        background:
          "radial-gradient(circle at 18% 18%, color-mix(in srgb, var(--color-accent) 15%, transparent), transparent 30%), var(--color-background)",
      }}
    >
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(color-mix(in srgb, var(--color-text) 14%, transparent) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 300 284"
        preserveAspectRatio="none"
      >
        <path
          d="M84 52 C164 58 164 108 217 119 S164 184 84 188 S164 248 217 251"
          fill="none"
          stroke="color-mix(in srgb, var(--color-border) 85%, transparent)"
          strokeWidth="2"
        />
        <motion.path
          key={template.id}
          d="M84 52 C164 58 164 108 217 119 S164 184 84 188 S164 248 217 251"
          fill="none"
          stroke="var(--color-accent)"
          strokeLinecap="round"
          strokeWidth="2.5"
          initial={{ pathLength: 0, opacity: 0.2 }}
          animate={
            shouldReduceMotion
              ? { pathLength: 1, opacity: 0.55 }
              : { pathLength: [0, 1, 1], opacity: [0.25, 0.75, 0.25] }
          }
          transition={
            shouldReduceMotion
              ? { duration: 0.01 }
              : { duration: 3.2, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.4 }
          }
        />
      </svg>

      <AnimatePresence mode="wait">
        <motion.div
          key={template.id}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {steps.map((step, index) => (
            <WorkflowAnimationNode key={step.id} step={step} index={index} />
          ))}
        </motion.div>
      </AnimatePresence>

      {!shouldReduceMotion && (
        <motion.span
          aria-hidden="true"
          key={`${template.id}-pulse`}
          className="absolute h-2.5 w-2.5 rounded-full shadow-[0_0_18px_var(--color-accent)]"
          style={{ background: "var(--color-accent)" }}
          initial={{ left: "25%", top: "17%", opacity: 0 }}
          animate={{
            left: ["25%", "70%", "28%", "70%"],
            top: ["17%", "39%", "63%", "84%"],
            opacity: [0, 1, 1, 0],
          }}
          transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.4 }}
        />
      )}
    </div>
  );
}

type ConnectionChangePayload = {
  toolkit?: ComposioToolkit | null;
  connected?: boolean;
  connectedToolkitSlug?: string | null;
  connectedToolkitName?: string | null;
  shouldProbeLiveAgent?: boolean;
};

type TemplateConnectionState = {
  connections: ComposioConnection[];
  toolkits: ComposioToolkit[];
  loading: boolean;
  error: string | null;
};

function AppLogo({
  toolkit,
  app,
  size = "md",
}: {
  toolkit: ComposioToolkit;
  app: SkillTemplateApp;
  size?: "sm" | "md";
}) {
  const [failed, setFailed] = useState(false);
  const brand = useComposioToolkitBrand({
    toolkitSlug: toolkit.slug,
    toolkitName: app.name,
    initialLogo: toolkit.logo,
  });
  const showImg = brand.logo && !failed;
  const dimension = size === "sm" ? "h-7 w-7 rounded-lg" : "h-10 w-10 rounded-xl";

  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden ${dimension}`}
      style={{
        background: "var(--color-background)",
        border: "1px solid var(--color-border)",
      }}
    >
      {showImg ? (
        <img
          src={brand.logo ?? undefined}
          alt=""
          className={size === "sm" ? "h-[18px] w-[18px] object-contain" : "h-6 w-6 object-contain"}
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className={size === "sm" ? "text-[10px] font-bold" : "text-xs font-bold"}
          style={{ color: "var(--color-text-muted)" }}
        >
          {app.name.slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function RequiredAppConnectionRow({
  app,
  toolkit,
  activeConnections,
  loading,
  index,
  onConnect,
}: {
  app: SkillTemplateApp;
  toolkit: ComposioToolkit;
  activeConnections: number;
  loading: boolean;
  index: number;
  onConnect: () => void;
}) {
  const connected = activeConnections > 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        delay: 0.08 + index * 0.05,
        type: "spring",
        stiffness: 420,
        damping: 32,
      }}
      className="group flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 transition-colors"
      style={{
        borderColor: connected
          ? "color-mix(in srgb, var(--color-success, #34C759) 28%, var(--color-border))"
          : "var(--color-border)",
        background: connected
          ? "color-mix(in srgb, var(--color-success, #34C759) 8%, var(--color-background))"
          : "var(--color-background)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <AppLogo app={app} toolkit={toolkit} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold" style={{ color: "var(--color-text)" }}>
            {app.name}
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
            {connected ? `${activeConnections} account connected` : "Connect account"}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onConnect}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold transition-all active:scale-[0.98] disabled:opacity-50"
        disabled={loading}
        style={{
          background: connected ? "var(--color-surface-hover)" : "var(--color-accent)",
          color: connected ? "var(--color-accent)" : "#fff",
        }}
      >
        {loading ? (
          <FiLoader aria-hidden="true" className="h-3 w-3 animate-spin" />
        ) : connected ? (
          <FiCheckCircle aria-hidden="true" className="h-3 w-3" />
        ) : (
          <FiPlus aria-hidden="true" className="h-3 w-3" />
        )}
        {connected ? "Manage" : "Connect"}
      </button>
    </motion.div>
  );
}

function TemplateSetupModal({
  template,
  open,
  onOpenChange,
  onStart,
}: {
  template: SkillTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (templateId: SkillTemplateId) => void;
}) {
  const [state, setState] = useState<TemplateConnectionState>({
    connections: [],
    toolkits: [],
    loading: false,
    error: null,
  });
  const [optimisticToolkits, setOptimisticToolkits] = useState<ComposioToolkit[]>([]);
  const [selectedToolkit, setSelectedToolkit] = useState<ComposioToolkit | null>(null);
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  const refreshConnections = useCallback(async (options?: { fresh?: boolean }) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch(
        `/api/composio/connections?include_toolkits=1${options?.fresh ? "&fresh=1" : ""}`,
      );
      const payload = (await response.json().catch(() => ({}))) as
        ComposioConnectionsResponse & { error?: string; toolkits?: ComposioToolkit[] };
      if (!response.ok) {
        throw new Error(
          payload.error
            ?? `Failed to load connected apps (${response.status})`,
        );
      }
      setState({
        connections: extractComposioConnections(payload),
        toolkits: payload.toolkits ?? [],
        loading: false,
        error: null,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load connected apps.",
      }));
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setSelectedToolkit(null);
      setConnectModalOpen(false);
      return;
    }
    void refreshConnections({ fresh: true });
  }, [open, refreshConnections]);

  const normalizedConnections = useMemo(
    () => normalizeComposioConnections(state.connections),
    [state.connections],
  );

  const connectionsByToolkit = useMemo(() => {
    const map = new Map<string, typeof normalizedConnections>();
    for (const connection of normalizedConnections) {
      const bucket = map.get(connection.normalized_toolkit_slug);
      if (bucket) {
        bucket.push(connection);
      } else {
        map.set(connection.normalized_toolkit_slug, [connection]);
      }
    }
    return map;
  }, [normalizedConnections]);

  const toolkitLookup = useMemo(() => {
    const map = new Map<string, ComposioToolkit>();
    for (const toolkit of [...state.toolkits, ...optimisticToolkits]) {
      map.set(normalizeComposioToolkitSlug(toolkit.slug), toolkit);
    }
    return map;
  }, [optimisticToolkits, state.toolkits]);

  const requiredApps = useMemo(() => {
    if (!template) {
      return [];
    }
    return template.requiredApps.map((app) => {
      const slug = normalizeComposioToolkitSlug(app.slug);
      const toolkit =
        toolkitLookup.get(slug) ?? createComposioToolkitPlaceholder(slug, app.name);
      const connections = connectionsByToolkit.get(slug) ?? [];
      const activeConnections = connections.filter((connection) => connection.is_active);
      return { app, toolkit, connections, activeConnections };
    });
  }, [connectionsByToolkit, template, toolkitLookup]);

  const connectedCount = requiredApps.filter((app) => app.activeConnections.length > 0).length;
  const allConnected = requiredApps.length === 0 || connectedCount === requiredApps.length;

  const selectedConnections = selectedToolkit
    ? connectionsByToolkit.get(normalizeComposioToolkitSlug(selectedToolkit.slug)) ?? []
    : [];

  const handleOpenConnectModal = useCallback((toolkit: ComposioToolkit) => {
    setSelectedToolkit(toolkit);
    setConnectModalOpen(true);
  }, []);

  const handleConnectionChange = useCallback((payload?: ConnectionChangePayload) => {
    if (payload?.connected && payload.connectedToolkitSlug && payload.connectedToolkitName) {
      setOptimisticToolkits((prev) => {
        const normalizedSlug = normalizeComposioToolkitSlug(payload.connectedToolkitSlug ?? "");
        return [
          ...prev.filter(
            (toolkit) => normalizeComposioToolkitSlug(toolkit.slug) !== normalizedSlug,
          ),
          createComposioToolkitPlaceholder(normalizedSlug, payload.connectedToolkitName),
        ];
      });
    }
    void refreshConnections({ fresh: true });
    if (payload?.connected) {
      window.setTimeout(() => {
        void refreshConnections({ fresh: true });
      }, 1500);
    }
  }, [refreshConnections]);

  const handleStart = useCallback(() => {
    if (!template) {
      return;
    }
    onOpenChange(false);
    onStart(template.id);
  }, [onOpenChange, onStart, template]);

  if (!template) {
    return null;
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden border-none p-0 shadow-2xl sm:max-w-5xl"
          style={{
            background: "var(--color-background)",
            color: "var(--color-text)",
          }}
        >
          <motion.div
            key={template.id}
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 480, damping: 36 }}
            className="relative flex min-h-[620px] flex-col overflow-hidden rounded-3xl md:flex-row"
          >
            <DialogClose
              type="button"
              className="absolute right-5 top-5 z-20 rounded-full p-2 transition-colors hover:bg-[var(--color-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              aria-label="Close template setup"
            >
              <FiX className="h-4 w-4" style={{ color: "var(--color-text-muted)" }} />
            </DialogClose>

            <section
              className="flex min-w-0 flex-1 flex-col border-b p-6 md:max-w-[410px] md:border-b-0 md:border-r md:p-8"
              style={{ borderColor: "var(--color-border)" }}
            >
              <DialogHeader className="space-y-0 pr-10">
                <p
                  className="text-[11px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Template setup
                </p>
                <DialogTitle className="mt-3 font-instrument text-[34px] leading-[0.98] tracking-tight md:text-[40px]">
                  {template.title}
                </DialogTitle>
                <DialogDescription className="mt-4 max-w-sm text-[13.5px] font-medium leading-relaxed">
                  {template.summary}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-5 flex flex-wrap gap-1.5">
                <TemplateBadge>{template.category}</TemplateBadge>
                {template.personas.slice(0, 2).map((persona) => (
                  <TemplateBadge key={persona}>{persona}</TemplateBadge>
                ))}
                {template.triggerModes.map((mode) => (
                  <TemplateBadge key={mode}>{badgeText(mode)}</TemplateBadge>
                ))}
                <TemplateBadge>{template.autonomy}</TemplateBadge>
              </div>

              <div className="flex flex-1 flex-col justify-center py-8">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[15px] font-semibold" style={{ color: "var(--color-text)" }}>
                      Connect required apps
                    </h3>
                    <p className="mt-1 text-[12px]" style={{ color: "var(--color-text-muted)" }}>
                      {requiredApps.length === 0
                        ? "No external apps needed"
                        : `${connectedCount}/${requiredApps.length} connected`}
                    </p>
                  </div>
                  {allConnected && (
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                      style={{
                        background:
                          "color-mix(in srgb, var(--color-success, #34C759) 12%, transparent)",
                        color: "var(--color-success, #34C759)",
                      }}
                    >
                      Ready
                    </span>
                  )}
                </div>

                <div className="space-y-2.5">
                  {requiredApps.length === 0 ? (
                    <p
                      className="rounded-2xl border px-3 py-3 text-[12.5px] leading-relaxed"
                      style={{
                        borderColor: "var(--color-border)",
                        background: "var(--color-background)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      This template uses Dench-native CRM, enrichment, web search,
                      files, and workspace context by default.
                    </p>
                  ) : (
                    requiredApps.map(({ app, toolkit, activeConnections }, index) => (
                      <RequiredAppConnectionRow
                        key={app.slug}
                        app={app}
                        toolkit={toolkit}
                        activeConnections={activeConnections.length}
                        loading={state.loading}
                        index={index}
                        onConnect={() => handleOpenConnectModal(toolkit)}
                      />
                    ))
                  )}
                </div>

                {state.error && (
                  <p
                    className="mt-4 rounded-2xl border px-3 py-2 text-[12px] leading-relaxed"
                    style={{
                      borderColor: "color-mix(in srgb, var(--color-error, #ef4444) 28%, transparent)",
                      background: "color-mix(in srgb, var(--color-error, #ef4444) 8%, transparent)",
                      color: "var(--color-error, #ef4444)",
                    }}
                  >
                    {state.error}
                  </p>
                )}
              </div>

              <div className="mt-auto flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={!allConnected}
                  className="h-9 rounded-full px-4 text-[13px] font-bold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
                  style={{
                    background: "var(--color-accent)",
                    color: "#fff",
                  }}
                >
                  Continue
                </button>
              </div>
            </section>

            <section
              className="relative flex min-h-[420px] flex-[1.25] flex-col justify-center overflow-hidden p-5 md:p-8"
              style={{
                background:
                  "linear-gradient(135deg, color-mix(in srgb, var(--color-surface-hover) 92%, transparent), var(--color-background))",
              }}
            >
              <div className="mb-5 max-w-md">
                <p
                  className="text-[11px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Workflow preview
                </p>
                <h3
                  className="mt-2 font-instrument text-[26px] leading-tight tracking-tight"
                  style={{ color: "var(--color-text)" }}
                >
                  See the agent path before you create it.
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  {template.outcome}
                </p>
              </div>
              <WorkflowAnimation template={template} className="h-[330px] md:h-[430px]" />
            </section>
          </motion.div>
        </DialogContent>
      </Dialog>

      <ComposioConnectModal
        toolkit={selectedToolkit}
        connections={selectedConnections}
        open={connectModalOpen}
        onOpenChange={setConnectModalOpen}
        onConnectionChange={handleConnectionChange}
      />
    </>
  );
}

function TemplateBadge({ children }: { children: ReactNode }) {
  return (
    <span
      className="rounded-full px-2 py-1 text-[10.5px] font-medium"
      style={{
        background: "color-mix(in srgb, var(--color-text) 8%, transparent)",
        color: "var(--color-text-muted)",
      }}
    >
      {children}
    </span>
  );
}

export function SkillTemplateGallery({
  selectedTemplateId,
  onSelectTemplate,
  mode = "dashboard",
  className,
  title,
  description,
  actionLabel = "Use",
}: SkillTemplateGalleryProps) {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] =
    useState<SkillTemplateCategory | null>(null);
  const [setupTemplate, setSetupTemplate] = useState<SkillTemplate | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const filteredTemplates = useMemo(() => {
    return SKILL_TEMPLATES.filter((template) => {
      const matchesCategory = selectedCategory
        ? template.category === selectedCategory
        : true;
      return matchesCategory && templateMatches(template, query);
    });
  }, [query, selectedCategory]);

  const handleInteraction = () => {
    window.setTimeout(() => {
      gridRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 100);
  };

  const handleCategoryClick = (category: SkillTemplateCategory | null) => {
    setSelectedCategory((current) => (current === category ? null : category));
    handleInteraction();
  };

  return (
    <section className={className ? `w-full space-y-6 ${className}` : "w-full space-y-6"}>
      {title || description ? (
        <div>
          {title && (
            <h1
              className="font-instrument text-[34px] leading-[1.1] tracking-tight"
              style={{ color: "var(--color-text)" }}
            >
              {title}
            </h1>
          )}
          {description && (
            <p
              className="mt-3 max-w-2xl text-[13.5px] leading-relaxed"
              style={{ color: "var(--color-text-muted)" }}
            >
              {description}
            </p>
          )}
        </div>
      ) : (
        <DefaultHeader mode={mode} />
      )}

      <div className="flex min-h-10 items-center gap-2 overflow-x-auto py-1">
        <div className="group relative shrink-0">
          <FiSearch
            aria-hidden="true"
            className="absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 transition-colors"
            style={{ color: "var(--color-text-muted)" }}
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={handleInteraction}
            aria-label="Search templates"
            placeholder="Search templates..."
            className="h-8 w-48 rounded-full border bg-transparent pl-8 pr-3 text-[13px] outline-none transition-[border-color,box-shadow]"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
            }}
          />
        </div>

        <div
          className="h-4 w-px shrink-0"
          style={{ background: "var(--color-border)" }}
        />

        <button
          type="button"
          onClick={() => handleCategoryClick(null)}
          aria-pressed={selectedCategory === null}
          className="shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors"
          style={{
            borderColor:
              selectedCategory === null ? "var(--color-border)" : "transparent",
            background:
              selectedCategory === null
                ? "var(--color-surface-hover)"
                : "transparent",
            color:
              selectedCategory === null
                ? "var(--color-text)"
                : "var(--color-text-muted)",
          }}
        >
          All
        </button>

        {SKILL_TEMPLATE_CATEGORIES.map((category) => {
          const active = selectedCategory === category;
          return (
            <button
              key={category}
              type="button"
              onClick={() => handleCategoryClick(category)}
              aria-pressed={active}
              className="shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--color-surface-hover)]"
              style={{
                borderColor: active ? "var(--color-border)" : "transparent",
                background: active ? "var(--color-surface-hover)" : "transparent",
                color: active ? "var(--color-text)" : "var(--color-text-muted)",
              }}
            >
              {category}
            </button>
          );
        })}
      </div>

      <div
        ref={gridRef}
        className="grid scroll-mt-24 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {filteredTemplates.map((template) => (
          <SkillTemplateCard
            key={template.id}
            template={template}
            selected={template.id === selectedTemplateId}
            onSelect={() => setSetupTemplate(template)}
            actionLabel={actionLabel}
          />
        ))}

        {filteredTemplates.length === 0 && (
          <div
            className="rounded-2xl border px-4 py-10 text-center text-[13px] md:col-span-2 xl:col-span-3"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text-muted)",
            }}
          >
            No templates found matching your criteria.
          </div>
        )}
      </div>

      <TemplateSetupModal
        template={setupTemplate}
        open={setupTemplate !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSetupTemplate(null);
          }
        }}
        onStart={onSelectTemplate}
      />
    </section>
  );
}
