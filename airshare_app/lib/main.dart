import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:permission_handler/permission_handler.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Request camera and storage permissions on startup
  await Permission.camera.request();
  await Permission.microphone.request(); // Optional but helpful
  
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AirShare App',
      theme: ThemeData.dark().copyWith(
        primaryColor: const Color(0xFF10B981),
        scaffoldBackgroundColor: const Color(0xFF07080C),
      ),
      home: const ServerConfigScreen(),
      debugShowCheckedModeBanner: false,
    );
  }
}

class ServerConfigScreen extends StatefulWidget {
  const ServerConfigScreen({super.key});

  @override
  State<ServerConfigScreen> createState() => _ServerConfigScreenState();
}

class _ServerConfigScreenState extends State<ServerConfigScreen> {
  final TextEditingController _ipController = TextEditingController(text: "192.168.1.");

  void _connect() {
    final ip = _ipController.text.trim();
    if (ip.isEmpty) return;
    
    final url = ip.startsWith("http") ? ip : "http://$ip:8000";
    
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => WebViewScreen(serverUrl: url),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.spatial_tracking, size: 72, color: Color(0xFF3B82F6)),
              const SizedBox(height: 16),
              const Text(
                'AirShare Daemon',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Text(
                'Enter your laptop IP to link app',
                style: TextStyle(color: Colors.grey),
              ),
              const SizedBox(height: 32),
              TextField(
                controller: _ipController,
                decoration: InputDecoration(
                  labelText: 'Laptop IP Address',
                  hintText: 'e.g. 192.168.1.100',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: _connect,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF3B82F6),
                  padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 15),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: const Text('Connect Link', style: TextStyle(fontSize: 16)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class WebViewScreen extends StatefulWidget {
  final String serverUrl;
  const WebViewScreen({super.key, required this.serverUrl});

  @override
  State<WebViewScreen> createState() => _WebViewScreenState();
}

class _WebViewScreenState extends State<WebViewScreen> {
  InAppWebViewController? webViewController;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AirShare Session'),
        backgroundColor: const Color(0xFF0D0F17),
      ),
      body: InAppWebView(
        initialUrlRequest: URLRequest(url: WebUri(widget.serverUrl)),
        initialSettings: InAppWebViewSettings(
          mediaPlaybackRequiresUserGesture: false,
          javaScriptEnabled: true,
          allowsInlineMediaPlayback: true,
          iframeAllow: "camera; microphone",
          iframeAllowFullscreen: true,
        ),
        onWebViewCreated: (controller) {
          webViewController = controller;
        },
        // Handlers to grant camera permission inside WebView WebRTC
        onPermissionRequest: (controller, request) async {
          return PermissionResponse(
            resources: request.resources,
            action: PermissionResponseAction.GRANT,
          );
        },
      ),
    );
  }
}
