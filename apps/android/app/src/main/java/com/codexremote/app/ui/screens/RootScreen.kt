package com.codexremote.app.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.codexremote.app.data.ConnectionPhase
import com.codexremote.app.data.RootDestination
import com.codexremote.app.data.RuntimeState
import com.codexremote.app.data.ThreadDetail
import com.codexremote.app.data.ThreadSummary
import com.codexremote.app.pairing.PairingViewModel
import com.codexremote.app.threads.ThreadsViewModel
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RootScreen(
    pairingViewModel: PairingViewModel,
    threadsViewModel: ThreadsViewModel,
) {
    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        val contents = result.contents
        if (!contents.isNullOrBlank()) {
            pairingViewModel.pairFromScannedQr(contents)
        }
    }
    val scanOptions = remember {
        ScanOptions().apply {
            setPrompt("Scan Codex Remote pairing QR")
            setBeepEnabled(false)
            setOrientationLocked(false)
        }
    }
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(threadsViewModel.transientMessage) {
        val message = threadsViewModel.transientMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        threadsViewModel.consumeTransientMessage()
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        if (!pairingViewModel.isPaired) {
            PairingScreen(
                pairingViewModel = pairingViewModel,
                onLaunchScanner = { scanLauncher.launch(scanOptions) },
            )
            return@Surface
        }

        Scaffold(
            snackbarHost = { SnackbarHost(snackbarHostState) },
            topBar = {
                when (threadsViewModel.destination) {
                    RootDestination.HOME -> CenterAlignedTopAppBar(
                        title = { Text("Codex Remote") },
                        actions = {
                            IconButton(onClick = threadsViewModel::openSettings) {
                                Icon(Icons.Filled.Settings, contentDescription = "Settings")
                            }
                        },
                    )

                    RootDestination.THREAD_DETAIL -> CenterAlignedTopAppBar(
                        title = {
                            Text(threadsViewModel.selectedThread?.title ?: "Thread")
                        },
                        navigationIcon = {
                            IconButton(onClick = threadsViewModel::backToHome) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                            }
                        },
                        actions = {
                            IconButton(onClick = threadsViewModel::openSelectedThreadInMac) {
                                Icon(Icons.Filled.Refresh, contentDescription = "Open in Codex.app")
                            }
                        },
                    )

                    RootDestination.SETTINGS -> CenterAlignedTopAppBar(
                        title = { Text("Settings") },
                        navigationIcon = {
                            IconButton(onClick = threadsViewModel::closeSettings) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                            }
                        },
                    )
                }
            },
        ) { innerPadding ->
            when (threadsViewModel.destination) {
                RootDestination.HOME -> ThreadsHomeScreen(
                    modifier = Modifier.padding(innerPadding),
                    connectionPhase = threadsViewModel.connectionPhase,
                    runtimeState = threadsViewModel.runtimeState,
                    newThreadTitle = threadsViewModel.newThreadTitle,
                    threads = threadsViewModel.threads,
                    onTitleChange = threadsViewModel::updateNewThreadTitle,
                    onCreateThread = threadsViewModel::createDefaultThread,
                    onOpenThread = threadsViewModel::openThread,
                    onRefresh = threadsViewModel::refreshThreads,
                )

                RootDestination.THREAD_DETAIL -> ThreadDetailScreen(
                    modifier = Modifier.padding(innerPadding),
                    connectionPhase = threadsViewModel.connectionPhase,
                    runtimeState = threadsViewModel.runtimeState,
                    thread = threadsViewModel.selectedThread,
                    draft = threadsViewModel.draft,
                    onDraftChange = threadsViewModel::updateDraft,
                    onSend = threadsViewModel::sendSelectedThread,
                    onContinueInNewChat = threadsViewModel::continueSelectedThreadInNewChat,
                )

                RootDestination.SETTINGS -> SettingsScreen(
                    modifier = Modifier.padding(innerPadding),
                    pairingViewModel = pairingViewModel,
                    threadsViewModel = threadsViewModel,
                )
            }
        }
    }
}

