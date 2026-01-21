// Recorder module - handles media capture and recording

import * as compositor from './compositor.js';

let mediaRecorder = null;
let recordedChunks = [];
let displayStream = null;
let micStream = null;
let cameraStream = null;
let audioContext = null;
let startTime = null;

// Initialize compositor (wrapped in try-catch to prevent module load failure)
try {
    compositor.init();
} catch (e) {
    console.error('Compositor init error:', e);
}

// Get supported MIME type
function getSupportedMimeType() {
    const types = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp8',
        'video/webm'
    ];

    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }

    return 'video/webm';
}

// Enumerate available media devices
export async function getDevices() {
    try {
        // Request permissions first to get device labels
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
            .then(stream => stream.getTracks().forEach(track => track.stop()))
            .catch(() => {}); // Ignore errors, we'll still get device IDs

        const devices = await navigator.mediaDevices.enumerateDevices();

        const microphones = devices
            .filter(d => d.kind === 'audioinput')
            .map(d => ({
                deviceId: d.deviceId,
                label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`
            }));

        const cameras = devices
            .filter(d => d.kind === 'videoinput')
            .map(d => ({
                deviceId: d.deviceId,
                label: d.label || `Camera ${d.deviceId.slice(0, 8)}`
            }));

        return { microphones, cameras };
    } catch (err) {
        console.error('Error enumerating devices:', err);
        return { microphones: [], cameras: [] };
    }
}

// Combine audio tracks from multiple streams
function combineAudioTracks(streams) {
    audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    for (const stream of streams) {
        for (const track of stream.getAudioTracks()) {
            const source = audioContext.createMediaStreamSource(new MediaStream([track]));
            source.connect(destination);
        }
    }

    return destination.stream;
}

// Start recording
export async function startRecording(options = {}) {
    const {
        micDeviceId = null,
        cameraDeviceId = null,
        cameraEnabled = false
    } = options;

    try {
        // Request screen capture with system audio
        displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                displaySurface: 'monitor',
                logicalSurface: true,
                cursor: 'always'
            },
            audio: true // Request system audio
        });

        // Collect audio streams
        const audioStreams = [];

        // Add display audio if present
        if (displayStream.getAudioTracks().length > 0) {
            audioStreams.push(displayStream);
        }

        // Request microphone if device ID provided
        if (micDeviceId) {
            try {
                micStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        deviceId: { exact: micDeviceId },
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
                audioStreams.push(micStream);
            } catch (err) {
                console.warn('Microphone access denied:', err);
            }
        }

        // Request camera if enabled
        if (cameraEnabled && cameraDeviceId) {
            try {
                cameraStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        deviceId: { exact: cameraDeviceId },
                        width: { ideal: 640 },
                        height: { ideal: 480 }
                    }
                });
            } catch (err) {
                console.warn('Camera access denied:', err);
            }
        }

        // Get video stream (composited if camera enabled, otherwise display)
        let videoStream;
        if (cameraStream) {
            // Use compositor for picture-in-picture
            videoStream = await compositor.startCompositing(displayStream, cameraStream);
        } else {
            videoStream = displayStream;
        }

        // Combine all streams
        let finalStream;
        if (audioStreams.length > 0) {
            const combinedAudio = combineAudioTracks(audioStreams);
            finalStream = new MediaStream([
                ...videoStream.getVideoTracks(),
                ...combinedAudio.getAudioTracks()
            ]);
        } else {
            finalStream = new MediaStream([...videoStream.getVideoTracks()]);
        }

        // Setup MediaRecorder
        recordedChunks = [];
        const mimeType = getSupportedMimeType();

        mediaRecorder = new MediaRecorder(finalStream, {
            mimeType,
            videoBitsPerSecond: 3000000 // 3 Mbps
        });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        // Handle stream ended (user clicked "Stop sharing")
        displayStream.getVideoTracks()[0].onended = () => {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                stopRecording();
            }
        };

        // Start recording
        mediaRecorder.start(1000); // Collect data every second
        startTime = Date.now();

        return {
            stream: finalStream,
            mimeType
        };
    } catch (err) {
        // Cleanup on error
        cleanup();
        throw err;
    }
}

// Stop recording and return blob
export function stopRecording() {
    return new Promise((resolve, reject) => {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            reject(new Error('No active recording'));
            return;
        }

        const duration = Math.round((Date.now() - startTime) / 1000);

        mediaRecorder.onstop = () => {
            const mimeType = mediaRecorder.mimeType;
            const blob = new Blob(recordedChunks, { type: mimeType });

            cleanup();

            resolve({
                blob,
                duration,
                mimeType
            });
        };

        mediaRecorder.onerror = (event) => {
            cleanup();
            reject(event.error);
        };

        mediaRecorder.stop();
    });
}

// Cleanup all resources
function cleanup() {
    compositor.stopCompositing();

    if (displayStream) {
        displayStream.getTracks().forEach(track => track.stop());
        displayStream = null;
    }

    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    mediaRecorder = null;
    recordedChunks = [];
    startTime = null;
}

// Get current recording state
export function getRecordingState() {
    if (!mediaRecorder) return 'inactive';
    return mediaRecorder.state;
}

// Get elapsed recording time in seconds
export function getElapsedTime() {
    if (!startTime) return 0;
    return Math.round((Date.now() - startTime) / 1000);
}

// Check if recording APIs are supported
export function isSupported() {
    return !!(
        navigator.mediaDevices &&
        navigator.mediaDevices.getDisplayMedia &&
        window.MediaRecorder
    );
}

// Start camera preview (for UI)
export async function startCameraPreview(deviceId) {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                width: { ideal: 320 },
                height: { ideal: 240 }
            }
        });
        return stream;
    } catch (err) {
        console.error('Camera preview error:', err);
        return null;
    }
}

// Stop camera preview
export function stopCameraPreview(stream) {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
}
