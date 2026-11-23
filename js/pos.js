/**
 * POS / Kasir Page Controller
 * Highly optimized for fast scanning, minimal clicks, and keyboard shortcuts.
 */
const POS = {
  selectedRowIndex: -1,
  currentFilteredProducts: [],
  activeCategory: 'ALL',
  lastTransaction: null,

  init() {
    this.bindEvents();
    this.renderCategoryFilter();
    this.renderProductsTable();
    this.renderCart();
    this.renderHeldCarts();
    if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
      this.switchMobileView('catalog');
    }

    // Listen to state changes
    State.on('productsUpdated', () => {
      this.renderCategoryFilter();
      this.filterAndRenderProducts();
    });

    State.on('cartUpdated', () => {
      this.renderCart();
    });

    State.on('heldCartsUpdated', () => {
      this.renderHeldCarts();
    });
  },

  bindEvents() {
    const searchInput = document.getElementById('posSearchInput');
    const quickBarcodeBuffer = [];
    let lastKeyTime = Date.now();

    // Barcode scanner buffer & search input handling
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.selectedRowIndex = -1;
        this.filterAndRenderProducts();
      });

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleSearchEnter();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.navigateTableRow(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.navigateTableRow(-1);
        }
      });
    }

    // Global Key Listener for Cashier
    window.addEventListener('keydown', (e) => {
      // Don't intercept if user is inside a form input outside pos
      const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';

      // F2: Focus POS Search
      if (e.key === 'F2') {
        e.preventDefault();
        App.switchTab('pos');
        const input = document.getElementById('posSearchInput');
        if (input) {
          input.focus();
          input.select();
        }
      }

      // F8: Open Payment Modal
      if (e.key === 'F8') {
        e.preventDefault();
        if (State.cart.length > 0) {
          this.openPaymentModal();
        } else {
          App.showToast('Keranjang masih kosong!', 'warning');
        }
      }

      // F4: Clear Cart
      if (e.key === 'F4') {
        e.preventDefault();
        if (State.cart.length > 0) {
          if (confirm('Kosongkan semua barang dalam keranjang?')) {
            State.clearCart();
          }
        }
      }

      // F9: Quick Restock
      if (e.key === 'F9') {
        e.preventDefault();
        App.switchTab('inventory');
      }

      // Hardware Barcode Scanner global capture (when search input is not focused)
      if (State.activeTab === 'pos' && (!isInput || document.activeElement.id !== 'posSearchInput')) {
        const currentTime = Date.now();
        if (currentTime - lastKeyTime > 100) {
          quickBarcodeBuffer.length = 0;
        }
        lastKeyTime = currentTime;

        if (e.key.length === 1) {
          quickBarcodeBuffer.push(e.key);
        } else if (e.key === 'Enter' && quickBarcodeBuffer.length >= 3) {
          const barcode = quickBarcodeBuffer.join('').trim();
          quickBarcodeBuffer.length = 0;
          this.quickScanAdd(barcode);
        }
      }
    });

    // Payment Modal amount paid live calculation
    const paidInput = document.getElementById('paymentAmountPaid');
    if (paidInput) {
      paidInput.addEventListener('input', () => {
        this.updatePaymentChange();
      });
      paidInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.processPayment();
        }
      });
    }
  },

  quickScanAdd(barcode) {
    const clean = barcode.toLowerCase();
    const product = State.products.find(p => 
      (p.barcode && p.barcode.toLowerCase() === clean) ||
      (p.code && p.code.toLowerCase() === clean)
    );

    if (product) {
      if (State.addToCart(product, 1)) {
        App.showToast(`+1 ${product.name}`, 'success');
      }
      // Clear search input if filled
      const sInput = document.getElementById('posSearchInput');
      if (sInput) sInput.value = '';
      this.filterAndRenderProducts();
    } else {
      State.playSound('error');
      App.showToast(`Produk dengan barcode/kode "${barcode}" tidak ditemukan!`, 'error');
    }
  },

  handleSearchEnter() {
    const searchInput = document.getElementById('posSearchInput');
    const query = searchInput ? searchInput.value.trim() : '';
    if (!query) return;

    // 1. Check exact match for barcode or code first
    const exactMatch = State.products.find(p => 
      (p.barcode && p.barcode.toLowerCase() === query.toLowerCase()) ||
      (p.code && p.code.toLowerCase() === query.toLowerCase())
    );

    if (exactMatch) {
      if (State.addToCart(exactMatch, 1)) {
        App.showToast(`+1 ${exactMatch.name}`, 'success');
      }
      searchInput.value = '';
      this.selectedRowIndex = -1;
      this.filterAndRenderProducts();
      return;
    }

    // 2. If row was selected with arrow keys, add that row
    if (this.selectedRowIndex >= 0 && this.selectedRowIndex < this.currentFilteredProducts.length) {
      const selected = this.currentFilteredProducts[this.selectedRowIndex];
      if (State.addToCart(selected, 1)) {
        App.showToast(`+1 ${selected.name}`, 'success');
      }
      searchInput.value = '';
      this.selectedRowIndex = -1;
      this.filterAndRenderProducts();
      return;
    }

    // 3. If there is exactly one filtered product, add it
    if (this.currentFilteredProducts.length === 1) {
      const single = this.currentFilteredProducts[0];
      if (State.addToCart(single, 1)) {
        App.showToast(`+1 ${single.name}`, 'success');
      }
      searchInput.value = '';
      this.selectedRowIndex = -1;
      this.filterAndRenderProducts();
      return;
    }

    // 4. Otherwise, select the first row
    if (this.currentFilteredProducts.length > 0) {
      this.selectedRowIndex = 0;
      this.highlightSelectedRow();
    } else {
      State.playSound('error');
      App.showToast(`Produk "${query}" tidak ditemukan!`, 'warning');
    }
  },

  navigateTableRow(direction) {
    if (this.currentFilteredProducts.length === 0) return;
    this.selectedRowIndex += direction;
    if (this.selectedRowIndex < 0) this.selectedRowIndex = 0;
    if (this.selectedRowIndex >= this.currentFilteredProducts.length) {
      this.selectedRowIndex = this.currentFilteredProducts.length - 1;
    }
    this.highlightSelectedRow();
  },

  highlightSelectedRow() {
    const rows = document.querySelectorAll('#posProductTableBody tr');
    rows.forEach((row, idx) => {
      if (idx === this.selectedRowIndex) {
        row.classList.add('table-row-selected');
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        row.classList.remove('table-row-selected');
      }
    });
  },

  renderCategoryFilter() {
    const container = document.getElementById('posCategoryPills');
    if (!container) return;

    // Get unique categories from products
    const categories = ['ALL', ...new Set(State.products.map(p => p.category || 'Umum'))];

    container.innerHTML = categories.map(cat => {
      const label = cat === 'ALL' ? 'Semua Kategori' : cat;
      const isActive = this.activeCategory === cat ? 'active' : '';
      return `<button type="button" class="category-pill ${isActive}" onclick="POS.setCategory('${cat}')">${label}</button>`;
    }).join('');
  },

  setCategory(category) {
    this.activeCategory = category;
    this.renderCategoryFilter();
    this.selectedRowIndex = -1;
    this.filterAndRenderProducts();
    const searchInput = document.getElementById('posSearchInput');
    if (searchInput) searchInput.focus();
  },

  filterAndRenderProducts() {
    const searchInput = document.getElementById('posSearchInput');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

    let list = State.products;

    // Category filter
    if (this.activeCategory !== 'ALL') {
      list = list.filter(p => (p.category || 'Umum') === this.activeCategory);
    }

    // Text query filter (Barcode, Kode Internal, Nama)
    if (query) {
      list = list.filter(p => {
        const barcode = (p.barcode || '').toLowerCase();
        const code = (p.code || '').toLowerCase();
        const name = (p.name || '').toLowerCase();
        return barcode.includes(query) || code.includes(query) || name.includes(query);
      });
    }

    this.currentFilteredProducts = list;
    this.renderProductsTable();
  },

  renderProductsTable() {
    const tbody = document.getElementById('posProductTableBody');
    const countBadge = document.getElementById('posProductCountBadge');
    if (!tbody) return;

    const products = this.currentFilteredProducts.length > 0 || (document.getElementById('posSearchInput')?.value || this.activeCategory !== 'ALL')
      ? this.currentFilteredProducts 
      : State.products;

    if (countBadge) {
      countBadge.textContent = `${products.length} produk`;
    }

    if (products.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <p>Tidak ada produk yang cocok dengan pencarian atau filter.</p>
          </td>
        </tr>
      `;
      return;
    }

    // Render dense rows
    tbody.innerHTML = products.map((p, idx) => {
      const isSelected = idx === this.selectedRowIndex ? 'table-row-selected' : '';
      const stockBadge = this.getStockBadge(p.stock, p.minStock);
      const identityCode = p.barcode ? `<span class="badge-barcode" title="Barcode: ${p.barcode}">𝄃𝄃 ${p.barcode}</span>` : 
        `<span class="badge-code" title="Kode Internal: ${p.code}">🏷️ ${p.code}</span>`;

      return `
        <tr class="${isSelected}" onclick="POS.selectAndAddRow(${idx})">
          <td class="col-identity">${identityCode}</td>
          <td class="col-name font-medium">
            <div class="product-name-text">${App.escapeHtml(p.name)}</div>
            <div class="product-meta-mobile">
              ${identityCode}
              <span class="meta-dot">&bull;</span>
              <span class="meta-cat">${App.escapeHtml(p.category || 'Umum')}</span>
              <span class="meta-dot">&bull;</span>
              ${stockBadge}
            </div>
          </td>
          <td class="col-category text-muted">${App.escapeHtml(p.category || 'Umum')}</td>
          <td class="col-price font-semibold text-emerald">${App.formatRupiah(p.sellPrice)}</td>
          <td class="col-stock">${stockBadge}</td>
          <td class="col-action text-right">
            <button type="button" class="btn-table-add" onclick="event.stopPropagation(); POS.addProductToCart(${p.id})">
              + Tambah
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  getStockBadge(stock, minStock = 5) {
    if (stock <= 0) {
      return `<span class="stock-badge stock-empty">Habis (0)</span>`;
    } else if (stock <= minStock) {
      return `<span class="stock-badge stock-warning">${stock} (Menipis)</span>`;
    }
    return `<span class="stock-badge stock-safe">${stock}</span>`;
  },

  selectAndAddRow(idx) {
    this.selectedRowIndex = idx;
    this.highlightSelectedRow();
    const product = this.currentFilteredProducts[idx] || State.products[idx];
    if (product) {
      if (State.addToCart(product, 1)) {
        App.showToast(`+1 ${product.name}`, 'success');
      }
    }
  },

  addProductToCart(productId) {
    const product = State.products.find(p => p.id === productId);
    if (product) {
      if (State.addToCart(product, 1)) {
        App.showToast(`+1 ${product.name}`, 'success');
      }
    }
  },

  // -------------------------------------------------------------
  // CART RENDERING & INTERACTIONS
  // -------------------------------------------------------------

  renderCart() {
    const cartItemsContainer = document.getElementById('posCartItems');
    const subtotalEl = document.getElementById('posCartSubtotal');
    const discountEl = document.getElementById('posCartDiscount');
    const grandTotalEl = document.getElementById('posCartGrandTotal');
    const totalQtyBadge = document.getElementById('posCartQtyBadge');
    const itemCountBadge = document.getElementById('posCartItemCount');
    const checkoutBtn = document.getElementById('posCheckoutBtn');

    if (!cartItemsContainer) return;

    const totals = State.getCartTotals();

    if (totalQtyBadge) totalQtyBadge.textContent = `${totals.totalQty} item`;
    if (itemCountBadge) itemCountBadge.textContent = `${totals.itemCount} jenis`;
    if (subtotalEl) subtotalEl.textContent = App.formatRupiah(totals.subtotal);
    if (discountEl) discountEl.textContent = `- ${App.formatRupiah(totals.discount)}`;
    if (grandTotalEl) grandTotalEl.textContent = App.formatRupiah(totals.grandTotal);

    // Sync mobile floating cart bar
    const mobileCartCount = document.getElementById('posMobileCartCount');
    const mobileCartTotal = document.getElementById('posMobileCartTotal');
    const mobileCartBar = document.getElementById('posMobileCartBar');
    const mobileCartAction = mobileCartBar ? mobileCartBar.querySelector('.mobile-cart-bar-action span') : null;
    const topbarCartCount = document.getElementById('topbarCartCount');
    const bottomNavCartBadge = document.getElementById('bottomNavCartBadge');
    const posMobileTabCartBadge = document.getElementById('posMobileTabCartBadge');

    if (topbarCartCount) topbarCartCount.textContent = totals.totalQty;
    if (bottomNavCartBadge) bottomNavCartBadge.textContent = totals.totalQty;
    if (posMobileTabCartBadge) posMobileTabCartBadge.textContent = `${totals.totalQty} item`;

    if (totals.totalQty > 0) {
      if (mobileCartCount) mobileCartCount.textContent = `${totals.totalQty} item`;
      if (mobileCartTotal) mobileCartTotal.textContent = App.formatRupiah(totals.grandTotal);
      if (mobileCartAction) mobileCartAction.textContent = 'Lihat Keranjang ➔';
      if (mobileCartBar) mobileCartBar.classList.add('has-items');
    } else {
      if (mobileCartCount) mobileCartCount.textContent = '0 item';
      if (mobileCartTotal) mobileCartTotal.textContent = 'Keranjang Kosong';
      if (mobileCartAction) mobileCartAction.textContent = 'Buka Keranjang ➔';
      if (mobileCartBar) mobileCartBar.classList.remove('has-items');
    }

    if (checkoutBtn) {
      checkoutBtn.disabled = State.cart.length === 0;
    }

    if (State.cart.length === 0) {
      cartItemsContainer.innerHTML = `
        <div class="cart-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="9" cy="21" r="1"></circle>
            <circle cx="20" cy="21" r="1"></circle>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
          </svg>
          <p class="font-medium">Keranjang Kosong</p>
          <span class="text-xs text-muted">Scan barcode atau pilih produk dari tabel di samping.</span>
        </div>
      `;
      return;
    }

    cartItemsContainer.innerHTML = State.cart.map(item => {
      return `
        <div class="cart-item">
          <div class="cart-item-header">
            <div class="cart-item-name font-medium">${App.escapeHtml(item.name)}</div>
            <button type="button" class="cart-item-remove" title="Hapus" onclick="State.removeFromCart(${item.productId})">
              &times;
            </button>
          </div>
          <div class="cart-item-body">
            <div class="cart-item-price text-muted">
              ${App.formatRupiah(item.sellPrice)} / ${item.unit}
            </div>
            <div class="cart-qty-control">
              <button type="button" class="qty-btn" onclick="State.updateCartQty(${item.productId}, ${item.qty - 1})">-</button>
              <input type="number" min="1" class="qty-input" value="${item.qty}" 
                onchange="State.updateCartQty(${item.productId}, this.value)" 
                onfocus="this.select()">
              <button type="button" class="qty-btn" onclick="State.updateCartQty(${item.productId}, ${item.qty + 1})">+</button>
            </div>
            <div class="cart-item-subtotal font-semibold text-emerald">
              ${App.formatRupiah(item.subtotal)}
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderHeldCarts() {
    const container = document.getElementById('posHeldCartsContainer');
    const badge = document.getElementById('posHeldCountBadge');
    if (!container) return;

    if (badge) {
      badge.textContent = State.heldCarts.length;
      badge.style.display = State.heldCarts.length > 0 ? 'inline-block' : 'none';
    }

    if (State.heldCarts.length === 0) {
      container.innerHTML = '<span class="text-xs text-muted">Tidak ada transaksi yang ditahan.</span>';
      return;
    }

    container.innerHTML = State.heldCarts.map(h => {
      const itemsCount = h.cart.reduce((s, it) => s + it.qty, 0);
      const total = h.cart.reduce((s, it) => s + it.subtotal, 0) - (h.discount || 0);
      return `
        <div class="held-cart-pill" onclick="State.restoreHeldCart(${h.id})">
          <span class="font-medium">⏰ ${h.time}</span>
          <span>(${itemsCount} item)</span>
          <span class="font-semibold text-emerald">${App.formatRupiah(total)}</span>
          <span class="held-restore-icon">↗ Pulihkan</span>
        </div>
      `;
    }).join('');
  },

  // -------------------------------------------------------------
  // MOBILE CART & VIEW SWITCHER
  // -------------------------------------------------------------

  mobileActiveView: 'catalog',

  switchMobileView(view) {
    this.mobileActiveView = view;
    const viewPos = document.getElementById('view-pos');
    const btnCatalog = document.getElementById('posMobileTabCatalog');
    const btnCart = document.getElementById('posMobileTabCart');
    const navCatalog = document.querySelector('.bottom-nav-item[data-tab="pos"]');
    const navCart = document.getElementById('bottomNavCartBtn');

    if (view === 'cart') {
      if (viewPos) viewPos.classList.add('mobile-view-cart');
      if (btnCatalog) btnCatalog.classList.remove('active');
      if (btnCart) btnCart.classList.add('active');
      if (navCatalog) navCatalog.classList.remove('active');
      if (navCart) navCart.classList.add('active');
    } else {
      if (viewPos) viewPos.classList.remove('mobile-view-cart');
      if (btnCatalog) btnCatalog.classList.add('active');
      if (btnCart) btnCart.classList.remove('active');
      if (navCatalog && State.activeTab === 'pos') navCatalog.classList.add('active');
      if (navCart) navCart.classList.remove('active');
    }
  },

  openMobileCart() {
    this.switchMobileView('cart');
    const cartSection = document.getElementById('posCartSection');
    const overlay = document.getElementById('cartOverlay');
    if (cartSection) cartSection.classList.add('cart-drawer-open');
    if (overlay) overlay.classList.add('active');
  },

  closeMobileCart() {
    this.switchMobileView('catalog');
    const cartSection = document.getElementById('posCartSection');
    const overlay = document.getElementById('cartOverlay');
    if (cartSection) cartSection.classList.remove('cart-drawer-open');
    if (overlay) overlay.classList.remove('active');
  },

  // -------------------------------------------------------------
  // PAYMENT / CHECKOUT MODAL
  // -------------------------------------------------------------

  openPaymentModal() {
    this.closeMobileCart();
    if (State.cart.length === 0) {
      App.showToast('Keranjang masih kosong!', 'warning');
      return;
    }

    const totals = State.getCartTotals();
    const modal = document.getElementById('paymentModal');
    const grandTotalDisplay = document.getElementById('paymentGrandTotalDisplay');
    const paidInput = document.getElementById('paymentAmountPaid');
    const quickCashContainer = document.getElementById('paymentQuickCashBtns');

    if (!modal) return;

    grandTotalDisplay.textContent = App.formatRupiah(totals.grandTotal);
    paidInput.value = '';
    this.updatePaymentChange();

    // Render smart quick cash buttons
    const billPresets = [
      { label: 'Uang Pas', amount: totals.grandTotal },
      { label: '10.000', amount: 10000 },
      { label: '20.000', amount: 20000 },
      { label: '50.000', amount: 50000 },
      { label: '100.000', amount: 100000 },
      { label: '200.000', amount: 200000 },
      { label: '500.000', amount: 500000 }
    ];

    if (quickCashContainer) {
      quickCashContainer.innerHTML = billPresets.map(preset => {
        return `
          <button type="button" class="btn-quick-cash" onclick="POS.setQuickCash(${preset.amount})">
            ${preset.label}
          </button>
        `;
      }).join('');
    }

    // Default payment method is Tunai
    document.querySelectorAll('.payment-method-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.method === 'Tunai');
    });

    modal.classList.add('modal-open');

    // Auto-focus amount paid input
    setTimeout(() => {
      paidInput.focus();
    }, 100);
  },

  setPaymentMethod(method) {
    document.querySelectorAll('.payment-method-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.method === method);
    });

    const cashSection = document.getElementById('paymentCashDetails');
    const paidInput = document.getElementById('paymentAmountPaid');
    const totals = State.getCartTotals();

    if (method === 'Tunai') {
      if (cashSection) cashSection.style.display = 'block';
      if (paidInput) {
        paidInput.focus();
      }
    } else {
      // Non-cash (QRIS / Transfer): auto set paid = grandTotal
      if (cashSection) cashSection.style.display = 'none';
      if (paidInput) paidInput.value = totals.grandTotal;
      this.updatePaymentChange();
    }
  },

  setQuickCash(amount) {
    const paidInput = document.getElementById('paymentAmountPaid');
    if (paidInput) {
      paidInput.value = amount;
      this.updatePaymentChange();
      paidInput.focus();
    }
  },

  updatePaymentChange() {
    const totals = State.getCartTotals();
    const paidInput = document.getElementById('paymentAmountPaid');
    const changeDisplay = document.getElementById('paymentChangeDisplay');
    const submitBtn = document.getElementById('paymentSubmitBtn');

    const paid = Number(paidInput ? paidInput.value : 0) || 0;
    const change = paid - totals.grandTotal;

    if (changeDisplay) {
      if (paid === 0) {
        changeDisplay.textContent = 'Rp 0';
        changeDisplay.className = 'payment-change text-muted';
      } else if (change < 0) {
        changeDisplay.textContent = `Kurang ${App.formatRupiah(Math.abs(change))}`;
        changeDisplay.className = 'payment-change text-danger font-semibold';
      } else {
        changeDisplay.textContent = App.formatRupiah(change);
        changeDisplay.className = 'payment-change text-emerald font-bold';
      }
    }

    // Enable/disable submit button if cash and underpaid
    const activeMethodBtn = document.querySelector('.payment-method-btn.active');
    const activeMethod = activeMethodBtn ? activeMethodBtn.dataset.method : 'Tunai';

    if (submitBtn) {
      if (activeMethod === 'Tunai' && paid < totals.grandTotal) {
        submitBtn.disabled = true;
      } else {
        submitBtn.disabled = false;
      }
    }
  },

  async processPayment() {
    const totals = State.getCartTotals();
    const paidInput = document.getElementById('paymentAmountPaid');
    const noteInput = document.getElementById('paymentNote');
    const activeMethodBtn = document.querySelector('.payment-method-btn.active');
    const paymentMethod = activeMethodBtn ? activeMethodBtn.dataset.method : 'Tunai';

    let amountPaid = Number(paidInput ? paidInput.value : 0);

    if (paymentMethod !== 'Tunai') {
      amountPaid = totals.grandTotal;
    }

    if (amountPaid < totals.grandTotal) {
      State.playSound('error');
      App.showToast('Uang yang dibayarkan kurang!', 'error');
      paidInput?.focus();
      return;
    }

    try {
      const orderData = {
        items: [...State.cart],
        discount: totals.discount,
        paymentMethod: paymentMethod,
        amountPaid: amountPaid,
        note: noteInput ? noteInput.value : '',
        cashier: State.storeSettings.cashierName || 'Kasir'
      };

      // Atomic IDB transaction
      const transaction = await DB.createTransaction(orderData);
      this.lastTransaction = transaction;

      // Play success audio
      State.playSound('success');

      // Refresh product list so that updated stocks reflect instantly!
      await State.refreshProducts();

      // Clear cart
      State.clearCart();

      // Close Payment Modal
      this.closePaymentModal();

      // Open Receipt Modal
      this.openReceiptModal(transaction);

      App.showToast(`Transaksi berhasil disimpan! No: ${transaction.invoiceNo}`, 'success');

      // Direct Thermal Auto-Print via QZ Tray (No browser dialog, zero duplicates)
      if (window.PrinterService && PrinterService.config.autoPrint) {
        PrinterService.printReceiptDirect(transaction, false).catch(pErr => {
          console.warn('Auto print error:', pErr);
        });
      }
    } catch (err) {
      console.error(err);
      State.playSound('error');
      App.showToast(`Gagal memproses transaksi: ${err.message}`, 'error');
    }
  },

  closePaymentModal() {
    const modal = document.getElementById('paymentModal');
    if (modal) modal.classList.remove('modal-open');
  },

  // -------------------------------------------------------------
  // RECEIPT / STRUK MODAL & THERMAL PRINTING
  // -------------------------------------------------------------

  openReceiptModal(transaction) {
    const modal = document.getElementById('receiptModal');
    const container = document.getElementById('thermalReceiptPreview');
    if (!modal || !container) return;

    this.lastTransaction = transaction;
    container.innerHTML = this.generateReceiptHtml(transaction);

    modal.classList.add('modal-open');

    // Auto-focus print button
    setTimeout(() => {
      document.getElementById('receiptPrintBtn')?.focus();
    }, 100);
  },

  closeReceiptModal() {
    const modal = document.getElementById('receiptModal');
    if (modal) modal.classList.remove('modal-open');

    // Return focus to POS search input for next customer
    const searchInput = document.getElementById('posSearchInput');
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
  },

  generateReceiptHtml(tx) {
    const s = State.storeSettings;
    const dateFormatted = new Date(tx.date).toLocaleString('id-ID', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const itemsHtml = tx.items.map(it => `
      <div class="receipt-item-row">
        <div class="receipt-item-name font-medium">${App.escapeHtml(it.name)}</div>
        <div class="receipt-item-details">
          <span>${it.qty} x ${App.formatRupiah(it.sellPrice)}</span>
          <span class="font-medium">${App.formatRupiah(it.subtotal)}</span>
        </div>
      </div>
    `).join('');

    return `
      <div class="thermal-receipt ${s.printerWidth === '80mm' ? 'receipt-80mm' : 'receipt-58mm'}">
        <div class="receipt-header text-center">
          <h2 class="receipt-store-name">${App.escapeHtml(s.storeName)}</h2>
          <p class="receipt-store-address">${App.escapeHtml(s.address)}</p>
          <p class="receipt-store-phone">Telp: ${App.escapeHtml(s.phone)}</p>
        </div>
        <div class="receipt-divider">================================</div>
        <div class="receipt-meta">
          <div><span>No. Nota:</span> <span>${tx.invoiceNo}</span></div>
          <div><span>Waktu:</span> <span>${dateFormatted}</span></div>
          <div><span>Kasir:</span> <span>${App.escapeHtml(tx.cashier || 'Kasir')}</span></div>
        </div>
        <div class="receipt-divider">--------------------------------</div>
        <div class="receipt-items">
          ${itemsHtml}
        </div>
        <div class="receipt-divider">--------------------------------</div>
        <div class="receipt-totals">
          <div class="receipt-calc-row">
            <span>Total (${tx.totalQty} item):</span>
            <span>${App.formatRupiah(tx.subtotal)}</span>
          </div>
          ${tx.discount > 0 ? `
            <div class="receipt-calc-row">
              <span>Diskon:</span>
              <span>-${App.formatRupiah(tx.discount)}</span>
            </div>
          ` : ''}
          <div class="receipt-calc-row font-bold text-lg">
            <span>GRAND TOTAL:</span>
            <span>${App.formatRupiah(tx.grandTotal)}</span>
          </div>
          <div class="receipt-calc-row">
            <span>Bayar (${tx.paymentMethod}):</span>
            <span>${App.formatRupiah(tx.amountPaid)}</span>
          </div>
          <div class="receipt-calc-row">
            <span>Kembalian:</span>
            <span>${App.formatRupiah(tx.change)}</span>
          </div>
        </div>
        <div class="receipt-divider">================================</div>
        <div class="receipt-footer text-center">
          ${App.escapeHtml(s.receiptFooter).replace(/\n/g, '<br>')}
        </div>
      </div>
    `;
  },

  async printReceipt(forceDirect = false) {
    if (forceDirect || (window.PrinterService && PrinterService.isConnected)) {
      const ok = await PrinterService.printReceiptDirect(this.lastTransaction, true);
      if (ok) return;
    }
    // Fallback to browser print dialog
    window.print();
  }
};

