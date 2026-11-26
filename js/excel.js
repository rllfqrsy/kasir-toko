/**
 * Excel Import / Export Engine using SheetJS (xlsx.full.min.js)
 * Fully offline-capable, handles 300+ to 1,000+ items seamlessly.
 */
const ExcelService = {
  parsedRows: [],
  previewData: [],

  init() {
    this.bindEvents();
  },

  bindEvents() {
    const fileInput = document.getElementById('excelFileInput');
    const dropZone = document.getElementById('excelDropZone');

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this.handleFile(file);
      });
    }

    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) {
          this.handleFile(e.dataTransfer.files[0]);
        }
      });
    }
  },

  async handleFile(file) {
    if (!window.XLSX) {
      App.showToast('SheetJS belum termuat. Pastikan file vendor tersedia.', 'error');
      return;
    }

    const previewContainer = document.getElementById('excelPreviewSection');
    const loadingEl = document.getElementById('excelLoadingIndicator');

    if (loadingEl) loadingEl.style.display = 'block';

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawJson = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (!rawJson || rawJson.length === 0) {
        throw new Error('File Excel kosong atau tidak memiliki data baris!');
      }

      await this.processRawRowsForPreview(rawJson);

      if (loadingEl) loadingEl.style.display = 'none';
      if (previewContainer) previewContainer.style.display = 'block';

      App.showToast(`Berhasil membaca ${rawJson.length} baris dari file Excel.`, 'success');
    } catch (err) {
      console.error(err);
      if (loadingEl) loadingEl.style.display = 'none';
      State.playSound('error');
      App.showToast(`Gagal membaca Excel: ${err.message}`, 'error');
    }
  },

  async processRawRowsForPreview(rawJson) {
    const existing = await DB.getAllProducts();
    const barcodeMap = new Map();
    const codeMap = new Map();
    existing.forEach(p => {
      if (p.barcode) barcodeMap.set(p.barcode.trim().toLowerCase(), p);
      if (p.code) codeMap.set(p.code.trim().toLowerCase(), p);
    });

    const seenBarcodesInFile = new Set();
    const seenCodesInFile = new Set();

    let newCount = 0;
    let updateCount = 0;
    let invalidCount = 0;

    this.previewData = rawJson.map((row, idx) => {
      // Normalize column keys regardless of case/underscores
      const getVal = (possibleKeys) => {
        for (const k of Object.keys(row)) {
          const cleanK = k.toLowerCase().replace(/[\s_-]/g, '');
          for (const pk of possibleKeys) {
            if (cleanK === pk) return row[k];
          }
        }
        return '';
      };

      const barcode = (getVal(['barcode', 'barkode', 'barcodeno']) || '').toString().trim();
      const code = (getVal(['kodeinternal', 'kode', 'kodebarang', 'kodeitem', 'sku']) || '').toString().trim();
      const name = (getVal(['namaproduk', 'nama', 'namabarang', 'itemname', 'productname']) || '').toString().trim();
      const category = (getVal(['kategori', 'category', 'kelompok']) || 'Umum').toString().trim();
      const unit = (getVal(['satuan', 'unit', 'kemasan']) || 'Pcs').toString().trim();
      const buyPrice = Number(getVal(['hargabeli', 'beli', 'modal', 'hpp', 'cost'])) || 0;
      const sellPrice = Number(getVal(['hargajual', 'jual', 'harga', 'price'])) || 0;
      const stock = Number(getVal(['stokawal', 'stok', 'stock', 'qty', 'jumlah'])) || 0;
      const minStock = Number(getVal(['minstok', 'minimumstok', 'safetystock'])) || 5;

      const item = {
        rowNum: idx + 2,
        barcode,
        code,
        name,
        category,
        unit,
        buyPrice,
        sellPrice,
        stock,
        minStock,
        status: 'NEW', // 'NEW', 'UPDATE', 'INVALID'
        reason: '',
        existingProduct: null
      };

      // RULE VALIDATION: Must have Barcode OR Code
      if (!barcode && !code) {
        item.status = 'INVALID';
        item.reason = 'Ditolak: Tidak ada Barcode & Kode Internal';
        invalidCount++;
        return item;
      }

      // Check duplicate barcode inside file
      if (barcode) {
        const lowerBar = barcode.toLowerCase();
        if (seenBarcodesInFile.has(lowerBar)) {
          item.status = 'INVALID';
          item.reason = `Ditolak: Barcode ganda "${barcode}" di dalam file`;
          invalidCount++;
          return item;
        }
        seenBarcodesInFile.add(lowerBar);
      }

      // Check duplicate code inside file
      if (code) {
        const lowerCode = code.toLowerCase();
        if (seenCodesInFile.has(lowerCode)) {
          item.status = 'INVALID';
          item.reason = `Ditolak: Kode ganda "${code}" di dalam file`;
          invalidCount++;
          return item;
        }
        seenCodesInFile.add(lowerCode);
      }

      // Check existing in DB
      let matched = null;
      const barcodeMatch = barcode && barcodeMap.has(barcode.toLowerCase())
        ? barcodeMap.get(barcode.toLowerCase())
        : null;
      const codeMatch = code && codeMap.has(code.toLowerCase())
        ? codeMap.get(code.toLowerCase())
        : null;

      if (barcodeMatch && codeMatch && barcodeMatch.id !== codeMatch.id) {
        item.status = 'INVALID';
        item.reason = 'Ditolak: Barcode dan Kode Internal cocok dengan dua produk berbeda';
        invalidCount++;
        return item;
      }

      matched = barcodeMatch || codeMatch;

      if (matched) {
        item.status = 'UPDATE';
        item.reason = `Update Master (Stok berjalan ${matched.stock} aman dipertahankan)`;
        item.existingProduct = matched;
        updateCount++;
      } else {
        item.status = 'NEW';
        item.reason = `Produk Baru (Akan ditambahkan dengan stok awal: ${stock})`;
        newCount++;
      }

      return item;
    });

    this.renderPreviewSummary(this.previewData.length, newCount, updateCount, invalidCount);
    this.renderPreviewTable();
  },

  renderPreviewSummary(total, newCount, updateCount, invalidCount) {
    const summaryContainer = document.getElementById('excelPreviewSummary');
    if (!summaryContainer) return;

    summaryContainer.innerHTML = `
      <div class="preview-metric-card">
        <span class="text-xs text-muted">Total Baris File</span>
        <div class="metric-val font-bold">${total}</div>
      </div>
      <div class="preview-metric-card border-emerald">
        <span class="text-xs text-muted">Produk Baru Ditambahkan</span>
        <div class="metric-val font-bold text-emerald">+${newCount}</div>
      </div>
      <div class="preview-metric-card border-warning">
        <span class="text-xs text-muted">Update Master (Stok Aman)</span>
        <div class="metric-val font-bold text-warning">${updateCount}</div>
      </div>
      <div class="preview-metric-card border-danger">
        <span class="text-xs text-muted">Ditolak / Tidak Valid</span>
        <div class="metric-val font-bold text-danger">${invalidCount}</div>
      </div>
    `;

    const confirmBtn = document.getElementById('excelConfirmImportBtn');
    if (confirmBtn) {
      confirmBtn.disabled = (newCount + updateCount) === 0;
    }
  },

  renderPreviewTable() {
    const tbody = document.getElementById('excelPreviewTableBody');
    if (!tbody) return;

    // Display first 100 rows for preview to keep rendering instant
    const sample = this.previewData.slice(0, 100);

    tbody.innerHTML = sample.map(item => {
      let badgeClass = 'badge-excel-new';
      let label = 'PRODUK BARU';
      if (item.status === 'UPDATE') {
        badgeClass = 'badge-excel-update';
        label = 'UPDATE MASTER';
      } else if (item.status === 'INVALID') {
        badgeClass = 'badge-excel-invalid';
        label = 'DITOLAK';
      }

      const idCode = item.barcode 
        ? `<span class="badge-barcode">𝄃𝄃 ${App.escapeHtml(item.barcode)}</span>` 
        : `<span class="badge-code">🏷️ ${App.escapeHtml(item.code)}</span>`;

      return `
        <tr class="row-${item.status.toLowerCase()}">
          <td class="col-num text-muted">${item.rowNum}</td>
          <td><span class="badge-status ${badgeClass}">${label}</span></td>
          <td>${idCode}</td>
          <td class="font-medium">${App.escapeHtml(item.name || '(Tanpa Nama)')}</td>
          <td class="text-muted text-xs">${App.escapeHtml(item.category)}</td>
          <td>${App.formatRupiah(item.buyPrice)}</td>
          <td class="font-semibold text-emerald">${App.formatRupiah(item.sellPrice)}</td>
          <td>
            ${item.status === 'UPDATE' 
              ? `<span class="text-warning font-medium">Stok Berjalan (${item.existingProduct.stock})</span>` 
              : `<span>${item.stock} ${item.unit}</span>`}
          </td>
          <td class="text-xs ${item.status === 'INVALID' ? 'text-danger font-medium' : 'text-muted'}">
            ${App.escapeHtml(item.reason)}
          </td>
        </tr>
      `;
    }).join('');

    const noticeEl = document.getElementById('excelPreviewNotice');
    if (noticeEl) {
      if (this.previewData.length > 100) {
        noticeEl.textContent = `Menampilkan preview 100 dari ${this.previewData.length} baris. Semua baris yang valid akan diproses saat konfirmasi.`;
        noticeEl.style.display = 'block';
      } else {
        noticeEl.style.display = 'none';
      }
    }
  },

  async executeImport() {
    const validRows = this.previewData.filter(it => it.status !== 'INVALID');
    if (validRows.length === 0) {
      App.showToast('Tidak ada baris valid untuk diimport!', 'warning');
      return;
    }

    const confirmBtn = document.getElementById('excelConfirmImportBtn');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Memproses Import...';
    }

    try {
      const report = await DB.batchImportProducts(this.previewData);
      State.playSound('success');

      // Refresh product state
      await State.refreshProducts();

      // Show Import Result Report Modal
      this.showImportResultReport(report);

      // Reset file input & preview
      this.previewData = [];
      document.getElementById('excelFileInput').value = '';
      document.getElementById('excelPreviewSection').style.display = 'none';
    } catch (err) {
      console.error(err);
      State.playSound('error');
      App.showToast(`Import gagal: ${err.message}`, 'error');
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '✅ Konfirmasi & Proses Import';
      }
    }
  },

  showImportResultReport(report) {
    const modal = document.getElementById('excelResultModal');
    const body = document.getElementById('excelResultModalBody');
    if (!modal || !body) return;

    const errorRowsHtml = report.errors.length > 0 ? `
      <div class="excel-error-log mt-3">
        <h4 class="text-danger font-medium mb-1">Daftar Baris Ditolak (${report.errors.length}):</h4>
        <div class="error-log-list">
          ${report.errors.map(e => `
            <div class="error-log-item">
              <span class="font-bold">Baris ${e.row}:</span> 
              <span>${App.escapeHtml(e.name)}</span> - 
              <span class="text-danger">${App.escapeHtml(e.reason)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    body.innerHTML = `
      <div class="result-stats-grid">
        <div class="result-stat-box border-emerald">
          <div class="stat-num text-emerald">${report.added}</div>
          <div class="stat-lbl">Produk Baru Ditambahkan</div>
        </div>
        <div class="result-stat-box border-warning">
          <div class="stat-num text-warning">${report.updated}</div>
          <div class="stat-lbl">Master Diperbarui (Stok Berjalan Aman)</div>
        </div>
        <div class="result-stat-box border-danger">
          <div class="stat-num text-danger">${report.skipped}</div>
          <div class="stat-lbl">Baris Ditolak / Dilewati</div>
        </div>
      </div>

      <div class="alert-info mt-3">
        💡 <strong>Perhatian Stok:</strong> Produk yang sudah ada diperbarui harga dan datanya tanpa mengganggu atau menimpa stok fisik yang sedang berjalan di kasir.
      </div>

      ${errorRowsHtml}
    `;

    modal.classList.add('modal-open');
  },

  closeResultModal() {
    const modal = document.getElementById('excelResultModal');
    if (modal) modal.classList.remove('modal-open');
  },

  // -------------------------------------------------------------
  // EXCEL EXPORTS
  // -------------------------------------------------------------

  exportProductsExcel() {
    if (!window.XLSX) {
      App.showToast('SheetJS belum siap.', 'error');
      return;
    }

    const products = State.products;
    if (products.length === 0) {
      App.showToast('Belum ada produk untuk diexport!', 'warning');
      return;
    }

    const data = products.map((p, idx) => {
      const margin = (p.sellPrice || 0) - (p.buyPrice || 0);
      const marginPct = p.sellPrice > 0 ? ((margin / p.sellPrice) * 100).toFixed(1) : 0;
      const totalNilaiModal = (p.stock || 0) * (p.buyPrice || 0);
      const totalNilaiJual = (p.stock || 0) * (p.sellPrice || 0);

      return {
        'No': idx + 1,
        'Barcode': p.barcode || '',
        'Kode_Internal': p.code || '',
        'Nama_Produk': p.name,
        'Kategori': p.category || 'Umum',
        'Satuan': p.unit || 'Pcs',
        'Harga_Beli': p.buyPrice || 0,
        'Harga_Jual': p.sellPrice || 0,
        'Laba_Per_Pcs': margin,
        'Margin_Persen': `${marginPct}%`,
        'Stok_Saat_Ini': p.stock || 0,
        'Min_Stok': p.minStock || 5,
        'Total_Nilai_Modal': totalNilaiModal,
        'Total_Nilai_Jual': totalNilaiJual
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Master_Produk');

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    XLSX.writeFile(workbook, `Data_Produk_Stok_Kelontong_${dateStr}.xlsx`);
    App.showToast('File Excel produk berhasil diunduh!', 'success');
  },

  async exportTransactionsExcel() {
    if (!window.XLSX) {
      App.showToast('SheetJS belum siap.', 'error');
      return;
    }

    const list = Transactions.getFilteredTransactions();
    if (list.length === 0) {
      App.showToast('Tidak ada transaksi untuk diexport!', 'warning');
      return;
    }

    // Sheet 1: Summary per Nota
    const summaryData = list.map((tx, idx) => ({
      'No': idx + 1,
      'No_Nota': tx.invoiceNo,
      'Tanggal': new Date(tx.date).toLocaleDateString('id-ID'),
      'Waktu': new Date(tx.date).toLocaleTimeString('id-ID'),
      'Kasir': tx.cashier || 'Kasir',
      'Metode_Bayar': tx.paymentMethod,
      'Total_Item': tx.totalQty,
      'Omzet_Penjualan': tx.grandTotal,
      'Modal_HPP': tx.totalBuyPrice,
      'Laba_Kotor': tx.grossProfit,
      'Uang_Diterima': tx.amountPaid,
      'Kembalian': tx.change
    }));

    // Sheet 2: Detail per Item
    const detailData = [];
    list.forEach(tx => {
      tx.items.forEach(it => {
        const itemHpp = (it.buyPrice || 0) * it.qty;
        const itemLaba = it.subtotal - itemHpp;
        detailData.push({
          'No_Nota': tx.invoiceNo,
          'Tanggal': new Date(tx.date).toLocaleDateString('id-ID'),
          'Barcode': it.barcode || '',
          'Kode_Internal': it.code || '',
          'Nama_Produk': it.name,
          'Satuan': it.unit || 'Pcs',
          'Qty': it.qty,
          'Harga_Beli': it.buyPrice,
          'Harga_Jual': it.sellPrice,
          'Subtotal_Penjualan': it.subtotal,
          'Total_HPP': itemHpp,
          'Laba_Kotor_Item': itemLaba
        });
      });
    });

    const wb = XLSX.utils.book_new();
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    const wsDetail = XLSX.utils.json_to_sheet(detailData);

    XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan_Transaksi');
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Detail_Item_Terjual');

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    XLSX.writeFile(wb, `Laporan_Penjualan_POS_${dateStr}.xlsx`);
    App.showToast('Laporan transaksi Excel berhasil diunduh!', 'success');
  },

  openLaporanHarianModal() {
    const modal = document.getElementById('laporanHarianModal');
    if (!modal) return;
    // Default to today
    document.getElementById('laporanHarianDate').value = new Date().toISOString().slice(0, 10);
    modal.classList.add('modal-open');
  },

  async exportLaporanHarianFromModal() {
    const dateVal = document.getElementById('laporanHarianDate')?.value;
    if (!dateVal) { App.showToast('Pilih tanggal laporan terlebih dahulu!', 'warning'); return; }
    App.closeModal('laporanHarianModal');
    await this.exportLaporanHarian(dateVal);
  },

  // -------------------------------------------------------------
  // LAPORAN HARIAN EXCEL
  // -------------------------------------------------------------

  async exportLaporanHarian(targetDate) {
    if (!window.XLSX) { App.showToast('SheetJS belum siap.', 'error'); return; }

    const dateStr = targetDate || new Date().toISOString().slice(0, 10);
    const txList = await DB.getTransactionsByDateRange(dateStr, dateStr);
    const sessions = await DB.getAllCashSessions(100);
    const daySessions = sessions.filter(s => s.date === dateStr);

    if (txList.length === 0 && daySessions.length === 0) {
      App.showToast('Tidak ada data untuk tanggal ini!', 'warning'); return;
    }

    const wb = XLSX.utils.book_new();
    const dateLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

    // ---- SHEET 1: RINGKASAN HARIAN ----
    const totalOmzet = txList.reduce((s, t) => s + (t.grandTotal || 0), 0);
    const totalHPP   = txList.reduce((s, t) => s + (t.totalBuyPrice || 0), 0);
    const totalLaba  = totalOmzet - totalHPP;
    const totalTunai = txList.filter(t => t.paymentMethod === 'Tunai').reduce((s, t) => s + t.grandTotal, 0);
    const totalQris  = txList.filter(t => t.paymentMethod === 'QRIS').reduce((s, t) => s + t.grandTotal, 0);
    const totalTransfer = txList.filter(t => t.paymentMethod === 'Transfer').reduce((s, t) => s + t.grandTotal, 0);
    const totalItems = txList.reduce((s, t) => s + (t.totalQty || 0), 0);
    const kasAwal    = daySessions.length > 0 ? daySessions[0].openingCash || 0 : 0;
    const kasAkhir   = daySessions.length > 0 && daySessions[0].closingCash !== null ? daySessions[0].closingCash : null;
    const expKas     = kasAwal + totalTunai;
    const marginPct  = totalOmzet > 0 ? ((totalLaba / totalOmzet) * 100).toFixed(1) : 0;
    const storeName  = State.storeSettings.storeName || 'TOKO KELONTONG QORSYA';

    const summaryRows = [
      { 'Keterangan': storeName, 'Nilai': '' },
      { 'Keterangan': `LAPORAN HARIAN: ${dateLabel}`, 'Nilai': '' },
      { 'Keterangan': '', 'Nilai': '' },
      { 'Keterangan': '--- RINGKASAN PENJUALAN ---', 'Nilai': '' },
      { 'Keterangan': 'Total Transaksi', 'Nilai': txList.length },
      { 'Keterangan': 'Total Item Terjual', 'Nilai': totalItems },
      { 'Keterangan': 'Total Omzet (Penjualan)', 'Nilai': totalOmzet },
      { 'Keterangan': 'Total Modal HPP', 'Nilai': totalHPP },
      { 'Keterangan': 'Laba Kotor', 'Nilai': totalLaba },
      { 'Keterangan': 'Margin Laba (%)', 'Nilai': `${marginPct}%` },
      { 'Keterangan': '', 'Nilai': '' },
      { 'Keterangan': '--- RINCIAN METODE BAYAR ---', 'Nilai': '' },
      { 'Keterangan': 'Penjualan Tunai', 'Nilai': totalTunai },
      { 'Keterangan': 'Penjualan QRIS', 'Nilai': totalQris },
      { 'Keterangan': 'Penjualan Transfer Bank', 'Nilai': totalTransfer },
      { 'Keterangan': '', 'Nilai': '' },
      { 'Keterangan': '--- REKONSILIASI KAS ---', 'Nilai': '' },
      { 'Keterangan': 'Uang Kas Awal (Pembukaan)', 'Nilai': kasAwal },
      { 'Keterangan': 'Penerimaan Tunai Hari Ini', 'Nilai': totalTunai },
      { 'Keterangan': 'Ekspektasi Kas di Laci', 'Nilai': expKas },
      { 'Keterangan': 'Kas Akhir Aktual (Penutupan)', 'Nilai': kasAkhir !== null ? kasAkhir : 'Belum ditutup' },
      { 'Keterangan': 'Selisih Kas', 'Nilai': kasAkhir !== null ? kasAkhir - expKas : 'Belum ditutup' },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    wsSummary['!cols'] = [{ wch: 36 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan_Harian');

    // ---- SHEET 2: DAFTAR TRANSAKSI ----
    const txData = txList.map((tx, idx) => ({
      'No': idx + 1,
      'No_Nota': tx.invoiceNo,
      'Waktu': new Date(tx.date).toLocaleTimeString('id-ID'),
      'Kasir': tx.cashier || 'Kasir',
      'Metode_Bayar': tx.paymentMethod,
      'Jumlah_Item': tx.totalQty,
      'Omzet': tx.grandTotal,
      'Modal_HPP': tx.totalBuyPrice,
      'Laba_Kotor': tx.grossProfit,
      'Uang_Diterima': tx.amountPaid,
      'Kembalian': tx.change,
      'Catatan': tx.note || ''
    }));
    if (txData.length > 0) {
      const wsTx = XLSX.utils.json_to_sheet(txData);
      wsTx['!cols'] = [{ wch: 4 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, wsTx, 'Daftar_Transaksi');
    }

    // ---- SHEET 3: DETAIL BARANG TERJUAL ----
    const detailData = [];
    txList.forEach(tx => {
      tx.items.forEach(it => {
        const hpp = (it.buyPrice || 0) * it.qty;
        detailData.push({
          'No_Nota': tx.invoiceNo,
          'Waktu': new Date(tx.date).toLocaleTimeString('id-ID'),
          'Barcode': it.barcode || '',
          'Kode_Internal': it.code || '',
          'Nama_Produk': it.name,
          'Satuan': it.unit || 'Pcs',
          'Qty': it.qty,
          'Harga_Beli': it.buyPrice,
          'Harga_Jual': it.sellPrice,
          'Subtotal': it.subtotal,
          'Total_HPP': hpp,
          'Laba_Item': it.subtotal - hpp
        });
      });
    });
    if (detailData.length > 0) {
      const wsDetail = XLSX.utils.json_to_sheet(detailData);
      wsDetail['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 8 }, { wch: 6 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsDetail, 'Detail_Barang_Terjual');
    }

    // ---- SHEET 4: SESI KAS ----
    if (daySessions.length > 0) {
      const kasData = daySessions.map(s => ({
        'Dibuka': new Date(s.openedAt).toLocaleTimeString('id-ID'),
        'Dibuka_Oleh': s.openedBy,
        'Kas_Awal': s.openingCash,
        'Ditutup': s.closedAt ? new Date(s.closedAt).toLocaleTimeString('id-ID') : 'Belum',
        'Ditutup_Oleh': s.closedBy || '-',
        'Kas_Akhir_Aktual': s.closingCash !== null ? s.closingCash : '-',
        'Kas_Ekspektasi': s.expectedCash !== null ? s.expectedCash : '-',
        'Selisih': s.cashDifference !== null ? s.cashDifference : '-',
        'Status': s.status === 'open' ? 'Toko Buka' : 'Toko Tutup',
        'Catatan_Buka': s.note || '',
        'Catatan_Tutup': s.closeNote || ''
      }));
      const wsKas = XLSX.utils.json_to_sheet(kasData);
      wsKas['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 24 }, { wch: 24 }];
      XLSX.utils.book_append_sheet(wb, wsKas, 'Sesi_Kas');
    }

    const fileDateStr = dateStr.replace(/-/g, '');
    XLSX.writeFile(wb, `Laporan_Harian_${fileDateStr}.xlsx`);
    App.showToast(`Laporan harian ${dateLabel} berhasil diunduh!`, 'success');
  },

  downloadTemplateExcel() {
    if (!window.XLSX) {
      App.showToast('SheetJS belum siap.', 'error');
      return;
    }

    const templateRows = [
      {
        'Barcode': '8992775211117',
        'Kode_Internal': '',
        'Nama_Produk': 'Minyak Goreng Bimoli 2L (Contoh Berbarcode)',
        'Kategori': 'Sembako',
        'Satuan': 'Pcs',
        'Harga_Beli': 34000,
        'Harga_Jual': 38000,
        'Stok_Awal': 50,
        'Min_Stok': 10
      },
      {
        'Barcode': '',
        'Kode_Internal': 'TLR-AYAM-01',
        'Nama_Produk': 'Telur Ayam Negeri Fresh (Contoh Tanpa Barcode)',
        'Kategori': 'Sembako',
        'Satuan': 'Butir',
        'Harga_Beli': 1800,
        'Harga_Jual': 2200,
        'Stok_Awal': 250,
        'Min_Stok': 40
      },
      {
        'Barcode': '089686010924',
        'Kode_Internal': '',
        'Nama_Produk': 'Indomie Goreng Original 85g',
        'Kategori': 'Mie Instan',
        'Satuan': 'Bks',
        'Harga_Beli': 2900,
        'Harga_Jual': 3500,
        'Stok_Awal': 120,
        'Min_Stok': 30
      },
      {
        'Barcode': '',
        'Kode_Internal': 'BRS-RAMOS-01',
        'Nama_Produk': 'Beras Ramos Super (Literan)',
        'Kategori': 'Sembako',
        'Satuan': 'Liter',
        'Harga_Beli': 12500,
        'Harga_Jual': 14500,
        'Stok_Awal': 100,
        'Min_Stok': 20
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template_Produk');

    XLSX.writeFile(wb, 'Template_Import_Produk_Toko_Kelontong.xlsx');
    App.showToast('Template Excel berhasil diunduh!', 'success');
  }
};

