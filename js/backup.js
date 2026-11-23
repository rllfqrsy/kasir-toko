/**
 * Backup & Restore Manager (JSON Format)
 * Guarantees zero data loss, offline safety, and database portability.
 */
const BackupService = {
  stagedBackupData: null,

  init() {
    this.bindEvents();
  },

  bindEvents() {
    const fileInput = document.getElementById('backupRestoreFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this.handleBackupFile(file);
      });
    }
  },

  async downloadBackup() {
    try {
      App.showToast('Menyiapkan file backup...', 'info');
      const dump = await DB.exportEntireDatabase();

      // Add summary stats to header
      dump.summary = {
        productsCount: dump.data.products?.length || 0,
        transactionsCount: dump.data.transactions?.length || 0,
        stockLogsCount: dump.data.stock_logs?.length || 0
      };

      const jsonStr = JSON.stringify(dump, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timePart = now.toTimeString().slice(0, 8).replace(/:/g, '');
      const fileName = `Backup_KelontongPOS_${datePart}_${timePart}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      State.playSound('success');
      App.showToast(`Backup berhasil diunduh (${dump.summary.productsCount} produk, ${dump.summary.transactionsCount} transaksi)!`, 'success');
    } catch (err) {
      console.error(err);
      State.playSound('error');
      App.showToast(`Gagal membuat backup: ${err.message}`, 'error');
    }
  },

  async handleBackupFile(file) {
    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (parseErr) {
        throw new Error('File bukan format JSON yang valid!');
      }

      if (!parsed || !parsed.data || !Array.isArray(parsed.data.products)) {
        throw new Error('Format file backup tidak sesuai dengan struktur KelontongPOS!');
      }

      this.stagedBackupData = parsed;
      this.openRestoreConfirmModal(parsed, file.name);
    } catch (err) {
      console.error(err);
      State.playSound('error');
      App.showToast(err.message, 'error');
      document.getElementById('backupRestoreFileInput').value = '';
    }
  },

  openRestoreConfirmModal(backup, fileName) {
    const modal = document.getElementById('restoreConfirmModal');
    const infoContainer = document.getElementById('restoreBackupInfo');
    if (!modal || !infoContainer) return;

    const exportDate = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString('id-ID') : 'Tidak diketahui';
    const prodCount = backup.data.products?.length || 0;
    const txCount = backup.data.transactions?.length || 0;
    const logCount = backup.data.stock_logs?.length || 0;

    infoContainer.innerHTML = `
      <div class="backup-file-summary">
        <div><strong>Nama File:</strong> <code>${App.escapeHtml(fileName)}</code></div>
        <div><strong>Waktu Backup:</strong> ${exportDate}</div>
        <div class="mt-2 flex gap-2">
          <span class="stock-badge stock-safe">${prodCount} Produk</span>
          <span class="stock-badge stock-safe">${txCount} Transaksi</span>
          <span class="stock-badge stock-safe">${logCount} Riwayat Stok</span>
        </div>
      </div>
    `;

    modal.classList.add('modal-open');
  },

  closeRestoreModal() {
    const modal = document.getElementById('restoreConfirmModal');
    if (modal) modal.classList.remove('modal-open');
    this.stagedBackupData = null;
    const fi = document.getElementById('backupRestoreFileInput');
    if (fi) fi.value = '';
  },

  async executeRestore(mode = 'replace') {
    if (!this.stagedBackupData) return;

    const modeText = mode === 'replace' ? 'MENGGANTI SELURUH DATA' : 'MENGGABUNGKAN DATA';
    if (!confirm(`Konfirmasi: Anda akan ${modeText} dari file backup ini. Lanjutkan?`)) {
      return;
    }

    try {
      App.showToast('Memulihkan database...', 'info');
      await DB.restoreEntireDatabase(this.stagedBackupData, mode);
      State.playSound('success');

      // Reload store settings & products
      await State.loadSettings();
      await State.refreshProducts();
      await Transactions.loadTransactions();

      this.closeRestoreModal();
      App.showToast('Database berhasil dipulihkan dari backup!', 'success');
    } catch (err) {
      console.error(err);
      State.playSound('error');
      App.showToast(`Gagal restore database: ${err.message}`, 'error');
    }
  },

  async clearAllDataSafely() {
    const userInput = prompt('PERINGATAN KERAS:\nTindakan ini akan MENGHAPUS SEMUA DATA produk, stok, dan riwayat transaksi!\n\nKetik kata "HAPUS" untuk konfirmasi:');
    if (userInput === 'HAPUS') {
      try {
        await DB.clearAllData();
        await State.refreshProducts();
        await Transactions.loadTransactions();
        State.playSound('error');
        App.showToast('Seluruh data lokal berhasil dibersihkan.', 'info');
      } catch (err) {
        App.showToast(`Gagal membersihkan data: ${err.message}`, 'error');
      }
    } else if (userInput !== null) {
      App.showToast('Pembersihan dibatalkan (kata kunci tidak cocok).', 'warning');
    }
  }
};

