package com.codexremote.app.network

import com.codexremote.app.data.BridgeEnvelope
import com.codexremote.app.data.ConnectionPhase
import com.codexremote.app.data.DeviceStore
import com.codexremote.app.data.ErrorPayload
import com.codexremote.app.data.PairingQrPayload
import com.codexremote.app.data.RuntimeState
import com.codexremote.app.data.ThreadDetail
import com.codexremote.app.data.ThreadMessage
import com.codexremote.app.data.ThreadSummary
import com.codexremote.app.data.WorkspaceSummary
import com.codexremote.app.data.objectArray
import com.codexremote.app.data.objectValue
import com.codexremote.app.data.string
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer

class BridgeRepository(private val deviceStore: DeviceStore) {
    private val client = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _threads = MutableStateFlow<List<ThreadSummary>>(emptyList())
    private val _selectedThread = MutableStateFlow<ThreadDetail?>(null)
    private val _connectionPhase = MutableStateFlow(ConnectionPhase.NOT_PAIRED)
    private val _runtimeState = MutableStateFlow(RuntimeState.OFFLINE)
    private val _bridgeErrors = MutableSharedFlow<String>(extraBufferCapacity = 8)
    private val _workspaces = MutableStateFlow<List<WorkspaceSummary>>(emptyList())
    private var socket: WebSocket? = null
    private var bridgeUrl: String? = null
    private var pairedDeviceId: String? = null
    private var privateKeyBase64: String? = null
    private var pendingPairPayload: JsonObject? = null
    private var pendingPairConfirmation: CompletableDeferred<JsonObject?>? = null
    private var trusted = false
    private var reconnectAllowed = false
    private var closed = false
    private val pendingReplies = ConcurrentHashMap<String, PendingReply>()

    val threads: Flow<List<ThreadSummary>> = _threads.asStateFlow()
    val selectedThread: Flow<ThreadDetail?> = _selectedThread.asStateFlow()
    val connectionPhase: Flow<ConnectionPhase> = _connectionPhase.asStateFlow()
    val runtimeState: Flow<RuntimeState> = _runtimeState.asStateFlow()
    val bridgeErrors: Flow<String> = _bridgeErrors.asSharedFlow()
    val workspaces: Flow<List<WorkspaceSummary>> = _workspaces.asStateFlow()

    suspend fun pair(qrPayload: PairingQrPayload) {
        val seed = ByteArray(32).also(SecureRandom()::nextBytes)
        val privateKey = Ed25519PrivateKeyParameters(seed, 0)
        val privateKeyPem = seed.encodeBase64()
        val publicKeyPem = encodePem("PUBLIC KEY", ED25519_SPKI_PREFIX + privateKey.generatePublicKey().encoded)
        val deviceId = UUID.randomUUID().toString()
        val confirmation = CompletableDeferred<JsonObject?>()
        pairedDeviceId = deviceId
        privateKeyBase64 = privateKeyPem
        bridgeUrl = qrPayload.bridgeUrl
        trusted = false
        reconnectAllowed = true
        pendingPairConfirmation = confirmation
        _connectionPhase.value = ConnectionPhase.PAIRING
        pendingPairPayload = buildJsonObject {
            put("pairingToken", qrPayload.pairingToken)
            put("deviceId", deviceId)
            put("deviceName", "Android")
            put("publicKey", publicKeyPem)
        }
        deviceStore.savePairing(qrPayload.bridgeUrl, deviceId, privateKeyPem)
        connect(qrPayload.bridgeUrl)
        try {
            withTimeout(20.seconds) {
                confirmation.await()
            }
        } finally {
            if (pendingPairConfirmation === confirmation) {
                pendingPairConfirmation = null
            }
        }
    }

    suspend fun restoreSession() {
        val snapshot = deviceStore.snapshot()
        bridgeUrl = snapshot.bridgeUrl
        pairedDeviceId = snapshot.deviceId
        privateKeyBase64 = snapshot.privateKey
        reconnectAllowed =
            !snapshot.bridgeUrl.isNullOrBlank() &&
                !snapshot.deviceId.isNullOrBlank() &&
                !snapshot.privateKey.isNullOrBlank()
        trusted = reconnectAllowed
        if (reconnectAllowed) {
            _connectionPhase.value = ConnectionPhase.CONNECTING
            connect(snapshot.bridgeUrl.orEmpty())
        } else {
            _connectionPhase.value = ConnectionPhase.NOT_PAIRED
        }
    }

