/**
 * Web Printer Helper and native Android Bluetooth printing service.
 */
const PrinterService = {
  isConnected: false,
  isConnecting: false,
  connectionPromise: null,
  helperSocket: null,
  helperRequestSequence: 0,
  helperPendingRequests: new Map(),
  isBluetoothConnected: false,
  isBluetoothConnecting: false,
  bluetoothDeviceAddress: '',
  nativeRequestSequence: 0,
  nativePendingRequests: new Map(),
  availablePrinterConfigs: [],
  config: {
    transport: 'helper',
    helperConfigId: '',
    helperConfigName: '',
    bluetoothDeviceId: '',
    bluetoothDeviceName: '',
    bluetoothDeviceType: '',
    autoPrint: true,
    paperWidth: '58mm', // '58mm' (32 columns) or '80mm' (42/48 columns)
    cutPaper: true,
    openDrawer: false
  },
  printedInvoices: new Set(), // Prevents duplicate prints for the same transaction

  async init() {
    await this.loadConfig();
    if (this.config.transport === 'bluetooth') {
      this.updateStatusUI();
    } else {
      this.initConnection();
    }
  },

  async discoverHelperWebSocketUrl() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch('http://127.0.0.1:8847/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'get_websocket_server_port', uid: 0 }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      const port = Number(result.data);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Port WebSocket Helper tidak valid.');
      }
      return `ws://127.0.0.1:${port}`;
    } catch (err) {
      console.debug('Port Web Printer Helper tidak ditemukan; mencoba port default:', err);
      return 'ws://127.0.0.1:8846';
    } finally {
      clearTimeout(timeout);
    }
  },

  async loadConfig() {
    try {
      const saved = await DB.getSetting('printer_config');
      if (saved) {
        this.config = { ...this.config, ...saved };
        const requiresHelperMigration = saved.transport === 'qz' ||
          (saved.transport === 'bluetooth' &&
            (saved.bluetoothDeviceType === 'serial' || !window.NativePrinterBridge));
        const hasObsoleteSettings = 'printerName' in saved ||
          'printMode' in saved || 'bluetoothBaudRate' in saved;
        delete this.config.printerName;
        delete this.config.printMode;
        delete this.config.bluetoothBaudRate;

        if (requiresHelperMigration) {
          this.config.transport = 'helper';
          if (saved.bluetoothDeviceType === 'serial' || !window.NativePrinterBridge) {
            this.config.bluetoothDeviceId = '';
            this.config.bluetoothDeviceName = '';
            this.config.bluetoothDeviceType = '';
          }
        }
        if (requiresHelperMigration || hasObsoleteSettings) {
          await DB.saveSetting('printer_config', this.config);
        }
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

  hasHelperConfig() {
    return this.config.helperConfigId !== '' && this.config.helperConfigId !== null &&
      this.config.helperConfigId !== undefined;
  },

  async initConnection(silent = true) {
    if (this.helperSocket?.readyState === WebSocket.OPEN) return true;
    if (this.connectionPromise) return this.connectionPromise;

    this.isConnected = false;
    this.isConnecting = true;
    this.updateStatusUI();

    this.connectionPromise = (async () => {
      let socket;
      try {
        const url = await this.discoverHelperWebSocketUrl();
        socket = new WebSocket(url);
        this.helperSocket = socket;
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Waktu koneksi ke Web Printer Helper habis.')), 5000);
          socket.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };
          socket.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('Tidak dapat terhubung ke Web Printer Helper.'));
          };
          socket.onclose = () => {
            clearTimeout(timeout);
            if (!this.isConnected) reject(new Error('Koneksi Web Printer Helper ditutup.'));
            this.handleHelperDisconnect();
          };
          socket.onmessage = event => this.handleHelperMessage(event.data);
        });

        this.isConnected = true;
        this.isConnecting = false;
        this.updateStatusUI();
        await this.refreshHelperConfigs(false);

        if (!silent) {
          App.showToast('Berhasil terhubung ke Web Printer Helper!', 'success');
        }
        return true;
      } catch (err) {
        this.isConnected = false;
        if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
        if (!silent) {
          console.warn('Web Printer Helper connection error:', err);
          App.showToast('Gagal terhubung ke Web Printer Helper. Pastikan aplikasinya aktif di komputer.', 'warning');
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

  handleHelperDisconnect() {
    this.isConnected = false;
    this.helperSocket = null;
    for (const [uid, pending] of this.helperPendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Koneksi Web Printer Helper terputus.'));
      this.helperPendingRequests.delete(uid);
    }
    this.updateStatusUI();
  },

  handleHelperMessage(rawMessage) {
    try {
      const response = JSON.parse(rawMessage);
      const pending = this.helperPendingRequests.get(String(response.uid));
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.helperPendingRequests.delete(String(response.uid));
      pending.resolve(response);
    } catch (err) {
      console.warn('Respons Web Printer Helper tidak valid:', err);
    }
  },

  async sendHelperRequest(method, data = {}) {
    const connected = await this.initConnection(true);
    if (!connected || this.helperSocket?.readyState !== WebSocket.OPEN) {
      throw new Error('Web Printer Helper tidak terhubung.');
    }

    const uid = String(++this.helperRequestSequence);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.helperPendingRequests.delete(uid);
        reject(new Error('Web Printer Helper tidak merespons permintaan.'));
      }, 20000);
      this.helperPendingRequests.set(uid, { resolve, reject, timeout });
      try {
        this.helperSocket.send(JSON.stringify({ uid: Number(uid), method, data }));
      } catch (err) {
        clearTimeout(timeout);
        this.helperPendingRequests.delete(uid);
        reject(err);
      }
    });
  },

  async refreshHelperConfigs(showError = true) {
    if (!this.isConnected) {
      const connected = await this.initConnection(!showError);
      if (!connected) return [];
    }

    try {
      const response = await this.sendHelperRequest('get_all_configs');
      if (!response.is_success) throw new Error(response.msg || 'Gagal membaca konfigurasi printer Helper.');
      this.availablePrinterConfigs = Array.isArray(response.data) ? response.data : [];
      if (!this.availablePrinterConfigs.some(
        config => String(config.id) === String(this.config.helperConfigId)
      )) {
        this.config.helperConfigId = '';
        this.config.helperConfigName = '';
      }
      this.populateHelperConfigDropdown();
      this.updateStatusUI();
      return this.availablePrinterConfigs;
    } catch (err) {
      console.warn('Gagal memuat konfigurasi Web Printer Helper:', err);
      this.availablePrinterConfigs = [];
      this.populateHelperConfigDropdown();
      this.updateStatusUI();
      if (showError) {
        App.showToast(`Gagal memuat konfigurasi printer Helper: ${err.message || err}`, 'error');
      }
      return [];
    }
  },

  populateHelperConfigDropdown() {
    const select = document.getElementById('settingHelperPrinterConfig');
    if (!select) return;

    if (this.availablePrinterConfigs.length === 0) {
      select.innerHTML = '<option value="">Buat konfigurasi printer di Helper, lalu muat ulang</option>';
      return;
    }

    select.innerHTML = '<option value="">Pilih konfigurasi printer Helper</option>' +
      this.availablePrinterConfigs.map(config => {
        const isSelected = String(config.id) === String(this.config.helperConfigId) ? 'selected' : '';
        return `<option value="${App.escapeHtml(config.id)}" ${isSelected}>${App.escapeHtml(config.name)}</option>`;
    }).join('');
  },

  updateTransportControls(transport) {
    const selectedTransport = transport ||
      document.getElementById('settingPrinterTransport')?.value ||
      this.config.transport;
    const bluetoothControls = document.getElementById('bluetoothPrinterControls');
    const helperControls = document.getElementById('helperPrinterControls');

    if (bluetoothControls) bluetoothControls.style.display = selectedTransport === 'bluetooth' ? 'block' : 'none';
    if (helperControls) helperControls.style.display = selectedTransport === 'helper' ? 'block' : 'none';

    this.updateStatusUI();
  },

  async connectSelectedTransport() {
    const transport = document.getElementById('settingPrinterTransport')?.value || this.config.transport;
    if (transport === 'helper') {
      return this.initConnection(false);
    }
    if (transport === 'bluetooth') {
      const printerSelect = document.getElementById('settingBluetoothPrinterSelect');
      const selectedAddress = printerSelect?.value;
      const selectedType = printerSelect?.selectedOptions[0]?.dataset.type || this.config.bluetoothDeviceType;

      if (!window.NativePrinterBridge) {
        App.showToast('Bluetooth langsung tersedia melalui APK Android. Di komputer, gunakan konfigurasi printer Web Printer Helper.', 'error');
        return false;
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
    return false;
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
      const label = `${device.name || 'Printer Bluetooth'} (${device.type === 'classic' ? 'SPP' : 'BLE'})`;
      const selected = device.address === this.config.bluetoothDeviceId ? 'selected' : '';
      return `<option value="${App.escapeHtml(device.address)}" data-type="${device.type}" ${selected}>${App.escapeHtml(label)}</option>`;
    });

    select.innerHTML = options.length
      ? `<option value="">Pilih printer Bluetooth</option>${options.join('')}`
      : '<option value="">Tidak ada printer ditemukan</option>';
  },

  async scanBluetoothPrinters() {
    if (!window.NativePrinterBridge) {
      App.showToast('Pemindaian Bluetooth langsung hanya tersedia melalui APK Android POS.', 'error');
      return false;
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

  async restoreBluetoothConnection() {
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
    const selectedPrinterName = isBluetooth
      ? this.config.bluetoothDeviceName || 'Printer BLE'
      : this.config.helperConfigName || 'Printer Aktif';

    if (badge) {
      badge.className = `status-badge ${connected ? 'status-online' : 'status-offline'}`;
      const state = connected ? 'Terhubung' : connecting ? 'Menghubungkan...' : 'Tidak Terhubung';
      badge.innerHTML = `<span class="status-dot"></span> ${isBluetooth ? 'Bluetooth' : 'Web Printer Helper'}: ${state}`;
    }

    if (statusText) {
      const transportName = isBluetooth ? 'Bluetooth' : 'Web Printer Helper';
      if (connected) {
        statusText.textContent = !isBluetooth && !this.hasHelperConfig()
          ? 'Web Printer Helper terhubung. Pilih konfigurasi printer lalu simpan pengaturan.'
          : `${transportName} terhubung. ${isBluetooth ? 'Printer' : 'Konfigurasi'}: ${selectedPrinterName}.`;
      } else if (connecting) {
        statusText.textContent = `Sedang menghubungkan ${transportName}...`;
      } else if (isBluetooth && !window.NativePrinterBridge) {
        statusText.textContent = 'Bluetooth langsung hanya tersedia melalui APK Android POS. Pada komputer, gunakan printer yang terpasang di Windows melalui Web Printer Helper.';
      } else if (isBluetooth && !this.config.bluetoothDeviceId) {
        statusText.textContent = 'Pindai printer Bluetooth, pilih perangkat, lalu hubungkan.';
      } else if (!isBluetooth && !this.config.helperConfigId) {
        statusText.textContent = 'Hubungkan Helper, pilih konfigurasi printer, lalu simpan pengaturan.';
      } else {
        statusText.textContent = isBluetooth
          ? `Printer ${selectedPrinterName} belum terhubung. Tekan Hubungkan Printer Bluetooth.`
          : 'Web Printer Helper tidak terhubung. Pastikan aplikasi berjalan di komputer ini.';
      }
    }

    if (bluetoothName) {
      bluetoothName.textContent = this.config.bluetoothDeviceName
        ? `Printer tersimpan: ${this.config.bluetoothDeviceName}`
        : 'Belum ada printer Bluetooth tersimpan.';
    }

    if (connectBtn) {
      connectBtn.textContent = isBluetooth && !window.NativePrinterBridge
        ? '🔌 Bluetooth tidak tersedia'
        : connected
          ? `🔄 ${isBluetooth ? 'Sambungkan Ulang' : 'Muat Ulang Konfigurasi'}`
          : `🔌 Hubungkan ${isBluetooth ? 'Printer Bluetooth' : 'Web Printer Helper'}`;
      connectBtn.disabled = connecting || (isBluetooth && !window.NativePrinterBridge);
    }

    const bluetoothScanBtn = document.getElementById('bluetoothPrinterScanBtn');
    if (bluetoothScanBtn) {
      bluetoothScanBtn.textContent = '🔎 Cari Printer Bluetooth';
      bluetoothScanBtn.disabled = connecting || !window.NativePrinterBridge;
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
  // WEB PRINTER HELPER PRINTING
  // -------------------------------------------------------------

  createReceiptPageUrl(receiptHtml) {
    const bytes = new TextEncoder().encode(receiptHtml);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const encodedHtml = btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const receiptUrl = new URL('receipt-print.html', window.location.href);
    receiptUrl.hash = encodedHtml;
    return receiptUrl.href;
  },

  async printHtmlWithHelper(receiptHtml) {
    if (!this.hasHelperConfig()) {
      await this.refreshHelperConfigs(false);
    }
    if (!this.hasHelperConfig()) {
      throw new Error('Pilih dan simpan konfigurasi printer Web Printer Helper terlebih dahulu.');
    }

    const config = this.availablePrinterConfigs.find(
      item => String(item.id) === String(this.config.helperConfigId)
    );
    const rawConfigId = config ? config.id : this.config.helperConfigId;
    const configId = Number.isFinite(Number(rawConfigId)) ? Number(rawConfigId) : rawConfigId;
    const response = await this.sendHelperRequest('print_page', {
      id: 0,
      config_id: configId,
      page_loaded_or_js_request: 'PAGE_LOADED',
      page_url: this.createReceiptPageUrl(receiptHtml)
    });
    if (!response.is_success) {
      throw new Error(response.msg || 'Web Printer Helper gagal mengirim struk ke printer.');
    }
    return response;
  },

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
          const connected = await this.connectBluetoothDevice();
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

    try {
      await this.printHtmlWithHelper(POS.generateReceiptHtml(tx));

      // Mark invoice as printed to avoid duplicates
      this.printedInvoices.add(tx.invoiceNo);

      State.playSound('success');
      App.showToast(`Nota ${tx.invoiceNo} berhasil dikirim ke ${this.config.helperConfigName || 'Web Printer Helper'}!`, 'success');
      return true;
    } catch (err) {
      console.error('Web Printer Helper print error:', err);
      State.playSound('error');
      App.showToast(`Gagal mencetak struk: ${err.message || err}`, 'error');
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
        const connected = await this.connectBluetoothDevice();
        if (!connected) return;
      } else if (!isBluetooth && !this.isConnected) {
        const ok = await this.initConnection(false);
        if (!ok) return;
      }

      if (!isBluetooth && !this.hasHelperConfig()) {
        await this.refreshHelperConfigs(false);
      }
      if (!isBluetooth && !this.hasHelperConfig()) {
        App.showToast('Pilih konfigurasi printer Web Printer Helper terlebih dahulu!', 'warning');
        return;
      }

      const selectedPrinter = isBluetooth ? this.config.bluetoothDeviceName : this.config.helperConfigName;
      App.showToast(`Mengirim uji cetak ke ${selectedPrinter}...`, 'info');

      const is80mm = this.config.paperWidth === '80mm';
      const maxChars = is80mm ? 42 : 32;
      const divider = '-'.repeat(maxChars);
      const doubleDivider = '='.repeat(maxChars);

      if (isBluetooth) {
        const ESC = '\x1B';
        const GS = '\x1D';
        const commands = [
          ESC + '@',
          ESC + 'a' + '\x01',
          ESC + 'E' + '\x01',
          GS + '!' + '\x11',
          'TEST PRINT POS\n',
          GS + '!' + '\x00',
          (State.storeSettings.storeName || 'TOKO QORSYA') + '\n',
          ESC + 'E' + '\x00',
          doubleDivider + '\n',
          ESC + 'a' + '\x00',
          'Waktu: ' + new Date().toLocaleString('id-ID') + '\n',
          'Printer: ' + this.config.bluetoothDeviceName + '\n',
          'Lebar Kertas: ' + this.config.paperWidth + ` (${maxChars} kolom)\n`,
          divider + '\n',
          '12345678901234567890123456789012' + (is80mm ? '3456789012' : '') + '\n',
          doubleDivider + '\n',
          ESC + 'a' + '\x01',
          'Printer Thermal Berfungsi Normal!\n',
          'Siap digunakan untuk transaksi kasir.\n',
          '\n\n\n',
          this.config.cutPaper ? GS + 'V' + '\x41' + '\x03' : ''
        ];
        await this.writeBluetoothBytes(this.encodeEscPos(commands));
      } else {
        const testHtml = `
          <div class="thermal-receipt ${is80mm ? 'receipt-80mm' : 'receipt-58mm'}">
            <div class="receipt-header text-center">
              <h2 class="receipt-store-name">TEST PRINT POS</h2>
              <p>${App.escapeHtml(State.storeSettings.storeName || 'TOKO QORSYA')}</p>
            </div>
            <div class="receipt-divider">${doubleDivider}</div>
            <div>Waktu: ${App.escapeHtml(new Date().toLocaleString('id-ID'))}</div>
            <div>Konfigurasi: ${App.escapeHtml(selectedPrinter || '')}</div>
            <div>Lebar kertas: ${this.config.paperWidth} (${maxChars} kolom)</div>
            <div class="receipt-divider">${divider}</div>
            <div>12345678901234567890123456789012${is80mm ? '3456789012' : ''}</div>
            <div class="receipt-divider">${doubleDivider}</div>
            <div class="receipt-footer text-center">Printer thermal berfungsi normal!</div>
          </div>
        `;
        await this.printHtmlWithHelper(testHtml);
      }

      State.playSound('success');
      App.showToast(`Uji cetak berhasil dikirim ke printer ${selectedPrinter}!`, 'success');
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

