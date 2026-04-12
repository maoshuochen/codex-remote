package com.codexremote.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
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
                val factory = remember(deviceStore, repository) {
                    AppViewModelFactory(deviceStore, repository)
                }
                val pairingViewModel: PairingViewModel = viewModel(factory = factory)
                val threadsViewModel: ThreadsViewModel = viewModel(factory = factory)
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
                DisposableEffect(repository) {
                    onDispose {
                        repository.close()
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

private class AppViewModelFactory(
    private val deviceStore: DeviceStore,
    private val repository: BridgeRepository,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return when {
            modelClass.isAssignableFrom(PairingViewModel::class.java) -> {
                PairingViewModel(deviceStore, repository)
            }
            modelClass.isAssignableFrom(ThreadsViewModel::class.java) -> {
                ThreadsViewModel(repository)
            }
            else -> throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        } as T
    }
}