    fun connect(url: String) {
        socket?.close(1000, null)
        bridgeUrl = url
        _connectionPhase.value = if (pendingPairPayload != null) ConnectionPhase.PAIRING else ConnectionPhase.CONNECTING
        socket = client.newWebSocket(
            Request.Builder().url(url).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    pendingPairPayload?.let { payload ->
                        scope.launch {
                            runCatching {
                                sendForReply("pair.request", payload)
                            }.onSuccess { confirmPayload ->
                                pendingPairConfirmation?.complete(confirmPayload)
                                pendingPairConfirmation = null
                                trusted = true
                                reconnectAllowed = true
                                pendingPairPayload = null
                                _connectionPhase.value = ConnectionPhase.LOADING_CHATS
                                requestBootstrapData()
                            }.onFailure { error ->
                                pendingPairConfirmation?.completeExceptionally(error)
                                pendingPairConfirmation = null
                                publishError(error)
                            }
                        }
                    }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val message = json.decodeFromString<BridgeEnvelope>(text)
                    val payload = message.payload as? JsonObject
                    resolvePendingReply(message, payload)
                    when (message.type) {
                        "auth.challenge" -> respondToChallenge(payload)
                        "thread.list" -> _threads.value = decodeThreadList(payload)
                        "thread.create" -> {
                            scope.launch {
                                requestThreadList()
                                val threadId = payload?.objectValue("thread")?.string("threadId")
                                if (!threadId.isNullOrBlank()) {
                                    requestThread(threadId)
                                }
                            }
                        }
                        "thread.get" -> _selectedThread.value = decodeThreadDetail(payload)
                        "thread.stream.delta" -> applyDelta(payload)
                        "thread.stream.done" -> {
                            _runtimeState.value = RuntimeState.READY
                            updateThreadStatus(payload?.string("threadId").orEmpty(), "idle")
                            val threadId = payload?.string("threadId").orEmpty()
                            if (threadId.isNotBlank()) {
                                scope.launch {
                                    requestThread(threadId)
                                }
                            }
                            scope.launch {
                                requestThreadList()
                            }
                        }
                        "thread.stream.error" -> {
                            _runtimeState.value = RuntimeState.ERROR
                            updateThreadStatus(payload?.string("threadId").orEmpty(), "error")
                            payload?.string("message")?.takeIf { it.isNotBlank() }?.let(_bridgeErrors::tryEmit)
                        }
                        "workspace.list" -> {
                            _workspaces.value = decodeWorkspaces(payload)
                            _connectionPhase.value = ConnectionPhase.SYNCING
                        }
                        "runtime.status" -> _runtimeState.value = payload.runtimeState()
                        "error" -> {
                            val error = payload?.let { json.decodeFromJsonElement<ErrorPayload>(it) }
                            error?.message?.let(_bridgeErrors::tryEmit)
                            if (pendingPairPayload != null) {
                                _connectionPhase.value = ConnectionPhase.ERROR
                            }
                        }
                    }
                    if (message.type == "thread.list") {
                        _connectionPhase.value = ConnectionPhase.READY
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    socket = null
                    failPendingReplies(t)
                    pendingPairConfirmation?.completeExceptionally(t)
                    pendingPairConfirmation = null
                    _runtimeState.value = RuntimeState.OFFLINE
                    _connectionPhase.value =
                        if (reconnectAllowed) ConnectionPhase.OFFLINE else ConnectionPhase.NOT_PAIRED
                    publishError(t)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    socket = null
                    failPendingReplies(IllegalStateException(reason.ifBlank { "WebSocket closed." }))
                    pendingPairConfirmation?.completeExceptionally(IllegalStateException(reason.ifBlank { "WebSocket closed." }))
                    pendingPairConfirmation = null
                    _runtimeState.value = RuntimeState.OFFLINE
                    _connectionPhase.value =
                        if (reconnectAllowed) ConnectionPhase.OFFLINE else ConnectionPhase.NOT_PAIRED
                }
            }
        )
    }

    suspend fun reconnectIfPossible() {
        if (!reconnectAllowed) {
            return
        }
        val url = bridgeUrl ?: deviceStore.snapshot().bridgeUrl ?: return
        if (socket != null && _connectionPhase.value != ConnectionPhase.OFFLINE && _connectionPhase.value != ConnectionPhase.ERROR) {
            return
        }
        trusted = true
        connect(url)
    }

    fun disconnect() {
        socket?.close(1000, "disconnect")
        socket = null
        failPendingReplies(IllegalStateException("Disconnected from bridge."))
        pendingPairConfirmation?.completeExceptionally(IllegalStateException("Pairing was cancelled."))
        pendingPairConfirmation = null
        _connectionPhase.value = if (reconnectAllowed) ConnectionPhase.OFFLINE else ConnectionPhase.NOT_PAIRED
        _runtimeState.value = RuntimeState.OFFLINE
    }

    fun close() {
        if (closed) {
            return
        }
        closed = true
        disconnect()
        scope.cancel()
    }

    suspend fun clearPairing() {
        reconnectAllowed = false
        trusted = false
        bridgeUrl = null
        pairedDeviceId = null
        privateKeyBase64 = null
        pendingPairPayload = null
        pendingPairConfirmation?.completeExceptionally(IllegalStateException("Pairing was cleared."))
        pendingPairConfirmation = null
        failPendingReplies(IllegalStateException("Pairing was cleared."))
        socket?.close(1000, "clear-pairing")
        socket = null
        _threads.value = emptyList()
        _selectedThread.value = null
        _workspaces.value = emptyList()
        _connectionPhase.value = ConnectionPhase.NOT_PAIRED
        _runtimeState.value = RuntimeState.OFFLINE
        deviceStore.clear()
    }

    fun clearSelectedThread() {
        _selectedThread.value = null
    }

    fun pruneThread(threadId: String) {
        if (threadId.isBlank()) {
            return
        }
        _threads.value = _threads.value.filterNot { it.threadId == threadId }
        if (_selectedThread.value?.threadId == threadId) {
            _selectedThread.value = null
        }
    }

    suspend fun requestThreadList() {
        sendForReply("thread.list", buildJsonObject {})
    }

    suspend fun requestThread(threadId: String): ThreadDetail {
        val payload = sendForReply(
            "thread.get",
            buildJsonObject {
                put("threadId", threadId)
            },
        )
        return decodeThreadDetail(payload)
            ?: throw IllegalStateException("Thread detail payload was missing.")
    }

    suspend fun createThread(title: String): ThreadSummary {
        val workspaceId = _workspaces.value.firstOrNull()?.workspaceId
            ?: throw IllegalStateException("Workspaces are still loading. Try again in a moment.")
        val payload = sendForReply(
            "thread.create",
            buildJsonObject {
                put("workspaceId", workspaceId)
                put("title", title)
            },
        )
        val summary = decodeThreadSummary(payload?.objectValue("thread"))
            ?: throw IllegalStateException("Thread creation did not return a thread.")
        requestThreadList()
        return summary
    }

    suspend fun sendThreadMessage(threadId: String, message: String) {
        updateThreadStatus(threadId, "busy")
        sendForReply(
            "thread.send",
            buildJsonObject {
                put("threadId", threadId)
                put("message", message)
            },
        )
    }

    suspend fun openThreadInMac(threadId: String) {
        sendForReply(
            "thread.open_in_codex_app",
            buildJsonObject {
                put("threadId", threadId)
            },
        )
    }

    private fun respondToChallenge(payload: JsonObject?) {
        if (!trusted) {
            return
        }
        val challengeId = payload?.string("challengeId").orEmpty()
        val nonce = payload?.string("nonce").orEmpty()
        val deviceId = pairedDeviceId ?: return
        val privateKey = privateKeyBase64 ?: return
        val signature = signNonce(privateKey, nonce)
        scope.launch {
            runCatching {
                sendForReply(
                    "auth.response",
                    buildJsonObject {
                        put("deviceId", deviceId)
                        put("challengeId", challengeId)
                        put("signature", signature)
                    },
                )
            }.onFailure(::publishError)
        }
    }

    private suspend fun sendForReply(type: String, payload: JsonObject): JsonObject? {
        val requestId = UUID.randomUUID().toString()
        val deferred = CompletableDeferred<JsonObject?>()
        pendingReplies[requestId] = PendingReply(deferred)
        return try {
            val sent = socket?.send(
                json.encodeToString(
                    BridgeEnvelope(
                        type = type,
                        requestId = requestId,
                        payload = payload,
                    )
                )
            ) ?: false
            if (!sent) {
                throw IllegalStateException("Not connected to your Mac bridge.")
            }
            withTimeout(20.seconds) {
                deferred.await()
            }
        } finally {
            pendingReplies.remove(requestId)
        }
    }

    private fun resolvePendingReply(message: BridgeEnvelope, payload: JsonObject?) {
        val requestId = message.requestId
        if (requestId != null) {
            val pendingReply = pendingReplies.remove(requestId)
            if (pendingReply != null) {
                if (message.type == "error") {
                    val bridgeError = payload?.let { json.decodeFromJsonElement<ErrorPayload>(it) }
                    pendingReply.deferred.completeExceptionally(
                        IllegalStateException(bridgeError?.message ?: "Bridge request failed."),
                    )
                } else {
                    pendingReply.deferred.complete(payload)
                }
            }
        }
    }

    private fun failPendingReplies(error: Throwable) {
        pendingReplies.values.forEach { reply -> reply.deferred.completeExceptionally(error) }
        pendingReplies.clear()
    }

    private fun decodeThreadList(payload: JsonObject?): List<ThreadSummary> {
        val threadsArray = payload?.objectArray("threads") ?: return emptyList()
        return threadsArray.mapNotNull { item ->
            decodeThreadSummary(item as? JsonObject)
        }
    }

    private fun decodeWorkspaces(payload: JsonObject?): List<WorkspaceSummary> {
        val workspaces = payload?.objectArray("workspaces") ?: return emptyList()
        return workspaces.mapNotNull { item ->
            val obj = item as? JsonObject ?: return@mapNotNull null
            WorkspaceSummary(
                workspaceId = obj.string("workspaceId"),
                name = obj.string("name"),
                root = obj.string("root"),
            )
        }
    }

    private fun decodeThreadDetail(payload: JsonObject?): ThreadDetail? {
        val thread = payload?.objectValue("thread") ?: return null
        val messages = thread.objectArray("messages").mapNotNull { item ->
            val obj = item as? JsonObject ?: return@mapNotNull null
            ThreadMessage(
                id = obj.string("id"),
                role = obj.string("role"),
                text = obj.string("text"),
            )
        }
        return ThreadDetail(
            threadId = thread.string("threadId"),
            title = thread.string("title"),
            workspaceId = thread.string("workspaceId"),
            messages = messages,
            status = thread.string("status"),
        )
    }

    private fun decodeThreadSummary(payload: JsonObject?): ThreadSummary? {
        payload ?: return null
        return ThreadSummary(
            threadId = payload.string("threadId"),
            title = payload.string("title"),
            updatedAt = payload.string("updatedAt"),
            workspaceId = payload.string("workspaceId"),
            lastMessagePreview = payload.string("lastMessagePreview"),
            status = payload.string("status"),
        )
    }

    private fun requestBootstrapData() {
        scope.launch {
            runCatching {
                sendForReply("workspace.list", buildJsonObject {})
                requestThreadList()
            }.onFailure(::publishError)
        }
    }

    private fun applyDelta(payload: JsonObject?) {
        val threadId = payload?.string("threadId").orEmpty()
        val chunk = payload?.string("chunk").orEmpty()
        if (threadId.isBlank() || chunk.isBlank()) {
            return
        }
        updateThreadStatus(threadId, "busy")

        val current = _selectedThread.value
        if (current?.threadId == threadId) {
            val messages = current.messages.toMutableList()
            val lastMessage = messages.lastOrNull()
            if (lastMessage?.role == "assistant") {
                messages[messages.lastIndex] = lastMessage.copy(text = lastMessage.text + chunk)
            } else {
                messages.add(
                    ThreadMessage(
                        id = "streaming-$threadId",
                        role = "assistant",
                        text = chunk,
                    )
                )
            }
            _selectedThread.value = current.copy(messages = messages, status = "busy")
        }

        _threads.value = _threads.value.map { summary ->
            if (summary.threadId == threadId) {
                summary.copy(
                    status = "busy",
                    lastMessagePreview = summary.lastMessagePreview.ifBlank { "Codex is responding..." },
                )
            } else {
                summary
            }
        }
    }

    private fun updateThreadStatus(threadId: String, status: String) {
        if (threadId.isBlank()) {
            return
        }
        _threads.value = _threads.value.map { summary ->
            if (summary.threadId == threadId) summary.copy(status = status) else summary
        }
        val current = _selectedThread.value
        if (current?.threadId == threadId) {
            _selectedThread.value = current.copy(status = status)
        }
    }

    private fun signNonce(privateKeyBase64: String, nonce: String): String {
        val privateKey = Ed25519PrivateKeyParameters(java.util.Base64.getDecoder().decode(privateKeyBase64), 0)
        val input = nonce.toByteArray()
        val signature = Ed25519Signer()
        signature.init(true, privateKey)
        signature.update(input, 0, input.size)
        return signature.generateSignature().encodeBase64()
    }

    private fun publishError(error: Throwable) {
        _bridgeErrors.tryEmit(error.message ?: "Bridge request failed.")
        if (pendingPairPayload != null) {
            _connectionPhase.value = ConnectionPhase.ERROR
        }
    }

    private companion object {
        val ED25519_SPKI_PREFIX = byteArrayOf(
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
            0x70, 0x03, 0x21, 0x00,
        )
    }

    private data class PendingReply(
        val deferred: CompletableDeferred<JsonObject?>,
    )
}

private fun JsonObject?.runtimeState(): RuntimeState {
    return when (this?.string("state")) {
        "starting" -> RuntimeState.STARTING
        "ready" -> RuntimeState.READY
        "busy" -> RuntimeState.BUSY
        "error" -> RuntimeState.ERROR
        else -> RuntimeState.OFFLINE
    }
}

private fun ByteArray.encodeBase64(): String = java.util.Base64.getEncoder().encodeToString(this)

private fun encodePem(label: String, bytes: ByteArray): String {
    val body = java.util.Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(bytes)
    return "-----BEGIN $label-----\n$body\n-----END $label-----"
}
