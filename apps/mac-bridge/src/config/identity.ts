import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type BridgeIdentity = {
  privateKeyPem: string;
  publicKeyPem: string;
  fingerprint: string;
};

export function ensureBridgeIdentity(privateKeyPath: string): BridgeIdentity {
  fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true });

  if (!fs.existsSync(privateKeyPath)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    fs.writeFileSync(
      privateKeyPath,
      privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      "utf8",
    );
    fs.writeFileSync(
      `${privateKeyPath}.pub`,
      publicKey.export({ format: "pem", type: "spki" }).toString(),
      "utf8",
    );
  }

  const privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
  const publicKeyPem = fs.readFileSync(`${privateKeyPath}.pub`, "utf8");
  const fingerprint = crypto
    .createHash("sha256")
    .update(publicKeyPem)
    .digest("base64url");

  return { privateKeyPem, publicKeyPem, fingerprint };
}
