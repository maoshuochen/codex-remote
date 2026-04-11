package com.codexremote.app.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "codex_remote")

data class PairingSnapshot(
    val bridgeUrl: String?,
    val deviceId: String?,
    val privateKey: String?,
)

class DeviceStore(private val context: Context) {
    private val bridgeUrlKey = stringPreferencesKey("bridge_url")
    private val deviceIdKey = stringPreferencesKey("device_id")
    private val privateKeyKey = stringPreferencesKey("private_key")

    val bridgeUrl: Flow<String?> = context.dataStore.data.map { prefs -> prefs[bridgeUrlKey] }
    val deviceId: Flow<String?> = context.dataStore.data.map { prefs -> prefs[deviceIdKey] }
    val privateKey: Flow<String?> = context.dataStore.data.map { prefs -> prefs[privateKeyKey] }
    val isPaired: Flow<Boolean> = context.dataStore.data.map { prefs ->
        !prefs[bridgeUrlKey].isNullOrBlank() &&
            !prefs[deviceIdKey].isNullOrBlank() &&
            !prefs[privateKeyKey].isNullOrBlank()
    }

    suspend fun savePairing(bridgeUrl: String, deviceId: String, privateKeyPem: String) {
        context.dataStore.edit { prefs ->
            prefs[bridgeUrlKey] = bridgeUrl
            prefs[deviceIdKey] = deviceId
            prefs[privateKeyKey] = privateKeyPem
        }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }

    suspend fun snapshot(): PairingSnapshot {
        return PairingSnapshot(
            bridgeUrl = bridgeUrl.first(),
            deviceId = deviceId.first(),
            privateKey = privateKey.first(),
        )
    }
}
