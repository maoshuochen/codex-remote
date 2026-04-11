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
import kotlinx.serialization.json.Json

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

    private val json = Json { ignoreUnknownKeys = true }

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
                val detail = error.message ?: "Unable to pair with this payload."
                pairingError = "${error::class.simpleName}: $detail"
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
        return json.decodeFromString<PairingQrPayload>(jsonPayload)
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

    private companion object {
        const val BASE64_PREFIX = "base64:"
    }
}
