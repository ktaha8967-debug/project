let ws;
let webcamElement = document.getElementById('webcam');
let canvasElement = document.getElementById('output-canvas');
let canvasCtx = canvasElement.getContext('2d');
let cameraOverlay = document.getElementById('camera-overlay');
let gestureBadge = document.getElementById('gesture-badge');
let wsStatus = document.getElementById('ws-status');
let receivedView = document.getElementById('received-view');
let receivedPhotoFrame = document.getElementById('received-photo-frame');
let toast = document.getElementById('toast');
let fileInput = document.getElementById('file-input');
let activePhoto = document.getElementById('active-photo');

let lastActionTime = 0;
const COOLDOWN_MS = 2500; // 2.5 seconds cooldown
let camera = null;
let currentGestureState = "idle";
let selectedFileBase64 = null;
let selectedFileName = "gallery_photo.jpg";
let isCameraActive = false;

// Set default photo
selectedFileBase64 = activePhoto.src;

// Update UI IP address
const localIP = window.location.hostname;
const port = window.location.port || '8000';
document.getElementById('ip-address').innerText = `http://${localIP}:${port}`;

// Setup WebSocket Connection
function connectWebSocket() {
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProto}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        wsStatus.innerText = "ONLINE";
        wsStatus.className = "status-indicator online";
        
        // Register device immediately
        ws.send(JSON.stringify({
            event: "register",
            device_name: myDeviceName
        }));
    };
    
    ws.onclose = () => {
        wsStatus.innerText = "OFFLINE. Retrying...";
        wsStatus.className = "status-indicator";
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.event === "devices_updated") {
            updateNearbyDevicesList(msg.devices);
        } else if (msg.event === "file_grabbed") {
            showToast(`🚀 File Grabbed! Ready to Release.`);
            // Visual pulse on bubble
            const bubble = document.getElementById('airshare-bubble');
            bubble.style.transform = 'scale(1.2)';
            bubble.style.boxShadow = '0 0 35px var(--accent-glow)';
            setTimeout(() => {
                bubble.style.transform = 'scale(1)';
                bubble.style.boxShadow = 'none';
            }, 500);
        } else if (msg.event === "file_released") {
            renderSharedContent(msg.data);
            showToast(`📥 File Received!`);
        }
    };
}

connectWebSocket();

// Device Name detection
function getDeviceName() {
    const userAgent = navigator.userAgent;
    if (/android/i.test(userAgent)) return "Android Phone";
    if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) return "iPhone";
    if (/Macintosh/i.test(userAgent)) return "MacBook";
    if (/Windows/i.test(userAgent)) return "Windows PC";
    return "Mobile Client";
}

const myDeviceName = `${getDeviceName()} #${Math.floor(100 + Math.random() * 900)}`;

function updateNearbyDevicesList(devices) {
    const listElement = document.getElementById('devices-list');
    listElement.innerHTML = "";
    
    const filtered = devices.map(d => d === myDeviceName ? `${d} (You)` : d);
    
    if (filtered.length <= 1) {
        listElement.innerHTML = `<div class="searching-text">Listening on local network...</div>`;
        return;
    }
    
    filtered.forEach((device) => {
        const el = document.createElement('div');
        el.className = "discovered-device";
        el.innerHTML = `<span>${device}</span>`;
        listElement.appendChild(el);
    });
}

// Select Photo from Gallery Grid
function selectPhoto(element) {
    // Remove active class from all items
    document.querySelectorAll('.photo-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Set clicked item active
    element.classList.add('active');
    
    const img = element.querySelector('img');
    activePhoto.src = img.src;
    selectedFileBase64 = img.src;
    selectedFileName = "gallery_photo.jpg";
    showToast("Selected new photo to share!");
}

// Handle Custom Photo Upload
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    selectedFileName = file.name;
    const reader = new FileReader();
    reader.onload = (event) => {
        selectedFileBase64 = event.target.result;
        activePhoto.src = selectedFileBase64;
        showToast("Custom photo loaded to gallery!");
        
        // Add to grid selection dynamically
        const firstGridItem = document.querySelector('.photo-item');
        if (firstGridItem) {
            firstGridItem.querySelector('img').src = selectedFileBase64;
            selectPhoto(firstGridItem);
        }
    };
    reader.readAsDataURL(file);
});

// Toast notification
function showToast(message) {
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}

// Render Received Content in Inbox
function renderSharedContent(data) {
    receivedPhotoFrame.innerHTML = "";
    if (data.type === "text") {
        receivedPhotoFrame.innerHTML = `<p style="padding: 10px; font-size: 0.75rem; font-weight: 500;">${data.content}</p>`;
    } else {
        receivedPhotoFrame.innerHTML = `
            <div style="text-align: center; width: 100%; position: relative;">
                <img src="${data.content}" class="received-image" alt="Received File">
                <a href="${data.content}" download="${data.filename || 'received.jpg'}" class="btn-secondary" style="display: inline-block; margin-top: 5px; text-decoration: none; font-size: 0.65rem; padding: 4px 8px;">
                    Save
                </a>
            </div>
        `;
    }
}

