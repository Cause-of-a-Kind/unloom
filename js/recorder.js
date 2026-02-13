// Recorder module - handles media capture and recording

import * as compositor from './compositor.js';

let mediaRecorder = null;
let recordedChunks = [];
let mp4MediaRecorder = null;
let mp4RecordedChunks = [];
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

// Get supported WebM MIME type
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

// Get supported MP4 MIME type (returns null if unsupported)
function getSupportedMp4MimeType() {
    const types = [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=avc1,opus',
        'video/mp4;codecs=avc1.42E01E,opus',
        'video/mp4;codecs=avc1',
        'video/mp4'
    ];

    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }

    return null;
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

        // Setup WebM MediaRecorder
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

        // Setup MP4 MediaRecorder (if supported)
        mp4RecordedChunks = [];
        const mp4MimeType = getSupportedMp4MimeType();

        if (mp4MimeType) {
            mp4MediaRecorder = new MediaRecorder(finalStream, {
                mimeType: mp4MimeType,
                videoBitsPerSecond: 3000000 // 3 Mbps
            });

            mp4MediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    mp4RecordedChunks.push(event.data);
                }
            };
        }

        // Handle stream ended (user clicked "Stop sharing")
        displayStream.getVideoTracks()[0].onended = () => {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                stopRecording();
            }
        };

        // Start recording on both recorders
        mediaRecorder.start(1000); // Collect data every second
        if (mp4MediaRecorder) {
            mp4MediaRecorder.start(1000);
        }
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

// Stop recording and return blobs for both formats
export function stopRecording() {
    return new Promise((resolve, reject) => {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            reject(new Error('No active recording'));
            return;
        }

        const duration = Math.round((Date.now() - startTime) / 1000);

        // Track completion of both recorders
        let webmBlob = null;
        let mp4Blob = null;
        const hasMp4 = mp4MediaRecorder && mp4MediaRecorder.state !== 'inactive';

        function tryResolve() {
            // Wait for both to finish (or just WebM if no MP4 recorder)
            if (!webmBlob) return;
            if (hasMp4 && !mp4Blob) return;

            cleanup();

            resolve({
                blob: webmBlob,
                mp4Blob: mp4Blob,
                duration,
                mimeType: 'video/webm'
            });
        }

        mediaRecorder.onstop = () => {
            webmBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
            tryResolve();
        };

        mediaRecorder.onerror = (event) => {
            cleanup();
            reject(event.error);
        };

        if (hasMp4) {
            mp4MediaRecorder.onstop = () => {
                mp4Blob = new Blob(mp4RecordedChunks, { type: mp4MediaRecorder.mimeType });
                tryResolve();
            };

            mp4MediaRecorder.onerror = () => {
                // MP4 failure is non-fatal; resolve with WebM only
                mp4Blob = null;
                if (webmBlob) {
                    cleanup();
                    resolve({ blob: webmBlob, mp4Blob: null, duration, mimeType: 'video/webm' });
                }
            };

            mp4MediaRecorder.stop();
        }

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
    mp4MediaRecorder = null;
    mp4RecordedChunks = [];
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
