package com.codexremote.app.pairing

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.codexremote.app.data.DeviceStore
import com.codexremote.app.data.PairingQrPayload
import com.codexremote.app.network.BridgeRepository
import java.util.Base64
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.SerializationException

private val pairingJson = Json { ignoreUnknownKeys = true }

class PairingViewModel(
    private val deviceStore: DeviceStore,
    private val repository: BridgeRepository,
) : ViewModel() {
    var qrText by mutableStateOf("")
        private set

    var isPaired by mutableStateOf(false)
        private set

    var pairingError by mutableStateOf<String?>(null)
        private set

    init {
        viewModelScope.launch {
            isPaired = deviceStore.isPaired.first()
        }
    }

    fun updateQrText(value: String) {
        qrText = value
        pairingError = null
    }

    fun pairFromRawQr() {
        viewModelScope.launch {
            pairingError = null
            runCatching {
                val payload = parsePayload(qrText)
                repository.pair(payload)
            }.onSuccess {
                pairingError = null
                isPaired = true
            }.onFailure { error ->
                pairingError = friendlyPairingError(error)
            }
        }
    }

    fun pairFromScannedQr(value: String) {
        qrText = value
        pairFromRawQr()
    }

    fun clearPairing() {
        viewModelScope.launch {
            repository.clearPairing()
            isPaired = false
            pairingError = null
        }
    }

    private fun parsePayload(raw: String): PairingQrPayload {
        val normalized = raw.trim()
        val jsonPayload = if (normalized.startsWith(BASE64_PREFIX, ignoreCase = true)) {
            decodeBase64Payload(normalized.removePrefix(BASE64_PREFIX))
        } else {
            normalized
        }
        return pairingJson.decodeFromString<PairingQrPayload>(jsonPayload)
    }
}

private fun friendlyPairingError(error: Throwable): String {
    return when (error) {
        is TimeoutCancellationException -> "Pairing timed out. Make sure the Mac bridge is still running, then scan a fresh QR code."
        is SerializationException -> "This pairing code does not look valid. Scan the QR code shown by the Mac bridge."
        is IllegalArgumentException -> {
            val message = error.message.orEmpty()
            when {
                message.contains("base64", ignoreCase = true) -> "This pairing code looks corrupted. Scan the latest QR code from the Mac bridge."
                message.contains("url", ignoreCase = true) -> "The bridge URL in this pairing code is invalid."
                else -> "Unable to pair with this code. Try scanning the QR code again."
            }
        }
        else -> when {
            error.message.orEmpty().contains("bridge", ignoreCase = true) ->
                "Can't reach the Mac bridge right now. Check that it is running, then try again."
            else -> error.message ?: "Unable to pair with this code."
        }
    }
}

private fun decodeBase64Payload(value: String): String {
    val trimmed = value.trim()
    val urlSafe = trimmed.padEnd(((trimmed.length + 3) / 4) * 4, '=')
    return runCatching {
        String(Base64.getUrlDecoder().decode(urlSafe))
    }.getOrElse {
        String(Base64.getDecoder().decode(urlSafe))
    }
}

private const val BASE64_PREFIX = "base64:"