// Toggle Gesture Camera Window overlay (Like launching utility bubble overlay)
function toggleGestureCamera() {
    if (isCameraActive) {
        cameraOverlay.style.display = 'none';
        isCameraActive = false;
        if (camera) {
            camera.stop();
        }
    } else {
        cameraOverlay.style.display = 'block';
        isCameraActive = true;
        document.getElementById('hud-status').innerText = "Connecting camera...";
        startCamera();
    }
}

// Start Camera using MediaPipe Hands
function startCamera() {
    const hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.75,
        minTrackingConfidence: 0.75
    });

    hands.onResults(onResults);

    camera = new Camera(webcamElement, {
        onFrame: async () => {
            await hands.send({ image: webcamElement });
        },
        width: 320,
        height: 240
    });
    
    camera.start().catch((err) => {
        console.error(err);
        document.getElementById('hud-status').innerText = "Camera Error";
        alert("Could not start camera. Please check camera access permissions.");
    });
}

// Hand landmarks results handler
function onResults(results) {
    if (canvasElement.width !== webcamElement.videoWidth) {
        canvasElement.width = webcamElement.videoWidth;
        canvasElement.height = webcamElement.videoHeight;
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        document.getElementById('hud-status').innerText = "Active Lens ready";
        
        for (const landmarks of results.multiHandLandmarks) {
            drawHandSkeleton(landmarks);
            detectGesture(landmarks);
        }
    } else {
        document.getElementById('hud-status').innerText = "Scanning gesture...";
        gestureBadge.innerText = "Idle";
        gestureBadge.className = "widget-badge";
        currentGestureState = "idle";
    }
    canvasCtx.restore();
}

function drawHandSkeleton(landmarks) {
    canvasCtx.fillStyle = '#10b981';
    canvasCtx.strokeStyle = '#ffffff66';
    canvasCtx.lineWidth = 3;

    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4],
        [0, 5], [5, 6], [6, 7], [7, 8],
        [5, 9], [9, 10], [10, 11], [11, 12],
        [9, 13], [13, 14], [14, 15], [15, 16],
        [0, 17], [17, 18], [18, 19], [19, 20],
        [5, 9], [9, 13], [13, 17]
    ];

    connections.forEach(([start, end]) => {
        const pt1 = landmarks[start];
        const pt2 = landmarks[end];
        canvasCtx.beginPath();
        canvasCtx.moveTo(pt1.x * canvasElement.width, pt1.y * canvasElement.height);
        canvasCtx.lineTo(pt2.x * canvasElement.width, pt2.y * canvasElement.height);
        canvasCtx.stroke();
    });

    landmarks.forEach((landmark) => {
        canvasCtx.beginPath();
        canvasCtx.arc(landmark.x * canvasElement.width, landmark.y * canvasElement.height, 4, 0, 2 * Math.PI);
        canvasCtx.fill();
    });
}

function detectGesture(landmarks) {
    const now = performance.now();
    
    // Check if fingers are folded
    const indexFolded = landmarks[8].y > landmarks[6].y;
    const middleFolded = landmarks[12].y > landmarks[10].y;
    const ringFolded = landmarks[16].y > landmarks[14].y;
    const pinkyFolded = landmarks[20].y > landmarks[18].y;

    const isFist = indexFolded && middleFolded && ringFolded && pinkyFolded;
    const isOpenHand = !indexFolded && !middleFolded && !ringFolded && !pinkyFolded;

    if (isFist) {
        gestureBadge.innerText = "Grab ✊";
        gestureBadge.className = "widget-badge grab";
        
        if (currentGestureState !== "grab" && (now - lastActionTime > COOLDOWN_MS)) {
            triggerGrabAction();
            lastActionTime = now;
        }
        currentGestureState = "grab";
    } else if (isOpenHand) {
        gestureBadge.innerText = "Release ✋";
        gestureBadge.className = "widget-badge release";

        if (currentGestureState !== "release" && (now - lastActionTime > COOLDOWN_MS)) {
            triggerReleaseAction();
            lastActionTime = now;
        }
        currentGestureState = "release";
    } else {
        gestureBadge.innerText = "Idle";
        gestureBadge.className = "widget-badge";
        currentGestureState = "idle";
    }
}

function triggerGrabAction() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast("⚠️ Server connection offline!");
        return;
    }

    if (!selectedFileBase64) {
        showToast("⚠️ No photo selected!");
        return;
    }

    // Send grab event
    ws.send(JSON.stringify({
        event: "grab",
        type: "file",
        content: selectedFileBase64,
        filename: selectedFileName
    }));

    // Beautiful UI feedback: the preview image shrinks as if sucked into the bubble
    const previewFrame = document.querySelector('.main-preview-frame');
    previewFrame.style.transform = 'scale(0.3) translateY(200px) rotate(15deg)';
    previewFrame.style.opacity = '0';
    
    setTimeout(() => {
        // Reset preview display after it goes into bubble
        previewFrame.style.transform = 'none';
        previewFrame.style.opacity = '1';
        // Auto minimize the camera overlay to mimic OS background behavior
        toggleGestureCamera();
    }, 1200);
}

function triggerReleaseAction() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast("⚠️ Server connection offline!");
        return;
    }

    // Send release event
    ws.send(JSON.stringify({
        event: "release"
    }));

    // Auto minimize overlay after action
    setTimeout(() => {
        toggleGestureCamera();
    }, 1000);
}
