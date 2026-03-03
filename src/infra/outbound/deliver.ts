/** Stub type for test setup; full implementation may live in upstream. */
export type OutboundSendDeps = {
  sendDiscord?: (to: string, text: string, opts?: { verbose?: boolean; mediaUrl?: string }) => Promise<{ channel?: string; messageId?: string }>;
  sendSlack?: (to: string, text: string, opts?: { verbose?: boolean; mediaUrl?: string }) => Promise<{ channel?: string; messageId?: string }>;
  sendTelegram?: (to: string, text: string, opts?: { verbose?: boolean; mediaUrl?: string }) => Promise<{ channel?: string; messageId?: string }>;
  sendWhatsApp?: (to: string, text: string, opts?: { verbose?: boolean; mediaUrl?: string }) => Promise<{ channel?: string; messageId?: string }>;
  sendSignal?: (to: string, text: string, opts?: { verbose?: boolean; mediaUrl?: string }) => Promise<{ channel?: string; messageId?: string }>;
  sendIMessage?: (to: string, text: string, opts?: { verbose?: boolean; mediaUrl?: string }) => Promise<{ channel?: string; messageId?: string }>;
};
