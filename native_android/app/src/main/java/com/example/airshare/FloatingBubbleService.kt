package com.example.airshare

import android.app.Service
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.JavascriptInterface
import android.widget.ImageView
import android.widget.Toast
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

class FloatingBubbleService : Service() {

    private lateinit var windowManager: WindowManager
    private lateinit var floatingView: View
    private lateinit var bubbleIcon: ImageView
    private lateinit var hiddenWebView: WebView

    private var serverSocket: ServerSocket? = null
    private var isServerRunning = false
    private var partnerIpAddress: String = "192.168.100.1" // Set by MainActivity during pairing

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent != null && intent.hasExtra("partner_ip")) {
            partnerIpAddress = intent.getStringExtra("partner_ip") ?: partnerIpAddress
            Toast.makeText(this, "AirShare: Paired with $partnerIpAddress", Toast.LENGTH_SHORT).show()
        }
        return START_STICKY
    }

    override fun onCreate() {
        super.onCreate()

        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        floatingView = LayoutInflater.from(this).inflate(R.layout.layout_floating_bubble, null)

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        )

        params.gravity = Gravity.TOP or Gravity.START
        params.x = 100
        params.y = 100

        windowManager.addView(floatingView, params)

        bubbleIcon = floatingView.findViewById(R.id.bubble_icon)
        hiddenWebView = floatingView.findViewById(R.id.hidden_webview)

        // Set default icon background (glowing bubble style)
        bubbleIcon.setImageResource(android.R.drawable.presence_online)

        // Setup hidden webview for silent gesture camera tracking
        setupWebView()

        // Drag & Click listeners
        bubbleIcon.setOnTouchListener(object : View.OnTouchListener {
            private var lastAction: Int = 0
            private var initialX: Int = 0
            private var initialY: Int = 0
            private var initialTouchX: Float = 0f
            private var initialTouchY: Float = 0f

            override fun onTouch(v: View?, event: MotionEvent?): Boolean {
                if (event == null) return false
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialX = params.x
                        initialY = params.y
                        initialTouchX = event.rawX
                        initialTouchY = event.rawY
                        lastAction = MotionEvent.ACTION_DOWN
                        return true
                    }
                    MotionEvent.ACTION_UP -> {
                        if (lastAction == MotionEvent.ACTION_DOWN) {
                            // Single Click: Toggle camera gesture tracking silently
                            toggleSilentGestureTracking()
                        }
                        lastAction = MotionEvent.ACTION_UP
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        params.x = initialX + (event.rawX - initialTouchX).toInt()
                        params.y = initialY + (event.rawY - initialTouchY).toInt()
                        windowManager.updateViewLayout(floatingView, params)
                        lastAction = MotionEvent.ACTION_MOVE
                        return true
                    }
                }
                return false
            }
        })

        // Start P2P background listener
        startP2PServer()
    }

    private fun setupWebView() {
        hiddenWebView.settings.javaScriptEnabled = true
        hiddenWebView.settings.domStorageEnabled = true
        hiddenWebView.settings.mediaPlaybackRequiresUserGesture = false
        hiddenWebView.settings.allowFileAccess = true
        hiddenWebView.settings.allowFileAccessFromFileURLs = true
        hiddenWebView.settings.allowUniversalAccessFromFileURLs = true

        hiddenWebView.addJavascriptInterface(ServiceSoundInterface(this), "Android")
        hiddenWebView.webViewClient = WebViewClient()
        hiddenWebView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { request.grant(request.resources) }
            }
        }

        hiddenWebView.loadUrl("file:///android_asset/index.html")
    }

    private var isTracking = false
    private fun toggleSilentGestureTracking() {
        isTracking = !isTracking
        if (isTracking) {
            bubbleIcon.setImageResource(android.R.drawable.presence_away) // Glow yellow/red
            hiddenWebView.evaluateJavascript("javascript:toggleGestureCamera()", null)
            Toast.makeText(this, "Gesture lens active silently ✊ / ✋", Toast.LENGTH_SHORT).show()
        } else {
            bubbleIcon.setImageResource(android.R.drawable.presence_online) // Glow green
            hiddenWebView.evaluateJavascript("javascript:toggleGestureCamera()", null)
            Toast.makeText(this, "Gesture lens deactivated", Toast.LENGTH_SHORT).show()
        }
    }

    // Direct P2P File Sending
    fun sendFileDirectly() {
        // Read clipboard data or get mock asset data to send
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clipData = clipboard.primaryClip
        var base64Data = ""
        
        if (clipData != null && clipData.itemCount > 0) {
            val text = clipData.getItemAt(0).text
            if (text != null && text.startsWith("data:image")) {
                base64Data = text.toString()
            }
        }
        
        if (base64Data.isEmpty()) {
            // Fallback: Send a mock string signaling file grab
            base64Data = "mock_photo_data"
        }

        // Send over direct TCP socket
        thread {
            try {
                val socket = Socket(partnerIpAddress, 9000)
                val out = socket.getOutputStream()
                val bytes = base64Data.toByteArray()
                out.write(bytes)
                out.flush()
                socket.close()
                runOnUiThread {
                    Toast.makeText(this, "🚀 Sent to $partnerIpAddress!", Toast.LENGTH_SHORT).show()
                    bubbleIcon.setImageResource(android.R.drawable.presence_online)
                    isTracking = false
                }
            } catch (e: Exception) {
                e.printStackTrace()
                runOnUiThread {
                    Toast.makeText(this, "⚠️ Send failed. Is partner paired?", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    // Direct P2P File Receiving Server
    private fun startP2PServer() {
        isServerRunning = true
        thread {
            try {
                serverSocket = ServerSocket(9000)
                while (isServerRunning) {
                    val clientSocket = serverSocket?.accept() ?: break
                    thread {
                        handleIncomingConnection(clientSocket)
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun handleIncomingConnection(socket: Socket) {
        try {
            val input = socket.getInputStream()
            val result = ByteArrayOutputStream()
            val buffer = ByteArray(1024)
            var length: Int
            while (input.read(buffer).also { length = it } != -1) {
                result.write(buffer, 0, length)
            }
            val receivedString = result.toString("UTF-8")
            socket.close()

            runOnUiThread {
                // Play sound
                playReleaseSound()
                Toast.makeText(this, "📥 Photo Received via P2P!", Toast.LENGTH_LONG).show()
                
                // Trigger webview to render received base64 image in inbox
                hiddenWebView.evaluateJavascript("javascript:renderSharedContent({type: 'file', content: '$receivedString', filename: 'AirShare_P2P.jpg'})", null)
                
                // Reset tracking state
                bubbleIcon.setImageResource(android.R.drawable.presence_online)
                isTracking = false
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun playReleaseSound() {
        val toneG = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 100)
        toneG.startTone(ToneGenerator.TONE_PROP_ACK, 200)
    }

    private fun runOnUiThread(action: () -> Unit) {
        Handler(Looper.getMainLooper()).post(action)
    }

    override fun onDestroy() {
        super.onDestroy()
        isServerRunning = false
        serverSocket?.close()
        if (::floatingView.isInitialized) {
            windowManager.removeView(floatingView)
        }
    }
}

// Sound and Gesture Callback bridge inside service
class ServiceSoundInterface(private val service: FloatingBubbleService) {
    @JavascriptInterface
    fun playGrabSound() {
        val toneG = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 100)
        toneG.startTone(ToneGenerator.TONE_PROP_BEEP2, 180)
        
        // Trigger direct file send when grab gesture is fired
        service.sendFileDirectly()
    }

    @JavascriptInterface
    fun playReleaseSound() {
        // Trigger file receive trigger logic
    }
}
