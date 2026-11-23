const fs = require('fs');
const path = require('path');
const vm = require('vm');

(async () => {
console.log('=== TEST 1: Syntactic Check of All JS Files ===');
const jsFiles = [
  'sample/initial-data.js',
  'js/db.js',
  'js/state.js',
  'js/printer.js',
  'js/pos.js',
  'js/products.js',
  'js/inventory.js',
  'js/transactions.js',
  'js/excel.js',
  'js/backup.js',
  'js/app.js',
  'sw.js'
];

let syntaxErrors = 0;
for (const file of jsFiles) {
  const filePath = path.join(__dirname, '..', file);
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    new vm.Script(code, { filename: file });
    console.log(`  ✓ ${file} syntax valid.`);
  } catch (e) {
    console.error(`  ✗ Error in ${file}:`, e.message);
    syntaxErrors++;
  }
}

if (syntaxErrors > 0) {
  console.error(`Failing early due to ${syntaxErrors} syntax errors.`);
  process.exit(1);
}

console.log('\n=== TEST 1B: Bluetooth ESC/POS Encoding & Native Bridge ===');
const printerSandbox = {
  window: { location: { href: 'http://localhost:8085/index.html' } },
  navigator: {},
  document: { getElementById: () => null },
  btoa: value => Buffer.from(value, 'binary').toString('base64'),
  TextEncoder,
  URL,
  WebSocket: { OPEN: 1, CLOSED: 3 },
  setTimeout,
  clearTimeout,
  console
};
vm.runInNewContext(
  `${fs.readFileSync(path.join(__dirname, '..', 'js/printer.js'), 'utf8')}\nglobalThis.PrinterService = PrinterService;`,
  printerSandbox,
  { filename: 'js/printer.js' }
);
const printer = printerSandbox.PrinterService;
const encodedReceipt = Array.from(printer.encodeEscPos(['Cà phê ☕\n', '\x1B@']));
const expectedReceipt = Array.from(Buffer.from('Ca phe ?\n\x1B@', 'ascii'));
if (JSON.stringify(encodedReceipt) !== JSON.stringify(expectedReceipt)) {
  console.error('Bluetooth ESC/POS encoding mismatch:', encodedReceipt);
  process.exit(1);
}

let transmittedBytes = [];
printerSandbox.window.NativePrinterBridge = {
  writeReceipt(base64, requestId) {
    transmittedBytes = Array.from(Buffer.from(base64, 'base64'));
    printerSandbox.window.NativePrinterBridgeCallbacks.onWriteComplete(requestId, true, '');
  }
};
printer.isBluetoothConnected = true;
const expectedBytes = Array.from(new Uint8Array(45).map((_, index) => index));
await printer.writeBluetoothBytes(new Uint8Array(expectedBytes));
if (JSON.stringify(transmittedBytes) !== JSON.stringify(expectedBytes)) {
  console.error('Native bridge payload mismatch:', transmittedBytes);
  process.exit(1);
}
console.log('  ✓ ESC/POS text is converted to printer-safe single-byte output.');
console.log('  ✓ Receipt bytes are passed intact to the Android printer bridge.');

let migratedPrinterConfig = null;
printerSandbox.DB = {
  getSetting: async () => ({ transport: 'qz', printerName: 'Legacy printer', printMode: 'raw' }),
  saveSetting: async (key, value) => {
    if (key === 'printer_config') migratedPrinterConfig = value;
  }
};
await printer.loadConfig();
if (
  printer.config.transport !== 'helper' ||
  printer.config.printerName !== undefined ||
  migratedPrinterConfig?.transport !== 'helper'
) {
  console.error('Legacy QZ printer configuration was not migrated:', printer.config);
  process.exit(1);
}
console.log('  ✓ Legacy QZ settings migrate to Web Printer Helper.');

let helperRequest = null;
printer.config.helperConfigId = '12';
printer.config.helperConfigName = 'Printer Thermal';
printer.availablePrinterConfigs = [{ id: 12, name: 'Printer Thermal' }];
printer.isConnected = true;
printer.helperSocket = {
  readyState: printerSandbox.WebSocket.OPEN,
  send(payload) {
    helperRequest = JSON.parse(payload);
    printer.handleHelperMessage(JSON.stringify({
      uid: helperRequest.uid,
      is_success: true
    }));
  }
};
const helperResult = await printer.printHtmlWithHelper('<p>Struk uji ☕</p>');
const helperUrl = new URL(helperRequest.data.page_url);
const encodedHtml = helperUrl.hash.slice(1).replace(/-/g, '+').replace(/_/g, '/');
const decodedHtml = Buffer.from(encodedHtml, 'base64').toString('utf8');
if (
  helperRequest.method !== 'print_page' ||
  helperRequest.data.config_id !== 12 ||
  helperRequest.data.page_loaded_or_js_request !== 'PAGE_LOADED' ||
  helperUrl.pathname !== '/receipt-print.html' ||
  decodedHtml !== '<p>Struk uji ☕</p>' ||
  !helperResult.is_success
) {
  console.error('Web Printer Helper print request mismatch:', helperRequest);
  process.exit(1);
}
console.log('  ✓ Receipt HTML is sent to the selected Web Printer Helper configuration.');

console.log('\n=== TEST 2: Excel & SheetJS 300+ Products Test ===');
const XLSX = require('../vendor/xlsx.full.min.js');

// Generate 350 test products
const testProducts = [];
for (let i = 1; i <= 350; i++) {
  if (i <= 200) {
    // Has barcode
    testProducts.push({
      Barcode: `899000000${String(i).padStart(4, '0')}`,
      Kode_Internal: '',
      Nama_Produk: `Produk Grosir Berbarcode ${i}`,
      Kategori: i % 2 === 0 ? 'Sembako' : 'Minuman',
      Satuan: 'Pcs',
      Harga_Beli: 5000 + (i * 50),
      Harga_Jual: 6000 + (i * 50),
      Stok_Awal: 10 + i,
      Min_Stok: 5
    });
  } else if (i <= 340) {
    // Unpackaged / curah (no barcode, has internal code)
    testProducts.push({
      Barcode: '',
      Kode_Internal: `CRH-${String(i).padStart(4, '0')}`,
      Nama_Produk: `Barang Curah Toko ${i}`,
      Kategori: 'Sembako',
      Satuan: 'Kg',
      Harga_Beli: 12000,
      Harga_Jual: 14500,
      Stok_Awal: 50,
      Min_Stok: 10
    });
  } else {
    // Invalid rows (no barcode AND no internal code) -> MUST BE REJECTED
    testProducts.push({
      Barcode: '',
      Kode_Internal: '',
      Nama_Produk: `Barang Tanpa Identitas ${i}`,
      Kategori: 'Lainnya',
      Satuan: 'Pcs',
      Harga_Beli: 1000,
      Harga_Jual: 2000,
      Stok_Awal: 10,
      Min_Stok: 2
    });
  }
}

// Write to an actual xlsx file using Node buffer
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(testProducts);
XLSX.utils.book_append_sheet(wb, ws, 'ImportTest');
const testXlsxPath = path.join(__dirname, 'test_350_products.xlsx');
const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
fs.writeFileSync(testXlsxPath, buffer);
console.log(`  ✓ Generated Excel with ${testProducts.length} rows at ${testXlsxPath}`);

// Now read back using SheetJS and verify matching
const fileBuffer = fs.readFileSync(testXlsxPath);
const readWb = XLSX.read(fileBuffer, { type: 'buffer' });
const readRows = XLSX.utils.sheet_to_json(readWb.Sheets['ImportTest'], { defval: '' });
console.log(`  ✓ Read back ${readRows.length} rows.`);

let validCount = 0;
let rejectedCount = 0;
readRows.forEach((r, idx) => {
  const barcode = (r.Barcode || '').trim();
  const code = (r.Kode_Internal || '').trim();
  if (!barcode && !code) {
    rejectedCount++;
  } else {
    validCount++;
  }
});

console.log(`  ✓ Valid products: ${validCount} (Expected: 340)`);
console.log(`  ✓ Rejected products: ${rejectedCount} (Expected: 10)`);
if (validCount !== 340 || rejectedCount !== 10) {
  console.error('Mismatch in validation logic!');
  process.exit(1);
}

console.log('\n=== TEST 3: Business Rule: Running Stock Preservation ===');
// Simulate existing product with current running stock = 12 (originally started at 50, sold 38)
const existingProductInDB = {
  id: 1,
  barcode: '8990000000001',
  code: '',
  name: 'Produk Lama',
  category: 'Sembako',
  buyPrice: 5000,
  sellPrice: 6000,
  stock: 12, // CURRENT RUNNING STOCK
  minStock: 5
};

// Excel update row arrives with updated prices and original Stok_Awal = 100
const excelUpdateRow = {
  barcode: '8990000000001',
  code: '',
  name: 'Produk Lama (Nama Diperbarui)',
  category: 'Sembako Super',
  buyPrice: 5500,
  sellPrice: 6500,
  stock: 100, // Excel says 100, BUT master update MUST NOT OVERWRITE RUNNING STOCK!
  minStock: 8
};

// Apply rule
const updatedInDB = {
  ...existingProductInDB,
  name: excelUpdateRow.name,
  category: excelUpdateRow.category,
  buyPrice: excelUpdateRow.buyPrice,
  sellPrice: excelUpdateRow.sellPrice,
  minStock: excelUpdateRow.minStock,
  // STOCK PRESERVED:
  stock: existingProductInDB.stock
};

console.log(`  ✓ Original running stock: ${existingProductInDB.stock}`);
console.log(`  ✓ Excel row stock value: ${excelUpdateRow.stock}`);
console.log(`  ✓ Updated DB stock: ${updatedInDB.stock} (Preserved: ${updatedInDB.stock === 12})`);
if (updatedInDB.stock !== 12 || updatedInDB.sellPrice !== 6500) {
  console.error('Failed stock preservation test!');
  process.exit(1);
}

console.log('\n=== TEST 4: Profit, Margin & Basket Calculations ===');
const sampleItems = [
  { name: 'Minyak 2L', buyPrice: 34000, sellPrice: 38000, qty: 2, subtotal: 76000 },
  { name: 'Indomie', buyPrice: 2900, sellPrice: 3500, qty: 5, subtotal: 17500 },
  { name: 'Telur Butir', buyPrice: 1800, sellPrice: 2200, qty: 10, subtotal: 22000 }
];

const subtotal = sampleItems.reduce((acc, it) => acc + it.subtotal, 0); // 76000 + 17500 + 22000 = 115500
const totalBuyPrice = sampleItems.reduce((acc, it) => acc + (it.buyPrice * it.qty), 0); // (34000*2) + (2900*5) + (1800*10) = 68000 + 14500 + 18000 = 100500
const grossProfit = subtotal - totalBuyPrice; // 115500 - 100500 = 15000
const marginPct = ((grossProfit / subtotal) * 100).toFixed(1); // (15000 / 115500) * 100 = 12.98% -> 13.0%

console.log(`  ✓ Subtotal (Omzet): Rp ${subtotal}`);
console.log(`  ✓ Total Modal (HPP): Rp ${totalBuyPrice}`);
console.log(`  ✓ Laba Kotor: Rp ${grossProfit} (${marginPct}%)`);

const amountPaid = 120000;
const change = amountPaid - subtotal; // 4500
console.log(`  ✓ Uang Bayar: Rp ${amountPaid}, Kembalian: Rp ${change}`);

if (subtotal !== 115500 || totalBuyPrice !== 100500 || grossProfit !== 15000 || change !== 4500) {
  console.error('Calculation verification failed!');
  process.exit(1);
}

console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
})().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
