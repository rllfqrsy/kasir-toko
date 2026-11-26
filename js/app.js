/**
 * Main Application Orchestrator & UI Controller
 */
const App = {
  async init() {
    console.log('Inisialisasi Toko Kelontong POS...');
    document.body.classList.add('pos-kiosk');
    this.updatePOSClock();
    this.posClockTimer = setInterval(() => this.updatePOSClock(), 1000);

    // 1. Initialize IndexedDB
    try {
      await DB.init();
      console.log('IndexedDB siap.');
    } catch (e) {
      console.error('Gagal inisialisasi IndexedDB:', e);
      this.showToast('Gagal memuat database browser!', 'error');
    }

    // 2. Load Store Settings & Products
    await State.loadSettings();
    await State.refreshProducts();

    // 3. Initialize Submodules
    POS.init();
    Products.init();
    Inventory.init();
    Transactions.init();
    ExcelService.init();
    BackupService.init();
    await PrinterService.init();
    await KasirSession.init();
    await StockOpname.init();

    // 4. Bind Global UI Events & Shortcuts
    this.bindGlobalEvents();
    this.updateOnlineBadge();
    this.initSettingsForm();

    // 5. Register PWA Service Worker
    this.registerServiceWorker();

    // If database is completely empty on first run, show welcoming toast with quick seed
    if (State.products.length === 0) {
      setTimeout(() => {
        this.showToast('Database masih kosong. Anda bisa klik "Data Contoh" di menu Produk!', 'info', 6000);
      }, 1200);
    }
  },

  bindGlobalEvents() {
    // Navigation Sidebar
    document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = btn.dataset.tab;
        if (tab) this.switchTab(tab);
      });
    });

    // Close any modal on Esc key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openModal = document.querySelector('.modal.modal-open');
        if (openModal) {
          openModal.classList.remove('modal-open');
        }
      }
      if (e.key === '?') {
        const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (tag !== 'input' && tag !== 'textarea') {
          e.preventDefault();
          this.openShortcutsModal();
        }
      }
    });

    // Network status
    window.addEventListener('online', () => this.updateOnlineBadge());
    window.addEventListener('offline', () => this.updateOnlineBadge());
  },

  updatePOSClock() {
    const now = new Date();
    const dateEl = document.getElementById('posClockDate');
    const timeEl = document.getElementById('posClockTime');
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    }
    if (timeEl) {
      timeEl.textContent = now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }) + ' WIB';
    }
  },

  // Mobile Sidebar Drawer
  toggleMobileSidebar() {
    const sidebar = document.querySelector('.app-sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.toggle('sidebar-open');
    if (overlay) overlay.classList.toggle('active');
  },

  closeMobileSidebar() {
    const sidebar = document.querySelector('.app-sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('sidebar-open');
    if (overlay) overlay.classList.remove('active');
  },

  switchTab(tabName) {
    State.activeTab = tabName;
    document.body.classList.toggle('pos-kiosk', tabName === 'pos');

    // Close any open mobile drawers
    this.closeMobileSidebar();
    if (tabName !== 'pos' && window.POS && typeof POS.closeMobileCart === 'function') {
      POS.closeMobileCart();
    }

    // Update sidebar buttons
    document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update mobile bottom nav buttons
    document.querySelectorAll('.bottom-nav-item').forEach(btn => {
      if (tabName === 'pos') {
        if (btn.dataset.tab === 'pos') {
          btn.classList.toggle('active', !window.POS || POS.mobileActiveView !== 'cart');
        } else if (btn.dataset.tab === 'cart') {
          btn.classList.toggle('active', window.POS && POS.mobileActiveView === 'cart');
        } else {
          btn.classList.remove('active');
        }
      } else {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
      }
    });

    // Update view panels
    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `view-${tabName}`);
    });

    // Specific tab activations
    if (tabName === 'pos') {
      if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches && window.POS) {
        POS.switchMobileView('catalog');
      }
      setTimeout(() => {
        const input = document.getElementById('posSearchInput');
        if (input) {
          input.focus();
          input.select();
        }
      }, 50);
    } else if (tabName === 'products') {
      Products.renderProductsList();
    } else if (tabName === 'inventory') {
      Inventory.renderRestockTable();
      Inventory.renderStockLogs();
    } else if (tabName === 'transactions') {
      Transactions.loadTransactions();
    } else if (tabName === 'kasir') {
      KasirSession.renderView();
    } else if (tabName === 'opname') {
      StockOpname.renderView();
    }
  },

  // -------------------------------------------------------------
  // SETTINGS FORM
  // -------------------------------------------------------------

  initSettingsForm() {
    const s = State.storeSettings;
    const nameInput = document.getElementById('settingStoreName');
    const addrInput = document.getElementById('settingStoreAddress');
    const phoneInput = document.getElementById('settingStorePhone');
    const footerInput = document.getElementById('settingReceiptFooter');
    const widthSelect = document.getElementById('settingPrinterWidth');
    const cashierInput = document.getElementById('settingCashierName');

    if (nameInput) nameInput.value = s.storeName || '';
    if (addrInput) addrInput.value = s.address || '';
    if (phoneInput) phoneInput.value = s.phone || '';
    if (footerInput) footerInput.value = s.receiptFooter || '';
    if (widthSelect) widthSelect.value = s.printerWidth || '58mm';
    if (cashierInput) cashierInput.value = s.cashierName || 'Kasir 1';

    // Update brand title in topbar
    const brandName = document.getElementById('topbarStoreName');
    if (brandName) brandName.textContent = s.storeName || 'TOKO KELONTONG QORSYA';

    // Populate printer configuration fields
    const pCfg = PrinterService.config;
    const transportSelect = document.getElementById('settingPrinterTransport');
    const pWidthSelect = document.getElementById('settingPrinterWidthSelect');
    const autoPrintCheck = document.getElementById('settingPrinterAutoPrint');
    const cutPaperCheck = document.getElementById('settingPrinterCutPaper');
    const openDrawerCheck = document.getElementById('settingPrinterOpenDrawer');

    if (transportSelect) transportSelect.value = pCfg.transport || 'helper';
    if (pWidthSelect) pWidthSelect.value = pCfg.paperWidth || '58mm';
    if (autoPrintCheck) autoPrintCheck.checked = pCfg.autoPrint !== false;
    if (cutPaperCheck) cutPaperCheck.checked = pCfg.cutPaper !== false;
    if (openDrawerCheck) openDrawerCheck.checked = pCfg.openDrawer === true;

    PrinterService.populateHelperConfigDropdown();
    PrinterService.updateTransportControls(pCfg.transport || 'helper');
  },

  async handleSaveSettings(e) {
    e.preventDefault();

    const newConfig = {
      storeName: document.getElementById('settingStoreName').value.trim() || 'TOKO KELONTONG QORSYA',
      address: document.getElementById('settingStoreAddress').value.trim(),
      phone: document.getElementById('settingStorePhone').value.trim(),
      receiptFooter: document.getElementById('settingReceiptFooter').value.trim(),
      printerWidth: document.getElementById('settingPrinterWidth').value,
      cashierName: document.getElementById('settingCashierName').value.trim() || 'Kasir 1'
    };

    await State.saveSettings(newConfig);

    const brandName = document.getElementById('topbarStoreName');
    if (brandName) brandName.textContent = newConfig.storeName;

    State.playSound('success');
    this.showToast('Pengaturan toko berhasil disimpan!', 'success');
  },

  async handleSavePrinterConfig(e) {
    e.preventDefault();

    const helperConfigSelect = document.getElementById('settingHelperPrinterConfig');
    const transportSelect = document.getElementById('settingPrinterTransport');
    const widthSelect = document.getElementById('settingPrinterWidthSelect');
    const autoPrintCheck = document.getElementById('settingPrinterAutoPrint');
    const cutPaperCheck = document.getElementById('settingPrinterCutPaper');
    const openDrawerCheck = document.getElementById('settingPrinterOpenDrawer');
    const helperConfig = helperConfigSelect?.selectedOptions[0];

    const newPrinterConfig = {
      transport: transportSelect ? transportSelect.value : PrinterService.config.transport || 'helper',
      helperConfigId: helperConfigSelect
        ? helperConfigSelect.value || PrinterService.config.helperConfigId
        : PrinterService.config.helperConfigId,
      helperConfigName: helperConfig?.value
        ? helperConfig.textContent
        : PrinterService.config.helperConfigName,
      paperWidth: widthSelect ? widthSelect.value : '58mm',
      autoPrint: autoPrintCheck ? autoPrintCheck.checked : true,
      cutPaper: cutPaperCheck ? cutPaperCheck.checked : true,
      openDrawer: openDrawerCheck ? openDrawerCheck.checked : false
    };

    // Also sync the store setting printer width
    if (newPrinterConfig.paperWidth) {
      await State.saveSettings({ printerWidth: newPrinterConfig.paperWidth });
    }

    await PrinterService.saveConfig(newPrinterConfig);
  },

  // -------------------------------------------------------------
  // TOAST NOTIFICATIONS
  // -------------------------------------------------------------

  showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-text">${this.escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-show');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('toast-show');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, duration);
  },

  // -------------------------------------------------------------
  // FORMATTING & HELPERS
  // -------------------------------------------------------------

  formatRupiah(number) {
    const n = Math.round(Number(number) || 0);
    return 'Rp ' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  },

  escapeHtml(string) {
    if (!string) return '';
    const entityMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return String(string).replace(/[&<>"']/g, s => entityMap[s]);
  },

  updateOnlineBadge() {
    const badge = document.getElementById('networkStatusBadge');
    if (!badge) return;

    if (navigator.onLine) {
      badge.className = 'status-badge status-online';
      badge.innerHTML = '<span class="status-dot"></span> Online (Offline Ready)';
    } else {
      badge.className = 'status-badge status-offline';
      badge.innerHTML = '<span class="status-dot"></span> Mode 100% Offline';
    }
  },

  openShortcutsModal() {
    const modal = document.getElementById('shortcutsModal');
    if (modal) modal.classList.add('modal-open');
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('modal-open');
  },

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => {
            console.log('PWA Service Worker terdaftar:', reg.scope);
          })
          .catch(err => {
            console.warn('PWA Service Worker gagal didaftarkan:', err);
          });
      });
    }
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

