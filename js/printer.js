/**
 * QZ Tray Direct Thermal Printing Service (ESC/POS 58mm & 80mm)
 * Direct printing without browser print dialog, with zero duplicate print prevention,
 * offline resilience, auto-reconnect, and local configuration persistence.
 */
const PrinterService = {
  isConnected: false,
  isConnecting: false,
  connectionPromise: null,
  isBluetoothConnected: false,
  isBluetoothConnecting: false,
  bluetoothDeviceAddress: '',
  nativeRequestSequence: 0,
  nativePendingRequests: new Map(),
  availablePrinters: [],
  config: {
    transport: 'qz',
    printerName: '',
    bluetoothDeviceId: '',
    bluetoothDeviceName: '',
    bluetoothDeviceType: '',
    bluetoothBaudRate: 9600,
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
    if (this.config.transport === 'bluetooth') {
      this.updateStatusUI();
    } else {
      this.initConnection();
    }
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
    this.updateTransportControls();
    this.updateStatusUI();
    App.showToast('Pengaturan printer berhasil disimpan!', 'success');
  },

  async initConnection(silent = true) {
    if (!window.qz) {
      if (!silent) App.showToast('Library QZ Tray tidak ditemukan di browser.', 'error');
      return false;
    }

    if (this.isConnected && qz.websocket.isActive()) return true;
    if (this.connectionPromise) return this.connectionPromise;

    this.isConnected = false;
    this.isConnecting = true;
    this.updateStatusUI();

    this.connectionPromise = (async () => {
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

        await this.refreshPrintersList();

        if (!silent) {
          App.showToast('Berhasil terhubung ke QZ Tray!', 'success');
        }
        return true;
      } catch (err) {
        this.isConnected = false;
        if (!silent) {
          console.warn('QZ Tray connection error:', err);
          App.showToast('Gagal terhubung ke QZ Tray. Pastikan aplikasi QZ Tray aktif di komputer.', 'warning');
        }
        return false;
      } finally {
        this.isConnecting = false;
        this.connectionPromise = null;
        this.updateStatusUI();
      }
    })();

    return this.connectionPromise;
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

  updateTransportControls(transport) {
    const selectedTransport = transport ||
      document.getElementById('settingPrinterTransport')?.value ||
      this.config.transport;
    const bluetoothControls = document.getElementById('bluetoothPrinterControls');
    const qzControls = document.getElementById('qzPrinterControls');
    const modeSelect = document.getElementById('settingPrintModeSelect');

    if (bluetoothControls) bluetoothControls.style.display = selectedTransport === 'bluetooth' ? 'block' : 'none';
    if (qzControls) qzControls.style.display = selectedTransport === 'qz' ? 'block' : 'none';
    if (modeSelect) {
      modeSelect.disabled = selectedTransport === 'bluetooth';
      if (selectedTransport === 'bluetooth') modeSelect.value = 'raw';
    }

    this.updateStatusUI();
  },

  async connectSelectedTransport() {
    const transport = document.getElementById('settingPrinterTransport')?.value || this.config.transport;
    if (transport === 'bluetooth') {
      const printerSelect = document.getElementById('settingBluetoothPrinterSelect');
      const selectedAddress = printerSelect?.value;
      const selectedType = printerSelect?.selectedOptions[0]?.dataset.type || this.config.bluetoothDeviceType;

      if (!window.NativePrinterBridge) {
        if (selectedType === 'serial' && selectedAddress) {
          return this.connectSerialBluetooth(selectedAddress);
        }
        if (this.config.bluetoothDeviceType === 'serial' && this.config.bluetoothDeviceId &&
            (!printerSelect || printerSelect.options.length <= 1)) {
          return this.connectSerialBluetooth(this.config.bluetoothDeviceId);
        }
        if (printerSelect && printerSelect.options.length > 1 && !selectedAddress) {
          App.showToast('Pilih port printer yang ditemukan terlebih dahulu.', 'warning');
          return false;
        }
        return this.connectQzForBluetoothFallback();
      }

      if (printerSelect && printerSelect.options.length > 1 && !selectedAddress) {
        App.showToast('Pilih printer Bluetooth yang ditemukan terlebih dahulu.', 'warning');
        return false;
      }
      const savedAddress = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(this.config.bluetoothDeviceId)
        ? this.config.bluetoothDeviceId
        : '';
      const address = selectedAddress || savedAddress;
      if (!address) {
        const devices = await this.scanBluetoothPrinters();
        if (Array.isArray(devices) && devices.length) {
          App.showToast('Pilih printer Bluetooth yang ditemukan, lalu tekan Hubungkan Printer.', 'info');
        }
        return false;
      }
      return this.connectBluetoothDevice(address, selectedType);
    }
    return this.initConnection(false);
  },

  async pairBluetoothPrinter() {
    return this.scanBluetoothPrinters();
  },

  async requestNativeBluetooth(method, args = []) {
    const bridge = window.NativePrinterBridge;
    if (!bridge || typeof bridge[method] !== 'function') {
      throw new Error('Bluetooth langsung hanya tersedia melalui aplikasi Android POS.');
    }

    const requestId = String(++this.nativeRequestSequence);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.nativePendingRequests.delete(requestId);
        reject(new Error('Aplikasi Android tidak merespons permintaan Bluetooth.'));
      }, 20000);

      this.nativePendingRequests.set(requestId, { resolve, reject, timeout });
      try {
        bridge[method](...args, requestId);
      } catch (err) {
        clearTimeout(timeout);
        this.nativePendingRequests.delete(requestId);
        reject(err);
      }
    });
  },

  completeNativeRequest(requestId, error, result) {
    const pending = this.nativePendingRequests.get(String(requestId));
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.nativePendingRequests.delete(String(requestId));
    if (error) pending.reject(new Error(error));
    else pending.resolve(result);
  },

  populateBluetoothPrinterDropdown(devices) {
    const select = document.getElementById('settingBluetoothPrinterSelect');
    if (!select) return;

    const options = devices.map(device => {
      const label = device.type === 'serial'
        ? `${device.name || 'Port Serial'} (${device.address})`
        : `${device.name || 'Printer Bluetooth'} (${device.type === 'classic' ? 'SPP' : 'BLE'})`;
      const selected = device.address === this.config.bluetoothDeviceId ? 'selected' : '';
      return `<option value="${App.escapeHtml(device.address)}" data-type="${device.type}" ${selected}>${App.escapeHtml(label)}</option>`;
    });

    select.innerHTML = options.length
      ? `<option value="">Pilih printer Bluetooth</option>${options.join('')}`
      : '<option value="">Tidak ada printer ditemukan</option>';
  },

  async scanBluetoothPrinters() {
    if (!window.NativePrinterBridge) {
      return this.connectQzForBluetoothFallback();
    }

    this.isBluetoothConnecting = true;
    this.updateStatusUI();

    try {
      const devices = await this.requestNativeBluetooth('scanPrinters');
      this.populateBluetoothPrinterDropdown(devices);
      if (devices.length) {
        App.showToast(`${devices.length} printer Bluetooth ditemukan.`, 'success');
      } else {
        App.showToast('Tidak ada printer ditemukan. Pastikan printer menyala dan dekat dengan tablet.', 'warning');
      }
      return devices;
    } catch (err) {
      console.error('Gagal memindai printer Bluetooth native:', err);
      App.showToast(`Gagal memindai printer Bluetooth: ${err.message || err}`, 'error');
      return false;
    } finally {
      this.isBluetoothConnecting = false;
      this.updateStatusUI();
    }
  },

  async connectQzForBluetoothFallback() {
    App.showToast(
      'Mencari port Bluetooth dan printer Windows melalui QZ Tray...',
      'info'
    );

    const connected = await this.initConnection(false);
    if (!connected) {
      App.showToast('Jalankan QZ Tray. Untuk koneksi Bluetooth langsung tanpa QZ Tray, gunakan APK Android POS.', 'error');
      return false;
    }

    if (window.qz?.serial?.findPorts) {
      try {
        const serialPorts = await qz.serial.findPorts();
        if (Array.isArray(serialPorts) && serialPorts.length) {
          const devices = serialPorts.map(port => ({
            address: port,
            name: `Port Serial ${port}`,
            type: 'serial'
          }));
          this.populateBluetoothPrinterDropdown(devices);
          App.showToast(
            `${serialPorts.length} port serial ditemukan. Pilih COM yang digunakan printer, lalu tekan Hubungkan Printer.`,
            'success'
          );
          return devices;
        }
      } catch (err) {
        console.warn('Gagal mencari port serial melalui QZ Tray:', err);
      }
    }

    const printers = await this.refreshPrintersList();
    if (!printers.length) {
      App.showToast(
        'Tidak ada port COM atau printer Windows ditemukan. Pasangkan printer sebagai port serial (SPP) atau instal driver printer Windows.',
        'warning'
      );
      return false;
    }

    const transportSelect = document.getElementById('settingPrinterTransport');
    if (transportSelect) transportSelect.value = 'qz';
    this.config.transport = 'qz';
    this.updateTransportControls('qz');
    App.showToast(
      'Printer OS ditemukan. Pilih printer pada daftar QZ Tray, lalu simpan pengaturan printer.',
      'success'
    );
    return printers;
  },

  async connectSerialBluetooth(port) {
    if (!port || !window.qz?.serial) {
      App.showToast('QZ Tray tidak menyediakan koneksi port serial pada perangkat ini.', 'error');
      return false;
    }

    if (this.isBluetoothConnected && port === this.bluetoothDeviceAddress) {
      this.updateStatusUI();
      return true;
    }

    this.isBluetoothConnecting = true;
    this.updateStatusUI();
    try {
      const connected = await this.initConnection(false);
      if (!connected) return false;

      await qz.serial.openPort(port, {
        baudRate: Number(this.config.bluetoothBaudRate) || 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'NONE',
        flowControl: 'NONE'
      });

      const select = document.getElementById('settingBluetoothPrinterSelect');
      const selectedName = select?.value === port
        ? select.selectedOptions[0]?.textContent.split(' (')[0]
        : '';
      this.config = {
        ...this.config,
        transport: 'bluetooth',
        bluetoothDeviceId: port,
        bluetoothDeviceName: selectedName || `Printer Bluetooth ${port}`,
        bluetoothDeviceType: 'serial'
      };
      this.isBluetoothConnected = true;
      this.bluetoothDeviceAddress = port;
      await DB.saveSetting('printer_config', this.config);
      this.updateStatusUI();
      App.showToast(`Terhubung ke printer Bluetooth melalui ${port}.`, 'success');
      return true;
    } catch (err) {
      this.isBluetoothConnected = false;
      console.error('Gagal membuka port serial printer:', err);
      App.showToast(`Gagal membuka ${port}: ${err.message || err}`, 'error');
      return false;
    } finally {
      this.isBluetoothConnecting = false;
      this.updateStatusUI();
    }
  },

  async restoreBluetoothConnection() {
    if (this.config.bluetoothDeviceType === 'serial' && this.config.bluetoothDeviceId) {
      return this.connectSerialBluetooth(this.config.bluetoothDeviceId);
    }
    if (!window.NativePrinterBridge ||
        !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(this.config.bluetoothDeviceId)) {
      this.updateStatusUI();
      return false;
    }

    try {
      return await this.connectBluetoothDevice(this.config.bluetoothDeviceId, this.config.bluetoothDeviceType);
    } catch (err) {
      console.warn('Tidak dapat menyambungkan ulang printer Bluetooth:', err);
      this.updateStatusUI();
      return false;
    }
  },

  async connectBluetoothDevice(address = this.config.bluetoothDeviceId, type = this.config.bluetoothDeviceType) {
    if (!address) {
      App.showToast('Pindai dan pilih printer Bluetooth terlebih dahulu.', 'warning');
      return false;
    }
    if (this.isBluetoothConnected && address === this.bluetoothDeviceAddress) {
      this.updateStatusUI();
      return true;
    }
    if (!window.NativePrinterBridge) {
      App.showToast('Bluetooth langsung hanya tersedia melalui aplikasi Android POS.', 'error');
      return false;
    }

    this.isBluetoothConnecting = true;
    this.updateStatusUI();
    try {
      await this.requestNativeBluetooth('connectPrinter', [address, type || 'ble']);
      const select = document.getElementById('settingBluetoothPrinterSelect');
      const selectedName = select?.value === address
        ? select.selectedOptions[0]?.textContent.split(' (')[0]
        : '';
      this.bluetoothDeviceAddress = address;
      this.config = {
        ...this.config,
        transport: 'bluetooth',
        bluetoothDeviceId: address,
        bluetoothDeviceName: selectedName || this.config.bluetoothDeviceName || 'Printer Bluetooth',
        bluetoothDeviceType: type || 'ble'
      };
      this.isBluetoothConnected = true;
      await DB.saveSetting('printer_config', this.config);
      this.updateStatusUI();
      App.showToast(`Terhubung ke ${this.config.bluetoothDeviceName}.`, 'success');
      return true;
    } catch (err) {
      this.isBluetoothConnected = false;
      console.error('Gagal menghubungkan printer Bluetooth native:', err);
      App.showToast(`Gagal menghubungkan printer: ${err.message || err}`, 'error');
      return false;
    } finally {
      this.isBluetoothConnecting = false;
      this.updateStatusUI();
    }
  },

  async writeBluetoothBytes(bytes) {
    if (!this.isBluetoothConnected) {
      throw new Error('Printer Bluetooth belum terhubung.');
    }

    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 = btoa(binary);
    if (this.config.bluetoothDeviceType === 'serial') {
      if (!window.qz?.serial || !this.isConnected || !qz.websocket.isActive()) {
        throw new Error('Koneksi QZ Tray atau port serial printer terputus.');
      }
      await qz.serial.sendData(this.config.bluetoothDeviceId, {
        type: 'BASE64',
        data: base64
      });
      return;
    }
    if (!window.NativePrinterBridge) {
      throw new Error('Bluetooth langsung hanya tersedia melalui aplikasi Android POS.');
    }
    await this.requestNativeBluetooth('writeReceipt', [base64]);
  },

  encodeEscPos(commands) {
    const text = commands.join('').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const bytes = [];
    for (const character of text) {
      const code = character.codePointAt(0);
      bytes.push(code <= 0x7f ? code : 0x3f);
    }
    return new Uint8Array(bytes);
  },

  async disconnectBluetoothPrinter() {
    if (this.config.bluetoothDeviceType === 'serial' && window.qz?.serial && this.bluetoothDeviceAddress) {
      await qz.serial.closePort(this.bluetoothDeviceAddress);
    }
    if (window.NativePrinterBridge?.disconnectPrinter) {
      window.NativePrinterBridge.disconnectPrinter();
    }
    this.isBluetoothConnected = false;
    this.bluetoothDeviceAddress = '';
    this.updateStatusUI();
  },

  updateStatusUI() {
    const badge = document.getElementById('printerStatusBadge');
    const statusText = document.getElementById('printerStatusText');
    const connectBtn = document.getElementById('printerConnectBtn');
    const bluetoothName = document.getElementById('bluetoothPrinterName');
    const transport = document.getElementById('settingPrinterTransport')?.value || this.config.transport;
    const isBluetooth = transport === 'bluetooth';
    const connected = isBluetooth ? this.isBluetoothConnected : this.isConnected;
    const connecting = isBluetooth ? this.isBluetoothConnecting : this.isConnecting;
    const printerName = isBluetooth
      ? this.config.bluetoothDeviceName || 'Printer BLE'
      : this.config.printerName || 'Printer Aktif';

    if (badge) {
      badge.className = `status-badge ${connected ? 'status-online' : 'status-offline'}`;
      const state = connected ? 'Terhubung' : connecting ? 'Menghubungkan...' : 'Tidak Terhubung';
      badge.innerHTML = `<span class="status-dot"></span> ${isBluetooth ? 'Bluetooth' : 'QZ Tray'}: ${state}`;
    }

    if (statusText) {
      const transportName = isBluetooth ? 'Bluetooth' : 'QZ Tray';
      if (connected) {
        statusText.textContent = `${transportName} terhubung. Printer: ${printerName}.`;
      } else if (connecting) {
        statusText.textContent = `Sedang menghubungkan ${transportName}...`;
      } else if (isBluetooth && !window.NativePrinterBridge) {
        statusText.textContent = 'Gunakan QZ Tray untuk mencari port COM Bluetooth (SPP) atau printer Windows. Printer Bluetooth yang hanya tertaut tidak selalu menyediakan port COM.';
      } else if (isBluetooth && !this.config.bluetoothDeviceId) {
        statusText.textContent = 'Pindai printer Bluetooth, pilih perangkat, lalu hubungkan.';
      } else {
        statusText.textContent = isBluetooth
          ? `Printer ${printerName} belum terhubung. Tekan Hubungkan Printer Bluetooth.`
          : 'QZ Tray tidak terhubung. Pilih Bluetooth dan gunakan APK Android POS untuk cetak langsung.';
      }
    }

    if (bluetoothName) {
      bluetoothName.textContent = this.config.bluetoothDeviceName
        ? `Printer tersimpan: ${this.config.bluetoothDeviceName}`
        : 'Belum ada printer Bluetooth tersimpan.';
    }

    if (connectBtn) {
      connectBtn.textContent = isBluetooth && !window.NativePrinterBridge && this.config.bluetoothDeviceType !== 'serial'
        ? '🔌 Cari via QZ Tray'
        : connected
          ? `🔄 ${isBluetooth ? 'Sambungkan Ulang' : 'Refresh Printer'}`
          : `🔌 Hubungkan ${isBluetooth ? (this.config.bluetoothDeviceType === 'serial' ? 'Port Bluetooth' : 'Printer Bluetooth') : 'QZ Tray'}`;
      connectBtn.disabled = connecting || (isBluetooth && !window.NativePrinterBridge && !window.qz);
    }

    const bluetoothScanBtn = document.getElementById('bluetoothPrinterScanBtn');
    if (bluetoothScanBtn) {
      bluetoothScanBtn.textContent = window.NativePrinterBridge
        ? '🔎 Cari Printer Bluetooth'
        : '🔎 Cari Printer via QZ Tray';
      bluetoothScanBtn.disabled = connecting || (!window.NativePrinterBridge && !window.qz);
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

    if (this.config.transport === 'bluetooth') {
      try {
        if (!this.isBluetoothConnected) {
          const connected = this.config.bluetoothDeviceType === 'serial'
            ? await this.connectSerialBluetooth(this.config.bluetoothDeviceId)
            : await this.connectBluetoothDevice();
          if (!connected) return false;
        }

        const commands = this.buildEscPosReceipt(tx);
        await this.writeBluetoothBytes(this.encodeEscPos(commands));
        this.printedInvoices.add(tx.invoiceNo);
        State.playSound('success');
        App.showToast(`Nota ${tx.invoiceNo} berhasil dikirim ke ${this.config.bluetoothDeviceName || 'printer Bluetooth'}!`, 'success');
        return true;
      } catch (err) {
        console.error('Bluetooth direct print error:', err);
        State.playSound('error');
        App.showToast(`Gagal mencetak melalui Bluetooth: ${err.message || err}`, 'error');
        return false;
      }
    }

    // Try connecting to QZ Tray if not connected yet
    if (!this.isConnected || !qz.websocket.isActive()) {
      this.isConnected = false;
      const ok = await this.initConnection(true);
      if (!ok) {
        console.warn('QZ Tray tidak aktif saat print receipt');
        App.showToast('Gagal terhubung ke QZ Tray. Periksa aplikasi QZ Tray dan printer yang dipilih.', 'error');
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
    const isBluetooth = this.config.transport === 'bluetooth';
    try {
      if (isBluetooth && !this.isBluetoothConnected) {
        const connected = this.config.bluetoothDeviceType === 'serial'
          ? await this.connectSerialBluetooth(this.config.bluetoothDeviceId)
          : await this.connectBluetoothDevice();
        if (!connected) return;
      } else if (!isBluetooth && !this.isConnected) {
        const ok = await this.initConnection(false);
        if (!ok) return;
      }

      if (!isBluetooth && !this.config.printerName) {
        App.showToast('Pilih printer terlebih dahulu sebelum uji cetak!', 'warning');
        return;
      }

      const selectedPrinter = isBluetooth ? this.config.bluetoothDeviceName : this.config.printerName;
      App.showToast(`Mengirim uji cetak ke ${selectedPrinter}...`, 'info');

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
        'Printer: ' + (isBluetooth ? this.config.bluetoothDeviceName : this.config.printerName) + '\n',
        'Lebar Kertas: ' + this.config.paperWidth + ` (${maxChars} kolom)\n`,
        'Mode Cetak: ' + (isBluetooth || this.config.printMode === 'raw' ? 'ESC/POS Raw' : 'Pixel HTML') + '\n',
        divider + '\n',
        '12345678901234567890123456789012' + (is80mm ? '3456789012' : '') + '\n',
        doubleDivider + '\n',
        ESC + 'a' + '\x01',                            // Center
        'Printer Thermal Berfungsi Normal!\n',
        'Siap digunakan untuk transaksi kasir.\n',
        '\n\n\n',
        this.config.cutPaper ? GS + 'V' + '\x41' + '\x03' : ''
      ];

      if (isBluetooth) {
        await this.writeBluetoothBytes(this.encodeEscPos(commands));
      } else {
        const qzConfig = qz.configs.create(this.config.printerName, {
          encoding: 'Cp437'
        });
        await qz.print(qzConfig, commands);
      }

      State.playSound('success');
      App.showToast(`Uji cetak berhasil terkirim ke printer ${isBluetooth ? this.config.bluetoothDeviceName : this.config.printerName}!`, 'success');
    } catch (err) {
      console.error('Test print failed:', err);
      State.playSound('error');
      App.showToast(`Uji cetak gagal: ${err.message || err}`, 'error');
    }
  }
};

window.NativePrinterBridgeCallbacks = {
  onScanComplete(requestId, devicesJson, error) {
    let devices = [];
    if (!error) {
      try {
        devices = JSON.parse(devicesJson || '[]');
      } catch (err) {
        error = `Respons pemindaian Bluetooth tidak valid: ${err.message}`;
      }
    }
    PrinterService.completeNativeRequest(requestId, error, devices);
  },

  onConnectComplete(requestId, success, error) {
    PrinterService.completeNativeRequest(
      requestId,
      success ? '' : error || 'Koneksi Bluetooth gagal.',
      Boolean(success)
    );
  },

  onWriteComplete(requestId, success, error) {
    PrinterService.completeNativeRequest(
      requestId,
      success ? '' : error || 'Pengiriman struk gagal.',
      Boolean(success)
    );
  },

  onPrinterDisconnected() {
    PrinterService.isBluetoothConnected = false;
    PrinterService.updateStatusUI();
  }
};

