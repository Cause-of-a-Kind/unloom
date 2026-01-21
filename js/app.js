// Main app module - coordinates all components

import * as storage from './storage.js';
import * as recorder from './recorder.js';
import * as library from './library.js';

// App state
let state = 'loading'; // loading, unsupported, no-folder, ready, recording
let timerInterval = null;
let cameraPreviewStream = null;

// DOM elements
const elements = {};

// Initialize the app
async function init() {
    // Cache DOM elements
    elements.unsupportedBanner = document.getElementById('unsupported-banner');
    elements.folderSection = document.getElementById('folder-section');
    elements.folderName = document.getElementById('folder-name');
    elements.changeFolderBtn = document.getElementById('change-folder-btn');
    elements.noFolderSection = document.getElementById('no-folder-section');
    elements.selectFolderBtn = document.getElementById('select-folder-btn');
    elements.readySection = document.getElementById('ready-section');
    elements.startRecordingBtn = document.getElementById('start-recording-btn');
    elements.recordingSection = document.getElementById('recording-section');
    elements.stopRecordingBtn = document.getElementById('stop-recording-btn');
    elements.recordingTimer = document.getElementById('recording-timer');
    elements.libraryContainer = document.getElementById('library-container');

    // Device selection elements
    elements.micSelect = document.getElementById('mic-select');
    elements.cameraToggle = document.getElementById('camera-toggle');
    elements.cameraLabel = document.getElementById('camera-label');
    elements.cameraOptions = document.getElementById('camera-options');
    elements.cameraSelect = document.getElementById('camera-select');
    elements.cameraPreviewContainer = document.getElementById('camera-preview-container');
    elements.cameraPreview = document.getElementById('camera-preview');

    // Check browser support
    if (!storage.isSupported() || !recorder.isSupported()) {
        setState('unsupported');
        return;
    }

    // Initialize storage
    await storage.initStorage();

    // Initialize player
    library.initPlayer();

    // Setup event listeners
    setupEventListeners();

    // Try to restore directory handle
    const handle = await storage.getDirectoryHandle();
    if (handle) {
        const hasPermission = await storage.verifyPermission(handle);
        if (hasPermission) {
            setState('ready');
            await refreshLibrary();
            await populateDevices();
            return;
        }
    }

    setState('no-folder');
}

// Setup event listeners
function setupEventListeners() {
    elements.selectFolderBtn?.addEventListener('click', handleFolderSelect);
    elements.changeFolderBtn?.addEventListener('click', handleFolderSelect);
    elements.startRecordingBtn?.addEventListener('click', handleStartRecording);
    elements.stopRecordingBtn?.addEventListener('click', handleStopRecording);

    // Device selection listeners
    elements.cameraToggle?.addEventListener('change', handleCameraToggle);
    elements.cameraSelect?.addEventListener('change', handleCameraChange);
}

// Populate device dropdowns
async function populateDevices() {
    const { microphones, cameras } = await recorder.getDevices();

    // Populate microphone dropdown
    if (elements.micSelect) {
        elements.micSelect.innerHTML = '<option value="">No microphone</option>';
        for (const mic of microphones) {
            const option = document.createElement('option');
            option.value = mic.deviceId;
            option.textContent = mic.label;
            elements.micSelect.appendChild(option);
        }

        // Select first mic by default if available
        if (microphones.length > 0) {
            elements.micSelect.value = microphones[0].deviceId;
        }
    }

    // Populate camera dropdown
    if (elements.cameraSelect) {
        elements.cameraSelect.innerHTML = '<option value="">Select camera</option>';
        for (const camera of cameras) {
            const option = document.createElement('option');
            option.value = camera.deviceId;
            option.textContent = camera.label;
            elements.cameraSelect.appendChild(option);
        }

        // Select first camera by default if available
        if (cameras.length > 0) {
            elements.cameraSelect.value = cameras[0].deviceId;
        }
    }
}

// Handle camera toggle
async function handleCameraToggle() {
    const enabled = elements.cameraToggle.checked;
    elements.cameraLabel.textContent = enabled ? 'On' : 'Off';

    if (enabled) {
        elements.cameraOptions?.classList.remove('hidden');
        await startCameraPreview();
    } else {
        elements.cameraOptions?.classList.add('hidden');
        stopCameraPreview();
    }
}

// Handle camera selection change
async function handleCameraChange() {
    if (elements.cameraToggle.checked) {
        await startCameraPreview();
    }
}

// Start camera preview
async function startCameraPreview() {
    stopCameraPreview(); // Stop any existing preview

    const deviceId = elements.cameraSelect?.value;
    if (!deviceId) return;

    cameraPreviewStream = await recorder.startCameraPreview(deviceId);
    if (cameraPreviewStream && elements.cameraPreview) {
        elements.cameraPreview.srcObject = cameraPreviewStream;
        elements.cameraPreviewContainer?.classList.remove('hidden');
    }
}

