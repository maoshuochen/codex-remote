import { loadConfig } from "./config/index.js";
import { ensureBridgeIdentity } from "./config/identity.js";
import { log } from "./logger.js";
import { CodexAppServerClient } from "./appserver/client.js";
import { BridgeServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const identity = ensureBridgeIdentity(config.bridgePrivateKeyPath);
  const codexClient = new CodexAppServerClient(config.codexWsPort);

  log("info", "starting codex app-server");
  await codexClient.start();

  const bridge = new BridgeServer(config, identity, codexClient);
  const shutdown = async (): Promise<void> => {
    log("info", "shutting down bridge");
    bridge.stop();
    codexClient.stop();
    log("info", "bridge stopped");
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  try {
    await bridge.start();
  } catch (error) {
    await shutdown();
    throw error;
  }
}

main().catch((error) => {
  log("error", "bridge startup failed", {
    message: error instanceof Error ? error.message : "Unknown startup error",
  });
  process.exitCode = 1;
});
