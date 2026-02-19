import type { PluginRuntime } from "openclaw/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NostrBusHandle, NostrBusOptions } from "./nostr-bus.js";

const { startNostrBusMock, getNostrRuntimeMock } = vi.hoisted(() => ({
  startNostrBusMock: vi.fn(),
  getNostrRuntimeMock: vi.fn(),
}));

vi.mock("./nostr-bus.js", async () => {
  const actual = await vi.importActual<typeof import("./nostr-bus.js")>("./nostr-bus.js");
  return {
    ...actual,
    startNostrBus: startNostrBusMock,
  };
});

vi.mock("./runtime.js", () => ({
  getNostrRuntime: getNostrRuntimeMock,
}));

import { nostrPlugin } from "./channel.js";

const TEST_PRIVATE_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_PUBLIC_KEY = "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const SENDER_PUBKEY = "1234512345123451234512345123451234512345123451234512345123451234";

function createRuntimeMock() {
  const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async ({ dispatcherOptions }) => {
    await dispatcherOptions.deliver({ text: "agent reply" });
    return {
      queuedFinal: true,
      counts: {
        block: 0,
        tool: 0,
        final: 1,
      },
    };
  });

  const runtime = {
    config: {
      loadConfig: vi.fn(() => ({})),
      writeConfigFile: vi.fn(async () => {}),
    },
    channel: {
      text: {
        resolveMarkdownTableMode: vi.fn(() => "off"),
        convertMarkdownTables: vi.fn((value: string) => value),
      },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher,
        finalizeInboundContext: vi.fn((ctx: Record<string, unknown>) => ({
          ...ctx,
          BodyForCommands: String(ctx.CommandBody ?? ""),
          CommandAuthorized: false,
        })),
      },
      routing: {
        resolveAgentRoute: vi.fn(() => ({
          agentId: "default",
          channel: "nostr",
          accountId: "default",
          sessionKey: "agent.default/main/nostr/direct:sender",
          mainSessionKey: "agent.default/main",
          matchedBy: "default" as const,
        })),
      },
    },
  };

  return {
    runtime: runtime as unknown as PluginRuntime,
    dispatchReplyWithBufferedBlockDispatcher,
  };
}

describe("nostrPlugin gateway inbound dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes inbound DMs through buffered reply dispatcher and delivers reply text", async () => {
    const { runtime, dispatchReplyWithBufferedBlockDispatcher } = createRuntimeMock();
    getNostrRuntimeMock.mockReturnValue(runtime);

    let onMessage: NostrBusOptions["onMessage"] | undefined;
    const busHandle: NostrBusHandle = {
      close: vi.fn(),
      publicKey: TEST_PUBLIC_KEY,
      sendDm: vi.fn(),
      getMetrics: vi.fn(() => ({}) as ReturnType<NostrBusHandle["getMetrics"]>),
      publishProfile: vi.fn(async () => ({
        eventId: "evt",
        createdAt: Date.now(),
        successes: [],
        failures: [],
      })),
      getProfileState: vi.fn(async () => ({
        lastPublishedAt: null,
        lastPublishedEventId: null,
        lastPublishResults: null,
      })),
    };
    startNostrBusMock.mockImplementation(async (options: NostrBusOptions) => {
      onMessage = options.onMessage;
      return busHandle;
    });

    const gatewayCtx = {
      account: {
        accountId: "default",
        name: "Nostr",
        enabled: true,
        configured: true,
        privateKey: TEST_PRIVATE_KEY,
        publicKey: TEST_PUBLIC_KEY,
        relays: ["wss://relay.damus.io"],
        profile: null,
        config: { dmPolicy: "pairing", allowFrom: [] },
      },
      setStatus: vi.fn(),
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    };

    const startAccount = nostrPlugin.gateway?.startAccount;
    expect(startAccount).toBeTypeOf("function");
    if (!startAccount) {
      return;
    }
    await startAccount(gatewayCtx as unknown as Parameters<typeof startAccount>[0]);

    expect(onMessage).toBeTypeOf("function");

    const reply = vi.fn(async () => {});
    await onMessage!(SENDER_PUBKEY, "hello from nostr", reply);

    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith("agent reply");
    expect(runtime.channel.text.convertMarkdownTables).toHaveBeenCalledWith("agent reply", "off");

    const dispatchParams = dispatchReplyWithBufferedBlockDispatcher.mock.calls[0]?.[0] as {
      ctx: Record<string, unknown>;
    };
    expect(dispatchParams.ctx.SenderId).toBe(SENDER_PUBKEY);
    expect(dispatchParams.ctx.OriginatingTo).toBe(`nostr:${SENDER_PUBKEY}`);
    expect(dispatchParams.ctx.ChatType).toBe("direct");
  });
});
