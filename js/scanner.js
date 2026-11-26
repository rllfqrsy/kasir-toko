/**
 * BarcodeScanner - Modul Scanner Kamera Barcode Multi-Browser
 *
 * Strategi:
 *  1. Coba BarcodeDetector API (native, Chrome 83+, Edge, Android WebView)
 *  2. Fallback ke ZXing library (mendukung semua browser modern termasuk Firefox & Safari)
 *
 * API Publik:
 *   BarcodeScanner.start(videoEl, canvasEl, onDetect, onError)
 *   BarcodeScanner.stop()
 *   BarcodeScanner.isRunning()
 *   BarcodeScanner.getSupportInfo()
 */
const BarcodeScanner = {
  _stream: null,
  _animFrame: null,
  _zxingReader: null,
  _running: false,
  _useNative: false,
  _nativeDetector: null,
  _lastCode: '',
  _lastCodeTime: 0,
  _debounceMs: 1800,

  // ---------------------------------------------------------------
  // DETEKSI DUKUNGAN BROWSER
  // ---------------------------------------------------------------

  getSupportInfo() {
    const hasNative = 'BarcodeDetector' in window;
    const hasZXing = typeof window.ZXing !== 'undefined';
    const hasGetUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    return {
      native: hasNative,
      zxing: hasZXing,
      camera: hasGetUserMedia,
      supported: hasGetUserMedia && (hasNative || hasZXing)
    };
  },

  // ---------------------------------------------------------------
  // START SCANNER
  // ---------------------------------------------------------------

  async start(videoEl, canvasEl, onDetect, onError) {
    if (this._running) await this.stop();

    const info = this.getSupportInfo();
    if (!info.camera) {
      (onError || console.error)('Kamera tidak didukung di browser ini.');
      return false;
    }
    if (!info.native && !info.zxing) {
      (onError || console.error)('Tidak ada library barcode scanner yang tersedia.');
      return false;
    }

    // Pilih engine
    this._useNative = info.native;

    // Minta akses kamera — utamakan kamera belakang
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
    } catch (err) {
      const msg = err.name === 'NotAllowedError'
        ? 'Izin kamera ditolak. Aktifkan izin kamera di pengaturan browser.'
        : `Gagal membuka kamera: ${err.message}`;
      (onError || console.error)(msg);
      return false;
    }

    videoEl.srcObject = this._stream;
    videoEl.setAttribute('autoplay', 'true');
    videoEl.setAttribute('muted', 'true');
    videoEl.setAttribute('playsinline', 'true');

    await new Promise((resolve) => {
      videoEl.onloadedmetadata = () => { videoEl.play().then(resolve).catch(resolve); };
    });

    this._running = true;
    this._lastCode = '';
    this._lastCodeTime = 0;

    if (this._useNative) {
      await this._startNative(videoEl, onDetect, onError);
    } else {
      await this._startZXing(videoEl, canvasEl, onDetect, onError);
    }

    return true;
  },

  // ---------------------------------------------------------------
  // ENGINE 1: NATIVE BarcodeDetector API
  // ---------------------------------------------------------------

  async _startNative(videoEl, onDetect, onError) {
    try {
      this._nativeDetector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e', 'codabar', 'itf', 'data_matrix']
      });
    } catch (e) {
      // Fallback jika native gagal init
      this._useNative = false;
      if (typeof window.ZXing !== 'undefined') {
        const canvasEl = document.createElement('canvas');
        await this._startZXing(videoEl, canvasEl, onDetect, onError);
      }
      return;
    }

    const detect = async () => {
      if (!this._running) return;
      if (videoEl.readyState >= 2 && !videoEl.paused) {
        try {
          const barcodes = await this._nativeDetector.detect(videoEl);
          if (barcodes.length > 0) {
            this._handleCode(barcodes[0].rawValue, onDetect);
          }
        } catch (_) { /* frame belum siap */ }
      }
      this._animFrame = requestAnimationFrame(detect);
    };

    this._animFrame = requestAnimationFrame(detect);
  },

  // ---------------------------------------------------------------
  // ENGINE 2: ZXing Library (Fallback)
  // ---------------------------------------------------------------

  async _startZXing(videoEl, canvasEl, onDetect, onError) {
    if (!window.ZXing) {
      (onError || console.error)('ZXing library tidak ditemukan!');
      return;
    }

    // Pastikan canvas ada
    if (!canvasEl) {
      canvasEl = document.createElement('canvas');
    }

    const ctx = canvasEl.getContext('2d', { willReadFrequently: true });

    const decode = () => {
      if (!this._running) return;
      if (videoEl.readyState < 2 || videoEl.paused || videoEl.videoWidth === 0) {
        this._animFrame = requestAnimationFrame(decode);
        return;
      }

      canvasEl.width  = videoEl.videoWidth;
      canvasEl.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

      try {
        const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
        const luminanceSource = new ZXing.RGBLuminanceSource(imageData.data, canvasEl.width, canvasEl.height);
        const binaryBitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminanceSource));
        const hints = new Map();
        hints.set(ZXing.DecodeHintType.TRY_HARDER, false);
        const result = this._getZXingReader().decode(binaryBitmap, hints);
        if (result) {
          this._handleCode(result.getText(), onDetect);
        }
      } catch (e) {
        // NotFoundException normal saat tidak ada barcode di frame
      }

      this._animFrame = requestAnimationFrame(decode);
    };

    this._animFrame = requestAnimationFrame(decode);
  },

  _getZXingReader() {
    if (!this._zxingReader) {
      this._zxingReader = new ZXing.MultiFormatReader();
    }
    return this._zxingReader;
  },

  // ---------------------------------------------------------------
  // DEBOUNCE & CALLBACK
  // ---------------------------------------------------------------

  _handleCode(code, onDetect) {
    if (!code) return;
    const now = Date.now();
    if (code === this._lastCode && now - this._lastCodeTime < this._debounceMs) return;
    this._lastCode = code;
    this._lastCodeTime = now;
    onDetect(code);
  },

  // ---------------------------------------------------------------
  // STOP SCANNER
  // ---------------------------------------------------------------

  stop() {
    this._running = false;
    if (this._animFrame) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = null;
    }
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    this._zxingReader = null;
    this._nativeDetector = null;
    this._lastCode = '';
  },

  isRunning() {
    return this._running;
  }
};
