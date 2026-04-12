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
import com.codexremote.app.data.WorkspaceSummary
import com.codexremote.app.pairing.PairingViewModel
import com.codexremote.app.threads.ThreadsViewModel
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

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
            setPrompt("Scan the Mac bridge QR code")
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
                    workspaces = threadsViewModel.workspaces,
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
                    workspaces = threadsViewModel.workspaces,
                    draft = threadsViewModel.draft,
                    onDraftChange = threadsViewModel::updateDraft,
                    onSend = threadsViewModel::sendSelectedThread,
                    onContinueInNewChat = threadsViewModel::continueSelectedThreadInNewChat,
                )

                RootDestination.SETTINGS -> SettingsScreen(
                    modifier = Modifier.padding(innerPadding),
                    pairingViewModel = pairingViewModel,
                    threadsViewModel = threadsViewModel,
                    workspaces = threadsViewModel.workspaces,
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
        Text("Pair your phone", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("Scan the QR code shown by the Mac bridge. If scanning fails, paste the pairing code below.")
        pairingViewModel.pairingError?.let { message ->
            Text(
                text = message,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Button(onClick = onLaunchScanner, modifier = Modifier.fillMaxWidth()) {
            Text("Scan QR code")
        }
        OutlinedTextField(
            value = pairingViewModel.qrText,
            onValueChange = pairingViewModel::updateQrText,
            modifier = Modifier.fillMaxWidth(),
            minLines = 6,
            label = { Text("Pairing code") },
        )
        Button(onClick = pairingViewModel::pairFromRawQr, modifier = Modifier.fillMaxWidth()) {
            Text("Pair phone")
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
    workspaces: List<WorkspaceSummary>,
    onTitleChange: (String) -> Unit,
    onCreateThread: () -> Unit,
    onOpenThread: (String) -> Unit,
    onRefresh: () -> Unit,
) {
    val runnableThreads = threads.filter { it.status != "read_only" }.sortedByDescending { it.updatedAt }
    val historyThreads = threads.filter { it.status == "read_only" }.sortedByDescending { it.updatedAt }
    val latestRunnableThread = runnableThreads.firstOrNull()
    val statusCopy = connectionStatusCopy(connectionPhase, runtimeState)
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        StatusCard(
            title = "Bridge status",
            primary = statusCopy.primary,
            secondary = statusCopy.secondary,
        )
        if (latestRunnableThread != null) {
            QuickActionCard(
                title = "Continue latest chat",
                message = buildQuickActionMessage(latestRunnableThread, workspaces),
                actionText = "Open latest",
                onClick = { onOpenThread(latestRunnableThread.threadId) },
            )
        }
        OutlinedTextField(
            value = newThreadTitle,
            onValueChange = onTitleChange,
            label = { Text("Chat title") },
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = onCreateThread) {
                Text("New chat")
            }
            Button(onClick = onRefresh) {
                Text("Refresh")
            }
        }
        if (runnableThreads.isEmpty() && historyThreads.isEmpty()) {
            EmptyStateCard(
                title = "No chats yet",
                message = "Create a chat to start talking to Codex from your phone. It will appear here once it starts.",
            )
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (runnableThreads.isNotEmpty()) {
                    item {
                        SectionLabel("Open chats")
                    }
                    items(runnableThreads) { thread ->
                        ThreadRow(
                            thread = thread,
                            workspaceName = workspaceNameFor(thread.workspaceId, workspaces),
                            onOpenThread = onOpenThread,
                        )
                    }
                }
                if (historyThreads.isNotEmpty()) {
                    item {
                        SectionLabel("History")
                    }
                    items(historyThreads) { thread ->
                        ThreadRow(
                            thread = thread,
                            workspaceName = workspaceNameFor(thread.workspaceId, workspaces),
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
    workspaces: List<WorkspaceSummary>,
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
    val statusCopy = connectionStatusCopy(connectionPhase, runtimeState)

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        StatusCard(
            title = "Chat status",
            primary = statusCopy.primary,
            secondary = statusCopy.secondary,
        )
        EmptyStateCard(
            title = "Chat info",
            message = buildThreadInfoMessage(thread, workspaces),
        )
        if (thread.messages.isEmpty()) {
            EmptyStateCard(
                title = "No messages yet",
                message = "Send the first message to start this chat.",
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
                title = "Read only",
                message = "This chat is read only. Start a new chat to continue.",
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
    workspaces: List<WorkspaceSummary>,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        val statusCopy = connectionStatusCopy(threadsViewModel.connectionPhase, threadsViewModel.runtimeState)
        StatusCard(
            title = "Connection",
            primary = statusCopy.primary,
            secondary = statusCopy.secondary,
        )
        EmptyStateCard(
            title = "What you can do",
            message = "Reconnect to refresh the session, disconnect to stop syncing, or forget this device to remove pairing.",
        )
        if (workspaces.isNotEmpty()) {
            EmptyStateCard(
                title = "Allowed workspaces",
                message = buildWorkspaceSummary(workspaces),
            )
        }
        Button(onClick = threadsViewModel::reconnect, modifier = Modifier.fillMaxWidth()) {
            Text("Reconnect")
        }
        Button(onClick = threadsViewModel::disconnect, modifier = Modifier.fillMaxWidth()) {
            Text("Disconnect")
        }
        Button(onClick = pairingViewModel::clearPairing, modifier = Modifier.fillMaxWidth()) {
            Text("Forget device")
        }
    }
}

@Composable
private fun ThreadRow(
    thread: ThreadSummary,
    workspaceName: String,
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
            Text(thread.title.ifBlank { "Untitled chat" }, style = MaterialTheme.typography.titleMedium)
            Text(thread.lastMessagePreview.ifBlank { "Open this chat to view the latest messages." })
            Text("Workspace: $workspaceName", style = MaterialTheme.typography.bodySmall)
            Text(
                "Status: ${threadStatusLabel(statusOverride ?: thread.status)}",
                style = MaterialTheme.typography.bodySmall,
            )
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

@Composable
private fun QuickActionCard(
    title: String,
    message: String,
    actionText: String,
    onClick: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(message)
            Button(onClick = onClick) {
                Text(actionText)
            }
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

private data class ConnectionStatusCopy(
    val primary: String,
    val secondary: String,
)

private fun connectionStatusCopy(phase: ConnectionPhase, runtimeState: RuntimeState): ConnectionStatusCopy {
    return when {
        phase == ConnectionPhase.NOT_PAIRED -> ConnectionStatusCopy(
            primary = "Not paired",
            secondary = "Scan the QR code from the Mac bridge to connect this phone.",
        )
        phase == ConnectionPhase.PAIRING -> ConnectionStatusCopy(
            primary = "Pairing",
            secondary = "Verifying this phone with the Mac bridge.",
        )
        phase == ConnectionPhase.CONNECTING -> ConnectionStatusCopy(
            primary = "Connecting",
            secondary = "Reconnecting to your Mac bridge.",
        )
        phase == ConnectionPhase.LOADING_CHATS -> ConnectionStatusCopy(
            primary = "Loading chats",
            secondary = "Fetching workspaces and recent threads.",
        )
        phase == ConnectionPhase.SYNCING -> ConnectionStatusCopy(
            primary = "Syncing",
            secondary = "Updating chats and runtime status.",
        )
        phase == ConnectionPhase.OFFLINE -> ConnectionStatusCopy(
            primary = "Offline",
            secondary = "The bridge is not reachable right now. Try reconnecting from Settings.",
        )
        phase == ConnectionPhase.ERROR -> ConnectionStatusCopy(
            primary = "Needs attention",
            secondary = "The bridge reported a problem. Try reconnecting or scan a fresh QR code.",
        )
        runtimeState == RuntimeState.BUSY -> ConnectionStatusCopy(
            primary = "Codex is busy",
            secondary = "The current chat is running. You can keep reading or wait for updates.",
        )
        runtimeState == RuntimeState.STARTING -> ConnectionStatusCopy(
            primary = "Starting",
            secondary = "Codex is still starting up on the Mac.",
        )
        runtimeState == RuntimeState.ERROR -> ConnectionStatusCopy(
            primary = "Codex error",
            secondary = "Codex reported an error. Open the chat or wait for a fresh update.",
        )
        else -> ConnectionStatusCopy(
            primary = "Ready",
            secondary = "You can open a chat or send a follow-up message.",
        )
    }
}

private fun threadStatusLabel(status: String): String =
    when (val normalized = status.trim().lowercase()) {
        "" -> "Unknown"
        "busy" -> "In progress"
        "idle" -> "Ready"
        "error" -> "Needs attention"
        "read_only" -> "Read only"
        else -> normalized.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
    }

private fun workspaceNameFor(workspaceId: String, workspaces: List<WorkspaceSummary>): String {
    if (workspaceId.isBlank()) {
        return "Unknown workspace"
    }
    return workspaces.firstOrNull { it.workspaceId == workspaceId }?.name
        ?: workspaceId
}

private fun buildQuickActionMessage(thread: ThreadSummary, workspaces: List<WorkspaceSummary>): String {
    val workspaceName = workspaceNameFor(thread.workspaceId, workspaces)
    val preview = thread.lastMessagePreview.ifBlank { "No recent message preview is available." }
    return "Workspace: $workspaceName. Updated ${formatThreadUpdatedAt(thread.updatedAt)}. $preview"
}

private fun buildThreadInfoMessage(thread: ThreadDetail, workspaces: List<WorkspaceSummary>): String {
    val workspaceName = workspaceNameFor(thread.workspaceId, workspaces)
    val messageCount = thread.messages.size
    val threadLabel = thread.title.ifBlank { "Untitled chat" }
    return "Chat: $threadLabel. Workspace: $workspaceName. Messages: $messageCount. Thread ID: ${thread.threadId}"
}

private fun buildWorkspaceSummary(workspaces: List<WorkspaceSummary>): String {
    return workspaces.joinToString("\n\n") { workspace ->
        val name = workspace.name.ifBlank { workspace.workspaceId }
        val root = workspace.root.ifBlank { "Unknown path" }
        "$name\n$root"
    }
}

private fun formatThreadUpdatedAt(value: String): String {
    return runCatching {
        val instant = OffsetDateTime.parse(value).toInstant()
        val localDateTime = instant.atZone(ZoneId.systemDefault())
        localDateTime.format(DateTimeFormatter.ofPattern("MMM d, HH:mm"))
    }.getOrElse {
        value.ifBlank { "recently" }
    }
}
