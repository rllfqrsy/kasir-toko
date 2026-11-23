/**
 * Database Layer for Toko Kelontong POS using IndexedDB
 * Handles Products, Transactions, Stock Logs, and Store Settings.
 */
const DB = {
  dbName: 'TokoKelontongPOS_DB',
  dbVersion: 1,
  _db: null,

  async init() {
    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Products Store
        if (!db.objectStoreNames.contains('products')) {
          const productStore = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
          productStore.createIndex('barcode', 'barcode', { unique: false });
          productStore.createIndex('code', 'code', { unique: false });
          productStore.createIndex('name', 'name', { unique: false });
          productStore.createIndex('category', 'category', { unique: false });
          productStore.createIndex('stock', 'stock', { unique: false });
          productStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // 2. Transactions Store
        if (!db.objectStoreNames.contains('transactions')) {
          const txStore = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
          txStore.createIndex('invoiceNo', 'invoiceNo', { unique: true });
          txStore.createIndex('date', 'date', { unique: false });
          txStore.createIndex('paymentMethod', 'paymentMethod', { unique: false });
        }

        // 3. Stock Logs Store
        if (!db.objectStoreNames.contains('stock_logs')) {
          const logStore = db.createObjectStore('stock_logs', { keyPath: 'id', autoIncrement: true });
          logStore.createIndex('productId', 'productId', { unique: false });
          logStore.createIndex('date', 'date', { unique: false });
          logStore.createIndex('type', 'type', { unique: false });
        }

        // 4. Settings Store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve(this._db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  async getDB() {
    if (!this._db) {
      await this.init();
    }
    return this._db;
  },

  // -------------------------------------------------------------
  // PRODUCTS METHODS
  // -------------------------------------------------------------

  async validateProductIdentity(product, excludeId = null) {
    const barcode = (product.barcode || '').trim();
    const code = (product.code || '').trim();

    if (!barcode && !code) {
      throw new Error('Produk wajib memiliki Barcode ATAU Kode Barang Internal!');
    }

    const all = await this.getAllProducts();

    if (barcode) {
      const duplicateBarcode = all.find(p => 
        p.id !== excludeId && (p.barcode || '').trim().toLowerCase() === barcode.toLowerCase()
      );
      if (duplicateBarcode) {
        throw new Error(`Barcode "${barcode}" sudah digunakan oleh produk "${duplicateBarcode.name}"!`);
      }
    }

    if (code) {
      const duplicateCode = all.find(p => 
        p.id !== excludeId && (p.code || '').trim().toLowerCase() === code.toLowerCase()
      );
      if (duplicateCode) {
        throw new Error(`Kode Internal "${code}" sudah digunakan oleh produk "${duplicateCode.name}"!`);
      }
    }

    return { barcode, code };
  },

  async getAllProducts() {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('products', 'readonly');
      const store = tx.objectStore('products');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  async getProductById(id) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('products', 'readonly');
      const store = tx.objectStore('products');
      const request = store.get(Number(id));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  },

  async findProductByBarcodeOrCode(term) {
    if (!term) return null;
    const clean = term.trim().toLowerCase();
    const all = await this.getAllProducts();
    return all.find(p => 
      (p.barcode && p.barcode.trim().toLowerCase() === clean) ||
      (p.code && p.code.trim().toLowerCase() === clean)
    ) || null;
  },

  async addProduct(product) {
    const validated = await this.validateProductIdentity(product);
    const db = await this.getDB();
    const now = new Date().toISOString();

    const record = {
      barcode: validated.barcode,
      code: validated.code,
      name: (product.name || '').trim(),
      category: (product.category || 'Umum').trim(),
      unit: (product.unit || 'Pcs').trim(),
      buyPrice: Number(product.buyPrice) || 0,
      sellPrice: Number(product.sellPrice) || 0,
      stock: Number(product.stock) || 0,
      minStock: Number(product.minStock) || 5,
      createdAt: now,
      updatedAt: now
    };

    if (!record.name) {
      throw new Error('Nama produk tidak boleh kosong!');
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['products', 'stock_logs'], 'readwrite');
      const pStore = tx.objectStore('products');
      const lStore = tx.objectStore('stock_logs');

      const addReq = pStore.add(record);
      addReq.onsuccess = (e) => {
        const newId = e.target.result;
        record.id = newId;

        // Log initial stock if > 0
        if (record.stock > 0) {
          lStore.add({
            productId: newId,
            productName: record.name,
            type: 'INITIAL',
            qtyChange: record.stock,
            stockBefore: 0,
            stockAfter: record.stock,
            reference: 'Stok Awal Produk Baru',
            date: now
          });
        }
      };

      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  },

  async updateProduct(id, updates) {
    id = Number(id);
    const existing = await this.getProductById(id);
    if (!existing) {
      throw new Error(`Produk dengan ID ${id} tidak ditemukan!`);
    }

    const merged = { ...existing, ...updates };
    const validated = await this.validateProductIdentity(merged, id);
    const now = new Date().toISOString();

    const record = {
      ...merged,
      id: id,
      barcode: validated.barcode,
      code: validated.code,
      name: (updates.name !== undefined ? updates.name : existing.name).trim(),
      category: (updates.category !== undefined ? updates.category : existing.category).trim(),
      unit: (updates.unit !== undefined ? updates.unit : existing.unit).trim(),
      buyPrice: updates.buyPrice !== undefined ? Number(updates.buyPrice) : existing.buyPrice,
      sellPrice: updates.sellPrice !== undefined ? Number(updates.sellPrice) : existing.sellPrice,
      stock: updates.stock !== undefined ? Number(updates.stock) : existing.stock,
      minStock: updates.minStock !== undefined ? Number(updates.minStock) : existing.minStock,
      updatedAt: now
    };

    if (!record.name) {
      throw new Error('Nama produk tidak boleh kosong!');
    }

    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['products', 'stock_logs'], 'readwrite');
      const pStore = tx.objectStore('products');
      const lStore = tx.objectStore('stock_logs');

      // Check if stock was directly edited
      if (updates.stock !== undefined && updates.stock !== existing.stock) {
        const diff = updates.stock - existing.stock;
        lStore.add({
          productId: id,
          productName: record.name,
          type: 'ADJUSTMENT',
          qtyChange: diff,
          stockBefore: existing.stock,
          stockAfter: record.stock,
          reference: updates.adjustmentReason || 'Penyesuaian Manual',
          date: now
        });
      }

      pStore.put(record);

      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  },

  async deleteProduct(id) {
    id = Number(id);
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['products', 'stock_logs'], 'readwrite');
      tx.objectStore('products').delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  // -------------------------------------------------------------
  // TRANSACTIONS & SALES CHECKOUT (ATOMIC STOCK DEDUCTION)
  // -------------------------------------------------------------

  async createTransaction(orderData) {
    const db = await this.getDB();
    const now = new Date().toISOString();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['transactions', 'products', 'stock_logs'], 'readwrite');
      const txStore = tx.objectStore('transactions');
      const pStore = tx.objectStore('products');
      const logStore = tx.objectStore('stock_logs');
      let stockValidationComplete = false;
      let stockValidationFailed = false;
      let validationError = null;
      const requestedByProduct = new Map();

      (orderData.items || []).forEach(item => {
        const productId = Number(item.productId);
        const qty = Math.max(0, Number(item.qty) || 0);
        requestedByProduct.set(productId, (requestedByProduct.get(productId) || 0) + qty);
      });

      const productIds = [...requestedByProduct.keys()];
      let pendingReads = productIds.length;

      if (pendingReads === 0) {
        tx.abort();
        reject(new Error('Keranjang tidak memiliki produk yang valid!'));
        return;
      }

      productIds.forEach(productId => {
        const getReq = pStore.get(productId);
        getReq.onsuccess = () => {
          const prod = getReq.result;
          const requestedQty = requestedByProduct.get(productId);
          if (!prod) {
            stockValidationFailed = true;
            validationError = `Produk dengan ID ${productId} tidak ditemukan!`;
          } else if (requestedQty <= 0 || (Number(prod.stock) || 0) < requestedQty) {
            stockValidationFailed = true;
            validationError = `Stok "${prod.name}" tidak cukup. Tersisa ${Number(prod.stock) || 0}!`;
          }

          pendingReads--;
          if (pendingReads === 0) {
            stockValidationComplete = true;
            if (stockValidationFailed) {
              tx.abort();
            } else {
              processCheckout();
            }
          }
        };
        getReq.onerror = () => {
          pendingReads--;
          stockValidationFailed = true;
          validationError = 'Gagal memeriksa stok produk!';
          if (pendingReads === 0) tx.abort();
        };
      });

      let record = null;

      const processCheckout = () => {
        if (stockValidationFailed) return;

        // Generate Invoice Number: INV-YYYYMMDD-XXXX
        const datePart = now.slice(0, 10).replace(/-/g, '');
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        const invoiceNo = `INV-${datePart}-${randomSuffix}`;

        let subtotal = 0;
        let totalBuyPrice = 0;
        const orderItems = [];

        (orderData.items || []).forEach(item => {
          const qty = Math.max(1, Number(item.qty) || 1);
          const buyPrice = Number(item.buyPrice) || 0;
          const sellPrice = Number(item.sellPrice) || 0;
          const discount = Number(item.discount) || 0;
          const lineTotal = (sellPrice * qty) - discount;

          subtotal += lineTotal;
          totalBuyPrice += (buyPrice * qty);

          orderItems.push({
            productId: item.productId,
            barcode: item.barcode || '',
            code: item.code || '',
            name: item.name,
            unit: item.unit || 'Pcs',
            buyPrice: buyPrice,
            sellPrice: sellPrice,
            qty: qty,
            discount: discount,
            subtotal: lineTotal
          });

          const getReq = pStore.get(Number(item.productId));
          getReq.onsuccess = () => {
            const prod = getReq.result;
            if (!prod) return;

            const stockBefore = Number(prod.stock) || 0;
            const stockAfter = stockBefore - qty;
            prod.stock = stockAfter;
            prod.updatedAt = now;
            pStore.put(prod);

            logStore.add({
              productId: prod.id,
              productName: prod.name,
              type: 'SALE',
              qtyChange: -qty,
              stockBefore: stockBefore,
              stockAfter: stockAfter,
              reference: invoiceNo,
              date: now
            });
          };
        });

        const orderDiscount = Number(orderData.discount) || 0;
        const grandTotal = Math.max(0, subtotal - orderDiscount);
        const amountPaid = Number(orderData.amountPaid) || grandTotal;
        const change = Math.max(0, amountPaid - grandTotal);
        const grossProfit = grandTotal - totalBuyPrice;

        record = {
          invoiceNo: invoiceNo,
          date: now,
          items: orderItems,
          itemCount: orderItems.length,
          totalQty: orderItems.reduce((acc, it) => acc + it.qty, 0),
          subtotal: subtotal,
          discount: orderDiscount,
          grandTotal: grandTotal,
          totalBuyPrice: totalBuyPrice,
          grossProfit: grossProfit,
          paymentMethod: orderData.paymentMethod || 'Tunai',
          amountPaid: amountPaid,
          change: change,
          note: (orderData.note || '').trim(),
          cashier: orderData.cashier || 'Kasir'
        };

        const addReq = txStore.add(record);
        addReq.onsuccess = (e) => {
          record.id = e.target.result;
        };
      };

      tx.oncomplete = () => resolve(record);
      tx.onabort = () => reject(new Error(validationError || 'Transaksi dibatalkan!'));
      tx.onerror = () => reject(tx.error || new Error(validationError || 'Gagal menyimpan transaksi!'));
    });
  },

  async getAllTransactions(limit = 2000) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('transactions', 'readonly');
      const store = tx.objectStore('transactions');
      const request = store.getAll();
      request.onsuccess = () => {
        const results = request.result || [];
        // Sort newest first
        results.sort((a, b) => new Date(b.date) - new Date(a.date));
        resolve(results.slice(0, limit));
      };
      request.onerror = () => reject(request.error);
    });
  },

  async getTransactionById(id) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('transactions', 'readonly');
      const store = tx.objectStore('transactions');
      const request = store.get(Number(id));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  },

  // -------------------------------------------------------------
  // RESTOCK / BARANG MASUK (ATOMIC STOCK INCREMENT)
  // -------------------------------------------------------------

  async processRestock(restockBatch) {
    // restockBatch: { supplier: string, invoiceNote: string, items: [{ productId, qty, buyPrice }] }
    const db = await this.getDB();
    const now = new Date().toISOString();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['products', 'stock_logs'], 'readwrite');
      const pStore = tx.objectStore('products');
      const logStore = tx.objectStore('stock_logs');

      const reference = restockBatch.invoiceNote 
        ? `Barang Masuk (${restockBatch.invoiceNote})` 
        : `Barang Masuk / Restock`;

      restockBatch.items.forEach(item => {
        const qty = Number(item.qty) || 0;
        if (qty <= 0) return;

        const getReq = pStore.get(Number(item.productId));
        getReq.onsuccess = () => {
          const prod = getReq.result;
          if (prod) {
            const stockBefore = prod.stock || 0;
            const stockAfter = stockBefore + qty;
            prod.stock = stockAfter;
            if (item.buyPrice && Number(item.buyPrice) > 0) {
              prod.buyPrice = Number(item.buyPrice);
            }
            prod.updatedAt = now;
            pStore.put(prod);

            logStore.add({
              productId: prod.id,
              productName: prod.name,
              type: 'RESTOCK',
              qtyChange: qty,
              stockBefore: stockBefore,
              stockAfter: stockAfter,
              reference: reference + (restockBatch.supplier ? ` - ${restockBatch.supplier}` : ''),
              date: now
            });
          }
        };
      });

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  // -------------------------------------------------------------
  // STOCK LOGS
  // -------------------------------------------------------------

  async getStockLogs(limit = 100, productId = null) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('stock_logs', 'readonly');
      const store = tx.objectStore('stock_logs');
      const req = store.getAll();
      req.onsuccess = () => {
        let results = req.result || [];
        if (productId) {
          results = results.filter(l => l.productId === Number(productId));
        }
        results.sort((a, b) => new Date(b.date) - new Date(a.date));
        resolve(results.slice(0, limit));
      };
      req.onerror = () => reject(req.error);
    });
  },

  // -------------------------------------------------------------
  // BATCH IMPORT EXCEL (RULES: NEW ADDED, EXISTING RECOGNIZED BY
  // BARCODE/CODE, MASTER UPDATE NEVER OVERWRITES RUNNING STOCK!)
  // -------------------------------------------------------------

  async batchImportProducts(rows) {
    const db = await this.getDB();
    const existingProducts = await this.getAllProducts();
    const now = new Date().toISOString();

    const barcodeMap = new Map();
    const codeMap = new Map();
    existingProducts.forEach(p => {
      if (p.barcode) barcodeMap.set(p.barcode.trim().toLowerCase(), p);
      if (p.code) codeMap.set(p.code.trim().toLowerCase(), p);
    });

    const report = {
      totalRows: rows.length,
      added: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    const toInsert = [];
    const toUpdate = [];

    // Track duplicates inside the excel file itself
    const seenBarcodesInFile = new Set();
    const seenCodesInFile = new Set();

    rows.forEach((row, index) => {
      const rowNum = index + 2; // considering header as row 1
      const barcode = (row.barcode || '').toString().trim();
      const code = (row.code || '').toString().trim();
      const name = (row.name || '').toString().trim();

      // Rule: Must have Barcode OR Code
      if (!barcode && !code) {
        report.skipped++;
        report.errors.push({
          row: rowNum,
          name: name || '(Tanpa Nama)',
          reason: 'Ditolak: Wajib memiliki Barcode atau Kode Internal.'
        });
        return;
      }

      // Check intra-file duplicates
      if (barcode) {
        const lowerBar = barcode.toLowerCase();
        if (seenBarcodesInFile.has(lowerBar)) {
          report.skipped++;
          report.errors.push({
            row: rowNum,
            name: name,
            reason: `Ditolak: Barcode ganda "${barcode}" di dalam file Excel.`
          });
          return;
        }
        seenBarcodesInFile.add(lowerBar);
      }

      if (code) {
        const lowerCode = code.toLowerCase();
        if (seenCodesInFile.has(lowerCode)) {
          report.skipped++;
          report.errors.push({
            row: rowNum,
            name: name,
            reason: `Ditolak: Kode Internal ganda "${code}" di dalam file Excel.`
          });
          return;
        }
        seenCodesInFile.add(lowerCode);
      }

      // Check if matches existing product
      let existing = null;
      const barcodeMatch = barcode && barcodeMap.has(barcode.toLowerCase())
        ? barcodeMap.get(barcode.toLowerCase())
        : null;
      const codeMatch = code && codeMap.has(code.toLowerCase())
        ? codeMap.get(code.toLowerCase())
        : null;

      if (barcodeMatch && codeMatch && barcodeMatch.id !== codeMatch.id) {
        report.skipped++;
        report.errors.push({
          row: rowNum,
          name,
          reason: 'Ditolak: Barcode dan Kode Internal cocok dengan dua produk berbeda.'
        });
        return;
      }

      existing = barcodeMatch || codeMatch;

      const buyPrice = Math.max(0, Number(row.buyPrice) || 0);
      const sellPrice = Math.max(0, Number(row.sellPrice) || 0);
      const minStock = Number(row.minStock) || 5;
      const category = (row.category || 'Umum').toString().trim();
      const unit = (row.unit || 'Pcs').toString().trim();

      if (existing) {
        // UPDATE EXISTING: CRITICAL RULE - DO NOT OVERWRITE RUNNING STOCK!
        toUpdate.push({
          ...existing,
          barcode: barcode || existing.barcode,
          code: code || existing.code,
          name: name || existing.name,
          category: category || existing.category,
          unit: unit || existing.unit,
          buyPrice: buyPrice > 0 ? buyPrice : existing.buyPrice,
          sellPrice: sellPrice > 0 ? sellPrice : existing.sellPrice,
          minStock: minStock > 0 ? minStock : existing.minStock,
          // KEEP EXISTING RUNNING STOCK!
          stock: existing.stock,
          updatedAt: now
        });
        report.updated++;
      } else {
        // NEW PRODUCT: ADD TO DATABASE, USE INITIAL STOCK
        const initialStock = Math.max(0, Number(row.stock) || 0);
        toInsert.push({
          barcode: barcode,
          code: code,
          name: name || `Produk Baru ${barcode || code}`,
          category: category,
          unit: unit,
          buyPrice: buyPrice,
          sellPrice: sellPrice,
          stock: initialStock,
          minStock: minStock,
          createdAt: now,
          updatedAt: now
        });
        report.added++;
      }
    });

    // Execute in IndexedDB transaction
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['products', 'stock_logs'], 'readwrite');
      const pStore = tx.objectStore('products');
      const logStore = tx.objectStore('stock_logs');

      toUpdate.forEach(item => {
        pStore.put(item);
      });

      toInsert.forEach(item => {
        const addReq = pStore.add(item);
        addReq.onsuccess = (e) => {
          const newId = e.target.result;
          if (item.stock > 0) {
            logStore.add({
              productId: newId,
              productName: item.name,
              type: 'INITIAL',
              qtyChange: item.stock,
              stockBefore: 0,
              stockAfter: item.stock,
              reference: 'Import Excel - Produk Baru',
              date: now
            });
          }
        };
      });

      tx.oncomplete = () => resolve(report);
      tx.onerror = () => reject(tx.error);
    });
  },

  // -------------------------------------------------------------
  // SETTINGS (STORE INFO, PRINTER WIDTH, ETC.)
  // -------------------------------------------------------------

  async getSetting(key, defaultValue = null) {
    const db = await this.getDB();
    return new Promise((resolve) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(req.result ? req.result.value : defaultValue);
      };
      req.onerror = () => resolve(defaultValue);
    });
  },

  async saveSetting(key, value) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      store.put({ key, value, updatedAt: new Date().toISOString() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  // -------------------------------------------------------------
  // BACKUP & RESTORE ENTIRE DATABASE (JSON)
  // -------------------------------------------------------------

  async exportEntireDatabase() {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['products', 'transactions', 'stock_logs', 'settings'], 'readonly');
      const dump = {
        app: 'KelontongPOS',
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        data: {}
      };

      const pReq = tx.objectStore('products').getAll();
      const tReq = tx.objectStore('transactions').getAll();
      const lReq = tx.objectStore('stock_logs').getAll();
      const sReq = tx.objectStore('settings').getAll();

      pReq.onsuccess = () => dump.data.products = pReq.result || [];
      tReq.onsuccess = () => dump.data.transactions = tReq.result || [];
      lReq.onsuccess = () => dump.data.stock_logs = lReq.result || [];
      sReq.onsuccess = () => dump.data.settings = sReq.result || [];

      tx.oncomplete = () => resolve(dump);
      tx.onerror = () => reject(tx.error);
    });
  },

  async restoreEntireDatabase(backupJson, mode = 'replace') {
    if (!backupJson || !backupJson.data || !Array.isArray(backupJson.data.products)) {
      throw new Error('Format file backup JSON tidak valid!');
    }

    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['products', 'transactions', 'stock_logs', 'settings'], 'readwrite');
      const pStore = tx.objectStore('products');
      const tStore = tx.objectStore('transactions');
      const lStore = tx.objectStore('stock_logs');
      const sStore = tx.objectStore('settings');

      if (mode === 'replace') {
        pStore.clear();
        tStore.clear();
        lStore.clear();
        sStore.clear();

        (backupJson.data.products || []).forEach(item => pStore.add(item));
        (backupJson.data.transactions || []).forEach(item => tStore.add(item));
        (backupJson.data.stock_logs || []).forEach(item => lStore.add(item));
        (backupJson.data.settings || []).forEach(item => sStore.add(item));
      } else {
        // Merge mode
        (backupJson.data.products || []).forEach(item => pStore.put(item));
        (backupJson.data.transactions || []).forEach(item => tStore.put(item));
        (backupJson.data.stock_logs || []).forEach(item => lStore.put(item));
        (backupJson.data.settings || []).forEach(item => sStore.put(item));
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async clearAllData() {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['products', 'transactions', 'stock_logs'], 'readwrite');
      tx.objectStore('products').clear();
      tx.objectStore('transactions').clear();
      tx.objectStore('stock_logs').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
};

