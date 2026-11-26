/**
 * POSScanner — Scanner kamera barcode untuk halaman Kasir (POS)
 * Menggunakan BarcodeScanner module (ZXing + Native, multi-browser).
 * Scan langsung menambah produk ke keranjang belanja.
 */
const POSScanner = {
  _modalOpen: false,

  // ---------------------------------------------------------------
  // BUKA MODAL SCANNER
  // ---------------------------------------------------------------

  open() {
    const modal = document.getElementById('posScannerModal');
    if (!modal) return;

    this._modalOpen = true;
    modal.classList.add('modal-open');

    // Tampilkan info engine
    const info = BarcodeScanner.getSupportInfo();
    const infoEl = document.getElementById('posScannerInfo');
    if (infoEl) {
      if (!info.supported) {
        infoEl.innerHTML = `<span class="text-danger">⚠️ Kamera tidak didukung di browser ini. Gunakan kolom input di bawah.</span>`;
      } else if (info.native) {
        infoEl.innerHTML = `<span class="text-emerald">⚡ Engine: Native BarcodeDetector API</span>`;
      } else {
        infoEl.innerHTML = `<span class="text-emerald">📦 Engine: ZXing (kompatibel semua browser)</span>`;
      }
    }

    // Reset status
    this._setStatus('idle');
    setTimeout(() => document.getElementById('posScannerManualInput')?.focus(), 150);
  },

  // ---------------------------------------------------------------
  // TUTUP MODAL SCANNER
  // ---------------------------------------------------------------

  close() {
    this._modalOpen = false;
    BarcodeScanner.stop();
    this._updateCameraUI(false);

    const modal = document.getElementById('posScannerModal');
    if (modal) modal.classList.remove('modal-open');

    // Kembalikan fokus ke input pencarian kasir
    setTimeout(() => {
      const searchInput = document.getElementById('posSearchInput');
      if (searchInput) { searchInput.focus(); searchInput.select(); }
    }, 100);
  },

  // ---------------------------------------------------------------
  // KAMERA
  // ---------------------------------------------------------------

  async startCamera() {
    const info = BarcodeScanner.getSupportInfo();
    if (!info.supported) {
      App.showToast('Browser ini tidak mendukung scan kamera. Gunakan Chrome, Edge, atau Firefox versi terbaru.', 'warning', 5000);
      return;
    }

    this._setStatus('starting');
    this._updateCameraUI(true);

    const videoEl  = document.getElementById('posScannerVideo');
    const canvasEl = document.getElementById('posScannerCanvas');

    const ok = await BarcodeScanner.start(
      videoEl,
      canvasEl,
      (code) => this._onCodeDetected(code),
      (errMsg) => {
        App.showToast(errMsg, 'error', 5000);
        this._setStatus('error');
        this._updateCameraUI(false);
      }
    );

    if (ok) {
      this._setStatus('scanning');
      // Tampilkan badge engine
      const info = BarcodeScanner.getSupportInfo();
      const badge = document.getElementById('posScanEngineBadge');
      if (badge) {
        badge.textContent = info.native ? '⚡ Native API' : '📦 ZXing Engine';
        badge.style.display = 'inline-block';
      }
    } else {
      this._updateCameraUI(false);
      this._setStatus('idle');
    }
  },

  stopCamera() {
    BarcodeScanner.stop();
    this._updateCameraUI(false);
    this._setStatus('idle');
  },

  _updateCameraUI(active) {
    const videoEl   = document.getElementById('posScannerVideo');
    const overlay   = document.getElementById('posScannerOverlay');
    const startBtn  = document.getElementById('posScanStartCamBtn');
    const stopBtn   = document.getElementById('posScanStopCamBtn');
    const badge     = document.getElementById('posScanEngineBadge');

    if (active) {
      if (overlay)  overlay.style.display  = 'block';
      if (startBtn) startBtn.style.display  = 'none';
      if (stopBtn)  stopBtn.style.display   = 'inline-flex';
    } else {
      if (videoEl)  videoEl.srcObject = null;
      if (overlay)  overlay.style.display   = 'none';
      if (startBtn) startBtn.style.display  = 'inline-flex';
      if (stopBtn)  stopBtn.style.display   = 'none';
      if (badge)    badge.style.display      = 'none';
    }
  },

  // ---------------------------------------------------------------
  // DETEKSI KODE
  // ---------------------------------------------------------------

  _onCodeDetected(code) {
    this._flashScanLine();
    this._processCode(code);
  },

  handleManualInput(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = document.getElementById('posScannerManualInput');
      const code = input?.value.trim();
      if (code) {
        this._processCode(code);
        if (input) input.value = '';
      }
    }
  },

  _processCode(code) {
    const product = State.products.find(p =>
      (p.barcode && p.barcode.toLowerCase() === code.toLowerCase()) ||
      (p.code    && p.code.toLowerCase()    === code.toLowerCase())
    );

    if (!product) {
      State.playSound('error');
      this._setStatus('notfound', code);
      App.showToast(`Produk "${code}" tidak ditemukan!`, 'error', 2500);
      return;
    }

    const added = State.addToCart(product, 1);
    if (added) {
      this._setStatus('added', product.name);
      App.showToast(`+1 ${product.name} → Keranjang`, 'success', 2000);
    } else {
      this._setStatus('error', product.name);
    }
  },

  // ---------------------------------------------------------------
  // STATUS DISPLAY
  // ---------------------------------------------------------------

  _setStatus(type, detail) {
    const el = document.getElementById('posScannerStatus');
    if (!el) return;

    const statusMap = {
      idle:     { icon: '📷', text: 'Tekan "Aktifkan Kamera" atau ketik kode di bawah.', cls: 'text-muted' },
      starting: { icon: '⏳', text: 'Memulai kamera...', cls: 'text-muted' },
      scanning: { icon: '🟢', text: 'Kamera aktif. Arahkan ke barcode barang.', cls: 'text-emerald' },
      added:    { icon: '✅', text: detail ? `+1 ${detail} ditambahkan ke keranjang!` : 'Produk ditambahkan.', cls: 'text-emerald' },
      notfound: { icon: '❌', text: detail ? `"${detail}" tidak ditemukan dalam database.` : 'Produk tidak ditemukan.', cls: 'text-danger' },
      error:    { icon: '⚠️', text: 'Gagal menambah produk (stok habis?).', cls: 'text-warning' }
    };

    const s = statusMap[type] || statusMap['idle'];
    el.innerHTML = `<span>${s.icon}</span> <span class="${s.cls}">${s.text}</span>`;
  },

  _flashScanLine() {
    const line = document.getElementById('posScanLine');
    if (!line) return;
    line.style.background = 'rgba(5,150,105,0.9)';
    line.style.height = '5px';
    setTimeout(() => {
      if (line) { line.style.background = ''; line.style.height = ''; }
    }, 280);
  }
};
