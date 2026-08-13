let ws;
let webcamElement = document.getElementById('webcam');
let canvasElement = document.getElementById('output-canvas');
let canvasCtx = canvasElement.getContext('2d');
let cameraOverlay = document.getElementById('camera-overlay');
let gestureBadge = document.getElementById('gesture-badge');
let wsStatus = document.getElementById('ws-status');
let receivedPhotoFrame = document.getElementById('received-photo-frame');
let toast = document.getElementById('toast');
let activePhoto = document.getElementById('active-photo');

let lastActionTime = 0;
const COOLDOWN_MS = 2500;
let camera = null;
let currentGestureState = "idle";
let selectedFileBase64 = null;
let selectedFileName = "gallery_photo.jpg";
let isCameraActive = false;

// Set default photo base64
selectedFileBase64 = activePhoto.src;

// Device identification
const myDeviceName = `Android Phone #${Math.floor(100 + Math.random() * 900)}`;

// Called automatically by Android Kotlin on page load finish
function initDeviceIp(deviceIp) {
    if (!deviceIp || deviceIp === "192.168.1.1") {
        document.getElementById('scan-status').innerText = "Scanning aborted. Local IP unavailable.";
        return;
    }
    
    // Extract subnet (e.g. "192.168.100.15" -> "192.168.100.")
    const parts = deviceIp.split('.');
    if (parts.length === 4) {
        const subnet = `${parts[0]}.${parts[1]}.${parts[2]}.`;
        document.getElementById('scan-status').innerText = `P2P Scanner: Subnet ${subnet}x`;
        scanSubnet(subnet);
    }
}

async function scanSubnet(subnet) {
    const scanStatus = document.getElementById('scan-status');
    const peersList = document.getElementById('peers-list');
    peersList.innerHTML = "";
    
    let foundPeers = [];
    scanStatus.innerText = "Scanning Wi-Fi network...";
    
    // Scan all 254 possible hosts concurrently in chunks to prevent connection limits
    const batchSize = 30;
    for (let i = 1; i <= 254; i += batchSize) {
        scanStatus.innerText = `Scanning local Wi-Fi (${i}-${Math.min(i + batchSize - 1, 254)})...`;
        
        const promises = [];
        for (let j = i; j < i + batchSize && j <= 254; j++) {
            const testIp = `${subnet}${j}`;
            promises.push(testServerIp(testIp));
        }
        
        const results = await Promise.all(promises);
        results.forEach((activeIp) => {
            if (activeIp && !foundPeers.includes(activeIp)) {
                foundPeers.push(activeIp);
                addPeerToUI(activeIp);
            }
        });
    }
    
    if (foundPeers.length === 0) {
        scanStatus.innerHTML = `
            <span style="color: #ef4444;">No peers discovered.</span><br>
            <button onclick="location.reload()" style="background: #3b82f6; border: none; color: white; padding: 6px 12px; border-radius: 6px; margin-top: 10px; font-weight: bold; font-size: 0.75rem;">Retry Scan</button>
        `;
    } else {
        scanStatus.innerText = `Scan complete. Found ${foundPeers.length} peer(s) nearby.`;
    }
}

function addPeerToUI(ip) {
    const peersList = document.getElementById('peers-list');
    const item = document.createElement('div');
    item.className = "peer-item";
    
    // Guess a name based on IP host
    const deviceName = `Windows PC #${ip.split('.')[3]}`;
    
    item.innerHTML = `
        <span class="peer-name">${deviceName} (${ip})</span>
        <button class="btn-pair" onclick="pairWithDevice('${ip}')">Pair</button>
    `;
    peersList.appendChild(item);
}

function pairWithDevice(ip) {
    if (typeof Android !== "undefined" && Android.pairDevice) {
        Android.pairDevice(ip);
    } else {
        document.getElementById('setup-panel').style.display = 'none';
        document.getElementById('gallery-panel').style.display = 'block';
        document.getElementById('airshare-bubble').style.display = 'flex';
        connectWebSocket(ip);
    }
}

