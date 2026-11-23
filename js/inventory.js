/**
 * Inventory / Barang Masuk & Stock Movement Controller
 */
const Inventory = {
  restockItems: [], // Items staged for incoming stock

  init() {
    this.bindEvents();
    this.renderRestockTable();
    this.renderStockLogs();

    State.on('productsUpdated', () => {
      this.renderStockLogs();
    });
  },

  bindEvents() {
    const searchInput = document.getElementById('inventorySearchInput');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleAddProductToRestock();
        }
      });
      searchInput.addEventListener('input', () => {
        this.renderProductSuggestions();
      });
    }
  },

  renderProductSuggestions() {
    const searchInput = document.getElementById('inventorySearchInput');
    const suggestionsEl = document.getElementById('inventoryProductSuggestions');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

    if (!suggestionsEl) return;

    if (!query || query.length < 2) {
      suggestionsEl.style.display = 'none';
      suggestionsEl.innerHTML = '';
      return;
    }

    const matches = State.products.filter(p => {
      const b = (p.barcode || '').toLowerCase();
      const c = (p.code || '').toLowerCase();
      const n = (p.name || '').toLowerCase();
      return b.includes(query) || c.includes(query) || n.includes(query);
    }).slice(0, 8);

    if (matches.length === 0) {
      suggestionsEl.style.display = 'block';
      suggestionsEl.innerHTML = '<div class="suggestion-empty text-muted">Produk tidak ditemukan</div>';
      return;
    }

    suggestionsEl.style.display = 'block';
    suggestionsEl.innerHTML = matches.map(p => {
      const idCode = p.barcode ? `𝄃𝄃 ${p.barcode}` : `🏷️ ${p.code}`;
      return `
        <div class="suggestion-item" onclick="Inventory.selectProductForRestock(${p.id})">
          <div class="font-medium">${App.escapeHtml(p.name)}</div>
          <div class="text-xs text-muted flex-between">
            <span>${idCode} | Stok: ${p.stock} ${p.unit}</span>
            <span class="text-emerald">Beli: ${App.formatRupiah(p.buyPrice)}</span>
          </div>
        </div>
      `;
    }).join('');
  },

  handleAddProductToRestock() {
    const searchInput = document.getElementById('inventorySearchInput');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (!query) return;

    // Find product
    const match = State.products.find(p => 
      (p.barcode && p.barcode.toLowerCase() === query) ||
      (p.code && p.code.toLowerCase() === query) ||
      (p.name && p.name.toLowerCase().includes(query))
    );

    if (match) {
      this.selectProductForRestock(match.id);
    } else {
      App.showToast(`Produk "${query}" tidak ditemukan!`, 'warning');
    }
  },

  selectProductForRestock(productId) {
    const product = State.products.find(p => p.id === productId);
    if (!product) return;

    const existing = this.restockItems.find(it => it.productId === product.id);
    if (existing) {
      existing.qty += 1;
    } else {
      this.restockItems.push({
        productId: product.id,
        name: product.name,
        barcode: product.barcode,
        code: product.code,
        currentStock: product.stock,
        unit: product.unit || 'Pcs',
        qty: 1,
        buyPrice: product.buyPrice || 0
      });
    }

    const searchInput = document.getElementById('inventorySearchInput');
    const suggestionsEl = document.getElementById('inventoryProductSuggestions');
    if (searchInput) searchInput.value = '';
    if (suggestionsEl) suggestionsEl.style.display = 'none';

    State.playSound('beep');
    this.renderRestockTable();
    searchInput?.focus();
  },

  renderRestockTable() {
    const tbody = document.getElementById('restockTableBody');
    const submitBtn = document.getElementById('restockSubmitBtn');
    const totalQtyEl = document.getElementById('restockTotalQty');
    const totalCostEl = document.getElementById('restockTotalCost');

    if (!tbody) return;

    const totalQty = this.restockItems.reduce((acc, it) => acc + (Number(it.qty) || 0), 0);
    const totalCost = this.restockItems.reduce((acc, it) => acc + ((Number(it.qty) || 0) * (Number(it.buyPrice) || 0)), 0);

    if (totalQtyEl) totalQtyEl.textContent = `${totalQty} unit`;
    if (totalCostEl) totalCostEl.textContent = App.formatRupiah(totalCost);
    if (submitBtn) submitBtn.disabled = this.restockItems.length === 0;

    if (this.restockItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            <p>Belum ada produk yang dipilih untuk barang masuk.</p>
            <span class="text-xs text-muted">Ketik barcode atau nama barang pada kotak pencarian di atas.</span>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = this.restockItems.map((item, idx) => {
      const subtotal = (Number(item.qty) || 0) * (Number(item.buyPrice) || 0);
      const stockAfter = item.currentStock + (Number(item.qty) || 0);

      return `
        <tr>
          <td class="col-num text-muted">${idx + 1}</td>
          <td class="font-medium">${App.escapeHtml(item.name)}</td>
          <td><span class="stock-badge stock-safe">${item.currentStock} ${item.unit}</span></td>
          <td style="width: 140px;">
            <input type="number" min="1" class="form-control form-control-sm text-center" 
              value="${item.qty}" 
              onchange="Inventory.updateRestockQty(${item.productId}, this.value)">
          </td>
          <td style="width: 160px;">
            <input type="number" min="0" class="form-control form-control-sm" 
              value="${item.buyPrice}" 
              onchange="Inventory.updateRestockBuyPrice(${item.productId}, this.value)">
          </td>
          <td class="font-semibold text-emerald">${App.formatRupiah(subtotal)}</td>
          <td class="text-right">
            <button type="button" class="btn-action delete" onclick="Inventory.removeRestockItem(${item.productId})">
              &times; Hapus
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  updateRestockQty(productId, val) {
    const item = this.restockItems.find(it => it.productId === productId);
    if (!item) return;
    const qty = Number(val) || 0;
    if (qty <= 0) {
      this.removeRestockItem(productId);
    } else {
      item.qty = qty;
      this.renderRestockTable();
    }
  },

  updateRestockBuyPrice(productId, val) {
    const item = this.restockItems.find(it => it.productId === productId);
    if (!item) return;
    item.buyPrice = Math.max(0, Number(val) || 0);
    this.renderRestockTable();
  },

  removeRestockItem(productId) {
    this.restockItems = this.restockItems.filter(it => it.productId !== productId);
    this.renderRestockTable();
  },

  clearRestock() {
    this.restockItems = [];
    this.renderRestockTable();
  },

  async submitRestock() {
    if (this.restockItems.length === 0) return;

    const supplierInput = document.getElementById('restockSupplier');
    const noteInput = document.getElementById('restockNote');

    const supplier = supplierInput ? supplierInput.value.trim() : '';
    const invoiceNote = noteInput ? noteInput.value.trim() : '';

    try {
      const restockBatch = {
        supplier,
        invoiceNote,
        items: this.restockItems.map(it => ({
          productId: it.productId,
          qty: Number(it.qty),
          buyPrice: Number(it.buyPrice)
        }))
      };

      await DB.processRestock(restockBatch);
      State.playSound('success');

      App.showToast(`Berhasil menambah stok untuk ${this.restockItems.length} produk!`, 'success');

      // Clear form
      this.clearRestock();
      if (supplierInput) supplierInput.value = '';
      if (noteInput) noteInput.value = '';

      // Refresh product list and logs
      await State.refreshProducts();
      await this.renderStockLogs();
    } catch (err) {
      console.error(err);
      State.playSound('error');
      App.showToast(`Gagal menyimpan restock: ${err.message}`, 'error');
    }
  },

  // -------------------------------------------------------------
  // STOCK MOVEMENT LOGS
  // -------------------------------------------------------------

  async renderStockLogs() {
    const tbody = document.getElementById('stockLogsTableBody');
    if (!tbody) return;

    const filterType = document.getElementById('stockLogTypeFilter')?.value || 'ALL';
    let logs = await DB.getStockLogs(100);

    if (filterType !== 'ALL') {
      logs = logs.filter(l => l.type === filterType);
    }

    if (logs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state text-muted">
            <p>Belum ada riwayat mutasi stok.</p>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const dateFormatted = new Date(l.date).toLocaleString('id-ID', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });

      let typeBadge = '';
      let changeClass = '';
      let changeSign = '';

      if (l.type === 'SALE') {
        typeBadge = '<span class="badge-status badge-sale">Penjualan</span>';
        changeClass = 'text-danger font-semibold';
        changeSign = '';
      } else if (l.type === 'RESTOCK') {
        typeBadge = '<span class="badge-status badge-restock">Barang Masuk</span>';
        changeClass = 'text-emerald font-semibold';
        changeSign = '+';
      } else if (l.type === 'INITIAL') {
        typeBadge = '<span class="badge-status badge-initial">Stok Awal</span>';
        changeClass = 'text-emerald font-semibold';
        changeSign = '+';
      } else {
        typeBadge = '<span class="badge-status badge-adjustment">Penyesuaian</span>';
        changeClass = l.qtyChange >= 0 ? 'text-emerald font-semibold' : 'text-danger font-semibold';
        changeSign = l.qtyChange >= 0 ? '+' : '';
      }

      return `
        <tr>
          <td class="text-xs text-muted">${dateFormatted}</td>
          <td class="font-medium">${App.escapeHtml(l.productName || 'Produk')}</td>
          <td>${typeBadge}</td>
          <td class="${changeClass}">${changeSign}${l.qtyChange}</td>
          <td class="text-muted">${l.stockBefore}</td>
          <td class="font-medium">${l.stockAfter}</td>
          <td class="text-xs text-muted">${App.escapeHtml(l.reference || '-')}</td>
        </tr>
      `;
    }).join('');
  }
};

