package com.codexremote.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.codexremote.app.data.DeviceStore
import com.codexremote.app.network.BridgeRepository
import com.codexremote.app.pairing.PairingViewModel
import com.codexremote.app.threads.ThreadsViewModel
import com.codexremote.app.ui.screens.RootScreen
import com.codexremote.app.ui.theme.CodexRemoteTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pairingPayload = intent?.getStringExtra(EXTRA_PAIRING_PAYLOAD)
        setContent {
            CodexRemoteTheme {
                val deviceStore = remember { DeviceStore(applicationContext) }
                val repository = remember { BridgeRepository(deviceStore) }
                val pairingViewModel = remember(deviceStore, repository) {
                    PairingViewModel(deviceStore, repository)
                }
                val threadsViewModel = remember(repository) {
                    ThreadsViewModel(repository)
                }
                val lifecycleOwner = LocalLifecycleOwner.current
                LaunchedEffect(pairingPayload) {
                    if (!pairingPayload.isNullOrBlank()) {
                        pairingViewModel.pairFromScannedQr(pairingPayload)
                    }
                }
                DisposableEffect(lifecycleOwner, threadsViewModel) {
                    val observer = LifecycleEventObserver { _, event ->
                        if (event == Lifecycle.Event.ON_START) {
                            threadsViewModel.onAppForegrounded()
                        }
                    }
                    lifecycleOwner.lifecycle.addObserver(observer)
                    onDispose {
                        lifecycleOwner.lifecycle.removeObserver(observer)
                    }
                }
                RootScreen(
                    pairingViewModel = pairingViewModel,
                    threadsViewModel = threadsViewModel,
                )
            }
        }
    }

    private companion object {
        const val EXTRA_PAIRING_PAYLOAD = "pairing_payload"
    }
}
