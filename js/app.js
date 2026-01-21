// Main app module - coordinates all components

import * as storage from './storage.js';
import * as recorder from './recorder.js';
import * as library from './library.js';

// App state
let state = 'loading'; // loading, unsupported, no-folder, ready, recording
let timerInterval = null;
let cameraPreviewStream = null;
let micPreviewStream = null;
let audioContext = null;
let audioAnalyser = null;
let audioAnimationId = null;

// Settings keys
const SETTINGS_KEY = 'unloom-settings';

// Load saved settings
function loadSettings() {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        return saved ? JSON.parse(saved) : {};
    } catch {
        return {};
    }
}

// Save settings
function saveSettings(settings) {
    try {
        const current = loadSettings();
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
    } catch {
        // Ignore storage errors
    }
}

// DOM elements
const elements = {};

// Initialize the app
async function init() {
    try {
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
        elements.micToggle = document.getElementById('mic-toggle');
        elements.cameraToggle = document.getElementById('camera-toggle');
        elements.cameraSelect = document.getElementById('camera-select');
        elements.cameraPreviewContainer = document.getElementById('camera-preview-container');
        elements.cameraPreview = document.getElementById('camera-preview');
        elements.audioPreviewContainer = document.getElementById('audio-preview-container');
        elements.audioLevel = document.getElementById('audio-level');

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
    } catch (err) {
        console.error('Init error:', err);
        // Fallback to no-folder state so user sees something
        setState('no-folder');
    }
}

// Setup event listeners
function setupEventListeners() {
    elements.selectFolderBtn?.addEventListener('click', handleFolderSelect);
    elements.changeFolderBtn?.addEventListener('click', handleFolderSelect);
    elements.startRecordingBtn?.addEventListener('click', handleStartRecording);
    elements.stopRecordingBtn?.addEventListener('click', handleStopRecording);

    // Device selection listeners
    elements.micToggle?.addEventListener('change', handleMicToggle);
    elements.micSelect?.addEventListener('change', handleMicChange);
    elements.cameraToggle?.addEventListener('change', handleCameraToggle);
    elements.cameraSelect?.addEventListener('change', handleCameraChange);
}

// Populate device dropdowns
async function populateDevices() {
    const { microphones, cameras } = await recorder.getDevices();
    const settings = loadSettings();

    // Populate microphone dropdown
    if (elements.micSelect) {
        elements.micSelect.innerHTML = '<option value="">Select microphone</option>';
        for (const mic of microphones) {
            const option = document.createElement('option');
            option.value = mic.deviceId;
            option.textContent = mic.label;
            elements.micSelect.appendChild(option);
        }

        // Restore saved mic or select first
        if (settings.micDeviceId && microphones.some(m => m.deviceId === settings.micDeviceId)) {
            elements.micSelect.value = settings.micDeviceId;
        } else if (microphones.length > 0) {
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

        // Restore saved camera or select first
        if (settings.cameraDeviceId && cameras.some(c => c.deviceId === settings.cameraDeviceId)) {
            elements.cameraSelect.value = settings.cameraDeviceId;
        } else if (cameras.length > 0) {
            elements.cameraSelect.value = cameras[0].deviceId;
        }
    }

    // Restore toggle states (default to true if not saved)
    if (elements.micToggle) {
        elements.micToggle.checked = settings.micEnabled !== false;
    }
    if (elements.cameraToggle) {
        elements.cameraToggle.checked = settings.cameraEnabled !== false;
    }

    // Start previews if toggles are checked
    if (elements.micToggle?.checked && elements.micSelect?.value) {
        await startMicPreview();
    }
    if (elements.cameraToggle?.checked && elements.cameraSelect?.value) {
        await startCameraPreview();
    }
}

// Handle microphone toggle
async function handleMicToggle() {
    const enabled = elements.micToggle.checked;
    saveSettings({ micEnabled: enabled });

    if (enabled) {
        await startMicPreview();
    } else {
        stopMicPreview();
    }
}

// Handle microphone selection change
async function handleMicChange() {
    saveSettings({ micDeviceId: elements.micSelect?.value });
    if (elements.micToggle?.checked) {
        await startMicPreview();
    }
}

// Handle camera toggle
async function handleCameraToggle() {
    const enabled = elements.cameraToggle.checked;
    saveSettings({ cameraEnabled: enabled });

    if (enabled) {
        await startCameraPreview();
    } else {
        stopCameraPreview();
    }
}

// Handle camera selection change
async function handleCameraChange() {
    saveSettings({ cameraDeviceId: elements.cameraSelect?.value });
    if (elements.cameraToggle?.checked) {
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

// Start microphone preview with audio level meter
async function startMicPreview() {
    stopMicPreview(); // Stop any existing preview

    const deviceId = elements.micSelect?.value;
    if (!deviceId) return;

    try {
        micPreviewStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: { exact: deviceId },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        // Create audio context and analyser for level meter
        audioContext = new AudioContext();
        audioAnalyser = audioContext.createAnalyser();
        audioAnalyser.fftSize = 256;

        const source = audioContext.createMediaStreamSource(micPreviewStream);
        source.connect(audioAnalyser);

        // Show the preview container
        elements.audioPreviewContainer?.classList.remove('hidden');

        // Start the level meter animation
        updateAudioLevel();
    } catch (err) {
        console.error('Mic preview error:', err);
    }
}

// Stop microphone preview
function stopMicPreview() {
    if (audioAnimationId) {
        cancelAnimationFrame(audioAnimationId);
        audioAnimationId = null;
    }

    if (micPreviewStream) {
        micPreviewStream.getTracks().forEach(track => track.stop());
        micPreviewStream = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
        audioAnalyser = null;
    }

    if (elements.audioLevel) {
        elements.audioLevel.style.height = '0%';
    }
    elements.audioPreviewContainer?.classList.add('hidden');
}

// Update the audio level meter
function updateAudioLevel() {
    if (!audioAnalyser) return;

    const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
    audioAnalyser.getByteTimeDomainData(dataArray);

    // Calculate RMS (root mean square) for better sensitivity
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const sample = (dataArray[i] - 128) / 128; // Normalize to -1 to 1
        sum += sample * sample;
    }
    const rms = Math.sqrt(sum / dataArray.length);

    // Scale up for better visibility (multiply by 3 for more sensitivity)
    const level = Math.min(100, rms * 300);

    if (elements.audioLevel) {
        elements.audioLevel.style.height = `${level}%`;
    }

    audioAnimationId = requestAnimationFrame(updateAudioLevel);
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

        // Stop previews before recording (we'll use them in the recording)
        stopMicPreview();
        stopCameraPreview();

        // Get selected devices (only use mic if toggle is enabled)
        const micEnabled = elements.micToggle?.checked || false;
        const micDeviceId = micEnabled ? (elements.micSelect?.value || null) : null;
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

        // Restart previews if they were enabled
        if (elements.micToggle?.checked) {
            await startMicPreview();
        }
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

    // Generate thumbnails for each recording
    const cards = elements.libraryContainer.querySelectorAll('.recording-card');
    for (const card of cards) {
        const filename = card.dataset.filename;
        if (filename) {
            try {
                const blob = await storage.getRecordingBlob(filename);
                const thumbnail = await library.generateThumbnail(blob);
                if (thumbnail) {
                    library.setCardThumbnail(card, thumbnail);
                }
            } catch (err) {
                // Silently ignore thumbnail generation errors
            }
        }
    }
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
