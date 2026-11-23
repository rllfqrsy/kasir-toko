/**
 * Default sample products for Toko Kelontong
 * Includes barcodes for packaged items and internal codes for bulk/unpackaged items.
 */
const SAMPLE_PRODUCTS = [
  // Sembako (Dengan Barcode & Tanpa Barcode)
  { barcode: "8992775211117", code: "", name: "Minyak Goreng Bimoli Klasik 2 Liter", category: "Sembako", unit: "Pcs", buyPrice: 34000, sellPrice: 38000, stock: 45, minStock: 10 },
  { barcode: "8992775211223", code: "", name: "Minyak Goreng SunCo 2 Liter Refill", category: "Sembako", unit: "Pcs", buyPrice: 35000, sellPrice: 39500, stock: 30, minStock: 8 },
  { barcode: "8999999195034", code: "", name: "Gula Pasir Gulaku Tebu Kuning 1 Kg", category: "Sembako", unit: "Pcs", buyPrice: 16500, sellPrice: 18500, stock: 60, minStock: 15 },
  { barcode: "8992745120012", code: "", name: "Tepung Terigu Segitiga Biru 1 Kg", category: "Sembako", unit: "Pcs", buyPrice: 11000, sellPrice: 13000, stock: 40, minStock: 10 },
  { barcode: "", code: "BRS-SETRA-01", name: "Beras Setra Ramos Super (Liter)", category: "Sembako", unit: "Liter", buyPrice: 12500, sellPrice: 14500, stock: 150, minStock: 30 },
  { barcode: "", code: "BRS-PANDAN-01", name: "Beras Pandan Wangi Cianjur (Kg)", category: "Sembako", unit: "Kg", buyPrice: 16000, sellPrice: 18500, stock: 80, minStock: 20 },
  { barcode: "", code: "TLR-AYAM-01", name: "Telur Ayam Negeri Fresh (Butir)", category: "Sembako", unit: "Butir", buyPrice: 1800, sellPrice: 2200, stock: 300, minStock: 50 },
  { barcode: "", code: "TLR-KG-01", name: "Telur Ayam Negeri (1 Kg)", category: "Sembako", unit: "Kg", buyPrice: 27000, sellPrice: 30000, stock: 35, minStock: 10 },
  { barcode: "", code: "GL-MERAH-01", name: "Gula Merah Aren Asli (Bongkah)", category: "Sembako", unit: "Pcs", buyPrice: 4000, sellPrice: 5000, stock: 50, minStock: 10 },
  { barcode: "", code: "KRUPUK-01", name: "Kerupuk Putih Kaleng Warung (Pcs)", category: "Makanan Ringan", unit: "Pcs", buyPrice: 800, sellPrice: 1500, stock: 80, minStock: 20 },

  // Mie Instan & Makanan Cepat Saji
  { barcode: "089686010924", code: "", name: "Indomie Goreng Original 85g", category: "Mie Instan", unit: "Bks", buyPrice: 2900, sellPrice: 3500, stock: 240, minStock: 40 },
  { barcode: "089686010115", code: "", name: "Indomie Kuah Ayam Bawang 69g", category: "Mie Instan", unit: "Bks", buyPrice: 2800, sellPrice: 3300, stock: 120, minStock: 25 },
  { barcode: "089686010122", code: "", name: "Indomie Kuah Soto Mie 70g", category: "Mie Instan", unit: "Bks", buyPrice: 2800, sellPrice: 3300, stock: 150, minStock: 30 },
  { barcode: "089686043328", code: "", name: "Indomie Goreng Aceh Pedas 90g", category: "Mie Instan", unit: "Bks", buyPrice: 3000, sellPrice: 3700, stock: 90, minStock: 20 },
  { barcode: "8992388111019", code: "", name: "Mie Sedaap Goreng 90g", category: "Mie Instan", unit: "Bks", buyPrice: 2900, sellPrice: 3500, stock: 100, minStock: 20 },
  { barcode: "8992388111224", code: "", name: "Mie Sedaap Korean Spicy Soup 77g", category: "Mie Instan", unit: "Bks", buyPrice: 3100, sellPrice: 3800, stock: 75, minStock: 15 },
  { barcode: "8992775010017", code: "", name: "Pop Mie Rasa Ayam Bawang Cup", category: "Mie Instan", unit: "Cup", buyPrice: 5000, sellPrice: 6500, stock: 48, minStock: 12 },

  // Minuman & Kopi
  { barcode: "8886008101053", code: "", name: "Aqua Air Mineral Botol 600ml", category: "Minuman", unit: "Btl", buyPrice: 3200, sellPrice: 4500, stock: 96, minStock: 24 },
  { barcode: "8886008101091", code: "", name: "Aqua Air Mineral Botol 1500ml", category: "Minuman", unit: "Btl", buyPrice: 5800, sellPrice: 7500, stock: 60, minStock: 18 },
  { barcode: "8996001600269", code: "", name: "Le Minerale Air Mineral 600ml", category: "Minuman", unit: "Btl", buyPrice: 3000, sellPrice: 4000, stock: 120, minStock: 30 },
  { barcode: "8998009010214", code: "", name: "Teh Botol Sosro Kotak 250ml", category: "Minuman", unit: "Kotak", buyPrice: 3200, sellPrice: 4000, stock: 72, minStock: 20 },
  { barcode: "8992753211115", code: "", name: "Teh Pucuk Harum Melati 350ml", category: "Minuman", unit: "Btl", buyPrice: 3000, sellPrice: 4000, stock: 144, minStock: 36 },
  { barcode: "8991001100118", code: "", name: "Kopi Kapal Api Spesial Mix (Renceng)", category: "Kopi & Teh", unit: "Renceng", buyPrice: 12500, sellPrice: 15000, stock: 40, minStock: 10 },
  { barcode: "8991001100224", code: "", name: "Kopi Good Day Mocacinno (Renceng)", category: "Kopi & Teh", unit: "Renceng", buyPrice: 13500, sellPrice: 16000, stock: 35, minStock: 10 },
  { barcode: "8999999015110", code: "", name: "Teh Celup Sariwangi Kotak Isi 25", category: "Kopi & Teh", unit: "Kotak", buyPrice: 6500, sellPrice: 8000, stock: 50, minStock: 10 },
  { barcode: "8992772120014", code: "", name: "Susu Kental Manis Frisian Flag Cokelat 370g", category: "Susu", unit: "Kaleng", buyPrice: 11500, sellPrice: 13500, stock: 48, minStock: 12 },
  { barcode: "8992772120021", code: "", name: "Susu Kental Manis Indomilk Putih 370g", category: "Susu", unit: "Kaleng", buyPrice: 11000, sellPrice: 13000, stock: 40, minStock: 10 },

  // Bumbu Dapur
  { barcode: "8992779110010", code: "", name: "Kecap Manis Bango Botol 135ml", category: "Bumbu Dapur", unit: "Btl", buyPrice: 8500, sellPrice: 10500, stock: 36, minStock: 8 },
  { barcode: "8992779110225", code: "", name: "Kecap Manis ABC Botol 135ml", category: "Bumbu Dapur", unit: "Btl", buyPrice: 7500, sellPrice: 9500, stock: 36, minStock: 8 },
  { barcode: "8992779220016", code: "", name: "Saus Sambal ABC Extra Pedas Botol 135ml", category: "Bumbu Dapur", unit: "Btl", buyPrice: 7000, sellPrice: 8500, stock: 40, minStock: 10 },
  { barcode: "8992741981013", code: "", name: "Penyedap Rasa Masako Ayam (Renceng)", category: "Bumbu Dapur", unit: "Renceng", buyPrice: 4800, sellPrice: 6000, stock: 50, minStock: 15 },
  { barcode: "8992741982027", code: "", name: "Penyedap Rasa Royco Sapi (Renceng)", category: "Bumbu Dapur", unit: "Renceng", buyPrice: 4800, sellPrice: 6000, stock: 50, minStock: 15 },
  { barcode: "8992741983031", code: "", name: "Ajinomoto Micin Gurih 100g", category: "Bumbu Dapur", unit: "Bks", buyPrice: 4200, sellPrice: 5500, stock: 60, minStock: 12 },
  { barcode: "8998866100115", code: "", name: "Garam Dapur Beriodium Daun 250g", category: "Bumbu Dapur", unit: "Bks", buyPrice: 2000, sellPrice: 3000, stock: 80, minStock: 20 },

  // Sabun, Sampo & Kebersihan
  { barcode: "8999999021234", code: "", name: "Sabun Mandi Lifebuoy Total 10 Batang 70g", category: "Sabun & Kebersihan", unit: "Pcs", buyPrice: 3500, sellPrice: 4500, stock: 72, minStock: 15 },
  { barcode: "8999999021345", code: "", name: "Sabun Mandi Dettol Original Batang 100g", category: "Sabun & Kebersihan", unit: "Pcs", buyPrice: 7500, sellPrice: 9000, stock: 40, minStock: 10 },
  { barcode: "8999999031011", code: "", name: "Sunlight Pencuci Piring Jeruk Nipis 750ml", category: "Sabun & Kebersihan", unit: "Pcs", buyPrice: 14500, sellPrice: 17000, stock: 36, minStock: 8 },
  { barcode: "8999999032025", code: "", name: "Mama Lemon Pencuci Piring Jeruk 750ml", category: "Sabun & Kebersihan", unit: "Pcs", buyPrice: 13500, sellPrice: 16000, stock: 30, minStock: 8 },
  { barcode: "8999999041010", code: "", name: "Deterjen Rinso Molto Bubuk 770g", category: "Sabun & Kebersihan", unit: "Bks", buyPrice: 20000, sellPrice: 23500, stock: 25, minStock: 6 },
  { barcode: "8999999042024", code: "", name: "Deterjen Daia Putih 850g", category: "Sabun & Kebersihan", unit: "Bks", buyPrice: 16000, sellPrice: 18500, stock: 30, minStock: 6 },
  { barcode: "8999999051019", code: "", name: "Pasta Gigi Pepsodent Pencegah Gigi Berlubang 190g", category: "Sabun & Kebersihan", unit: "Pcs", buyPrice: 12000, sellPrice: 14500, stock: 40, minStock: 10 },

  // Rokok
  { barcode: "8999909001019", code: "", name: "Sampoerna A Mild 16 Batang", category: "Rokok", unit: "Bks", buyPrice: 32500, sellPrice: 35000, stock: 50, minStock: 10 },
  { barcode: "8999909002023", code: "", name: "Djarum Super 12 Batang", category: "Rokok", unit: "Bks", buyPrice: 22000, sellPrice: 24000, stock: 60, minStock: 15 },
  { barcode: "8999909003037", code: "", name: "Gudang Garam Surya 16 Batang", category: "Rokok", unit: "Bks", buyPrice: 33000, sellPrice: 36000, stock: 45, minStock: 10 },
  { barcode: "8999909004041", code: "", name: "Marlboro Red 20 Batang", category: "Rokok", unit: "Bks", buyPrice: 42000, sellPrice: 45000, stock: 30, minStock: 8 },

  // Barang Lainnya / Plastik / Rumah Tangga (Kode Internal)
  { barcode: "", code: "PLSTK-01", name: "Kantong Plastik Kresek Putih 15cm (Pack)", category: "Lainnya", unit: "Pack", buyPrice: 4000, sellPrice: 6000, stock: 50, minStock: 10 },
  { barcode: "", code: "PLSTK-02", name: "Kantong Plastik Kresek Hitam 24cm (Pack)", category: "Lainnya", unit: "Pack", buyPrice: 6000, sellPrice: 8500, stock: 40, minStock: 10 },
  { barcode: "", code: "LILIN-01", name: "Lilin Putih Penerangan Jumbo (Bungkus Isi 6)", category: "Lainnya", unit: "Bks", buyPrice: 7000, sellPrice: 9500, stock: 30, minStock: 5 },
  { barcode: "", code: "OBAT-PARACET-01", name: "Paracetamol 500mg Strip Isi 10", category: "Obat & Medis", unit: "Strip", buyPrice: 4000, sellPrice: 6500, stock: 40, minStock: 10 },
  { barcode: "", code: "OBAT-BODREX-01", name: "Bodrex Sakit Kepala Strip Isi 20", category: "Obat & Medis", unit: "Strip", buyPrice: 8000, sellPrice: 11000, stock: 35, minStock: 10 }
];

