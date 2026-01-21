// Compositor module - handles canvas-based video compositing for picture-in-picture

let canvas = null;
let ctx = null;
let animationId = null;
let displayVideo = null;
let cameraVideo = null;
let outputStream = null;

// Camera overlay settings
const CAMERA_SIZE_RATIO = 0.2; // Camera takes 20% of width
const CAMERA_MARGIN = 20; // Pixels from edge
const CAMERA_POSITION = 'bottom-left'; // bottom-left, bottom-right, top-left, top-right
const CAMERA_BORDER_RADIUS = 12;

// Initialize the compositor
export function init() {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
}

// Start compositing display and camera streams
export function startCompositing(displayStream, cameraStream, options = {}) {
    const { position = CAMERA_POSITION, sizeRatio = CAMERA_SIZE_RATIO } = options;

    // Create video elements to draw from
    displayVideo = document.createElement('video');
    displayVideo.srcObject = displayStream;
    displayVideo.muted = true;
    displayVideo.play();

    if (cameraStream) {
        cameraVideo = document.createElement('video');
        cameraVideo.srcObject = cameraStream;
        cameraVideo.muted = true;
        cameraVideo.play();
    }

    // Wait for display video to have dimensions
    return new Promise((resolve) => {
        displayVideo.onloadedmetadata = () => {
            // Set canvas size to match display
            canvas.width = displayVideo.videoWidth || 1920;
            canvas.height = displayVideo.videoHeight || 1080;

            // Start render loop
            render(position, sizeRatio);

            // Capture canvas as stream
            outputStream = canvas.captureStream(30);

            resolve(outputStream);
        };
    });
}

// Render loop
function render(position, sizeRatio) {
    // Draw display video as background
    if (displayVideo.readyState >= 2) {
        ctx.drawImage(displayVideo, 0, 0, canvas.width, canvas.height);
    }

    // Draw camera overlay if present
    if (cameraVideo && cameraVideo.readyState >= 2) {
        drawCameraOverlay(position, sizeRatio);
    }

    animationId = requestAnimationFrame(() => render(position, sizeRatio));
}

// Draw the camera overlay with rounded corners
function drawCameraOverlay(position, sizeRatio) {
    const cameraWidth = Math.round(canvas.width * sizeRatio);
    const cameraHeight = Math.round(cameraWidth * (cameraVideo.videoHeight / cameraVideo.videoWidth));

    // Calculate position
    let x, y;
    switch (position) {
        case 'top-left':
            x = CAMERA_MARGIN;
            y = CAMERA_MARGIN;
            break;
        case 'top-right':
            x = canvas.width - cameraWidth - CAMERA_MARGIN;
            y = CAMERA_MARGIN;
            break;
        case 'bottom-right':
            x = canvas.width - cameraWidth - CAMERA_MARGIN;
            y = canvas.height - cameraHeight - CAMERA_MARGIN;
            break;
        case 'bottom-left':
        default:
            x = CAMERA_MARGIN;
            y = canvas.height - cameraHeight - CAMERA_MARGIN;
            break;
    }

    // Draw rounded rectangle clip path
    ctx.save();
    ctx.beginPath();
    roundedRect(ctx, x, y, cameraWidth, cameraHeight, CAMERA_BORDER_RADIUS);
    ctx.clip();

    // Draw camera video
    ctx.drawImage(cameraVideo, x, y, cameraWidth, cameraHeight);

    ctx.restore();

    // Draw border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    roundedRect(ctx, x, y, cameraWidth, cameraHeight, CAMERA_BORDER_RADIUS);
    ctx.stroke();
}

// Helper to draw rounded rectangle
function roundedRect(ctx, x, y, width, height, radius) {
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// Stop compositing and cleanup
export function stopCompositing() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    if (displayVideo) {
        displayVideo.srcObject = null;
        displayVideo = null;
    }

    if (cameraVideo) {
        cameraVideo.srcObject = null;
        cameraVideo = null;
    }

    outputStream = null;
}

// Get the composited output stream
export function getOutputStream() {
    return outputStream;
}
