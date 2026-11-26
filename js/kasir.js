/**
 * Kasir Session Manager
 * Mengelola pembukaan toko (uang awal), penutupan toko (saldo akhir),
 * dan rekonsiliasi kas harian.
 */
const KasirSession = {
  activeSession: null,

  async init() {
    this.activeSession = await DB.getActiveCashSession();
    this.renderTopbarStatus();
  },

  // ---------------------------------------------------------------
  // TOPBAR STATUS BADGE
  // ---------------------------------------------------------------

  renderTopbarStatus() {
    const badge = document.getElementById('cashSessionBadge');
    if (!badge) return;
    if (this.activeSession) {
      const jam = new Date(this.activeSession.openedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      badge.innerHTML = `<span class="status-dot"></span> Toko Buka (${jam})`;
      badge.className = 'status-badge status-online cash-session-badge';
      badge.title = `Kas awal: ${App.formatRupiah(this.activeSession.openingCash)}`;
    } else {
      badge.innerHTML = `<span class="status-dot"></span> Toko Belum Dibuka`;
      badge.className = 'status-badge status-offline cash-session-badge';
      badge.title = 'Klik untuk membuka toko';
    }
  },

  // ---------------------------------------------------------------
  // RENDER VIEW KASIR SESSION
  // ---------------------------------------------------------------

  async renderView() {
    this.activeSession = await DB.getActiveCashSession();
    const sessions = await DB.getAllCashSessions(30);
    const container = document.getElementById('view-kasir');
    if (!container) return;

    // ---- KPI HARI INI ----
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayTx = await DB.getTransactionsByDateRange(todayStr, todayStr);
    const todayOmzet = todayTx.reduce((s, t) => s + (t.grandTotal || 0), 0);
    const todayCash = todayTx.filter(t => t.paymentMethod === 'Tunai').reduce((s, t) => s + (t.grandTotal || 0), 0);
    const todayQris = todayTx.filter(t => t.paymentMethod === 'QRIS').reduce((s, t) => s + (t.grandTotal || 0), 0);
    const todayTransfer = todayTx.filter(t => t.paymentMethod === 'Transfer').reduce((s, t) => s + (t.grandTotal || 0), 0);

    // Expected cash in drawer = opening cash + all cash sales today
    const openingCash = this.activeSession ? this.activeSession.openingCash : 0;
    const expectedDrawer = openingCash + todayCash;

    const statusHtml = this.activeSession ? `
      <div class="kpi-card border-emerald">
        <div class="kpi-title">Status Toko</div>
        <div class="kpi-value text-emerald" style="font-size:1.5rem;">🟢 BUKA</div>
        <div class="kpi-subtext">Dibuka pukul ${new Date(this.activeSession.openedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} oleh ${App.escapeHtml(this.activeSession.openedBy)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Uang Kas Awal</div>
        <div class="kpi-value">${App.formatRupiah(this.activeSession.openingCash)}</div>
        <div class="kpi-subtext">Uang di laci saat toko dibuka</div>
      </div>
      <div class="kpi-card border-emerald">
        <div class="kpi-title">Ekspektasi Kas di Laci</div>
        <div class="kpi-value text-emerald">${App.formatRupiah(expectedDrawer)}</div>
        <div class="kpi-subtext">Kas awal + penjualan tunai hari ini</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Omzet Hari Ini</div>
        <div class="kpi-value text-emerald">${App.formatRupiah(todayOmzet)}</div>
        <div class="kpi-subtext">${todayTx.length} transaksi</div>
      </div>
    ` : `
      <div class="kpi-card" style="grid-column: 1/-1; text-align:center; padding: 32px;">
        <div style="font-size: 3rem; margin-bottom: 12px;">🔒</div>
        <div class="kpi-title" style="font-size:1.1rem;">Toko Belum Dibuka</div>
        <div class="kpi-subtext mt-2">Klik "Buka Toko" untuk memulai sesi kasir hari ini dan mencatat uang kas awal.</div>
      </div>
    `;

    const breakdownHtml = this.activeSession ? `
      <div class="card mt-3">
        <h3 class="font-semibold mb-3">Rincian Penjualan Hari Ini</h3>
        <div class="form-grid-2" style="gap: 12px;">
          <div class="kpi-card" style="margin:0;">
            <div class="kpi-title">💵 Penjualan Tunai</div>
            <div class="kpi-value">${App.formatRupiah(todayCash)}</div>
            <div class="kpi-subtext">Masuk ke laci kas</div>
          </div>
          <div class="kpi-card" style="margin:0;">
            <div class="kpi-title">📱 QRIS</div>
            <div class="kpi-value">${App.formatRupiah(todayQris)}</div>
            <div class="kpi-subtext">Transfer ke rekening</div>
          </div>
          <div class="kpi-card" style="margin:0;">
            <div class="kpi-title">🏦 Transfer Bank</div>
            <div class="kpi-value">${App.formatRupiah(todayTransfer)}</div>
            <div class="kpi-subtext">Transfer ke rekening</div>
          </div>
          <div class="kpi-card border-emerald" style="margin:0;">
            <div class="kpi-title">🏧 Total Kas Harus Ada</div>
            <div class="kpi-value text-emerald">${App.formatRupiah(expectedDrawer)}</div>
            <div class="kpi-subtext">Kas awal + tunai masuk</div>
          </div>
        </div>
      </div>
    ` : '';

    // Session history table
    const historyHtml = sessions.length > 0 ? sessions.map(s => {
      const openTime = new Date(s.openedAt).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const closeTime = s.closedAt ? new Date(s.closedAt).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
      const statusBadge = s.status === 'open'
        ? `<span class="stock-badge stock-safe">Buka</span>`
        : `<span class="stock-badge stock-empty">Tutup</span>`;
      const diffClass = s.cashDifference === null ? '' : (s.cashDifference > 0 ? 'text-emerald' : s.cashDifference < 0 ? 'text-danger' : 'text-muted');
      const diffText = s.cashDifference === null ? '-' : (s.cashDifference >= 0 ? `+${App.formatRupiah(s.cashDifference)}` : `-${App.formatRupiah(Math.abs(s.cashDifference))}`);
      return `
        <tr>
          <td class="text-xs text-muted">${openTime}</td>
          <td>${statusBadge}</td>
          <td>${App.escapeHtml(s.openedBy)}</td>
          <td class="font-semibold">${App.formatRupiah(s.openingCash)}</td>
          <td>${s.closingCash !== null ? App.formatRupiah(s.closingCash) : '-'}</td>
          <td>${s.expectedCash !== null ? App.formatRupiah(s.expectedCash) : '-'}</td>
          <td class="${diffClass} font-semibold">${diffText}</td>
          <td class="text-xs text-muted">${closeTime}</td>
        </tr>
      `;
    }).join('') : `<tr><td colspan="8" class="empty-state text-muted">Belum ada riwayat sesi.</td></tr>`;

    // Action buttons
    const actionHtml = this.activeSession ? `
      <div class="flex gap-2">
        <button type="button" class="btn btn-secondary" onclick="KasirSession.openEditSessionModal()">
          ✏️ Edit Kas Awal
        </button>
        <button type="button" class="btn btn-danger" onclick="KasirSession.openCloseSessionModal()">
          🔒 Tutup Toko & Hitung Kas Akhir
        </button>
      </div>
    ` : `
      <button type="button" class="btn btn-primary btn-lg" onclick="KasirSession.openOpenSessionModal()">
        🔓 Buka Toko & Catat Uang Kas Awal
      </button>
    `;

    // Inject into section-header area
    const headerAction = document.getElementById('kasirSessionHeaderAction');
    if (headerAction) headerAction.innerHTML = actionHtml;

    const kpiGrid = document.getElementById('kasirSessionKpi');
    if (kpiGrid) kpiGrid.innerHTML = statusHtml;

    const breakdownArea = document.getElementById('kasirSessionBreakdown');
    if (breakdownArea) breakdownArea.innerHTML = breakdownHtml;

    const historyTbody = document.getElementById('kasirSessionHistoryTbody');
    if (historyTbody) historyTbody.innerHTML = historyHtml;

    this.renderTopbarStatus();
  },

  // ---------------------------------------------------------------
  // MODAL: BUKA TOKO
  // ---------------------------------------------------------------

  openOpenSessionModal() {
    const modal = document.getElementById('openSessionModal');
    if (!modal) return;
    document.getElementById('openSessionCash').value = '';
    document.getElementById('openSessionBy').value = State.storeSettings.cashierName || 'Kasir 1';
    document.getElementById('openSessionNote').value = '';
    modal.classList.add('modal-open');
    setTimeout(() => document.getElementById('openSessionCash')?.focus(), 100);
  },

  closeOpenSessionModal() {
    document.getElementById('openSessionModal')?.classList.remove('modal-open');
  },

  async submitOpenSession() {
    const cash = Number(document.getElementById('openSessionCash')?.value) || 0;
    const by = document.getElementById('openSessionBy')?.value.trim() || 'Kasir 1';
    const note = document.getElementById('openSessionNote')?.value.trim() || '';

    try {
      this.activeSession = await DB.openCashSession({ openingCash: cash, openedBy: by, note });
      this.closeOpenSessionModal();
      App.showToast(`Toko dibuka! Kas awal: ${App.formatRupiah(cash)}`, 'success');
      State.playSound('success');
      await this.renderView();
    } catch (err) {
      App.showToast(`Gagal membuka toko: ${err.message}`, 'error');
    }
  },

  // ---------------------------------------------------------------
  // MODAL: TUTUP TOKO
  // ---------------------------------------------------------------

  async openCloseSessionModal() {
    if (!this.activeSession) { App.showToast('Tidak ada sesi kasir yang aktif!', 'warning'); return; }
    const modal = document.getElementById('closeSessionModal');
    if (!modal) return;

    // Recalculate expected cash
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayTx = await DB.getTransactionsByDateRange(todayStr, todayStr);
    const todayCash = todayTx.filter(t => t.paymentMethod === 'Tunai').reduce((s, t) => s + t.grandTotal, 0);
    const expected = this.activeSession.openingCash + todayCash;

    document.getElementById('closeSessionBy').value = State.storeSettings.cashierName || 'Kasir 1';
    document.getElementById('closeSessionNote').value = '';
    document.getElementById('closeSessionActualCash').value = '';
    document.getElementById('closeSessionExpected').textContent = App.formatRupiah(expected);
    document.getElementById('closeSessionOpeningCash').textContent = App.formatRupiah(this.activeSession.openingCash);
    document.getElementById('closeSessionTodayCash').textContent = App.formatRupiah(todayCash);
    document.getElementById('closeSessionDiff').textContent = '-';
    document.getElementById('closeSessionDiff').className = 'font-bold';
    modal.dataset.expectedCash = expected;
    modal.classList.add('modal-open');

    // Live diff calculation
    const actualInput = document.getElementById('closeSessionActualCash');
    actualInput.addEventListener('input', () => this.updateClosingDiff(expected));
    setTimeout(() => actualInput.focus(), 100);
  },

  updateClosingDiff(expected) {
    const actual = Number(document.getElementById('closeSessionActualCash')?.value) || 0;
    const diff = actual - expected;
    const el = document.getElementById('closeSessionDiff');
    if (!el) return;
    if (diff > 0) {
      el.textContent = `+${App.formatRupiah(diff)} (Lebih)`;
      el.className = 'font-bold text-emerald';
    } else if (diff < 0) {
      el.textContent = `-${App.formatRupiah(Math.abs(diff))} (Kurang)`;
      el.className = 'font-bold text-danger';
    } else {
      el.textContent = 'Rp 0 (Pas)';
      el.className = 'font-bold text-muted';
    }
  },

  closeCloseSessionModal() {
    document.getElementById('closeSessionModal')?.classList.remove('modal-open');
  },

  async submitCloseSession() {
    if (!this.activeSession) return;
    const modal = document.getElementById('closeSessionModal');
    const closingCash = Number(document.getElementById('closeSessionActualCash')?.value) || 0;
    const closedBy = document.getElementById('closeSessionBy')?.value.trim() || 'Kasir';
    const closeNote = document.getElementById('closeSessionNote')?.value.trim() || '';
    const expectedCash = Number(modal?.dataset.expectedCash) || 0;

    try {
      await DB.closeCashSession(this.activeSession.id, { closingCash, closedBy, closeNote, expectedCash });
      this.activeSession = null;
      this.closeCloseSessionModal();
      App.showToast('Toko berhasil ditutup. Sesi kas tercatat!', 'success');
      State.playSound('success');
      await this.renderView();
    } catch (err) {
      App.showToast(`Gagal menutup toko: ${err.message}`, 'error');
    }
  },

  // ---------------------------------------------------------------
  // MODAL: EDIT KAS AWAL
  // ---------------------------------------------------------------

  openEditSessionModal() {
    if (!this.activeSession) return;
    const modal = document.getElementById('openSessionModal');
    if (!modal) return;
    document.getElementById('openSessionCash').value = this.activeSession.openingCash;
    document.getElementById('openSessionBy').value = this.activeSession.openedBy;
    document.getElementById('openSessionNote').value = this.activeSession.note || '';
    modal.dataset.editMode = 'true';
    modal.dataset.editId = this.activeSession.id;
    modal.querySelector('.modal-header h3').textContent = 'Edit Uang Kas Awal';
    modal.classList.add('modal-open');
    setTimeout(() => document.getElementById('openSessionCash')?.focus(), 100);
  }
};
