// Library module - handles recording list display and playback

let playerModal = null;
let videoElement = null;
let currentObjectUrl = null;

// Format duration as MM:SS
export function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0:00';

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Format timestamp as readable date
export function formatDate(timestamp) {
    if (!timestamp) return 'Unknown';

    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return 'Today ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
        return 'Yesterday ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
        return date.toLocaleDateString([], { weekday: 'long' }) + ' ' +
            date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
        return date.toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
    }
}

// Format file size
export function formatSize(bytes) {
    if (!bytes) return '';

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

// Create a recording card element
export function createRecordingCard(recording, onPlay, onDelete) {
    const card = document.createElement('div');
    card.className = 'recording-card';
    card.dataset.filename = recording.filename;

    card.innerHTML = `
        <div class="recording-thumbnail">
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
            </svg>
        </div>
        <div class="recording-info">
            <div class="recording-title" title="${recording.filename}">${recording.title || recording.filename}</div>
            <div class="recording-meta">
                <span class="recording-duration">${formatDuration(recording.duration)}</span>
                <span class="recording-date">${formatDate(recording.timestamp)}</span>
                ${recording.size ? `<span class="recording-size">${formatSize(recording.size)}</span>` : ''}
            </div>
        </div>
        <button class="recording-delete" title="Delete recording" aria-label="Delete recording">
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
        </button>
    `;

    // Click card to play
    card.addEventListener('click', (e) => {
        if (!e.target.closest('.recording-delete')) {
            onPlay(recording.filename);
        }
    });

    // Delete button
    card.querySelector('.recording-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        onDelete(recording.filename);
    });

    return card;
}

// Render the library grid
export function renderLibrary(container, recordings, onPlay, onDelete) {
    container.innerHTML = '';

    if (recordings.length === 0) {
        container.innerHTML = `
            <div class="library-empty">
                <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
                    <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>
                </svg>
                <p>No recordings yet</p>
                <p class="library-empty-hint">Click "Start Recording" to create your first recording</p>
            </div>
        `;
        return;
    }

    for (const recording of recordings) {
        const card = createRecordingCard(recording, onPlay, onDelete);
        container.appendChild(card);
    }
}

// Initialize the player modal
export function initPlayer() {
    playerModal = document.getElementById('player-modal');
    videoElement = document.getElementById('player-video');

    if (!playerModal || !videoElement) return;

    // Close on backdrop click
    playerModal.addEventListener('click', (e) => {
        if (e.target === playerModal) {
            hidePlayer();
        }
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && playerModal.classList.contains('visible')) {
            hidePlayer();
        }
    });

    // Close button
    const closeBtn = playerModal.querySelector('.player-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', hidePlayer);
    }
}

// Show the player with a blob
export function showPlayer(blob) {
    if (!playerModal || !videoElement) return;

    // Revoke previous URL
    if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
    }

    currentObjectUrl = URL.createObjectURL(blob);
    videoElement.src = currentObjectUrl;
    playerModal.classList.add('visible');
    videoElement.play();
}

// Hide the player
export function hidePlayer() {
    if (!playerModal || !videoElement) return;

    videoElement.pause();
    videoElement.src = '';
    playerModal.classList.remove('visible');

    if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
    }
}
