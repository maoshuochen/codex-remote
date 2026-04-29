import crypto from "node:crypto";
import type {
  AuthChallengePayload,
  PairConfirmPayload,
  PairRequestPayload,
  PairingQrPayload,
} from "@codex-remote/protocol";
import type { BridgeConfig } from "../config/index.js";
import type { BridgeIdentity } from "../config/identity.js";
import { TrustStore, type TrustedDevice } from "./store.js";

type ChallengeRecord = {
  challengeId: string;
  nonce: string;
  expiresAt: number;
};

export class PairingService {
  private readonly trustStore: TrustStore;
  private currentPairingToken: { value: string; expiresAt: number } | null = null;
  private readonly challenges = new Map<string, ChallengeRecord>();

  constructor(
    private readonly config: BridgeConfig,
    private readonly identity: BridgeIdentity,
  ) {
    this.trustStore = new TrustStore(config.trustStorePath);
  }

  issuePairingQr(bridgeUrl: string, webUrl: string, pairingToken: string): PairingQrPayload {
    const expiresAt = Date.now() + this.config.pairingTtlSeconds * 1000;
    this.currentPairingToken = { value: pairingToken, expiresAt };
    return {
      bridgeUrl,
      webUrl,
      deviceName: this.config.deviceName,
      pairingToken,
      expiresAt: new Date(expiresAt).toISOString(),
      bridgePublicKeyFingerprint: this.identity.fingerprint,
    };
  }

  acceptPairRequest(request: PairRequestPayload): PairConfirmPayload {
    if (
      this.currentPairingToken === null ||
      request.pairingToken !== this.currentPairingToken.value ||
      Date.now() > this.currentPairingToken.expiresAt
    ) {
      throw new Error("Pairing token is invalid or expired.");
    }

    const trustedDevice: TrustedDevice = {
      deviceId: request.deviceId,
      deviceName: request.deviceName,
      publicKey: request.publicKey,
      pairedAt: new Date().toISOString(),
    };
    this.trustStore.put(trustedDevice);
    this.currentPairingToken = null;

    return {
      deviceId: request.deviceId,
      trusted: true,
      bridgePublicKeyFingerprint: this.identity.fingerprint,
    };
  }

  createChallenge(): AuthChallengePayload {
    const challengeId = crypto.randomUUID();
    const nonce = crypto.randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 60_000;
    this.challenges.set(challengeId, { challengeId, nonce, expiresAt });
    return {
      challengeId,
      nonce,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  verifyChallengeResponse(deviceId: string, challengeId: string, signatureBase64: string): boolean {
    const challenge = this.challenges.get(challengeId);
    const device = this.trustStore.get(deviceId);
    if (!challenge || !device || Date.now() > challenge.expiresAt) {
      return false;
    }

    this.challenges.delete(challengeId);
    return crypto.verify(
      null,
      Buffer.from(challenge.nonce),
      device.publicKey,
      Buffer.from(signatureBase64, "base64"),
    );
  }

  getTrustedDevice(deviceId: string): TrustedDevice | undefined {
    return this.trustStore.get(deviceId);
  }
}