@Composable
private fun PairingScreen(
    pairingViewModel: PairingViewModel,
    onLaunchScanner: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Pair your Mac", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("Scan the Remodex-style QR code from the bridge, or paste the pairing payload manually.")
        pairingViewModel.pairingError?.let { message ->
            Text(
                text = message,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Button(onClick = onLaunchScanner, modifier = Modifier.fillMaxWidth()) {
            Text("Scan QR Code")
        }
        OutlinedTextField(
            value = pairingViewModel.qrText,
            onValueChange = pairingViewModel::updateQrText,
            modifier = Modifier.fillMaxWidth(),
            minLines = 6,
            label = { Text("Pairing payload") },
        )
        Button(onClick = pairingViewModel::pairFromRawQr, modifier = Modifier.fillMaxWidth()) {
            Text("Pair device")
        }
    }
}

@Composable
private fun ThreadsHomeScreen(
    modifier: Modifier = Modifier,
    connectionPhase: ConnectionPhase,
    runtimeState: RuntimeState,
    newThreadTitle: String,
    threads: List<ThreadSummary>,
    onTitleChange: (String) -> Unit,
    onCreateThread: () -> Unit,
    onOpenThread: (String) -> Unit,
    onRefresh: () -> Unit,
) {
    val runnableThreads = threads.filter { it.status != "read_only" }
    val historyThreads = threads.filter { it.status == "read_only" }
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        StatusCard(
            title = "Bridge status",
            primary = connectionPhase.label(),
            secondary = "Runtime: ${runtimeState.label()}",
        )
        OutlinedTextField(
            value = newThreadTitle,
            onValueChange = onTitleChange,
            label = { Text("New chat title") },
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = onCreateThread) {
                Text("New Chat")
            }
            Button(onClick = onRefresh) {
                Text("Refresh")
            }
        }
        if (runnableThreads.isEmpty() && historyThreads.isEmpty()) {
            EmptyStateCard(
                title = "No chats yet",
                message = "Create a new chat to start talking to Codex from your phone.",
            )
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (runnableThreads.isNotEmpty()) {
                    item {
                        SectionLabel("Chats")
                    }
                    items(runnableThreads) { thread ->
                        ThreadRow(thread = thread, onOpenThread = onOpenThread)
                    }
                }
                if (historyThreads.isNotEmpty()) {
                    item {
                        SectionLabel("History")
                    }
                    items(historyThreads) { thread ->
                        ThreadRow(
                            thread = thread,
                            onOpenThread = onOpenThread,
                            statusOverride = "Read only",
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ThreadDetailScreen(
    modifier: Modifier = Modifier,
    connectionPhase: ConnectionPhase,
    runtimeState: RuntimeState,
    thread: ThreadDetail?,
    draft: String,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onContinueInNewChat: () -> Unit,
) {
    if (thread == null) {
        Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }
    val readOnly = thread.status == "read_only"

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        StatusCard(
            title = "Current chat",
            primary = runtimeState.label(),
            secondary = "Connection: ${connectionPhase.label()}",
        )
        if (thread.messages.isEmpty()) {
            EmptyStateCard(
                title = "No messages yet",
                message = "Send the first instruction to start this chat.",
            )
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(thread.messages) { message ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(message.role.replaceFirstChar(Char::titlecase), fontWeight = FontWeight.SemiBold)
                            Text(message.text.ifBlank { "(empty message)" })
                        }
                    }
                }
            }
        }
        if (readOnly) {
            EmptyStateCard(
                title = "Read-only thread",
                message = "This older session can be viewed here, but new replies should go into a fresh chat.",
            )
            Button(onClick = onContinueInNewChat, modifier = Modifier.fillMaxWidth()) {
                Text("Continue in new chat")
            }
        } else {
            OutlinedTextField(
                value = draft,
                onValueChange = onDraftChange,
                label = { Text("Message") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
            )
            Button(onClick = onSend, modifier = Modifier.fillMaxWidth()) {
                Text("Send")
            }
        }
    }
}

@Composable
private fun SettingsScreen(
    modifier: Modifier = Modifier,
    pairingViewModel: PairingViewModel,
    threadsViewModel: ThreadsViewModel,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        StatusCard(
            title = "Connection",
            primary = threadsViewModel.connectionPhase.label(),
            secondary = "Runtime: ${threadsViewModel.runtimeState.label()}",
        )
        Button(onClick = threadsViewModel::reconnect, modifier = Modifier.fillMaxWidth()) {
            Text("Reconnect")
        }
        Button(onClick = threadsViewModel::disconnect, modifier = Modifier.fillMaxWidth()) {
            Text("Disconnect")
        }
        Button(onClick = pairingViewModel::clearPairing, modifier = Modifier.fillMaxWidth()) {
            Text("Forget Pair")
        }
    }
}

@Composable
private fun ThreadRow(
    thread: ThreadSummary,
    onOpenThread: (String) -> Unit,
    statusOverride: String? = null,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpenThread(thread.threadId) },
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(thread.title, style = MaterialTheme.typography.titleMedium)
            Text(thread.lastMessagePreview.ifBlank { "Open this chat to view the conversation." })
            Text("Status: ${statusOverride ?: thread.status}", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun StatusCard(
    title: String,
    primary: String,
    secondary: String,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(primary, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            Text(secondary, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun EmptyStateCard(
    title: String,
    message: String,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(message)
        }
    }
}

private fun ConnectionPhase.label(): String =
    when (this) {
        ConnectionPhase.NOT_PAIRED -> "Not paired"
        ConnectionPhase.PAIRING -> "Pairing"
        ConnectionPhase.CONNECTING -> "Connecting"
        ConnectionPhase.LOADING_CHATS -> "Loading chats"
        ConnectionPhase.SYNCING -> "Syncing"
        ConnectionPhase.READY -> "Ready"
        ConnectionPhase.OFFLINE -> "Offline"
        ConnectionPhase.ERROR -> "Error"
    }

private fun RuntimeState.label(): String =
    when (this) {
        RuntimeState.STARTING -> "Starting"
        RuntimeState.READY -> "Ready"
        RuntimeState.BUSY -> "Busy"
        RuntimeState.ERROR -> "Error"
        RuntimeState.OFFLINE -> "Offline"
    }
