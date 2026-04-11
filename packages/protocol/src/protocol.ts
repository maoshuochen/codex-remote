import { z } from "zod";

export const runtimeStateSchema = z.enum(["starting", "ready", "busy", "error"]);

export const pairingQrPayloadSchema = z.object({
  bridgeUrl: z.string().url(),
  deviceName: z.string().min(1),
  pairingToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  bridgePublicKeyFingerprint: z.string().min(1),
});

export const workspaceSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  root: z.string().min(1),
});

export const threadSummarySchema = z.object({
  threadId: z.string().min(1),
  title: z.string().min(1),
  updatedAt: z.string().datetime(),
  workspaceId: z.string().min(1),
  lastMessagePreview: z.string().default(""),
  status: z.string().min(1),
});

export const threadMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  text: z.string(),
  createdAt: z.string().datetime().optional(),
});

export const threadDetailSchema = z.object({
  threadId: z.string().min(1),
  title: z.string().min(1),
  workspaceId: z.string().min(1),
  messages: z.array(threadMessageSchema),
  status: z.string().min(1),
});

export const pairRequestPayloadSchema = z.object({
  pairingToken: z.string().min(1),
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  publicKey: z.string().min(1),
});

export const pairConfirmPayloadSchema = z.object({
  deviceId: z.string().min(1),
  trusted: z.literal(true),
  bridgePublicKeyFingerprint: z.string().min(1),
});

export const authChallengePayloadSchema = z.object({
  challengeId: z.string().min(1),
  nonce: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export const authResponsePayloadSchema = z.object({
  deviceId: z.string().min(1),
  challengeId: z.string().min(1),
  signature: z.string().min(1),
});

export const workspaceListResponsePayloadSchema = z.object({
  workspaces: z.array(workspaceSchema),
});

export const threadListResponsePayloadSchema = z.object({
  threads: z.array(threadSummarySchema),
});

export const threadCreatePayloadSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(1),
});

export const threadCreateResponsePayloadSchema = z.object({
  thread: threadSummarySchema,
});

export const threadGetPayloadSchema = z.object({
  threadId: z.string().min(1),
});

export const threadGetResponsePayloadSchema = z.object({
  thread: threadDetailSchema,
});

export const threadSendPayloadSchema = z.object({
  threadId: z.string().min(1),
  message: z.string().min(1),
});

export const threadSendResponsePayloadSchema = z.object({
  accepted: z.literal(true),
  threadId: z.string().min(1),
});

export const threadOpenPayloadSchema = z.object({
  threadId: z.string().min(1),
});

export const threadOpenResponsePayloadSchema = z.object({
  opened: z.literal(true),
  threadId: z.string().min(1),
});

export const threadStreamDeltaPayloadSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  chunk: z.string(),
});

export const threadStreamDonePayloadSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
});

export const threadStreamErrorPayloadSchema = z.object({
  threadId: z.string().min(1),
  message: z.string().min(1),
});

export const runtimeStatusPayloadSchema = z.object({
  state: runtimeStateSchema,
  detail: z.string().optional(),
});

export const errorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const bridgeMessageSchema = z.object({
  type: z.string().min(1),
  requestId: z.string().min(1).optional(),
  payload: z.unknown().optional(),
});

export type PairingQrPayload = z.infer<typeof pairingQrPayloadSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type ThreadSummary = z.infer<typeof threadSummarySchema>;
export type ThreadMessage = z.infer<typeof threadMessageSchema>;
export type ThreadDetail = z.infer<typeof threadDetailSchema>;
export type PairRequestPayload = z.infer<typeof pairRequestPayloadSchema>;
export type PairConfirmPayload = z.infer<typeof pairConfirmPayloadSchema>;
export type AuthChallengePayload = z.infer<typeof authChallengePayloadSchema>;
export type AuthResponsePayload = z.infer<typeof authResponsePayloadSchema>;
export type WorkspaceListResponsePayload = z.infer<typeof workspaceListResponsePayloadSchema>;
export type ThreadListResponsePayload = z.infer<typeof threadListResponsePayloadSchema>;
export type ThreadCreatePayload = z.infer<typeof threadCreatePayloadSchema>;
export type ThreadCreateResponsePayload = z.infer<typeof threadCreateResponsePayloadSchema>;
export type ThreadGetPayload = z.infer<typeof threadGetPayloadSchema>;
export type ThreadGetResponsePayload = z.infer<typeof threadGetResponsePayloadSchema>;
export type ThreadSendPayload = z.infer<typeof threadSendPayloadSchema>;
export type ThreadSendResponsePayload = z.infer<typeof threadSendResponsePayloadSchema>;
export type ThreadOpenPayload = z.infer<typeof threadOpenPayloadSchema>;
export type ThreadOpenResponsePayload = z.infer<typeof threadOpenResponsePayloadSchema>;
export type ThreadStreamDeltaPayload = z.infer<typeof threadStreamDeltaPayloadSchema>;
export type ThreadStreamDonePayload = z.infer<typeof threadStreamDonePayloadSchema>;
export type ThreadStreamErrorPayload = z.infer<typeof threadStreamErrorPayloadSchema>;
export type RuntimeStatusPayload = z.infer<typeof runtimeStatusPayloadSchema>;
export type ErrorPayload = z.infer<typeof errorPayloadSchema>;
export type BridgeMessage = z.infer<typeof bridgeMessageSchema>;
