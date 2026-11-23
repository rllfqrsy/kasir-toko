/**
 * Manajemen Produk Controller
 * Full CRUD, Identity Validation Rules, Filtering, and Quick Restock/Adjustment.
 */
const Products = {
  currentPage: 1,
  pageSize: 25,
  currentCategoryFilter: 'ALL',
  currentStockFilter: 'ALL',
  currentSearchQuery: '',
  currentSortField: 'name',
  currentSortDir: 'asc',
  editingProductId: null,

  init() {
    this.bindEvents();
    this.renderCategoryFilter();
    this.renderProductsList();

    State.on('productsUpdated', () => {
      this.renderCategoryFilter();
      this.renderProductsList();
    });
  },

  bindEvents() {
    const searchInput = document.getElementById('productSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.currentSearchQuery = searchInput.value.trim().toLowerCase();
        this.currentPage = 1;
        this.renderProductsList();
      });
    }

    const categorySelect = document.getElementById('productFilterCategory');
    if (categorySelect) {
      categorySelect.addEventListener('change', () => {
        this.currentCategoryFilter = categorySelect.value;
        this.currentPage = 1;
        this.renderProductsList();
      });
    }

    const stockSelect = document.getElementById('productFilterStock');
    if (stockSelect) {
      stockSelect.addEventListener('change', () => {
        this.currentStockFilter = stockSelect.value;
        this.currentPage = 1;
        this.renderProductsList();
      });
    }

    // Modal Live Margin Calculation
    const buyInput = document.getElementById('prodModalBuyPrice');
    const sellInput = document.getElementById('prodModalSellPrice');
    const calcMargin = () => {
      const buy = Number(buyInput?.value) || 0;
      const sell = Number(sellInput?.value) || 0;
      const profit = sell - buy;
      const pct = sell > 0 ? ((profit / sell) * 100).toFixed(1) : 0;
      const badge = document.getElementById('prodModalMarginBadge');
      if (badge) {
        badge.textContent = `Laba: ${App.formatRupiah(profit)} (${pct}%)`;
        badge.className = profit >= 0 ? 'margin-badge profit-positive' : 'margin-badge profit-negative';
      }
    };

    buyInput?.addEventListener('input', calcMargin);
    sellInput?.addEventListener('input', calcMargin);
  },

  renderCategoryFilter() {
    const select = document.getElementById('productFilterCategory');
    if (!select) return;

    const categories = ['ALL', ...new Set(State.products.map(p => p.category || 'Umum'))];
    select.innerHTML = categories.map(cat => {
      const label = cat === 'ALL' ? 'Semua Kategori' : cat;
      const selected = this.currentCategoryFilter === cat ? 'selected' : '';
      return `<option value="${cat}" ${selected}>${label}</option>`;
    }).join('');
  },

  getFilteredProducts() {
    let list = State.products;

    // Filter Category
    if (this.currentCategoryFilter !== 'ALL') {
      list = list.filter(p => (p.category || 'Umum') === this.currentCategoryFilter);
    }

    // Filter Stock Status
    if (this.currentStockFilter === 'low') {
      list = list.filter(p => p.stock > 0 && p.stock <= (p.minStock || 5));
    } else if (this.currentStockFilter === 'empty') {
      list = list.filter(p => p.stock <= 0);
    } else if (this.currentStockFilter === 'safe') {
      list = list.filter(p => p.stock > (p.minStock || 5));
    }

    // Filter Query (Barcode, Code, Name)
    if (this.currentSearchQuery) {
      const q = this.currentSearchQuery;
      list = list.filter(p => {
        const bar = (p.barcode || '').toLowerCase();
        const code = (p.code || '').toLowerCase();
        const name = (p.name || '').toLowerCase();
        return bar.includes(q) || code.includes(q) || name.includes(q);
      });
    }

    // Sort
    list.sort((a, b) => {
      let valA = a[this.currentSortField];
      let valB = b[this.currentSortField];

      if (this.currentSortField === 'margin') {
        valA = (a.sellPrice || 0) - (a.buyPrice || 0);
        valB = (b.sellPrice || 0) - (b.buyPrice || 0);
      }

      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = (valB || '').toLowerCase();
        return this.currentSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }

      valA = Number(valA) || 0;
      valB = Number(valB) || 0;
      return this.currentSortDir === 'asc' ? valA - valB : valB - valA;
    });

    return list;
  },

  renderProductsList() {
    const tbody = document.getElementById('productListTableBody');
    const paginationEl = document.getElementById('productPagination');
    const totalCountEl = document.getElementById('productTotalCount');

    if (!tbody) return;

    const list = this.getFilteredProducts();

    if (totalCountEl) {
      totalCountEl.textContent = `Menampilkan ${list.length} dari ${State.products.length} produk`;
    }

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-state">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
            </svg>
            <p>Tidak ada produk yang sesuai.</p>
            ${State.products.length === 0 ? `
              <button type="button" class="btn btn-primary mt-2" onclick="Products.loadInitialSampleData()">
                ✨ Muat Data Awal Toko Kelontong (50+ Produk)
              </button>
            ` : ''}
          </td>
        </tr>
      `;
      if (paginationEl) paginationEl.innerHTML = '';
      return;
    }

    // Paginate
    const totalPages = Math.ceil(list.length / this.pageSize);
    if (this.currentPage > totalPages) this.currentPage = totalPages;
    if (this.currentPage < 1) this.currentPage = 1;

    const startIdx = (this.currentPage - 1) * this.pageSize;
    const pagedItems = list.slice(startIdx, startIdx + this.pageSize);

    tbody.innerHTML = pagedItems.map((p, idx) => {
      const margin = (p.sellPrice || 0) - (p.buyPrice || 0);
      const marginPct = p.sellPrice > 0 ? ((margin / p.sellPrice) * 100).toFixed(0) : 0;
      const stockBadge = POS.getStockBadge(p.stock, p.minStock);

      const barcodeHtml = p.barcode 
        ? `<span class="badge-barcode">𝄃𝄃 ${App.escapeHtml(p.barcode)}</span>` 
        : '<span class="text-muted text-xs">-</span>';

      const codeHtml = p.code 
        ? `<span class="badge-code">🏷️ ${App.escapeHtml(p.code)}</span>` 
        : '<span class="text-muted text-xs">-</span>';

      return `
        <tr>
          <td class="col-num text-muted">${startIdx + idx + 1}</td>
          <td>${barcodeHtml}</td>
          <td>${codeHtml}</td>
          <td class="font-medium">${App.escapeHtml(p.name)}</td>
          <td><span class="category-tag">${App.escapeHtml(p.category || 'Umum')}</span></td>
          <td class="text-muted">${App.formatRupiah(p.buyPrice)}</td>
          <td class="font-semibold text-emerald">${App.formatRupiah(p.sellPrice)}</td>
          <td>
            <span class="margin-text ${margin >= 0 ? 'text-emerald' : 'text-danger'}">
              +${App.formatRupiah(margin)} (${marginPct}%)
            </span>
          </td>
          <td>${stockBadge} <span class="text-xs text-muted">(${App.escapeHtml(p.unit || 'Pcs')})</span></td>
          <td class="text-right table-actions">
            <button class="btn-action edit" title="Edit Produk" onclick="Products.openEditModal(${p.id})">
              ✏️ Edit
            </button>
            <button class="btn-action delete" title="Hapus Produk" onclick="Products.confirmDelete(${p.id})">
              🗑️ Hapus
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Render pagination
    if (paginationEl) {
      paginationEl.innerHTML = `
        <div class="pagination-info text-xs text-muted">
          Halaman ${this.currentPage} dari ${totalPages} (${list.length} item)
        </div>
        <div class="pagination-controls">
          <button class="btn btn-secondary btn-sm" ${this.currentPage <= 1 ? 'disabled' : ''} onclick="Products.setPage(${this.currentPage - 1})">
            ◀ Sebelumnya
          </button>
          <button class="btn btn-secondary btn-sm" ${this.currentPage >= totalPages ? 'disabled' : ''} onclick="Products.setPage(${this.currentPage + 1})">
            Selanjutnya ▶
          </button>
        </div>
      `;
    }
  },

  setPage(page) {
    this.currentPage = page;
    this.renderProductsList();
  },

  sortBy(field) {
    if (this.currentSortField === field) {
      this.currentSortDir = this.currentSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.currentSortField = field;
      this.currentSortDir = 'asc';
    }
    this.renderProductsList();
  },

  // -------------------------------------------------------------
  // MODAL PRODUCT CRUD
  // -------------------------------------------------------------

  openAddModal() {
    this.editingProductId = null;
    const modal = document.getElementById('productFormModal');
    const title = document.getElementById('productModalTitle');
    const form = document.getElementById('productForm');

    if (!modal || !form) return;

    title.textContent = 'Tambah Produk Baru';
    form.reset();

    // Reset hidden ID
    document.getElementById('prodModalId').value = '';
    document.getElementById('prodModalMinStock').value = 5;
    document.getElementById('prodModalUnit').value = 'Pcs';
    document.getElementById('prodModalStock').value = 0;
    document.getElementById('prodModalStock').disabled = false; // Stock can be set for new product

    const badge = document.getElementById('prodModalMarginBadge');
    if (badge) {
      badge.textContent = 'Laba: Rp 0 (0%)';
      badge.className = 'margin-badge';
    }

    modal.classList.add('modal-open');
    setTimeout(() => {
      document.querySelector('#productFormModal .modal-body')?.scrollTo({ top: 0 });
      document.getElementById('prodModalBarcode')?.focus();
    }, 100);
  },

  async openEditModal(productId) {
    this.editingProductId = Number(productId);
    const product = await DB.getProductById(this.editingProductId);
    if (!product) {
      App.showToast('Produk tidak ditemukan!', 'error');
      return;
    }

    const modal = document.getElementById('productFormModal');
    const title = document.getElementById('productModalTitle');

    title.textContent = `Edit Produk: ${product.name}`;

    document.getElementById('prodModalId').value = product.id;
    document.getElementById('prodModalBarcode').value = product.barcode || '';
    document.getElementById('prodModalCode').value = product.code || '';
    document.getElementById('prodModalName').value = product.name || '';
    document.getElementById('prodModalCategory').value = product.category || 'Umum';
    document.getElementById('prodModalUnit').value = product.unit || 'Pcs';
    document.getElementById('prodModalBuyPrice').value = product.buyPrice || 0;
    document.getElementById('prodModalSellPrice').value = product.sellPrice || 0;
    document.getElementById('prodModalStock').value = product.stock || 0;
    document.getElementById('prodModalMinStock').value = product.minStock || 5;

    // Recalculate margin badge
    const profit = (product.sellPrice || 0) - (product.buyPrice || 0);
    const pct = product.sellPrice > 0 ? ((profit / product.sellPrice) * 100).toFixed(1) : 0;
    const badge = document.getElementById('prodModalMarginBadge');
    if (badge) {
      badge.textContent = `Laba: ${App.formatRupiah(profit)} (${pct}%)`;
      badge.className = profit >= 0 ? 'margin-badge profit-positive' : 'margin-badge profit-negative';
    }

    modal.classList.add('modal-open');
    setTimeout(() => {
      document.querySelector('#productFormModal .modal-body')?.scrollTo({ top: 0 });
      document.getElementById('prodModalName')?.focus();
    }, 100);
  },

  closeModal() {
    const modal = document.getElementById('productFormModal');
    if (modal) modal.classList.remove('modal-open');
    this.editingProductId = null;
  },

  async saveProduct(event) {
    event.preventDefault();

    const id = document.getElementById('prodModalId').value;
    const barcode = document.getElementById('prodModalBarcode').value.trim();
    const code = document.getElementById('prodModalCode').value.trim();
    const name = document.getElementById('prodModalName').value.trim();
    const category = document.getElementById('prodModalCategory').value.trim() || 'Umum';
    const unit = document.getElementById('prodModalUnit').value.trim() || 'Pcs';
    const buyPrice = Number(document.getElementById('prodModalBuyPrice').value) || 0;
    const sellPrice = Number(document.getElementById('prodModalSellPrice').value) || 0;
    const stock = Number(document.getElementById('prodModalStock').value) || 0;
    const minStock = Number(document.getElementById('prodModalMinStock').value) || 5;

    // RULE ENFORCEMENT: At least Barcode OR Code is required!
    if (!barcode && !code) {
      State.playSound('error');
      App.showToast('Gagal: Produk WAJIB memiliki Barcode ATAU Kode Barang Internal!', 'error');
      document.getElementById('prodModalBarcode')?.focus();
      return;
    }

    if (!name) {
      State.playSound('error');
      App.showToast('Gagal: Nama produk tidak boleh kosong!', 'error');
      document.getElementById('prodModalName')?.focus();
      return;
    }

    const payload = {
      barcode,
      code,
      name,
      category,
      unit,
      buyPrice,
      sellPrice,
      stock,
      minStock
    };

    try {
      if (id) {
        // Update
        await DB.updateProduct(Number(id), payload);
        App.showToast(`Produk "${name}" berhasil diperbarui!`, 'success');
      } else {
        // Add
        await DB.addProduct(payload);
        App.showToast(`Produk "${name}" berhasil ditambahkan!`, 'success');
      }

      this.closeModal();
      await State.refreshProducts();
    } catch (err) {
      console.error(err);
      State.playSound('error');
      App.showToast(err.message, 'error');
    }
  },

  async confirmDelete(productId) {
    const product = await DB.getProductById(productId);
    if (!product) return;

    if (confirm(`Yakin ingin menghapus produk "${product.name}"?\nData yang dihapus tidak dapat dikembalikan.`)) {
      try {
        await DB.deleteProduct(productId);
        App.showToast(`Produk "${product.name}" berhasil dihapus.`, 'info');
        await State.refreshProducts();
      } catch (err) {
        App.showToast(`Gagal menghapus: ${err.message}`, 'error');
      }
    }
  },

  // Helper to load 50+ sample items if needed
  async loadInitialSampleData() {
    if (typeof SAMPLE_PRODUCTS === 'undefined' || !SAMPLE_PRODUCTS.length) {
      App.showToast('Data contoh tidak tersedia.', 'warning');
      return;
    }

    if (confirm(`Muat ${SAMPLE_PRODUCTS.length} produk contoh toko kelontong ke database lokal?`)) {
      try {
        let added = 0;
        for (const item of SAMPLE_PRODUCTS) {
          try {
            await DB.addProduct(item);
            added++;
          } catch (e) {
            // Skip duplicate
          }
        }
        await State.refreshProducts();
        State.playSound('success');
        App.showToast(`Berhasil memuat ${added} produk contoh toko kelontong!`, 'success');
      } catch (err) {
        App.showToast(`Gagal memuat data contoh: ${err.message}`, 'error');
      }
    }
  }
};

