/**
 * Transactions History & Profit / Revenue Analytics
 */
const Transactions = {
  transactionsList: [],
  selectedTransaction: null,
  activeDateFilter: 'today',

  async init() {
    this.bindEvents();
    await this.loadTransactions();
  },

  bindEvents() {
    const filterSelect = document.getElementById('txDateFilter');
    if (filterSelect) {
      filterSelect.addEventListener('change', (e) => {
        this.activeDateFilter = e.target.value;
        const customRange = document.getElementById('txCustomDateRange');
        if (customRange) {
          customRange.style.display = this.activeDateFilter === 'custom' ? 'flex' : 'none';
        }
        this.renderTransactions();
      });
    }

    const searchInput = document.getElementById('txSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.renderTransactions();
      });
    }

    const startDateInput = document.getElementById('txStartDate');
    const endDateInput = document.getElementById('txEndDate');
    if (startDateInput && endDateInput) {
      startDateInput.addEventListener('change', () => this.renderTransactions());
      endDateInput.addEventListener('change', () => this.renderTransactions());
    }
  },

  async loadTransactions() {
    this.transactionsList = await DB.getAllTransactions(5000);
    this.renderTransactions();
  },

  getFilteredTransactions() {
    const searchInput = document.getElementById('txSearchInput');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    let list = this.transactionsList;

    // Date Filter
    if (this.activeDateFilter === 'today') {
      list = list.filter(t => t.date.slice(0, 10) === todayStr);
    } else if (this.activeDateFilter === '7days') {
      const past7 = new Date();
      past7.setDate(now.getDate() - 7);
      list = list.filter(t => new Date(t.date) >= past7);
    } else if (this.activeDateFilter === 'month') {
      const currentMonth = todayStr.slice(0, 7);
      list = list.filter(t => t.date.slice(0, 7) === currentMonth);
    } else if (this.activeDateFilter === 'custom') {
      const s = document.getElementById('txStartDate')?.value;
      const e = document.getElementById('txEndDate')?.value;
      if (s) {
        list = list.filter(t => t.date.slice(0, 10) >= s);
      }
      if (e) {
        list = list.filter(t => t.date.slice(0, 10) <= e);
      }
    }

    // Search query filter (Invoice No or Cashier)
    if (query) {
      list = list.filter(t => 
        (t.invoiceNo && t.invoiceNo.toLowerCase().includes(query)) ||
        (t.cashier && t.cashier.toLowerCase().includes(query))
      );
    }

    return list;
  },

  renderTransactions() {
    const list = this.getFilteredTransactions();
    const tbody = document.getElementById('txTableBody');

    // Update Analytics KPI Cards
    const totalOmzet = list.reduce((sum, t) => sum + (t.grandTotal || 0), 0);
    const totalHPP = list.reduce((sum, t) => sum + (t.totalBuyPrice || 0), 0);
    const totalLaba = totalOmzet - totalHPP;
    const profitMargin = totalOmzet > 0 ? ((totalLaba / totalOmzet) * 100).toFixed(1) : 0;
    const totalTxCount = list.length;
    const totalItemsSold = list.reduce((sum, t) => sum + (t.totalQty || 0), 0);

    const omzetEl = document.getElementById('kpiTotalOmzet');
    const hppEl = document.getElementById('kpiTotalHPP');
    const labaEl = document.getElementById('kpiTotalLaba');
    const marginEl = document.getElementById('kpiMarginPct');
    const txCountEl = document.getElementById('kpiTotalTx');
    const itemsSoldEl = document.getElementById('kpiTotalItems');

    if (omzetEl) omzetEl.textContent = App.formatRupiah(totalOmzet);
    if (hppEl) hppEl.textContent = App.formatRupiah(totalHPP);
    if (labaEl) labaEl.textContent = App.formatRupiah(totalLaba);
    if (marginEl) marginEl.textContent = `${profitMargin}%`;
    if (txCountEl) txCountEl.textContent = `${totalTxCount} Transaksi`;
    if (itemsSoldEl) itemsSoldEl.textContent = `${totalItemsSold} Pcs/Item`;

    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state text-muted">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2" y="5" width="20" height="14" rx="2"></rect>
              <line x1="2" y1="10" x2="22" y2="10"></line>
            </svg>
            <p>Tidak ada transaksi dalam periode ini.</p>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = list.map((tx, idx) => {
      const dateFormatted = new Date(tx.date).toLocaleString('id-ID', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });

      const paymentMethodBadge = `<span class="badge-payment badge-pay-${(tx.paymentMethod || 'tunai').toLowerCase()}">${tx.paymentMethod}</span>`;

      return `
        <tr>
          <td class="col-num text-muted">${idx + 1}</td>
          <td class="font-medium font-mono">${tx.invoiceNo}</td>
          <td class="text-xs text-muted">${dateFormatted}</td>
          <td>${paymentMethodBadge}</td>
          <td>${tx.totalQty || 0} unit (${tx.items.length} jenis)</td>
          <td class="font-semibold text-emerald">${App.formatRupiah(tx.grandTotal)}</td>
          <td class="text-muted">${App.formatRupiah(tx.totalBuyPrice)}</td>
          <td class="font-semibold text-emerald">+${App.formatRupiah(tx.grossProfit)}</td>
          <td class="text-right table-actions">
            <button type="button" class="btn-action view" onclick="Transactions.openDetailModal(${tx.id})">
              🔍 Detail
            </button>
            <button type="button" class="btn-action print" onclick="Transactions.reprintReceipt(${tx.id})">
              🖨️ Struk
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  async openDetailModal(id) {
    const tx = await DB.getTransactionById(id);
    if (!tx) return;

    this.selectedTransaction = tx;
    const modal = document.getElementById('txDetailModal');
    const title = document.getElementById('txDetailModalTitle');
    const body = document.getElementById('txDetailModalBody');

    if (!modal || !body) return;

    title.textContent = `Detail Transaksi: ${tx.invoiceNo}`;

    const dateFormatted = new Date(tx.date).toLocaleString('id-ID', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const itemsHtml = tx.items.map((it, idx) => {
      const lineProfit = it.subtotal - ((it.buyPrice || 0) * it.qty);
      return `
        <tr>
          <td class="text-muted">${idx + 1}</td>
          <td class="font-medium">${App.escapeHtml(it.name)}</td>
          <td class="text-center">${it.qty} ${it.unit || 'Pcs'}</td>
          <td class="text-right">${App.formatRupiah(it.sellPrice)}</td>
          <td class="text-right font-medium">${App.formatRupiah(it.subtotal)}</td>
          <td class="text-right text-emerald">+${App.formatRupiah(lineProfit)}</td>
        </tr>
      `;
    }).join('');

    body.innerHTML = `
      <div class="tx-detail-info-grid">
        <div>
          <span class="text-muted text-xs">Nomor Nota:</span>
          <div class="font-bold font-mono">${tx.invoiceNo}</div>
        </div>
        <div>
          <span class="text-muted text-xs">Waktu Transaksi:</span>
          <div class="font-medium">${dateFormatted}</div>
        </div>
        <div>
          <span class="text-muted text-xs">Metode Pembayaran:</span>
          <div class="font-semibold text-emerald">${tx.paymentMethod}</div>
        </div>
        <div>
          <span class="text-muted text-xs">Kasir:</span>
          <div class="font-medium">${App.escapeHtml(tx.cashier || 'Kasir')}</div>
        </div>
      </div>

      <div class="table-container mt-3">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Nama Produk</th>
              <th class="text-center">Qty</th>
              <th class="text-right">Harga Jual</th>
              <th class="text-right">Subtotal</th>
              <th class="text-right">Laba Kotor</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
      </div>

      <div class="tx-detail-summary mt-3">
        <div class="flex-between py-1">
          <span class="text-muted">Total Pembelian (Omzet):</span>
          <span class="font-bold">${App.formatRupiah(tx.grandTotal)}</span>
        </div>
        <div class="flex-between py-1">
          <span class="text-muted">Total Modal (HPP):</span>
          <span>${App.formatRupiah(tx.totalBuyPrice)}</span>
        </div>
        <div class="flex-between py-1 border-t">
          <span class="font-bold text-emerald">Keuntungan Kotor (Laba):</span>
          <span class="font-bold text-emerald text-lg">+${App.formatRupiah(tx.grossProfit)}</span>
        </div>
        <div class="flex-between py-1">
          <span class="text-muted">Uang Dibayarkan:</span>
          <span>${App.formatRupiah(tx.amountPaid)}</span>
        </div>
        <div class="flex-between py-1">
          <span class="text-muted">Kembalian:</span>
          <span>${App.formatRupiah(tx.change)}</span>
        </div>
      </div>
    `;

    modal.classList.add('modal-open');
  },

  closeDetailModal() {
    const modal = document.getElementById('txDetailModal');
    if (modal) modal.classList.remove('modal-open');
    this.selectedTransaction = null;
  },

  async reprintReceipt(id) {
    const tx = await DB.getTransactionById(id);
    if (!tx) return;
    POS.openReceiptModal(tx);
  }
};

