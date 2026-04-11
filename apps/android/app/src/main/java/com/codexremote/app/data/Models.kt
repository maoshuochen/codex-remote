package com.codexremote.app.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

@Serializable
data class BridgeEnvelope(
    val type: String,
    val requestId: String? = null,
    val payload: kotlinx.serialization.json.JsonElement? = null,
)

@Serializable
data class PairingQrPayload(
    val bridgeUrl: String,
    val deviceName: String,
    val pairingToken: String,
    val expiresAt: String,
    val bridgePublicKeyFingerprint: String,
)

data class WorkspaceSummary(
    val workspaceId: String,
    val name: String,
    val root: String,
)

data class ThreadSummary(
    val threadId: String,
    val title: String,
    val updatedAt: String,
    val workspaceId: String,
    val lastMessagePreview: String,
    val status: String,
)

data class ThreadMessage(
    val id: String,
    val role: String,
    val text: String,
)

data class ThreadDetail(
    val threadId: String,
    val title: String,
    val workspaceId: String,
    val messages: List<ThreadMessage>,
    val status: String,
)

enum class ConnectionPhase {
    NOT_PAIRED,
    PAIRING,
    CONNECTING,
    LOADING_CHATS,
    SYNCING,
    READY,
    OFFLINE,
    ERROR,
}

enum class RuntimeState {
    STARTING,
    READY,
    BUSY,
    ERROR,
    OFFLINE,
}

enum class RootDestination {
    HOME,
    THREAD_DETAIL,
    SETTINGS,
}

@Serializable
data class ErrorPayload(
    val code: String,
    val message: String,
)

@Serializable
data class PairConfirmPayload(
    val deviceId: String,
    val trusted: Boolean,
    @SerialName("bridgePublicKeyFingerprint")
    val bridgePublicKeyFingerprint: String,
)

fun JsonObject.string(name: String): String = this[name]?.toString()?.trim('"').orEmpty()
fun JsonObject.objectArray(name: String): JsonArray = this[name] as? JsonArray ?: JsonArray(emptyList())
fun JsonObject.objectValue(name: String): JsonObject? = this[name] as? JsonObject
