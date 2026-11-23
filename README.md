# 🏪 POS Toko Kelontong (Point of Sale Offline-First)

Aplikasi Kasir (Point of Sale) modern, minimalis, ringan, dan cepat yang dirancang khusus untuk toko kelontong, warung Madura, dan minimarket lokal di Indonesia.

---

## ✨ Fitur Utama

1. **Kasir Berkecepatan Tinggi (Halaman Utama):**
   - Pencarian instan (Barcode, Kode Internal, atau Nama Produk).
   - Dukungan penuh **Barcode Scanner Hardware** (USB / Bluetooth) secara otomatis.
   - Tabel produk yang padat dan mudah dibaca (bukan kartu besar).
   - Keranjang belanja dengan kontrol Qty cepat, penahanan transaksi sementara (*Hold Cart / Pending*), kalkulasi subtotal otomatis.
   - Pembayaran fleksibel (Tunai, QRIS, Transfer Bank).
   - Tombol pecahan uang cepat (*Uang Pas, 10rb, 20rb, 50rb, 100rb, dll.*) serta kalkulator kembalian otomatis.
   - Cetak struk printer thermal (ukuran 58mm & 80mm standar struk kasir).

2. **Manajemen Produk & Aturan Identitas:**
   - **Barcode** menjadi identitas utama jika produk memilikinya (kemasan pabrikan seperti Indomie, Aqua, sabun).
   - **Kode Barang Internal** (opsional) untuk produk tanpa barcode (misal: telur curah `TLR-01`, beras literan `BRS-01`, kantong kresek `PLSTK-01`).
   - Validasi ketat: Barcode dan kode internal harus unik jika diisi.
   - **Produk tanpa barcode dan tanpa kode internal otomatis ditolak**.
   - Input harga beli (modal/HPP), harga jual, margin keuntungan dinamis, serta batas stok minimum.

3. **Import & Export Excel (SheetJS / xlsx):**
   - Mendukung import **300 hingga 1.000+ produk sekaligus** dari format `.xlsx` dan `.xls`.
   - **Aturan Import Master:**
     - Produk baru otomatis ditambahkan dengan stok awal.
     - Produk lama dikenali berdasarkan barcode atau kode internal.
     - **Pembaruan master TIDAK MENIMPA stok berjalan** (stok kasir yang sedang aktif tetap aman).
   - Fitur **Preview Interaktif** dengan badge status per baris (*Produk Baru*, *Update Master*, atau *Ditolak*).
   - Laporan rekap hasil import lengkap dengan catatan baris yang ditolak.
   - Tombol unduh **Template Excel (.xlsx)** siap pakai.
   - Export seluruh data produk, nilai stok modal & jual, serta riwayat penjualan ke Excel.

