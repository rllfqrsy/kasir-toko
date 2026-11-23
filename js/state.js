/**
 * Central State Management & Audio Synthesizer
 */
const State = {
  activeTab: 'pos',
  products: [],
  cart: [],
  cartDiscount: 0,
  heldCarts: [], // For holding cart when another customer comes
  storeSettings: {
    storeName: 'TOKO KELONTONG QORSYA',
    address: 'Jl. Raya Desa No. 12, RT 02/03',
    phone: '0812-3456-7890',
    receiptFooter: 'Terima kasih atas kunjungan Anda!\nBarang yang sudah dibeli tidak dapat ditukar.',
    printerWidth: '58mm', // '58mm' or '80mm'
    cashierName: 'Kasir 1'
  },
  soundEnabled: true,
  audioCtx: null,

  // Event Listeners
  _listeners: {},

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  },

  emit(event, data) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(cb => cb(data));
    }
  },

  // Audio Feedback using Web Audio API (Zero external assets needed!)
  playSound(type = 'beep') {
    if (!this.soundEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      if (type === 'beep') {
        // High crisp beep for barcode scan / item added
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1400, now);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'success') {
        // Double pleasant chime for transaction completed
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.1); // A5
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'error') {
        // Low double buzz for warning / rejected
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.setValueAtTime(160, now + 0.1);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      }
    } catch (e) {
      // Audio not supported or blocked, ignore gracefully
    }
  },

  // State mutators
  async loadSettings() {
    const saved = await DB.getSetting('store_config');
    if (saved) {
      // Auto-update if previous store name was the default Berkah
      if (saved.storeName === 'TOKO KELONTONG BERKAH') {
        saved.storeName = 'TOKO KELONTONG QORSYA';
        await DB.saveSetting('store_config', saved);
      }
      this.storeSettings = { ...this.storeSettings, ...saved };
    }
    const soundPref = await DB.getSetting('sound_enabled');
    if (soundPref !== null && soundPref !== undefined) {
      this.soundEnabled = soundPref;
    }
    this.emit('settingsUpdated', this.storeSettings);
  },

  async saveSettings(newSettings) {
    this.storeSettings = { ...this.storeSettings, ...newSettings };
    await DB.saveSetting('store_config', this.storeSettings);
    this.emit('settingsUpdated', this.storeSettings);
  },

  async toggleSound() {
    this.soundEnabled = !this.soundEnabled;
    await DB.saveSetting('sound_enabled', this.soundEnabled);
    this.emit('soundToggled', this.soundEnabled);
    if (this.soundEnabled) this.playSound('beep');
    return this.soundEnabled;
  },

  async refreshProducts() {
    this.products = await DB.getAllProducts();
    this.emit('productsUpdated', this.products);
    return this.products;
  },

  // Cart operations
  addToCart(product, qty = 1) {
    qty = Math.floor(Number(qty) || 0);
    if (qty <= 0) return false;

    const availableStock = Math.max(0, Number(product.stock) || 0);
    if (availableStock <= 0) {
      if (window.App && App.showToast) {
        App.showToast(`Stok ${product.name} sudah habis!`, 'error');
      }
      return false;
    }

    const existingIndex = this.cart.findIndex(item => item.productId === product.id);

    if (existingIndex > -1) {
      const item = this.cart[existingIndex];
      const requestedQty = item.qty + qty;
      if (requestedQty > availableStock) {
        if (window.App && App.showToast) {
          App.showToast(`Stok ${product.name} tersisa ${availableStock}!`, 'warning');
        }
        return false;
      }
      item.qty = requestedQty;
      item.maxStock = availableStock;
      item.subtotal =
        (item.sellPrice * item.qty) - (item.discount || 0);
    } else {
      if (qty > availableStock) {
        if (window.App && App.showToast) {
          App.showToast(`Stok ${product.name} tersisa ${availableStock}!`, 'warning');
        }
        return false;
      }
      this.cart.push({
        productId: product.id,
        barcode: product.barcode || '',
        code: product.code || '',
        name: product.name,
        unit: product.unit || 'Pcs',
        buyPrice: product.buyPrice || 0,
        sellPrice: product.sellPrice || 0,
        qty: qty,
        discount: 0,
        subtotal: product.sellPrice * qty,
        maxStock: availableStock
      });
    }

    this.playSound('beep');
    this.emit('cartUpdated', this.cart);
    return true;
  },

  updateCartQty(productId, newQty) {
    const item = this.cart.find(it => it.productId === productId);
    if (!item) return;

    newQty = Number(newQty);
    if (newQty <= 0) {
      this.removeFromCart(productId);
    } else {
      const product = this.products.find(p => p.id === productId);
      const availableStock = product
        ? Math.max(0, Number(product.stock) || 0)
        : Math.max(0, Number(item.maxStock) || 0);
      item.qty = Math.min(Math.floor(newQty), availableStock);
      if (item.qty <= 0) {
        this.removeFromCart(productId);
        return;
      }
      if (newQty > availableStock && window.App && App.showToast) {
        App.showToast(`Jumlah dibatasi sampai stok tersedia (${availableStock})!`, 'warning');
      }
      item.maxStock = availableStock;
      item.subtotal = (item.sellPrice * item.qty) - (item.discount || 0);
      this.emit('cartUpdated', this.cart);
    }
  },

  updateCartItemDiscount(productId, discount) {
    const item = this.cart.find(it => it.productId === productId);
    if (!item) return;
    item.discount = Math.max(0, Number(discount) || 0);
    item.subtotal = Math.max(0, (item.sellPrice * item.qty) - item.discount);
    this.emit('cartUpdated', this.cart);
  },

  removeFromCart(productId) {
    this.cart = this.cart.filter(it => it.productId !== productId);
    this.emit('cartUpdated', this.cart);
  },

  clearCart() {
    this.cart = [];
    this.cartDiscount = 0;
    this.emit('cartUpdated', this.cart);
  },

  getCartTotals() {
    const subtotal = this.cart.reduce((sum, item) => sum + item.subtotal, 0);
    const totalBuyPrice = this.cart.reduce((sum, item) => sum + (item.buyPrice * item.qty), 0);
    const grandTotal = Math.max(0, subtotal - this.cartDiscount);
    const totalQty = this.cart.reduce((sum, item) => sum + item.qty, 0);
    const grossProfit = grandTotal - totalBuyPrice;

    return {
      subtotal,
      discount: this.cartDiscount,
      grandTotal,
      totalBuyPrice,
      totalQty,
      itemCount: this.cart.length,
      grossProfit
    };
  },

  holdCart() {
    if (this.cart.length === 0) return false;
    this.heldCarts.push({
      id: Date.now(),
      time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      cart: [...this.cart],
      discount: this.cartDiscount
    });
    this.clearCart();
    this.emit('heldCartsUpdated', this.heldCarts);
    return true;
  },

  restoreHeldCart(heldId) {
    const idx = this.heldCarts.findIndex(h => h.id === heldId);
    if (idx === -1) return false;
    const restored = this.heldCarts.splice(idx, 1)[0];
    this.cart = restored.cart.map(item => {
      const product = this.products.find(p => p.id === item.productId);
      const availableStock = product
        ? Math.max(0, Number(product.stock) || 0)
        : Math.max(0, Number(item.maxStock) || 0);
      const qty = Math.min(Math.max(0, Number(item.qty) || 0), availableStock);
      return qty > 0
        ? {
            ...item,
            qty,
            maxStock: availableStock,
            subtotal: Math.max(0, (item.sellPrice * qty) - (item.discount || 0))
          }
        : null;
    }).filter(Boolean);
    this.cartDiscount = restored.discount;
    this.emit('cartUpdated', this.cart);
    this.emit('heldCartsUpdated', this.heldCarts);
    return true;
  }
};

