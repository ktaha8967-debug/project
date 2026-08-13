import os
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
import json
import socket

app = FastAPI()

# In-memory storage for the shared data
# Structure: {"type": "image/text", "content": "base64_data_or_url_or_text"}
shared_clipboard = {
    "type": "text",
    "content": "Aapka hand-gesture transfer ready hai! Pehle phone par pinch kijiye aur yahan open hand kijiye."
}

# Keep track of active WebSocket connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[WebSocket, str] = {}

    async def connect(self, websocket: WebSocket, device_name: str):
        self.active_connections[websocket] = device_name
        await self.broadcast_devices()

    async def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            del self.active_connections[websocket]
        await self.broadcast_devices()

    async def broadcast_devices(self):
        devices = list(self.active_connections.values())
        await self.broadcast({
            "event": "devices_updated",
            "devices": devices
        })

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections.keys()):
            try:
                await connection.send_text(json.dumps(message))
            except Exception:
                pass

manager = ConnectionManager()

# Endpoint to upload a file (alternative to WS base64)
@app.post("/upload-file")
async def upload_file(file: UploadFile = File(...)):
    global shared_clipboard
    contents = await file.read()
    # Save the file or convert to base64
    import base64
    base64_data = base64.b64encode(contents).decode("utf-8")
    content_type = file.content_type
    
    shared_clipboard = {
        "type": "file",
        "mime": content_type,
        "filename": file.filename,
        "content": f"data:{content_type};base64,{base64_data}"
    }
    
    # Notify all clients that a file has been grabbed
    await manager.broadcast({
        "event": "file_grabbed",
        "filename": file.filename
    })
    return JSONResponse(content={"status": "success", "filename": file.filename})

# WebSocket endpoint for real-time signaling
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global shared_clipboard
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Registration event
            if message.get("event") == "register":
                device_name = message.get("device_name", "Unknown Device")
                await manager.connect(websocket, device_name)
                # Send current clipboard state
                await websocket.send_text(json.dumps({
                    "event": "init",
                    "clipboard": {
                        "type": shared_clipboard.get("type"),
                        "filename": shared_clipboard.get("filename", "text")
                    }
                }))
            
            # If a client grabs a text/image directly via WS
            elif message.get("event") == "grab":
                shared_clipboard = {
                    "type": message.get("type", "text"),
                    "content": message.get("content"),
                    "filename": message.get("filename", "data")
                }
                # Broadcast that something is ready to be released
                await manager.broadcast({
                    "event": "file_grabbed",
                    "filename": shared_clipboard.get("filename")
                })
                
            # If a client releases (requests download)
            elif message.get("event") == "release":
                await websocket.send_text(json.dumps({
                    "event": "file_released",
                    "data": shared_clipboard
                }))
                
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
                
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Helper function to get local IP address
def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # doesn't even have to be reachable
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

# Mount static folder
os.makedirs("static", exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    local_ip = get_local_ip()
    print("\n" + "="*50)
    print(f"Server is running!")
    print(f"Laptop/Desktop URL: http://localhost:8000")
    print(f"Mobile URL (connect to same Wi-Fi): http://{local_ip}:8000")
    print("="*50 + "\n")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