4. **Cetak Thermal (Web Printer Helper / Android Native):**
   - Pada Windows, aplikasi web mengirim halaman struk ke [Web Printer Helper](https://github.com/zerlei/WebpagePrinterHelper) melalui service lokal. Instal dan jalankan Helper, buat konfigurasi berisi printer OS dan ukuran kertas, lalu pilih konfigurasi tersebut di **Pengaturan Toko → Printer Struk Thermal**.
   - Atur lebar kertas dan margin printer di konfigurasi Helper agar sesuai dengan struk 58 mm atau 80 mm. Pemotong kertas dan laci kasir dikontrol oleh driver/printer pada alur Helper.
   - Aplikasi Android di folder `android/` memindai dan menghubungkan printer BLE atau printer klasik SPP melalui jembatan native, tanpa pemilih perangkat Web Bluetooth.
   - Pada menu **Pengaturan Toko → Printer Struk Thermal → Bluetooth**, tekan **Cari Printer Bluetooth**, pilih perangkat, lalu tekan **Hubungkan Printer**.
   - Izin Nearby devices dari Android diperlukan saat pemindaian pertama; izin ini dikelola Android dan tidak dapat dilewati oleh aplikasi.
   - Browser komputer tidak memindai Bluetooth; printer di Windows perlu terpasang sebagai printer sistem dan dipilih melalui konfigurasi Web Printer Helper. Bluetooth langsung tetap menggunakan APK Android POS.
   - Printer BLE harus menyediakan layanan GATT dengan karakteristik tulis ESC/POS. Printer klasik harus mendukung Serial Port Profile (SPP); pasangkan melalui pengaturan Bluetooth Android sebelum dipilih di POS.

5. **Stok Otomatis & Barang Masuk (Restock):**
   - Stok otomatis berkurang setiap transaksi kasir tersimpan.
   - Formulir **Barang Masuk (Restock)** untuk menambah stok saat kulakan grosir atau sales datang, lengkap dengan pencatatan harga beli baru dan supplier.
   - Riwayat mutasi stok lengkap (*Penjualan*, *Barang Masuk*, *Penyesuaian*, *Stok Awal*).

6. **Laporan Keuangan & Analisis Laba:**
   - Laporan ringkasan: **Total Omzet Penjualan**, **Total Modal (HPP)**, **Laba Kotor (Keuntungan Bersih)**, dan **Margin Laba (%)**.
   - Filter tanggal: *Hari Ini*, *7 Hari Terakhir*, *Bulan Ini*, atau *Rentang Tanggal Kustom*.
   - Detail transaksi per nota dan tombol cetak ulang struk.

7. **100% Offline-First & Keamanan Data (IndexedDB):**
   - Berjalan murni di browser menggunakan **IndexedDB**.
   - Dilengkapi PWA Service Worker (`sw.js`) dan Manifest (`manifest.json`) agar dapat diinstal ke desktop/ponsel dan dibuka tanpa koneksi internet sama sekali.
   - Menggunakan bundel lokal SheetJS di folder `vendor/` (tidak bergantung pada CDN luar).

8. **Backup & Restore Database (JSON):**
   - Unduh seluruh database (produk, transaksi, mutasi stok, pengaturan toko) dalam 1 file `.json`.
   - Restore database dengan opsi: *Timpa Bersih* atau *Gabungkan Data*.

---

## ⌨️ Daftar Pintasan Keyboard (Shortcuts)

| Tombol | Fungsi |
| :--- | :--- |
| **F2** | Fokus ke kotak pencarian kasir / scan barcode |
| **F8** | Buka dialog pembayaran / bayar transaksi |
| **F4** | Kosongkan keranjang belanja kasir |
| **F9** | Buka halaman Barang Masuk (Restock) |
| **↑ / ↓** | Navigasi baris tabel produk di kasir |
| **Enter** | Tambah item terpilih / Konfirmasi bayar / Cetak struk |
| **Esc** | Tutup jendela modal / pop-up yang sedang terbuka |
| **?** | Buka panduan pintasan keyboard |

---

## 🚀 Cara Menjalankan Aplikasi

Aplikasi dibuat dengan HTML, CSS, dan Vanilla JavaScript tanpa dependensi build step yang rumit. Anda dapat menjalankannya dengan salah satu cara berikut:

### Cara 1: Menggunakan Local Server (Direkomendasikan untuk PWA & Service Worker)
Jalankan server lokal melalui terminal:
```bash
# Menggunakan Python
python -m http.server 8085

# Atau menggunakan Node.js
npx serve -l 8085
```
Lalu buka browser Anda di: **`http://localhost:8085/`**

### Cara 2: Membuka Langsung File HTML
Cukup klik ganda (double-click) file `index.html` di browser (Google Chrome, Microsoft Edge, Mozilla Firefox, dll).
*Catatan: Seluruh fitur IndexedDB, kalkulasi kasir, dan SheetJS berfungsi langsung. Untuk caching PWA Service Worker yang optimal, jalankan melalui local server.*

*Catatan cetak langsung: Cetak struk dari browser komputer memerlukan aplikasi Web Printer Helper aktif dan konfigurasi printer yang sudah dibuat di dalam Helper. Bluetooth langsung tersedia melalui wrapper Android pada folder `android/`.*

### Aplikasi Android untuk printer Bluetooth

Buka folder `android/` menggunakan Android Studio dengan JDK 17 dan Android SDK 35. Build aplikasi akan menyalin aset POS dari folder utama ke dalam APK. Pilih **Build → Build APK(s)**, lalu instal `android/app/build/outputs/apk/debug/app-debug.apk` pada tablet Android. Izinkan akses **Perangkat di sekitar / Nearby devices** saat pertama kali memindai. Izin sistem Android tetap diperlukan; pemilih perangkat Web Bluetooth tidak digunakan. Printer SPP perlu dipasangkan lewat Pengaturan Bluetooth Android sebelum dipilih di POS.

---

## 📂 Struktur Berkas Project

```
web kasir/
├── index.html                 # Halaman utama aplikasi (Single Page App)
├── receipt-print.html         # Halaman khusus untuk dirender oleh Web Printer Helper
├── manifest.json              # Konfigurasi PWA (Progressive Web App)
├── sw.js                      # Service Worker untuk offline caching
├── android/                   # Wrapper Android dan jembatan printer BLE/SPP native
├── README.md                  # Dokumentasi lengkap aplikasi
├── css/
│   ├── style.css              # Desain UI minimalis (putih & hijau emerald, print styles)
│   └── receipt-print.css      # Gaya halaman cetak Web Printer Helper
├── js/
│   ├── app.js                 # Inisialisasi utama, routing sidebar, toast & helper
│   ├── db.js                  # Engine IndexedDB lokal & transaksi stok
│   ├── state.js               # Manajemen state global & synthesizer audio Web Audio API
│   ├── pos.js                 # Logika kasir, scanner buffer, keranjang, & struk
│   ├── products.js            # Manajemen produk, validasi barcode/kode, CRUD
│   ├── inventory.js           # Barang masuk / restock & riwayat mutasi stok
│   ├── transactions.js        # Riwayat transaksi & laporan omzet/laba kotor
│   ├── excel.js               # Parser & exporter SheetJS (preview & validasi)
│   └── backup.js              # Export & restore database JSON
├── vendor/
│   └── xlsx.full.min.js       # Bundel lokal SheetJS (100% offline)
├── sample/
│   └── initial-data.js        # 50+ data produk contoh toko kelontong Indonesia
├── icons/
│   └── icon.svg               # Ikon vektor aplikasi
└── test/
    ├── verify.js              # Unit test otomatis & verifikasi aturan bisnis
    └── test_350_products.xlsx # File tes 350 baris produk
```