function testServerIp(ip) {
    return new Promise((resolve) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 750); // 750ms fast connection timeout
        
        // Ping the server endpoint
        fetch(`http://${ip}:8000/`, { signal: controller.signal, mode: 'no-cors' })
            .then(() => {
                clearTimeout(timeoutId);
                resolve(ip);
            })
            .catch(() => {
                clearTimeout(timeoutId);
                resolve(null);
            });
    });
}

// WebSocket Connection
function connectWebSocket(ip) {
    const wsUrl = `ws://${ip}:8000/ws`;
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        wsStatus.innerText = "ONLINE";
        
        // Register device immediately
        ws.send(JSON.stringify({
            event: "register",
            device_name: myDeviceName
        }));
    };
    
    ws.onclose = () => {
        wsStatus.innerText = "RECONNECTING...";
        setTimeout(() => connectWebSocket(ip), 3000);
    };
    
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.event === "file_grabbed") {
            showToast(`🚀 File Grabbed! Ready to Release.`);
        } else if (msg.event === "file_released") {
            renderSharedContent(msg.data);
            showToast(`📥 File Received!`);
        }
    };
}

// Select Photo from Grid
function selectPhoto(element) {
    document.querySelectorAll('.photo-item').forEach(item => {
        item.classList.remove('active');
    });
    element.classList.add('active');
    
    const img = element.querySelector('img');
    activePhoto.src = img.src;
    selectedFileBase64 = img.src;
    showToast("Photo selected!");
}

// Render Received Content
function renderSharedContent(data) {
    receivedPhotoFrame.innerHTML = "";
    if (data.type === "text") {
        receivedPhotoFrame.innerHTML = `<p style="padding: 10px; font-size: 0.75rem;">${data.content}</p>`;
    } else {
        receivedPhotoFrame.innerHTML = `
            <div style="text-align: center; width: 100%;">
                <img src="${data.content}" class="received-image" alt="Received Image">
            </div>
        `;
    }
}

// Toast
function showToast(message) {
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}

// Toggle Lens Overlay (Runs silently in the background, no visible camera UI!)
function toggleGestureCamera() {
    const bubble = document.getElementById('airshare-bubble');
    if (isCameraActive) {
        isCameraActive = false;
        if (camera) camera.stop();
        bubble.style.background = "linear-gradient(135deg, var(--accent) 0%, #1e40af 100%)";
        showToast("AirShare Lens deactivated");
    } else {
        isCameraActive = true;
        bubble.style.background = "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)"; // Glow red when scanning silently
        showToast("AirShare Lens active. Make gesture ✊ / ✋");
        startCamera();
    }
}

// Start Camera using MediaPipe
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
        document.getElementById('hud-status').innerText = "Camera Blocked";
        alert("Camera start failed! Please check app settings permission.");
    });
}

// MediaPipe Results
function onResults(results) {
    if (canvasElement.width !== webcamElement.videoWidth) {
        canvasElement.width = webcamElement.videoWidth;
        canvasElement.height = webcamElement.videoHeight;
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        document.getElementById('hud-status').innerText = "Active Lens scanning";
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
    canvasCtx.strokeStyle = '#ffffff55';
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
    }
}

function triggerGrabAction() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast("⚠️ Server connection offline!");
        return;
    }

    // Play native Android sound if available
    if (typeof Android !== "undefined" && Android.playGrabSound) {
        Android.playGrabSound();
    }

    ws.send(JSON.stringify({
        event: "grab",
        type: "file",
        content: selectedFileBase64,
        filename: selectedFileName
    }));

    // Animation visual feedback
    const previewFrame = document.querySelector('.main-preview-frame');
    previewFrame.style.transform = 'scale(0.2) translateY(300px)';
    previewFrame.style.opacity = '0';
    
    setTimeout(() => {
        previewFrame.style.transform = 'none';
        previewFrame.style.opacity = '1';
        toggleGestureCamera();
    }, 1200);
}

function triggerReleaseAction() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast("⚠️ Server connection offline!");
        return;
    }

    // Play native Android sound if available
    if (typeof Android !== "undefined" && Android.playReleaseSound) {
        Android.playReleaseSound();
    }

    ws.send(JSON.stringify({
        event: "release"
    }));

    setTimeout(() => {
        toggleGestureCamera();
    }, 1000);
}
