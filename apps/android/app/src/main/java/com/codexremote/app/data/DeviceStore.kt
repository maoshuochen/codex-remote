package com.codexremote.app.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
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
    private val privateKeyCiphertextKey = stringPreferencesKey("private_key_ciphertext")
    private val privateKeyIvKey = stringPreferencesKey("private_key_iv")

    val bridgeUrl: Flow<String?> = context.dataStore.data.map { prefs -> prefs[bridgeUrlKey] }
    val deviceId: Flow<String?> = context.dataStore.data.map { prefs -> prefs[deviceIdKey] }
    val privateKey: Flow<String?> = context.dataStore.data.map { prefs ->
        decryptPrivateKey(
            ciphertextBase64 = prefs[privateKeyCiphertextKey],
            ivBase64 = prefs[privateKeyIvKey],
        )
    }
    val isPaired: Flow<Boolean> = context.dataStore.data.map { prefs ->
        !prefs[bridgeUrlKey].isNullOrBlank() &&
            !prefs[deviceIdKey].isNullOrBlank() &&
            !decryptPrivateKey(
                ciphertextBase64 = prefs[privateKeyCiphertextKey],
                ivBase64 = prefs[privateKeyIvKey],
            ).isNullOrBlank()
    }

    suspend fun savePairing(bridgeUrl: String, deviceId: String, privateKeyPem: String) {
        val encrypted = encryptPrivateKey(privateKeyPem)
        context.dataStore.edit { prefs ->
            prefs[bridgeUrlKey] = bridgeUrl
            prefs[deviceIdKey] = deviceId
            prefs[privateKeyCiphertextKey] = encrypted.ciphertextBase64
            prefs[privateKeyIvKey] = encrypted.ivBase64
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

    private fun encryptPrivateKey(value: String): EncryptedPrivateKey {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
        val ciphertext = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
        return EncryptedPrivateKey(
            ciphertextBase64 = Base64.getEncoder().encodeToString(ciphertext),
            ivBase64 = Base64.getEncoder().encodeToString(cipher.iv),
        )
    }

    private fun decryptPrivateKey(ciphertextBase64: String?, ivBase64: String?): String? {
        if (ciphertextBase64.isNullOrBlank() || ivBase64.isNullOrBlank()) {
            return null
        }

        return runCatching {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            val iv = Base64.getDecoder().decode(ivBase64)
            val ciphertext = Base64.getDecoder().decode(ciphertextBase64)
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateSecretKey(),
                GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv),
            )
            String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8)
        }.getOrNull()
    }

    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply {
            load(null)
        }
        val existing = keyStore.getKey(KEY_ALIAS, null)
        if (existing is SecretKey) {
            return existing
        }

        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    private data class EncryptedPrivateKey(
        val ciphertextBase64: String,
        val ivBase64: String,
    )

    private companion object {
        const val ANDROID_KEY_STORE = "AndroidKeyStore"
        const val KEY_ALIAS = "codex_remote_device_store"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_LENGTH_BITS = 128
    }
}