// Stop camera preview
function stopCameraPreview() {
    if (cameraPreviewStream) {
        recorder.stopCameraPreview(cameraPreviewStream);
        cameraPreviewStream = null;
    }
    if (elements.cameraPreview) {
        elements.cameraPreview.srcObject = null;
    }
    elements.cameraPreviewContainer?.classList.add('hidden');
}

// Update UI based on state
function setState(newState) {
    state = newState;

    // Hide all sections
    elements.unsupportedBanner?.classList.add('hidden');
    elements.folderSection?.classList.add('hidden');
    elements.noFolderSection?.classList.add('hidden');
    elements.readySection?.classList.add('hidden');
    elements.recordingSection?.classList.add('hidden');

    // Show relevant sections
    switch (state) {
        case 'unsupported':
            elements.unsupportedBanner?.classList.remove('hidden');
            break;

        case 'no-folder':
            elements.noFolderSection?.classList.remove('hidden');
            break;

        case 'ready':
            elements.folderSection?.classList.remove('hidden');
            elements.readySection?.classList.remove('hidden');
            updateFolderDisplay();
            break;

        case 'recording':
            elements.folderSection?.classList.remove('hidden');
            elements.recordingSection?.classList.remove('hidden');
            break;
    }
}

// Update folder name display
function updateFolderDisplay() {
    const folderName = storage.getFolderName();
    if (elements.folderName) {
        elements.folderName.textContent = folderName || 'Unknown folder';
    }
}

// Handle folder selection
async function handleFolderSelect() {
    try {
        const handle = await storage.requestFolderAccess();
        if (handle) {
            setState('ready');
            await refreshLibrary();
            await populateDevices();
        }
    } catch (err) {
        console.error('Error selecting folder:', err);
        alert('Failed to access folder. Please try again.');
    }
}

// Handle start recording
async function handleStartRecording() {
    try {
        elements.startRecordingBtn.disabled = true;

        // Stop camera preview before recording (we'll use it in the recording)
        stopCameraPreview();

        // Get selected devices
        const micDeviceId = elements.micSelect?.value || null;
        const cameraEnabled = elements.cameraToggle?.checked || false;
        const cameraDeviceId = elements.cameraSelect?.value || null;

        await recorder.startRecording({
            micDeviceId,
            cameraEnabled,
            cameraDeviceId
        });

        setState('recording');
        startTimer();
    } catch (err) {
        console.error('Error starting recording:', err);
        elements.startRecordingBtn.disabled = false;

        if (err.name === 'NotAllowedError') {
            alert('Screen sharing permission denied. Please allow screen sharing to record.');
        } else {
            alert('Failed to start recording. Please try again.');
        }
    }
}

// Handle stop recording
async function handleStopRecording() {
    try {
        elements.stopRecordingBtn.disabled = true;
        stopTimer();

        const { blob, duration } = await recorder.stopRecording();

        // Generate filename
        const timestamp = Date.now();
        const filename = `recording-${timestamp}.webm`;

        // Save to folder
        await storage.saveRecording(blob, {
            filename,
            duration,
            timestamp
        });

        setState('ready');
        await refreshLibrary();

        // Restart camera preview if it was enabled
        if (elements.cameraToggle?.checked) {
            await startCameraPreview();
        }
    } catch (err) {
        console.error('Error stopping recording:', err);
        alert('Failed to save recording. Please try again.');
    } finally {
        elements.stopRecordingBtn.disabled = false;
        elements.startRecordingBtn.disabled = false;
    }
}

// Start recording timer
function startTimer() {
    updateTimerDisplay();
    timerInterval = setInterval(updateTimerDisplay, 1000);
}

// Stop recording timer
function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// Update timer display
function updateTimerDisplay() {
    const elapsed = recorder.getElapsedTime();
    if (elements.recordingTimer) {
        elements.recordingTimer.textContent = library.formatDuration(elapsed);
    }
}

// Refresh the library view
async function refreshLibrary() {
    const recordings = await storage.getRecordings();
    library.renderLibrary(
        elements.libraryContainer,
        recordings,
        handlePlayRecording,
        handleDeleteRecording
    );
}

// Handle playing a recording
async function handlePlayRecording(filename) {
    try {
        const blob = await storage.getRecordingBlob(filename);
        library.showPlayer(blob);
    } catch (err) {
        console.error('Error playing recording:', err);
        alert('Failed to play recording. The file may have been moved or deleted.');
        await refreshLibrary();
    }
}

// Handle deleting a recording
async function handleDeleteRecording(filename) {
    const confirmed = confirm(`Delete "${filename}"?\n\nThis cannot be undone.`);
    if (!confirmed) return;

    try {
        await storage.deleteRecording(filename);
        await refreshLibrary();
    } catch (err) {
        console.error('Error deleting recording:', err);
        alert('Failed to delete recording.');
    }
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
