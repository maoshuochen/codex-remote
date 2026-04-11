package com.codexremote.app.threads

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.codexremote.app.data.ConnectionPhase
import com.codexremote.app.data.RootDestination
import com.codexremote.app.data.RuntimeState
import com.codexremote.app.data.ThreadDetail
import com.codexremote.app.data.ThreadSummary
import com.codexremote.app.network.BridgeRepository
import kotlinx.coroutines.launch

class ThreadsViewModel(
    private val repository: BridgeRepository,
) : ViewModel() {
    var threads by mutableStateOf<List<ThreadSummary>>(emptyList())
        private set

    var selectedThread by mutableStateOf<ThreadDetail?>(null)
        private set

    var connectionPhase by mutableStateOf(ConnectionPhase.NOT_PAIRED)
        private set

    var runtimeState by mutableStateOf(RuntimeState.OFFLINE)
        private set

    var draft by mutableStateOf("")
        private set

    var newThreadTitle by mutableStateOf("")
        private set

    var destination by mutableStateOf(RootDestination.HOME)
        private set

    var transientMessage by mutableStateOf<String?>(null)
        private set

    init {
        viewModelScope.launch {
            repository.restoreSession()
        }
        viewModelScope.launch {
            repository.threads.collect { threads = it }
        }
        viewModelScope.launch {
            repository.selectedThread.collect { thread ->
                selectedThread = thread
                if (thread != null && destination == RootDestination.HOME) {
                    destination = RootDestination.THREAD_DETAIL
                }
            }
        }
        viewModelScope.launch {
            repository.connectionPhase.collect { phase ->
                connectionPhase = phase
            }
        }
        viewModelScope.launch {
            repository.runtimeState.collect { state ->
                runtimeState = state
            }
        }
        viewModelScope.launch {
            repository.bridgeErrors.collect { message ->
                transientMessage = message
            }
        }
    }

    fun onAppForegrounded() {
        viewModelScope.launch {
            repository.reconnectIfPossible()
        }
    }

    fun refreshThreads() {
        viewModelScope.launch {
            runCatching {
                repository.requestThreadList()
            }.onFailure(::publishError)
        }
    }

    fun updateDraft(value: String) {
        draft = value
    }

    fun updateNewThreadTitle(value: String) {
        newThreadTitle = value
    }

    fun createDefaultThread() {
        val requestedTitle = newThreadTitle.ifBlank { "New thread" }
        viewModelScope.launch {
            runCatching {
                val summary = repository.createThread(requestedTitle)
                newThreadTitle = ""
                repository.requestThread(summary.threadId)
                destination = RootDestination.THREAD_DETAIL
            }.onFailure(::publishError)
        }
    }

    fun openThread(threadId: String) {
        destination = RootDestination.THREAD_DETAIL
        viewModelScope.launch {
            runCatching {
                repository.requestThread(threadId)
            }.onFailure {
                destination = RootDestination.HOME
                publishError(it)
            }
        }
    }

    fun sendSelectedThread() {
        val threadId = selectedThread?.threadId ?: return
        val message = draft.trim()
        if (message.isBlank()) {
            return
        }
        viewModelScope.launch {
            runCatching {
                repository.sendThreadMessage(threadId, message)
            }.onSuccess {
                draft = ""
            }.onFailure(::publishError)
        }
    }

    fun continueSelectedThreadInNewChat() {
        val sourceThread = selectedThread ?: return
        viewModelScope.launch {
            runCatching {
                val newTitle = buildContinuationTitle(sourceThread.title)
                val summary = repository.createThread(newTitle)
                repository.requestThread(summary.threadId)
                repository.sendThreadMessage(summary.threadId, buildContinuationPrompt(sourceThread))
                destination = RootDestination.THREAD_DETAIL
                transientMessage = "Created a new chat with this thread's context."
            }.onFailure(::publishError)
        }
    }

    fun openSelectedThreadInMac() {
        val threadId = selectedThread?.threadId ?: return
        viewModelScope.launch {
            runCatching {
                repository.openThreadInMac(threadId)
                transientMessage = "Opened in Codex.app"
            }.onFailure(::publishError)
        }
    }

    fun openSettings() {
        destination = RootDestination.SETTINGS
    }

    fun closeSettings() {
        destination = if (selectedThread != null) RootDestination.THREAD_DETAIL else RootDestination.HOME
    }

    fun backToHome() {
        destination = RootDestination.HOME
    }

    fun reconnect() {
        viewModelScope.launch {
            runCatching {
                repository.reconnectIfPossible()
            }.onFailure(::publishError)
        }
    }

    fun disconnect() {
        repository.disconnect()
    }

    fun consumeTransientMessage() {
        transientMessage = null
    }

    private fun publishError(error: Throwable) {
        val message = error.message ?: "Something went wrong."
        if (message.contains("thread not found", ignoreCase = true)) {
            selectedThread?.threadId?.let(repository::pruneThread)
            repository.clearSelectedThread()
            destination = RootDestination.HOME
            refreshThreads()
        }
        transientMessage = message
    }

    private fun buildContinuationTitle(title: String): String {
        val base = title.ifBlank { "Untitled thread" }
        val normalized = if (base.startsWith("Continue:", ignoreCase = true)) base else "Continue: $base"
        return normalized.take(80)
    }

    private fun buildContinuationPrompt(thread: ThreadDetail): String {
        val recentMessages = thread.messages.takeLast(6)
        val transcript = recentMessages.joinToString("\n\n") { message ->
            "${message.role.replaceFirstChar(Char::titlecase)}: ${message.text.trim().ifBlank { "(empty)" }}"
        }
        return buildString {
            appendLine("Continue this earlier Codex thread in a new writable chat.")
            appendLine()
            appendLine("Original thread title: ${thread.title}")
            appendLine("Original thread id: ${thread.threadId}")
            appendLine()
            appendLine("Recent context:")
            appendLine(transcript.ifBlank { "No prior messages were available." })
            appendLine()
            append("Pick up from the latest context and continue helping from there.")
        }
    }
}
