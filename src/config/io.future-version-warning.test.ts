import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempHome } from "./home-env.test-harness.js";
import { createConfigIO } from "./io.js";

async function writeConfigWithTouchedVersion(home: string, touchedVersion: string): Promise<void> {
  const configPath = path.join(home, ".openclaw", "openclaw.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        gateway: { mode: "local" },
        meta: { lastTouchedVersion: touchedVersion },
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function getFutureVersionWarningMessages(warn: ReturnType<typeof vi.fn>): string[] {
  return warn.mock.calls
    .map((call) => call[0])
    .filter(
      (message): message is string =>
        typeof message === "string" &&
        message.includes("Config was last written by a newer OpenClaw"),
    );
}

describe("config io future-version warning", () => {
  it("warns once for repeated reads of the same mismatch", async () => {
    await withTempHome("openclaw-config-future-warning-", async (home) => {
      await writeConfigWithTouchedVersion(home, "2099.1.1");
      const warn = vi.fn();
      const io = createConfigIO({
        env: { OPENCLAW_DISABLE_CONFIG_CACHE: "1" } as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: {
          warn,
          error: vi.fn(),
        },
      });

      io.loadConfig();
      io.loadConfig();
      await io.readConfigFileSnapshot();
      await io.readConfigFileSnapshot();

      expect(getFutureVersionWarningMessages(warn)).toHaveLength(1);
    });
  });

  it("emits a fresh warning when the touched version changes", async () => {
    await withTempHome("openclaw-config-future-warning-", async (home) => {
      const warn = vi.fn();
      const io = createConfigIO({
        env: { OPENCLAW_DISABLE_CONFIG_CACHE: "1" } as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: {
          warn,
          error: vi.fn(),
        },
      });

      await writeConfigWithTouchedVersion(home, "2099.1.1");
      io.loadConfig();
      await writeConfigWithTouchedVersion(home, "2099.1.2");
      io.loadConfig();

      const warnings = getFutureVersionWarningMessages(warn);
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain("2099.1.1");
      expect(warnings[1]).toContain("2099.1.2");
    });
  });
});
