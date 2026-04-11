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
  await bridge.start();
}

main().catch((error) => {
  log("error", "bridge startup failed", {
    message: error instanceof Error ? error.message : "Unknown startup error",
  });
  process.exitCode = 1;
});
