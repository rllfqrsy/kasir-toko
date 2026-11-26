/**
 * Stock Opname (Pengecekan Fisik Barang)
 * Memungkinkan kasir memindai barcode dari kamera atau scanner fisik
 * untuk menghitung stok aktual dan membandingkan dengan data sistem.
 * Engine kamera: BarcodeScanner module (ZXing + native fallback, multi-browser)
 */
const StockOpname = {
  currentSession: null,
  scannedItems: new Map(),

  async init() {
    await this.renderView();
  },

  // ---------------------------------------------------------------
  // RENDER VIEW
  // ---------------------------------------------------------------

  async renderView() {
    const opnames = await DB.getAllStockOpname();

    const historyHtml = opnames.length > 0 ? opnames.map(o => {
      const date = new Date(o.createdAt).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const statusBadge = o.status === 'completed'
        ? `<span class="stock-badge stock-safe">Selesai</span>`
        : `<span class="stock-badge stock-warning">Draft</span>`;
      const totalItems = (o.items || []).length;
      const selisih = (o.items || []).filter(i => i.physicalStock !== null && i.physicalStock !== i.systemStock).length;
      return `
        <tr>
          <td class="font-medium">${App.escapeHtml(o.name)}</td>
          <td class="text-xs text-muted">${date}</td>
          <td>${statusBadge}</td>
          <td class="text-center">${totalItems} produk</td>
          <td class="text-center ${selisih > 0 ? 'text-danger font-semibold' : 'text-muted'}">${selisih > 0 ? selisih + ' selisih' : '—'}</td>
          <td class="text-right table-actions">
            <button type="button" class="btn-action view" onclick="StockOpname.openDetailModal(${o.id})">📋 Detail</button>
            ${o.status !== 'completed' ? `<button type="button" class="btn-action" style="background:var(--danger);color:#fff;" onclick="StockOpname.continueSession(${o.id})">▶ Lanjutkan</button>` : ''}
          </td>
        </tr>
      `;
    }).join('') : `<tr><td colspan="6" class="empty-state text-muted">Belum ada data stock opname.</td></tr>`;

    const historyTbody = document.getElementById('opnameHistoryTbody');
    if (historyTbody) historyTbody.innerHTML = historyHtml;
  },

  // ---------------------------------------------------------------
  // MULAI / LANJUT SESI
  // ---------------------------------------------------------------

  startNewSession() {
    this.currentSession = null;
    this.scannedItems = new Map();
    this.openScannerModal();
  },

  async continueSession(id) {
    const all = await DB.getAllStockOpname();
    const session = all.find(o => o.id === id);
    if (!session) { App.showToast('Sesi opname tidak ditemukan!', 'error'); return; }
    this.currentSession = session;
    this.scannedItems = new Map();
    (session.items || []).forEach(item => {
      this.scannedItems.set(item.productId, {
        product: { id: item.productId, name: item.productName, barcode: item.barcode, code: item.code },
        systemStock: item.systemStock,
        physicalStock: item.physicalStock !== null ? item.physicalStock : null
      });
    });
    this.openScannerModal();
  },

  // ---------------------------------------------------------------
  // MODAL SCANNER
  // ---------------------------------------------------------------

  openScannerModal() {
    const modal = document.getElementById('opnameScannerModal');
    if (!modal) return;
    this.renderScanTable();
    modal.classList.add('modal-open');

    // Tampilkan info dukungan browser
    const info = BarcodeScanner.getSupportInfo();
    const infoEl = document.getElementById('opnameScannerInfo');
    if (infoEl) {
      if (info.native) {
        infoEl.textContent = '✅ Kamera barcode didukung penuh (Native API).';
        infoEl.className = 'text-xs text-emerald';
      } else if (info.zxing) {
        infoEl.textContent = '✅ Kamera barcode menggunakan ZXing (kompatibel semua browser).';
        infoEl.className = 'text-xs text-emerald';
      } else {
        infoEl.textContent = '⚠️ Kamera barcode tidak didukung. Gunakan input manual.';
        infoEl.className = 'text-xs text-warning';
      }
    }

    setTimeout(() => document.getElementById('opnameBarcodeInput')?.focus(), 200);
  },

  closeScannerModal() {
    BarcodeScanner.stop();
    this._updateCameraUI(false);
    document.getElementById('opnameScannerModal')?.classList.remove('modal-open');
  },

  // ---------------------------------------------------------------
  // TABEL HASIL SCAN
  // ---------------------------------------------------------------

  renderScanTable() {
    const tbody = document.getElementById('opnameScanTableBody');
    const countEl = document.getElementById('opnameScanCount');
    const selisihEl = document.getElementById('opnameSelisihCount');
    if (!tbody) return;

    const items = [...this.scannedItems.values()];
    if (countEl) countEl.textContent = `${items.length} produk discan`;

    const selisihCount = items.filter(it => it.physicalStock !== null && it.physicalStock !== it.systemStock).length;
    if (selisihEl) {
      selisihEl.textContent = selisihCount > 0 ? `${selisihCount} selisih ditemukan` : '—';
      selisihEl.className = selisihCount > 0 ? 'font-semibold text-danger' : 'text-muted';
    }

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state text-muted" style="padding:16px;">Belum ada barang yang di-scan. Scan barcode atau ketik kode barang di bawah.</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map((entry, idx) => {
      const p = entry.product;
      const physical = entry.physicalStock;
      const diff = physical !== null ? physical - entry.systemStock : null;
      const diffClass = diff === null ? '' : (diff > 0 ? 'text-emerald' : diff < 0 ? 'text-danger' : 'text-muted');
      const diffText = diff === null ? '—' : (diff > 0 ? `+${diff}` : `${diff}`);
      const rowStyle = diff !== null && diff !== 0 ? 'style="background:#fef2f2"' : '';

      return `
        <tr ${rowStyle}>
          <td class="text-muted text-xs">${idx + 1}</td>
          <td>
            <div class="font-medium">${App.escapeHtml(p.name)}</div>
            <div class="text-xs text-muted">${p.barcode || p.code || ''}</div>
          </td>
          <td class="text-center font-semibold">${entry.systemStock}</td>
          <td class="text-center">
            <input type="number" min="0" class="qty-input" style="width:70px; text-align:center;"
              value="${physical !== null ? physical : ''}"
              placeholder="—"
              onchange="StockOpname.updatePhysicalCount(${p.id}, this.value)"
              onfocus="this.select()">
          </td>
          <td class="text-center ${diffClass} font-bold">${diffText}</td>
        </tr>
      `;
    }).join('');
  },

  updatePhysicalCount(productId, value) {
    const entry = this.scannedItems.get(productId);
    if (!entry) return;
    const val = value === '' ? null : Math.max(0, Number(value) || 0);
    entry.physicalStock = val;
    this.scannedItems.set(productId, entry);
    // Refresh hanya badge selisih, tidak full re-render agar input tidak kehilangan fokus
    const items = [...this.scannedItems.values()];
    const selisihCount = items.filter(it => it.physicalStock !== null && it.physicalStock !== it.systemStock).length;
    const selisihEl = document.getElementById('opnameSelisihCount');
    if (selisihEl) {
      selisihEl.textContent = selisihCount > 0 ? `${selisihCount} selisih ditemukan` : '—';
      selisihEl.className = selisihCount > 0 ? 'font-semibold text-danger' : 'text-muted';
    }
  },

  // ---------------------------------------------------------------
  // KAMERA — menggunakan BarcodeScanner module
  // ---------------------------------------------------------------

  async startCamera() {
    const videoEl = document.getElementById('opnameCameraVideo');
    const canvasEl = document.getElementById('opnameScanCanvas');
    if (!videoEl) return;

    const info = BarcodeScanner.getSupportInfo();
    if (!info.supported) {
      App.showToast('Browser ini tidak mendukung scan kamera. Gunakan Chrome, Edge, atau Firefox versi terbaru.', 'warning', 5000);
      return;
    }

    this._updateCameraUI(true);
    App.showToast('Memulai kamera...', 'info', 2000);

    const ok = await BarcodeScanner.start(
      videoEl,
      canvasEl,
      (code) => this.processScannedCode(code),
      (errMsg) => {
        App.showToast(errMsg, 'error', 5000);
        this._updateCameraUI(false);
      }
    );

    if (!ok) {
      this._updateCameraUI(false);
    } else {
      App.showToast('Kamera aktif. Arahkan ke barcode barang.', 'info', 3000);
    }
  },

  stopCamera() {
    BarcodeScanner.stop();
    this._updateCameraUI(false);
  },

  _updateCameraUI(active) {
    const videoEl    = document.getElementById('opnameCameraVideo');
    const overlay    = document.getElementById('opnameCameraOverlay');
    const startBtn   = document.getElementById('opnameStartCameraBtn');
    const stopBtn    = document.getElementById('opnameStopCameraBtn');
    const engineBadge = document.getElementById('opnameScanEngineBadge');

    if (!active) {
      if (videoEl) videoEl.srcObject = null;
      if (overlay)  overlay.style.display = 'none';
      if (startBtn) startBtn.style.display = 'inline-flex';
      if (stopBtn)  stopBtn.style.display  = 'none';
    } else {
      if (overlay)  overlay.style.display = 'block';
      if (startBtn) startBtn.style.display = 'none';
      if (stopBtn)  stopBtn.style.display  = 'inline-flex';
      if (engineBadge) {
        const info = BarcodeScanner.getSupportInfo();
        engineBadge.textContent = info.native ? '⚡ Native API' : '📦 ZXing Engine';
        engineBadge.style.display = 'inline-block';
      }
    }
  },

  // ---------------------------------------------------------------
  // PROSES KODE YANG DISCAN
  // ---------------------------------------------------------------

  handleManualInput(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = document.getElementById('opnameBarcodeInput');
      const code = input?.value.trim();
      if (code) {
        this.processScannedCode(code);
        input.value = '';
        input.focus();
      }
    }
  },

  processScannedCode(code) {
    const product = State.products.find(p =>
      (p.barcode && p.barcode.toLowerCase() === code.toLowerCase()) ||
      (p.code    && p.code.toLowerCase()    === code.toLowerCase())
    );

    if (!product) {
      State.playSound('error');
      App.showToast(`Produk "${code}" tidak ditemukan!`, 'error', 2500);
      this._flashScanLine('red');
      return;
    }

    const existing = this.scannedItems.get(product.id);
    let count;
    if (existing) {
      count = (existing.physicalStock !== null ? existing.physicalStock : 0) + 1;
      existing.physicalStock = count;
      this.scannedItems.set(product.id, existing);
    } else {
      count = 1;
      this.scannedItems.set(product.id, {
        product,
        systemStock: product.stock,
        physicalStock: 1
      });
    }

    State.playSound('beep');
    App.showToast(`${product.name}: fisik = ${count}`, 'success', 1800);
    this._flashScanLine('green');
    this.renderScanTable();
  },

  _flashScanLine(color) {
    const line = document.getElementById('opnameScanLine');
    if (!line) return;
    line.style.background = color === 'green' ? 'rgba(5,150,105,0.9)' : 'rgba(239,68,68,0.9)';
    line.style.height = '5px';
    setTimeout(() => {
      if (line) { line.style.background = ''; line.style.height = ''; }
    }, 300);
  },

  // ---------------------------------------------------------------
  // SIMPAN OPNAME
  // ---------------------------------------------------------------

  async saveOpname(finalize = false) {
    if (this.scannedItems.size === 0) {
      App.showToast('Belum ada barang yang di-scan!', 'warning');
      return;
    }

    const name = document.getElementById('opnameSessionName')?.value.trim()
      || `Opname ${new Date().toLocaleDateString('id-ID')}`;

    const items = [...this.scannedItems.values()].map(entry => ({
      productId: entry.product.id,
      productName: entry.product.name,
      barcode: entry.product.barcode || '',
      code: entry.product.code || '',
      systemStock: entry.systemStock,
      physicalStock: entry.physicalStock
    }));

    try {
      if (this.currentSession) {
        await DB.updateStockOpname(this.currentSession.id, { name, items, status: finalize ? 'completed' : 'draft' });
        if (finalize) await DB.applyStockOpnameAdjustments(this.currentSession.id);
      } else {
        const created = await DB.createStockOpname({
          name, items,
          status: finalize ? 'completed' : 'draft',
          createdBy: State.storeSettings.cashierName || 'Kasir'
        });
        if (finalize) await DB.applyStockOpnameAdjustments(created.id);
      }

      App.showToast(finalize ? 'Opname selesai! Stok sudah diperbarui.' : 'Opname tersimpan sebagai draft.', 'success');

      if (finalize) {
        await State.refreshProducts();
        this.closeScannerModal();
      }

      await this.renderView();
    } catch (err) {
      App.showToast(`Gagal menyimpan opname: ${err.message}`, 'error');
    }
  },

  // ---------------------------------------------------------------
  // DETAIL OPNAME
  // ---------------------------------------------------------------

  async openDetailModal(id) {
    const all = await DB.getAllStockOpname();
    const opname = all.find(o => o.id === id);
    if (!opname) return;

    const modal = document.getElementById('opnameDetailModal');
    const body = document.getElementById('opnameDetailBody');
    if (!modal || !body) return;

    document.getElementById('opnameDetailTitle').textContent = `Detail Opname: ${opname.name}`;

    const rows = (opname.items || []).map((item, idx) => {
      const diff = item.physicalStock !== null ? item.physicalStock - item.systemStock : null;
      const diffClass = diff === null ? '' : (diff > 0 ? 'text-emerald' : diff < 0 ? 'text-danger' : 'text-muted');
      const diffText = diff === null ? '—' : (diff > 0 ? `+${diff}` : `${diff}`);
      const rowStyle = diff !== null && diff !== 0 ? 'style="background:#fef2f2"' : '';
      return `
        <tr ${rowStyle}>
          <td class="text-muted">${idx + 1}</td>
          <td class="font-medium">${App.escapeHtml(item.productName)}</td>
          <td class="text-muted text-xs">${item.barcode || item.code || '—'}</td>
          <td class="text-center">${item.systemStock}</td>
          <td class="text-center">${item.physicalStock !== null ? item.physicalStock : '—'}</td>
          <td class="text-center ${diffClass} font-bold">${diffText}</td>
        </tr>
      `;
    }).join('');

    const selisihItems = (opname.items || []).filter(i => i.physicalStock !== null && i.physicalStock !== i.systemStock);
    const dateFormatted = new Date(opname.createdAt).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    body.innerHTML = `
      <div class="form-grid-2 mb-3" style="gap:12px;">
        <div><span class="text-muted text-xs">Tanggal:</span><div class="font-medium">${dateFormatted}</div></div>
        <div><span class="text-muted text-xs">Status:</span><div>${opname.status === 'completed' ? '<span class="stock-badge stock-safe">Selesai</span>' : '<span class="stock-badge stock-warning">Draft</span>'}</div></div>
        <div><span class="text-muted text-xs">Total Produk:</span><div class="font-semibold">${(opname.items || []).length} produk</div></div>
        <div><span class="text-muted text-xs">Produk Selisih:</span><div class="font-semibold ${selisihItems.length > 0 ? 'text-danger' : 'text-muted'}">${selisihItems.length} produk</div></div>
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead><tr><th>#</th><th>Nama Produk</th><th>Barcode/Kode</th><th class="text-center">Stok Sistem</th><th class="text-center">Stok Fisik</th><th class="text-center">Selisih</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    modal.classList.add('modal-open');
  },

  closeDetailModal() {
    document.getElementById('opnameDetailModal')?.classList.remove('modal-open');
  }
};
