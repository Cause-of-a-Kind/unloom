// Storage module - handles IndexedDB and File System Access API operations

const DB_NAME = 'unloom-db';
const DB_VERSION = 1;
const HANDLE_STORE = 'directoryHandle';
const RECORDINGS_STORE = 'recordings';

let db = null;
let directoryHandle = null;

// Initialize IndexedDB
export async function initStorage() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            // Store for directory handle
            if (!database.objectStoreNames.contains(HANDLE_STORE)) {
                database.createObjectStore(HANDLE_STORE, { keyPath: 'id' });
            }

            // Store for recording metadata
            if (!database.objectStoreNames.contains(RECORDINGS_STORE)) {
                const store = database.createObjectStore(RECORDINGS_STORE, { keyPath: 'filename' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

// Get stored directory handle from IndexedDB
export async function getDirectoryHandle() {
    if (directoryHandle) return directoryHandle;

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(HANDLE_STORE, 'readonly');
        const store = transaction.objectStore(HANDLE_STORE);
        const request = store.get('main');

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            if (request.result) {
                directoryHandle = request.result.handle;
                resolve(directoryHandle);
            } else {
                resolve(null);
            }
        };
    });
}

// Store directory handle in IndexedDB
export async function setDirectoryHandle(handle) {
    directoryHandle = handle;

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(HANDLE_STORE, 'readwrite');
        const store = transaction.objectStore(HANDLE_STORE);
        const request = store.put({ id: 'main', handle });

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

// Request folder access via picker
export async function requestFolderAccess() {
    try {
        const handle = await window.showDirectoryPicker({
            mode: 'readwrite',
            startIn: 'videos'
        });
        await setDirectoryHandle(handle);
        return handle;
    } catch (err) {
        if (err.name === 'AbortError') {
            return null; // User cancelled
        }
        throw err;
    }
}

// Verify/request permission on existing handle
export async function verifyPermission(handle) {
    if (!handle) return false;

    // Check current permission state
    const options = { mode: 'readwrite' };
    if (await handle.queryPermission(options) === 'granted') {
        return true;
    }

    // Request permission
    if (await handle.requestPermission(options) === 'granted') {
        return true;
    }

    return false;
}

// Save recording to folder and metadata to IndexedDB
export async function saveRecording(blob, metadata) {
    if (!directoryHandle) {
        throw new Error('No directory selected');
    }

    const filename = metadata.filename || `recording-${Date.now()}.webm`;

    // Write file to folder
    const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    // Store metadata in IndexedDB
    const recordingData = {
        filename,
        duration: metadata.duration || 0,
        timestamp: metadata.timestamp || Date.now(),
        title: metadata.title || filename,
        size: blob.size
    };

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(RECORDINGS_STORE, 'readwrite');
        const store = transaction.objectStore(RECORDINGS_STORE);
        const request = store.put(recordingData);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(recordingData);
    });
}

// Get all recordings (from folder + metadata)
export async function getRecordings() {
    if (!directoryHandle) {
        return [];
    }

    // Get files from directory
    const files = [];
    try {
        for await (const entry of directoryHandle.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.webm')) {
                files.push(entry.name);
            }
        }
    } catch (err) {
        console.error('Error reading directory:', err);
        return [];
    }

    // Get metadata from IndexedDB
    const metadataMap = await new Promise((resolve, reject) => {
        const transaction = db.transaction(RECORDINGS_STORE, 'readonly');
        const store = transaction.objectStore(RECORDINGS_STORE);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const map = new Map();
            for (const item of request.result) {
                map.set(item.filename, item);
            }
            resolve(map);
        };
    });

    // Combine: prioritize files that exist in folder
    const recordings = files.map(filename => {
        const meta = metadataMap.get(filename);
        return meta || {
            filename,
            duration: 0,
            timestamp: 0,
            title: filename,
            size: 0
        };
    });

    // Sort by timestamp descending (newest first)
    recordings.sort((a, b) => b.timestamp - a.timestamp);

    return recordings;
}

// Delete a recording
export async function deleteRecording(filename) {
    if (!directoryHandle) {
        throw new Error('No directory selected');
    }

    // Remove file from folder
    try {
        await directoryHandle.removeEntry(filename);
    } catch (err) {
        console.error('Error removing file:', err);
    }

    // Remove metadata from IndexedDB
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(RECORDINGS_STORE, 'readwrite');
        const store = transaction.objectStore(RECORDINGS_STORE);
        const request = store.delete(filename);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

// Get recording blob for playback
export async function getRecordingBlob(filename) {
    if (!directoryHandle) {
        throw new Error('No directory selected');
    }

    const fileHandle = await directoryHandle.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return file;
}

// Get current folder name for display
export function getFolderName() {
    return directoryHandle ? directoryHandle.name : null;
}

// Check if File System Access API is supported
export function isSupported() {
    return 'showDirectoryPicker' in window;
}
