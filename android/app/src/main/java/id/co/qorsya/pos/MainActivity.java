package id.co.qorsya.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebResourceRequest;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
import androidx.webkit.WebViewClientCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.io.IOException;
import java.io.OutputStream;

public class MainActivity extends Activity {
    private static final int BLUETOOTH_PERMISSION_REQUEST = 1401;
    private static final long SCAN_DURATION_MS = 10000;
    private static final int BLE_CHUNK_SIZE = 20;
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, JSONObject> scannedDevices = new LinkedHashMap<>();
    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner bluetoothScanner;
    private ScanCallback scanCallback;
    private Runnable scanTimeoutRunnable;
    private String pendingAction;
    private String pendingRequestId;
    private String pendingAddress;
    private String pendingDeviceType;
    private String scanRequestId;
    private String connectRequestId;
    private String writeRequestId;
    private BluetoothGatt bluetoothGatt;
    private BluetoothGattCharacteristic writeCharacteristic;
    private BluetoothSocket classicSocket;
    private OutputStream classicOutput;
    private byte[] writeBuffer;
    private int writeOffset;
    private boolean writeWithoutResponse;

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        BluetoothManager manager = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
        bluetoothAdapter = manager == null ? null : manager.getAdapter();

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(new ServiceWorkerClientCompat() {
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !"appassets.androidplatform.net".equals(request.getUrl().getHost());
            }
        });
        webView.addJavascriptInterface(new NativePrinterBridge(), "NativePrinterBridge");
        setContentView(webView);
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
    }

    private String[] requiredPermissions(String action) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return action.equals("scan")
                    ? new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT}
                    : new String[]{Manifest.permission.BLUETOOTH_CONNECT};
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && action.equals("scan")) {
            return new String[]{Manifest.permission.ACCESS_FINE_LOCATION};
        }
        return new String[0];
    }

    private void runBluetoothAction(String action, String requestId, String address, String deviceType) {
        pendingAction = action;
        pendingRequestId = requestId;
        pendingAddress = address;
        pendingDeviceType = deviceType;
        String[] permissions = requiredPermissions(action);
        boolean missingPermission = false;
        for (String permission : permissions) {
            if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
                missingPermission = true;
                break;
            }
        }

        if (missingPermission) {
            requestPermissions(permissions, BLUETOOTH_PERMISSION_REQUEST);
        } else {
            executePendingAction();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != BLUETOOTH_PERMISSION_REQUEST) return;

        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) {
                String action = pendingAction;
                String requestId = pendingRequestId;
                clearPendingAction();
                completeAction(action, requestId, "Izin Bluetooth ditolak. Aktifkan izin Nearby devices di pengaturan Android.");
                return;
            }
        }
        executePendingAction();
    }

    private void executePendingAction() {
        String action = pendingAction;
        String requestId = pendingRequestId;
        String address = pendingAddress;
        String deviceType = pendingDeviceType;
        clearPendingAction();

        if ("scan".equals(action)) {
            startScan(requestId);
        } else if ("connect".equals(action)) {
            connectToPrinter(address, deviceType, requestId);
        }
    }

    private void clearPendingAction() {
        pendingAction = null;
        pendingRequestId = null;
        pendingAddress = null;
        pendingDeviceType = null;
    }

    private void completeAction(String action, String requestId, String error) {
        if ("scan".equals(action)) {
            completeScan(requestId, new JSONArray(), error);
        } else if ("connect".equals(action)) {
            completeConnect(requestId, false, error);
        }
    }

    @SuppressLint("MissingPermission")
    private void startScan(String requestId) {
        stopScan();
        scannedDevices.clear();
        addBondedDevices();

        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            completeScan(requestId, getScannedDevices(),
                    "Bluetooth mati. Nyalakan Bluetooth melalui pengaturan cepat Android.");
            return;
        }

        bluetoothScanner = bluetoothAdapter.getBluetoothLeScanner();
        if (bluetoothScanner == null) {
            JSONArray devices = getScannedDevices();
            completeScan(requestId, devices, devices.length() == 0
                    ? "BLE tidak tersedia. Pasangkan printer SPP melalui pengaturan Bluetooth Android."
                    : "");
            return;
        }

        scanRequestId = requestId;
        scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                handler.post(() -> addScanResult(result));
            }

            @Override
            public void onBatchScanResults(java.util.List<ScanResult> results) {
                handler.post(() -> {
                    for (ScanResult result : results) addScanResult(result);
                });
            }

            @Override
            public void onScanFailed(int errorCode) {
                handler.post(() -> finishScan("Pemindaian Bluetooth gagal (kode " + errorCode + ")."));
            }
        };

        try {
            bluetoothScanner.startScan(scanCallback);
            scanTimeoutRunnable = () -> finishScan("");
            handler.postDelayed(scanTimeoutRunnable, SCAN_DURATION_MS);
        } catch (SecurityException exception) {
            finishScan("Izin pemindaian Bluetooth tidak tersedia.");
        }
    }

    @SuppressLint("MissingPermission")
    private void addBondedDevices() {
        if (bluetoothAdapter == null) return;
        for (BluetoothDevice device : bluetoothAdapter.getBondedDevices()) {
            String type = device.getType() == BluetoothDevice.DEVICE_TYPE_LE ? "ble" : "classic";
            addDevice(device, type, null);
        }
    }

    @SuppressLint("MissingPermission")
    private void addScanResult(ScanResult result) {
        BluetoothDevice device = result.getDevice();
        if (device == null || device.getAddress() == null) return;

        String scanName = result.getScanRecord() == null ? null : result.getScanRecord().getDeviceName();
        addDevice(device, "ble", scanName);
    }

    @SuppressLint("MissingPermission")
    private void addDevice(BluetoothDevice device, String type, String scanName) {
        String name = device.getName();
        if ((name == null || name.trim().isEmpty()) && scanName != null) name = scanName;
        if (name == null || name.trim().isEmpty()) name = "Printer Bluetooth";

        try {
            JSONObject item = new JSONObject();
            item.put("address", device.getAddress());
            item.put("name", name);
            item.put("type", type);
            JSONObject existing = scannedDevices.get(device.getAddress());
            if (existing == null || "ble".equals(type)) scannedDevices.put(device.getAddress(), item);
        } catch (JSONException ignored) {
        }
    }

    @SuppressLint("MissingPermission")
    private void finishScan(String error) {
        if (scanCallback == null) return;
        if (scanTimeoutRunnable != null) {
            handler.removeCallbacks(scanTimeoutRunnable);
            scanTimeoutRunnable = null;
        }
        try {
            if (bluetoothScanner != null) bluetoothScanner.stopScan(scanCallback);
        } catch (SecurityException ignored) {
        }
        scanCallback = null;

        String requestId = scanRequestId;
        scanRequestId = null;
        JSONArray devices = getScannedDevices();
        if (error != null && !error.isEmpty() && devices.length() > 0) error = "";
        completeScan(requestId, devices, error);
    }

    private JSONArray getScannedDevices() {
        JSONArray devices = new JSONArray();
        for (JSONObject device : scannedDevices.values()) devices.put(device);
        return devices;
    }

    @SuppressLint("MissingPermission")
    private void stopScan() {
        if (scanTimeoutRunnable != null) {
            handler.removeCallbacks(scanTimeoutRunnable);
            scanTimeoutRunnable = null;
        }
        if (scanCallback != null && bluetoothScanner != null) {
            try {
                bluetoothScanner.stopScan(scanCallback);
            } catch (SecurityException ignored) {
            }
            scanCallback = null;
            String requestId = scanRequestId;
            scanRequestId = null;
            completeScan(requestId, getScannedDevices(), "Pemindaian Bluetooth dibatalkan.");
        }
    }

    @SuppressLint("MissingPermission")
    private void connectToPrinter(String address, String deviceType, String requestId) {
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            completeConnect(requestId, false, "Bluetooth mati. Nyalakan Bluetooth melalui pengaturan cepat Android.");
            return;
        }
        if (address == null || address.trim().isEmpty()) {
            completeConnect(requestId, false, "Alamat printer Bluetooth tidak valid.");
            return;
        }

        stopScan();
        connectRequestId = null;
        closeGatt();
        closeClassicSocket();
        if ("classic".equals(deviceType)) {
            connectToClassicPrinter(address, requestId);
            return;
        }

        try {
            connectRequestId = requestId;
            BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
            bluetoothGatt = device.connectGatt(this, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
            if (bluetoothGatt == null) {
                connectRequestId = null;
                completeConnect(requestId, false, "Tidak dapat memulai koneksi BLE ke printer.");
            }
        } catch (IllegalArgumentException | SecurityException exception) {
            connectRequestId = null;
            completeConnect(requestId, false, "Gagal membuka koneksi BLE: " + exception.getMessage());
        }
    }

    @SuppressLint("MissingPermission")
    private void connectToClassicPrinter(String address, String requestId) {
        connectRequestId = requestId;
        new Thread(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
                if (device.getBondState() != BluetoothDevice.BOND_BONDED) {
                    throw new IOException("Pasangkan printer SPP terlebih dahulu melalui Pengaturan Bluetooth Android.");
                }
                bluetoothAdapter.cancelDiscovery();
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                socket.connect();
                OutputStream output = socket.getOutputStream();
                BluetoothSocket connectedSocket = socket;
                handler.post(() -> {
                    if (!requestId.equals(connectRequestId)) {
                        closeSocket(connectedSocket);
                        return;
                    }
                    classicSocket = connectedSocket;
                    classicOutput = output;
                    connectRequestId = null;
                    completeConnect(requestId, true, "");
                });
            } catch (IOException | SecurityException exception) {
                closeSocket(socket);
                handler.post(() -> {
                    if (requestId.equals(connectRequestId)) connectRequestId = null;
                    completeConnect(requestId, false, "Koneksi Bluetooth SPP gagal: " + exception.getMessage());
                });
            }
        }).start();
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (gatt != bluetoothGatt) return;
            if (status != BluetoothGatt.GATT_SUCCESS) {
                failConnection("Koneksi Bluetooth gagal (status " + status + ").");
                return;
            }
            if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
                if (!gatt.discoverServices()) failConnection("Tidak dapat mencari layanan printer BLE.");
                return;
            }
            if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                String requestId = connectRequestId;
                connectRequestId = null;
                writeCharacteristic = null;
                if (requestId != null) completeConnect(requestId, false, "Printer menolak atau memutus koneksi BLE.");
                else callJavascript("onPrinterDisconnected()");
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (gatt != bluetoothGatt) return;
            if (status != BluetoothGatt.GATT_SUCCESS) {
                failConnection("Gagal membaca layanan printer BLE.");
                return;
            }

            BluetoothGattCharacteristic candidate = null;
            for (BluetoothGattService service : gatt.getServices()) {
                for (BluetoothGattCharacteristic characteristic : service.getCharacteristics()) {
                    int properties = characteristic.getProperties();
                    if ((properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0 ||
                            (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) {
                        candidate = characteristic;
                        if (isKnownPrinterService(service.getUuid())) break;
                    }
                }
                if (candidate != null && isKnownPrinterService(service.getUuid())) break;
            }

            if (candidate == null) {
                failConnection("Printer tidak menyediakan karakteristik BLE yang dapat ditulis.");
                return;
            }

            writeCharacteristic = candidate;
            String requestId = connectRequestId;
            connectRequestId = null;
            completeConnect(requestId, true, "");
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
            if (gatt != bluetoothGatt) return;
            if (writeRequestId == null || writeWithoutResponse) return;
            if (status != BluetoothGatt.GATT_SUCCESS) {
                finishWrite("Printer menolak data struk (status " + status + ").");
                return;
            }
            writeNextChunk();
        }
    };

    private boolean isKnownPrinterService(UUID uuid) {
        String value = uuid.toString().toLowerCase(Locale.ROOT);
        return value.startsWith("000018f0-") ||
                value.startsWith("0000ffe0-") ||
                value.startsWith("0000ff00-") ||
                value.startsWith("0000ae00-") ||
                value.startsWith("49535343-");
    }

    private void failConnection(String message) {
        String requestId = connectRequestId;
        connectRequestId = null;
        closeGatt();
        completeConnect(requestId, false, message);
    }

    @JavascriptInterface
    public void scanPrinters(String requestId) {
        runOnUiThread(() -> runBluetoothAction("scan", requestId, null, null));
    }

    @JavascriptInterface
    public void connectPrinter(String address, String deviceType, String requestId) {
        runOnUiThread(() -> runBluetoothAction("connect", requestId, address, deviceType));
    }

    @JavascriptInterface
    public void writeReceipt(String base64, String requestId) {
        runOnUiThread(() -> beginWrite(base64, requestId));
    }

    @JavascriptInterface
    public void disconnectPrinter() {
        runOnUiThread(() -> {
            closeGatt();
            closeClassicSocket();
        });
    }

    private void beginWrite(String base64, String requestId) {
        if (writeRequestId != null) {
            completeWrite(requestId, false, "Printer masih memproses cetakan sebelumnya.");
            return;
        }
        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            OutputStream output = classicOutput;
            BluetoothSocket socket = classicSocket;
            if (output != null && socket != null && socket.isConnected()) {
                writeRequestId = requestId;
                new Thread(() -> {
                    try {
                        output.write(data);
                        output.flush();
                        handler.post(() -> finishWrite(""));
                    } catch (IOException exception) {
                        handler.post(() -> {
                            closeClassicSocket();
                            finishWrite("Gagal mengirim struk melalui Bluetooth SPP: " + exception.getMessage());
                            callJavascript("onPrinterDisconnected()");
                        });
                    }
                }).start();
                return;
            }
            if (bluetoothGatt == null || writeCharacteristic == null) {
                completeWrite(requestId, false, "Printer Bluetooth belum terhubung.");
                return;
            }

            writeBuffer = data;
            writeOffset = 0;
            writeRequestId = requestId;
            int properties = writeCharacteristic.getProperties();
            writeWithoutResponse = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) == 0;
            writeCharacteristic.setWriteType(writeWithoutResponse
                    ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                    : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            writeNextChunk();
        } catch (IllegalArgumentException exception) {
            completeWrite(requestId, false, "Data struk tidak valid.");
        }
    }

    @SuppressLint("MissingPermission")
    private void writeNextChunk() {
        if (writeRequestId == null) return;
        if (writeOffset >= writeBuffer.length) {
            finishWrite("");
            return;
        }

        int end = Math.min(writeOffset + BLE_CHUNK_SIZE, writeBuffer.length);
        byte[] chunk = Arrays.copyOfRange(writeBuffer, writeOffset, end);
        writeOffset = end;
        if (!writeCharacteristic.setValue(chunk) || !bluetoothGatt.writeCharacteristic(writeCharacteristic)) {
            finishWrite("Gagal mengirim data ke printer BLE.");
            return;
        }

        if (writeWithoutResponse) {
            handler.postDelayed(this::writeNextChunk, 30);
        }
    }

    private void finishWrite(String error) {
        String requestId = writeRequestId;
        writeRequestId = null;
        writeBuffer = null;
        writeOffset = 0;
        completeWrite(requestId, error.isEmpty(), error);
    }

    private void closeGatt() {
        BluetoothGatt oldGatt = bluetoothGatt;
        bluetoothGatt = null;
        if (oldGatt != null) {
            try {
                oldGatt.disconnect();
                oldGatt.close();
            } catch (SecurityException ignored) {
            }
            bluetoothGatt = null;
        }
        writeCharacteristic = null;
        writeRequestId = null;
        writeBuffer = null;
    }

    private void closeClassicSocket() {
        BluetoothSocket socket = classicSocket;
        classicSocket = null;
        classicOutput = null;
        if (socket != null) closeSocket(socket);
    }

    private void closeSocket(BluetoothSocket socket) {
        if (socket == null) return;
        try {
            socket.close();
        } catch (IOException ignored) {
        }
    }

    private void completeScan(String requestId, JSONArray devices, String error) {
        if (requestId == null) return;
        callJavascript("onScanComplete(" + JSONObject.quote(requestId) + ", " +
                JSONObject.quote(devices.toString()) + ", " + JSONObject.quote(error == null ? "" : error) + ")");
    }

    private void completeConnect(String requestId, boolean success, String error) {
        if (requestId == null) return;
        callJavascript("onConnectComplete(" + JSONObject.quote(requestId) + ", " + success + ", " +
                JSONObject.quote(error == null ? "" : error) + ")");
    }

    private void completeWrite(String requestId, boolean success, String error) {
        if (requestId == null) return;
        callJavascript("onWriteComplete(" + JSONObject.quote(requestId) + ", " + success + ", " +
                JSONObject.quote(error == null ? "" : error) + ")");
    }

    private void callJavascript(String callback) {
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript(
                        "window.NativePrinterBridgeCallbacks && window.NativePrinterBridgeCallbacks." + callback,
                        null);
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        stopScan();
        closeGatt();
        closeClassicSocket();
        if (webView != null) {
            webView.removeJavascriptInterface("NativePrinterBridge");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    public final class NativePrinterBridge {
        @JavascriptInterface
        public void scanPrinters(String requestId) {
            MainActivity.this.scanPrinters(requestId);
        }

        @JavascriptInterface
        public void writeReceipt(String base64, String requestId) {
            MainActivity.this.writeReceipt(base64, requestId);
        }

        @JavascriptInterface
        public void disconnectPrinter() {
            runOnUiThread(() -> {
                closeGatt();
                closeClassicSocket();
            });
        }

        @JavascriptInterface
        public void connectPrinter(String address, String deviceType, String requestId) {
            MainActivity.this.connectPrinter(address, deviceType, requestId);
        }
    }
}
