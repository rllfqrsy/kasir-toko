/**
 * QZ Tray Direct Thermal Printing Service (ESC/POS 58mm & 80mm)
 * Direct printing without browser print dialog, with zero duplicate print prevention,
 * offline resilience, auto-reconnect, and local configuration persistence.
 */
const PrinterService = {
  isConnected: false,
  isConnecting: false,
  availablePrinters: [],
  config: {
    printerName: '',
    autoPrint: true,
    paperWidth: '58mm', // '58mm' (32 columns) or '80mm' (42/48 columns)
    printMode: 'raw',   // 'raw' (ESC/POS bytes) or 'html' (Pixel HTML)
    cutPaper: true,
    openDrawer: false
  },
  printedInvoices: new Set(), // Prevents duplicate prints for the same transaction

  async init() {
    await this.loadConfig();
    this.setupQZSecurity();
    this.initConnection();
  },

  setupQZSecurity() {
    if (!window.qz) return;

    // Allow unsigned localhost connection without SSL cert error popups
    qz.security.setCertificatePromise((resolve) => {
      resolve();
    });

    qz.security.setSignaturePromise((toSign) => {
      return (resolve) => {
        resolve();
      };
    });
  },

  async loadConfig() {
    try {
      const saved = await DB.getSetting('printer_config');
      if (saved) {
        this.config = { ...this.config, ...saved };
      }
    } catch (e) {
      console.warn('Gagal membaca konfigurasi printer:', e);
    }
  },

  async saveConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    await DB.saveSetting('printer_config', this.config);
    this.updateStatusUI();
    App.showToast('Pengaturan printer berhasil disimpan!', 'success');
  },

  async initConnection(silent = true) {
    if (!window.qz) {
      if (!silent) App.showToast('Library QZ Tray tidak ditemukan di browser.', 'error');
      return false;
    }

    if (this.isConnected || this.isConnecting) return true;

    this.isConnecting = true;
    this.updateStatusUI();

    try {
      if (!qz.websocket.isActive()) {
        await qz.websocket.connect({
          retries: 2,
          delay: 1
        });
      }

      this.isConnected = true;
      this.isConnecting = false;
      this.updateStatusUI();

      // Find all available OS printers
      await this.refreshPrintersList();

      if (!silent) {
        App.showToast('Berhasil terhubung ke QZ Tray!', 'success');
      }
      return true;
    } catch (err) {
      this.isConnected = false;
      this.isConnecting = false;
      this.updateStatusUI();
      if (!silent) {
        console.warn('QZ Tray connection error:', err);
        App.showToast('Gagal terhubung ke QZ Tray. Pastikan aplikasi QZ Tray aktif di komputer.', 'warning');
      }
      return false;
    }
  },

  async refreshPrintersList() {
    if (!this.isConnected || !window.qz) return [];

    try {
      const list = await qz.printers.find();
      this.availablePrinters = list || [];

      // If no printer selected yet, pick system default or first printer
      if (!this.config.printerName && this.availablePrinters.length > 0) {
        try {
          const defaultPrn = await qz.printers.getDefault();
          this.config.printerName = defaultPrn || this.availablePrinters[0];
        } catch (e) {
          this.config.printerName = this.availablePrinters[0];
        }
      }

      this.populatePrinterDropdown();
      return this.availablePrinters;
    } catch (err) {
      console.warn('Gagal mencari printer:', err);
      return [];
    }
  },

  populatePrinterDropdown() {
    const select = document.getElementById('settingPrinterSelect');
    if (!select) return;

    if (this.availablePrinters.length === 0) {
      select.innerHTML = '<option value="">-- Tidak ada printer terdeteksi --</option>';
      return;
    }

    select.innerHTML = this.availablePrinters.map(p => {
      const isSelected = p === this.config.printerName ? 'selected' : '';
      return `<option value="${App.escapeHtml(p)}" ${isSelected}>${App.escapeHtml(p)}</option>`;
    }).join('');
  },

  updateStatusUI() {
    const badge = document.getElementById('printerStatusBadge');
    const statusText = document.getElementById('printerStatusText');
    const connectBtn = document.getElementById('printerConnectBtn');

    if (badge) {
      if (this.isConnected) {
        badge.className = 'status-badge status-online';
        badge.innerHTML = `<span class="status-dot"></span> QZ Tray: Terhubung (${this.config.printerName || 'Printer Aktif'})`;
      } else if (this.isConnecting) {
        badge.className = 'status-badge status-offline';
        badge.innerHTML = `<span class="status-dot"></span> Menghubungkan QZ Tray...`;
      } else {
        badge.className = 'status-badge status-offline';
        badge.innerHTML = `<span class="status-dot"></span> QZ Tray: Tidak Terhubung`;
      }
    }

    if (statusText) {
      if (this.isConnected) {
        statusText.innerHTML = `<span class="text-emerald font-semibold">🟢 QZ Tray Terhubung</span> (Printer: <strong>${this.config.printerName || 'Belum dipilih'}</strong>)`;
      } else if (this.isConnecting) {
        statusText.innerHTML = `<span class="text-warning font-semibold">🟡 Sedang menghubungkan ke QZ Tray...</span>`;
      } else {
        statusText.innerHTML = `<span class="text-danger font-semibold">🔴 QZ Tray Tidak Terhubung</span> <br><small class="text-muted">Jalankan aplikasi QZ Tray di PC Anda untuk cetak nota otomatis tanpa dialog browser.</small>`;
      }
    }

    if (connectBtn) {
      connectBtn.textContent = this.isConnected ? '🔄 Refresh Printer' : '🔌 Hubungkan QZ Tray';
    }
  },

  // -------------------------------------------------------------
  // ESC/POS COMMAND BUILDER (FAST, CRISP THERMAL PRINTING)
  // -------------------------------------------------------------

  buildEscPosReceipt(tx) {
    const s = State.storeSettings;
    const is80mm = this.config.paperWidth === '80mm';
    const maxChars = is80mm ? 42 : 32;

    // Helper: format two columns (left-aligned text, right-aligned text)
    const padLine = (left, right) => {
      const l = String(left || '');
      const r = String(right || '');
      const spaceLen = maxChars - l.length - r.length;
      if (spaceLen > 0) {
        return l + ' '.repeat(spaceLen) + r;
      }
      return l + ' ' + r;
    };

    // Helper: center text
    const centerLine = (text) => {
      const t = String(text || '');
      const pad = Math.max(0, Math.floor((maxChars - t.length) / 2));
      return ' '.repeat(pad) + t;
    };

    const divider = '-'.repeat(maxChars);
    const doubleDivider = '='.repeat(maxChars);

    const dateFormatted = new Date(tx.date).toLocaleString('id-ID', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    // ESC/POS Commands
    const ESC = '\x1B';
    const GS = '\x1D';

    const CMD_INIT = ESC + '@';                     // Initialize printer
    const CMD_ALIGN_CENTER = ESC + 'a' + '\x01';    // Center align
    const CMD_ALIGN_LEFT = ESC + 'a' + '\x00';      // Left align
    const CMD_BOLD_ON = ESC + 'E' + '\x01';         // Bold ON
    const CMD_BOLD_OFF = ESC + 'E' + '\x00';        // Bold OFF
    const CMD_DOUBLE_ON = GS + '!' + '\x11';        // Double width & height
    const CMD_NORMAL = GS + '!' + '\x00';           // Normal text
    const CMD_CUT = GS + 'V' + '\x41' + '\x03';     // Paper Cut with 3-line feed
    const CMD_DRAWER = ESC + 'p' + '\x00' + '\x19' + '\xFA'; // Cash drawer kick

    let data = [];

    // Initialize
    data.push(CMD_INIT);

    // Optional Drawer Kick
    if (this.config.openDrawer) {
      data.push(CMD_DRAWER);
    }

    // Store Header (Centered & Bold)
    data.push(CMD_ALIGN_CENTER);
    data.push(CMD_BOLD_ON);
    data.push((s.storeName || 'TOKO KELONTONG QORSYA') + '\n');
    data.push(CMD_BOLD_OFF);

    if (s.address) {
      data.push(s.address + '\n');
    }
    if (s.phone) {
      data.push('Telp: ' + s.phone + '\n');
    }

    data.push(doubleDivider + '\n');

    // Transaction Meta
    data.push(CMD_ALIGN_LEFT);
    data.push(padLine('No. Nota:', tx.invoiceNo) + '\n');
    data.push(padLine('Waktu:', dateFormatted) + '\n');
    data.push(padLine('Kasir:', tx.cashier || 'Kasir') + '\n');
    data.push(divider + '\n');

    // Line Items
    tx.items.forEach(it => {
      // Line 1: Item Name (up to full width)
      data.push(it.name + '\n');
      // Line 2: Qty x Price on left, Subtotal on right
      const qtyPrice = `${it.qty} x ${App.formatRupiah(it.sellPrice)}`;
      const subtotal = App.formatRupiah(it.subtotal);
      data.push(padLine('  ' + qtyPrice, subtotal) + '\n');
    });

    data.push(divider + '\n');

    // Totals & Payment
    data.push(padLine(`Total (${tx.totalQty} item):`, App.formatRupiah(tx.subtotal)) + '\n');
    if (tx.discount > 0) {
      data.push(padLine('Diskon:', '-' + App.formatRupiah(tx.discount)) + '\n');
    }

    data.push(CMD_BOLD_ON);
    data.push(padLine('GRAND TOTAL:', App.formatRupiah(tx.grandTotal)) + '\n');
    data.push(CMD_BOLD_OFF);

    data.push(padLine(`Bayar (${tx.paymentMethod}):`, App.formatRupiah(tx.amountPaid)) + '\n');
    data.push(padLine('Kembalian:', App.formatRupiah(tx.change)) + '\n');

    data.push(doubleDivider + '\n');

    // Footer Message
    data.push(CMD_ALIGN_CENTER);
    const footerLines = (s.receiptFooter || 'Terima kasih atas kunjungan Anda!').split('\n');
    footerLines.forEach(line => {
      if (line.trim()) data.push(line.trim() + '\n');
    });

    // Extra Feed Lines & Cut
    data.push('\n\n\n');
    if (this.config.cutPaper) {
      data.push(CMD_CUT);
    }

    return data;
  },

  // -------------------------------------------------------------
  // DIRECT PRINT EXECUTION (ESC/POS RAW OR ISOLATED HTML PIXEL)
  // -------------------------------------------------------------

  async printReceiptDirect(tx, forceReprint = false) {
    if (!tx || !tx.invoiceNo) {
      App.showToast('Data transaksi tidak valid untuk dicetak.', 'error');
      return false;
    }

    // DUPLICATE PRINT PREVENTION:
    // If not a forced reprint and already printed, prevent duplicate!
    if (!forceReprint && this.printedInvoices.has(tx.invoiceNo)) {
      console.log(`Nota ${tx.invoiceNo} sudah dicetak, mencegah cetak duplikat.`);
      return true;
    }

    // Try connecting to QZ Tray if not connected yet
    if (!this.isConnected) {
      const ok = await this.initConnection(true);
      if (!ok) {
        console.warn('QZ Tray tidak aktif saat print receipt');
        return false;
      }
    }

    if (!this.config.printerName) {
      App.showToast('Printer belum dipilih! Silakan pilih printer di Pengaturan Toko.', 'warning');
      return false;
    }

    try {
      const qzConfig = qz.configs.create(this.config.printerName, {
        encoding: 'Cp437',
        units: 'mm',
        colorType: 'monochrome'
      });

      if (this.config.printMode === 'raw') {
        // Mode 1: Pure ESC/POS Commands (Instant, authentic thermal print)
        const commands = this.buildEscPosReceipt(tx);
        await qz.print(qzConfig, commands);
      } else {
        // Mode 2: HTML Pixel (ISOLATED ONLY TO THE RECEIPT ELEMENT!)
        const receiptHtml = POS.generateReceiptHtml(tx);
        const wrappedHtml = `
          <!DOCTYPE html>
          <html>
            <head>z
              <meta charset="utf-8">
              <style>
                body { margin: 0; padding: 0; background: #fff; font-family: monospace; font-size: 12px; }
                .thermal-receipt { width: ${this.config.paperWidth === '80mm' ? '72mm' : '48mm'}; margin: 0 auto; padding: 4px; }
                .receipt-divider { overflow: hidden; white-space: nowrap; }
                .receipt-calc-row { display: flex; justify-content: space-between; }
                .receipt-meta div { display: flex; justify-content: space-between; }
                .receipt-item-details { display: flex; justify-content: space-between; }
                .text-center { text-align: center; }
                .font-bold { font-weight: bold; }
              </style>
            </head>
            <body>
              ${receiptHtml}
            </body>
          </html>
        `;

        await qz.print(qzConfig, [{
          type: 'pixel',
          format: 'html',
          flavor: 'plain',
          data: wrappedHtml
        }]);
      }

      // Mark invoice as printed to avoid duplicates
      this.printedInvoices.add(tx.invoiceNo);

      State.playSound('success');
      App.showToast(`Nota ${tx.invoiceNo} berhasil dicetak langsung ke ${this.config.printerName}!`, 'success');
      return true;
    } catch (err) {
      console.error('QZ Direct print error:', err);
      State.playSound('error');
      App.showToast(`Gagal mencetak ke printer "${this.config.printerName}": ${err.message || err}`, 'error');
      return false;
    }
  },

  // -------------------------------------------------------------
  // TEST PRINT (UJI CETAK PRINTER)
  // -------------------------------------------------------------

  async testPrint() {
    if (!this.isConnected) {
      const ok = await this.initConnection(false);
      if (!ok) return;
    }

    if (!this.config.printerName) {
      App.showToast('Pilih printer terlebih dahulu sebelum uji cetak!', 'warning');
      return;
    }

    try {
      App.showToast(`Mengirim uji cetak ke ${this.config.printerName}...`, 'info');

      const is80mm = this.config.paperWidth === '80mm';
      const maxChars = is80mm ? 42 : 32;
      const divider = '-'.repeat(maxChars);
      const doubleDivider = '='.repeat(maxChars);

      const ESC = '\x1B';
      const GS = '\x1D';

      const commands = [
        ESC + '@',                                     // Init
        ESC + 'a' + '\x01',                            // Center
        ESC + 'E' + '\x01',                            // Bold ON
        GS + '!' + '\x11',                             // Double size
        'TEST PRINT POS\n',
        GS + '!' + '\x00',                             // Normal
        (State.storeSettings.storeName || 'TOKO QORSYA') + '\n',
        ESC + 'E' + '\x00',                            // Bold OFF
        doubleDivider + '\n',
        ESC + 'a' + '\x00',                            // Left
        'Waktu: ' + new Date().toLocaleString('id-ID') + '\n',
        'Printer: ' + this.config.printerName + '\n',
        'Lebar Kertas: ' + this.config.paperWidth + ` (${maxChars} kolom)\n`,
        'Mode Cetak: ' + (this.config.printMode === 'raw' ? 'ESC/POS Raw' : 'Pixel HTML') + '\n',
        divider + '\n',
        '12345678901234567890123456789012' + (is80mm ? '3456789012' : '') + '\n',
        doubleDivider + '\n',
        ESC + 'a' + '\x01',                            // Center
        'Printer Thermal Berfungsi Normal!\n',
        'Siap digunakan untuk transaksi kasir.\n',
        '\n\n\n',
        GS + 'V' + '\x41' + '\x03'                      // Cut
      ];

      const qzConfig = qz.configs.create(this.config.printerName, {
        encoding: 'Cp437'
      });

      await qz.print(qzConfig, commands);

      State.playSound('success');
      App.showToast(`Uji cetak berhasil terkirim ke printer ${this.config.printerName}!`, 'success');
    } catch (err) {
      console.error('Test print failed:', err);
      State.playSound('error');
      App.showToast(`Uji cetak gagal: ${err.message || err}`, 'error');
    }
  }
};

