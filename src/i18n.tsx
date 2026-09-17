import React from "react";
import type { UiLocale } from "./api";
import { pageMessages } from "./i18n-pages";

type Translation = { en: string; id: string };

export const localeOptions: Array<{ value: UiLocale; label: string; shortLabel: string; htmlLang: string }> = [
  { value: "zh-CN", label: "中文", shortLabel: "中", htmlLang: "zh-CN" },
  { value: "en", label: "English", shortLabel: "EN", htmlLang: "en" },
  { value: "id", label: "Bahasa Indonesia", shortLabel: "ID", htmlLang: "id" },
];

const messages: Record<string, Translation> = {
  ...pageMessages,
  "语言": { en: "Language", id: "Bahasa" },
  "切换语言": { en: "Change language", id: "Ganti bahasa" },
  "正在保存语言偏好": { en: "Saving language preference", id: "Menyimpan preferensi bahasa" },
  "语言偏好保存失败，请重试。": { en: "Could not save the language preference. Please try again.", id: "Preferensi bahasa gagal disimpan. Silakan coba lagi." },
  "工作台": { en: "Workspace", id: "Ruang Kerja" },
  "商品资料": { en: "Product Data", id: "Data Produk" },
  "库存与履约": { en: "Inventory & Fulfillment", id: "Inventaris & Pemenuhan" },
  "备货协同": { en: "Stock Preparation", id: "Kolaborasi Persediaan" },
  "经营分析": { en: "Business Analytics", id: "Analisis Bisnis" },
  "工具与设置": { en: "Tools & Settings", id: "Alat & Pengaturan" },
  "经营总览": { en: "Operations Overview", id: "Ringkasan Operasional" },
  "经营工作台": { en: "Operations Dashboard", id: "Dasbor Operasional" },
  "产品库": { en: "Product Library", id: "Pustaka Produk" },
  "产品中心": { en: "Product Center", id: "Pusat Produk" },
  "按国家、品牌、SKU 和产品名称快速浏览在售产品，查看产品价格、品类、单位和基础资料。": { en: "Browse active products by country, brand, SKU, or name, and review pricing, category, unit, and core product details.", id: "Telusuri produk aktif berdasarkan negara, merek, SKU, atau nama, lalu lihat harga, kategori, satuan, dan detail utama produk." },
  "样例数据": { en: "Sample data", id: "Data contoh" },
  "等待同步": { en: "Awaiting sync", id: "Menunggu sinkronisasi" },
  "系统已同步": { en: "System synced", id: "Sistem tersinkronisasi" },
  "分销": { en: "Distribution", id: "Distribusi" },
  "搜索 SKU、产品名称、分类、品牌": { en: "Search SKU, product name, category, or brand", id: "Cari SKU, nama produk, kategori, atau merek" },
  "俄罗斯": { en: "Russia", id: "Rusia" },
  "俄罗斯联邦": { en: "Russian Federation", id: "Federasi Rusia" },
  "马来西亚": { en: "Malaysia", id: "Malaysia" },
  "印尼": { en: "Indonesia", id: "Indonesia" },
  "印度尼西亚": { en: "Indonesia", id: "Indonesia" },
  "越南": { en: "Vietnam", id: "Vietnam" },
  "中国": { en: "China", id: "Tiongkok" },
  "个产品": { en: " products", id: " produk" },
  "需要查看分销价、库存和素材？": { en: "Need distribution pricing, inventory, and assets?", id: "Perlu harga distribusi, inventaris, dan aset?" },
  "当前为外部浏览模式。请联系同舟运营开通分销账号，登录后可查看价格、库存、资质和素材文件。": { en: "You are browsing in external mode. Contact Tongzhou Operations for a distributor account to view pricing, inventory, qualifications, and asset files.", id: "Anda sedang menggunakan mode eksternal. Hubungi tim Operasional Tongzhou untuk akun distributor agar dapat melihat harga, inventaris, perizinan, dan file aset." },
  "申请分销账号": { en: "Request distributor account", id: "Ajukan akun distributor" },
  "去登录": { en: "Sign in", id: "Masuk" },
  "暂不显示": { en: "Hide for now", id: "Sembunyikan sementara" },
  "正在读取产品库...": { en: "Loading product library...", id: "Memuat pustaka produk..." },
  "产品库显示方式": { en: "Product library view", id: "Tampilan pustaka produk" },
  "视图": { en: "View", id: "Tampilan" },
  "当前宽度使用自动布局": { en: "Automatic layout for this width", id: "Tata letak otomatis untuk lebar ini" },
  "价格与库存": { en: "Price & inventory", id: "Harga & inventaris" },
  "登录后可见": { en: "Visible after sign-in", id: "Terlihat setelah masuk" },
  "申请分销账号后查看": { en: "Request an account to view", id: "Ajukan akun untuk melihat" },
  "查看产品关联资料": { en: "View linked product data", id: "Lihat data produk terkait" },
  "已显示": { en: "Showing", id: "Ditampilkan" },
  "回到顶部": { en: "Back to top", id: "Kembali ke atas" },
  "顶部": { en: "Top", id: "Atas" },
  "资质库": { en: "Qualifications", id: "Pusat Perizinan" },
  "素材库": { en: "Asset Library", id: "Pustaka Aset" },
  "库存同步": { en: "Inventory Sync", id: "Sinkronisasi Stok" },
  "动销监控": { en: "Inventory Risk", id: "Risiko Inventaris" },
  "库存风险": { en: "Inventory Risk", id: "Risiko Inventaris" },
  "库存快照": { en: "Inventory Snapshots", id: "Snapshot Inventaris" },
  "仓库货值": { en: "Inventory Value", id: "Nilai Inventaris" },
  "动销分析": { en: "Sales Movement", id: "Pergerakan Penjualan" },
  "动销趋势与对账": { en: "Movement & Reconciliation", id: "Tren & Rekonsiliasi" },
  "仓库信息": { en: "Warehouse Directory", id: "Informasi Gudang" },
  "仓库协同": { en: "Warehouse Collaboration", id: "Kolaborasi Gudang" },
  "备货中心": { en: "Stock Preparation", id: "Pusat Persediaan" },
  "备货建议": { en: "Stock Recommendations", id: "Rekomendasi Persediaan" },
  "备货执行": { en: "Stock Execution", id: "Eksekusi Persediaan" },
  "生产中心": { en: "Production Center", id: "Pusat Produksi" },
  "订单分析": { en: "Order Analytics", id: "Analisis Pesanan" },
  "经营贡献": { en: "Contribution Analytics", id: "Analisis Kontribusi" },
  "同舟AI": { en: "Tongzhou AI", id: "Tongzhou AI" },
  "快捷导航": { en: "Quick Links", id: "Tautan Cepat" },
  "妙手 ERP": { en: "Miaoshou ERP", id: "Miaoshou ERP" },
  "Ozon 订单": { en: "Ozon Orders", id: "Pesanan Ozon" },
  "仓库授权": { en: "Warehouse Connections", id: "Otorisasi Gudang" },
  "企业微信通知": { en: "WeCom Notifications", id: "Notifikasi WeCom" },
  "用户管理": { en: "User Management", id: "Manajemen Pengguna" },
  "操作日志": { en: "Activity Log", id: "Log Aktivitas" },
  "API 接入": { en: "API Access", id: "Akses API" },
  "同舟供应链": { en: "Tongzhou Supply Chain", id: "Rantai Pasok Tongzhou" },
  "同舟供应链数智化系统": { en: "Tongzhou Digital Supply Chain", id: "Sistem Rantai Pasok Digital Tongzhou" },
  "产品 · 仓库 · 备货协同": { en: "Products · Warehouses · Stock Collaboration", id: "Produk · Gudang · Kolaborasi Persediaan" },
  "主导航": { en: "Main navigation", id: "Navigasi utama" },
  "打开导航": { en: "Open navigation", id: "Buka navigasi" },
  "关闭导航": { en: "Close navigation", id: "Tutup navigasi" },
  "展开侧边栏": { en: "Expand sidebar", id: "Perluas bilah samping" },
  "折叠侧边栏": { en: "Collapse sidebar", id: "Ciutkan bilah samping" },
  "全局搜索商品或 SKU": { en: "Search products or SKU", id: "Cari produk atau SKU" },
  "全局搜索商品 / SKU": { en: "Search products / SKU", id: "Cari produk / SKU" },
  "同步全部数据": { en: "Sync all data", id: "Sinkronkan semua data" },
  "同步中": { en: "Syncing", id: "Menyinkronkan" },
  "同步": { en: "Sync", id: "Sinkronkan" },
  "刷新": { en: "Refresh", id: "Muat ulang" },
  "重新读取": { en: "Reload", id: "Muat ulang" },
  "退出": { en: "Sign out", id: "Keluar" },
  "登录": { en: "Sign in", id: "Masuk" },
  "管理员": { en: "Administrator", id: "Administrator" },
  "直营运营": { en: "Operations", id: "Operasional" },
  "仓库操作员": { en: "Warehouse Operator", id: "Operator Gudang" },
  "分销商": { en: "Distributor", id: "Distributor" },
  "游客": { en: "Guest", id: "Tamu" },
  "需要登录后访问": { en: "Sign in required", id: "Harap masuk terlebih dahulu" },
  "当前账号暂时没有该页面权限。如需查看，请联系管理员调整角色或授权范围。": { en: "This account does not currently have access to this page. Contact an administrator to update the role or access scope.", id: "Akun ini belum memiliki akses ke halaman ini. Hubungi administrator untuk memperbarui peran atau cakupan akses." },
  "该页面包含库存、价格、动销、备货或系统配置数据。请使用内部访问码登录，或联系运营开通分销账号。": { en: "This page contains inventory, pricing, sales, stock-planning, or system configuration data. Sign in with an internal access code or ask Operations for a distributor account.", id: "Halaman ini memuat data stok, harga, penjualan, persediaan, atau konfigurasi sistem. Masuk dengan kode akses internal atau minta akun distributor kepada tim operasional." },
  "我知道了": { en: "Got it", id: "Mengerti" },
  "当前显示上一次成功数据。": { en: "Showing the last successfully loaded data. ", id: "Menampilkan data terakhir yang berhasil dimuat. " },
  "确认": { en: "Confirm", id: "Konfirmasi" },
  "取消": { en: "Cancel", id: "Batal" },
  "关闭": { en: "Close", id: "Tutup" },
  "保存": { en: "Save", id: "Simpan" },
  "保存中": { en: "Saving", id: "Menyimpan" },
  "编辑": { en: "Edit", id: "Edit" },
  "删除": { en: "Delete", id: "Hapus" },
  "新增": { en: "Add", id: "Tambah" },
  "查询": { en: "Search", id: "Cari" },
  "查询中": { en: "Searching", id: "Mencari" },
  "重置": { en: "Reset", id: "Atur ulang" },
  "下载": { en: "Download", id: "Unduh" },
  "上传": { en: "Upload", id: "Unggah" },
  "复制": { en: "Copy", id: "Salin" },
  "详情": { en: "Details", id: "Detail" },
  "查看详情": { en: "View details", id: "Lihat detail" },
  "查看进度": { en: "View progress", id: "Lihat progres" },
  "处理中": { en: "Processing", id: "Diproses" },
  "待处理": { en: "Pending", id: "Menunggu" },
  "已完成": { en: "Completed", id: "Selesai" },
  "已取消": { en: "Cancelled", id: "Dibatalkan" },
  "已启用": { en: "Enabled", id: "Aktif" },
  "已停用": { en: "Disabled", id: "Nonaktif" },
  "启用": { en: "Enable", id: "Aktifkan" },
  "停用": { en: "Disable", id: "Nonaktifkan" },
  "全部": { en: "All", id: "Semua" },
  "全部状态": { en: "All statuses", id: "Semua status" },
  "全部仓库": { en: "All warehouses", id: "Semua gudang" },
  "全部国家": { en: "All countries", id: "Semua negara" },
  "全部品牌": { en: "All brands", id: "Semua merek" },
  "暂无数据": { en: "No data", id: "Belum ada data" },
  "暂无记录": { en: "No records", id: "Belum ada catatan" },
  "未配置": { en: "Not configured", id: "Belum dikonfigurasi" },
  "未同步": { en: "Not synced", id: "Belum disinkronkan" },
  "今日已更新": { en: "Updated today", id: "Diperbarui hari ini" },
  "等待首次自动同步": { en: "Waiting for the first automatic sync", id: "Menunggu sinkronisasi otomatis pertama" },
  "到点后自动触发": { en: "Runs automatically on schedule", id: "Berjalan otomatis sesuai jadwal" },
  "正常": { en: "Normal", id: "Normal" },
  "异常": { en: "Exception", id: "Bermasalah" },
  "成功": { en: "Success", id: "Berhasil" },
  "失败": { en: "Failed", id: "Gagal" },
  "风险": { en: "Risk", id: "Risiko" },
  "健康": { en: "Healthy", id: "Sehat" },
  "紧急": { en: "Urgent", id: "Mendesak" },
  "普通": { en: "Normal", id: "Normal" },
  "状态": { en: "Status", id: "Status" },
  "更新时间": { en: "Updated at", id: "Diperbarui" },
  "数据更新于": { en: "Data updated at", id: "Data diperbarui pada" },
  "搜索": { en: "Search", id: "Cari" },
  "筛选": { en: "Filter", id: "Filter" },
  "商品名称": { en: "Product name", id: "Nama produk" },
  "产品名称": { en: "Product name", id: "Nama produk" },
  "产品图片": { en: "Product image", id: "Gambar produk" },
  "商品图片": { en: "Product image", id: "Gambar produk" },
  "数量": { en: "Quantity", id: "Jumlah" },
  "可用库存": { en: "Available stock", id: "Stok tersedia" },
  "库存": { en: "Inventory", id: "Inventaris" },
  "仓库": { en: "Warehouse", id: "Gudang" },
  "国家": { en: "Country", id: "Negara" },
  "品牌": { en: "Brand", id: "Merek" },
  "单位": { en: "Unit", id: "Satuan" },
  "金额": { en: "Amount", id: "Jumlah" },
  "成本": { en: "Cost", id: "Biaya" },
  "备注": { en: "Notes", id: "Catatan" },
  "创建时间": { en: "Created at", id: "Dibuat pada" },
  "开始日期": { en: "Start date", id: "Tanggal mulai" },
  "结束日期": { en: "End date", id: "Tanggal selesai" },
  "账号": { en: "Account", id: "Akun" },
  "密码": { en: "Password", id: "Kata sandi" },
  "账号密码": { en: "Account & password", id: "Akun & kata sandi" },
  "内部访问码": { en: "Internal access code", id: "Kode akses internal" },
  "欢迎登船": { en: "Welcome aboard", id: "Selamat datang" },
  "进入同舟供应链数智化系统，继续今天的协作。": { en: "Enter the Tongzhou digital supply chain workspace and continue today’s collaboration.", id: "Masuk ke ruang kerja rantai pasok digital Tongzhou dan lanjutkan kolaborasi hari ini." },
  "进入协作空间": { en: "Enter workspace", id: "Masuk ruang kerja" },
  "登录信息仅用于本系统身份验证，传输过程受安全保护。": { en: "Your credentials are used only for authentication and are protected in transit.", id: "Informasi masuk hanya digunakan untuk autentikasi dan dilindungi selama transmisi." },
  "方向一致，各司其职，一起把船开的更远！": { en: "One direction, clear roles—together we sail farther!", id: "Satu arah, peran yang jelas—bersama kita berlayar lebih jauh!" },
  "我们是": { en: "We are", id: "Kita adalah" },
  "同一艘船上的人": { en: "on the same ship", id: "orang-orang di kapal yang sama" },
  "关闭登录页面": { en: "Close sign-in page", id: "Tutup halaman masuk" },
  "仓库协同中心": { en: "Warehouse Collaboration Center", id: "Pusat Kolaborasi Gudang" },
  "仓库协同业务板块": { en: "Warehouse collaboration modules", id: "Modul kolaborasi gudang" },
  "售后责任、补发处理与日常仓库工单统一协同，所有进度可追踪、可通知。": { en: "Manage after-sales responsibility, reshipments, and daily warehouse tickets in one place, with trackable and notifiable progress.", id: "Kelola tanggung jawab purnajual, pengiriman ulang, dan tiket gudang harian di satu tempat dengan progres yang dapat dilacak dan diberi notifikasi." },
  "售后订单": { en: "After-sales Orders", id: "Pesanan Purnajual" },
  "责任判定、补发、驳回与结算": { en: "Responsibility, reshipment, rejection & settlement", id: "Tanggung jawab, kirim ulang, penolakan & penyelesaian" },
  "仓库工单": { en: "Warehouse Tickets", id: "Tiket Gudang" },
  "订单催促与日常问题反馈": { en: "Order follow-up and daily issue reporting", id: "Tindak lanjut pesanan dan laporan masalah harian" },
  "运营填报": { en: "Submit Case", id: "Ajukan Kasus" },
  "我的售后": { en: "My Cases", id: "Kasus Saya" },
  "仓库处理": { en: "Warehouse Processing", id: "Proses Gudang" },
  "退货查询": { en: "Return Lookup", id: "Pencarian Retur" },
  "待仓库接单": { en: "Awaiting warehouse acceptance", id: "Menunggu penerimaan gudang" },
  "仓库已受理": { en: "Accepted by warehouse", id: "Diterima gudang" },
  "待补发": { en: "Awaiting reshipment", id: "Menunggu kirim ulang" },
  "仓库已驳回，待运营修改": { en: "Rejected—awaiting Operations update", id: "Ditolak—menunggu perbaikan Operasional" },
  "补发已发出": { en: "Reshipment sent", id: "Pengiriman ulang telah dikirim" },
  "已完结": { en: "Completed", id: "Selesai" },
  "已作废": { en: "Voided", id: "Dibatalkan" },
  "待仓库受理": { en: "Awaiting warehouse", id: "Menunggu gudang" },
  "仓库处理中": { en: "Warehouse processing", id: "Sedang diproses gudang" },
  "已解决": { en: "Resolved", id: "Terselesaikan" },
  "创建工单": { en: "Create ticket", id: "Buat tiket" },
  "我的工单": { en: "My tickets", id: "Tiket saya" },
  "待办工单": { en: "Pending tickets", id: "Tiket tertunda" },
  "订单催促": { en: "Order follow-up", id: "Tindak lanjut pesanan" },
  "发货/物流问题": { en: "Shipping / logistics", id: "Pengiriman / logistik" },
  "库存/缺货问题": { en: "Inventory / stockout", id: "Inventaris / stok habis" },
  "入库/上架问题": { en: "Inbound / putaway", id: "Inbound / penyimpanan" },
  "费用/赔付问题": { en: "Fees / compensation", id: "Biaya / kompensasi" },
  "数据/系统问题": { en: "Data / system", id: "Data / sistem" },
  "其他问题": { en: "Other issue", id: "Masalah lain" },
  "请选择处理仓库。": { en: "Select a processing warehouse.", id: "Pilih gudang pemrosesan." },
  "工单主题": { en: "Ticket subject", id: "Subjek tiket" },
  "详细说明": { en: "Details", id: "Penjelasan rinci" },
  "关联订单号": { en: "Related order number", id: "Nomor pesanan terkait" },
  "优先级": { en: "Priority", id: "Prioritas" },
  "提交工单": { en: "Submit ticket", id: "Kirim tiket" },
  "仓库回复": { en: "Warehouse reply", id: "Balasan gudang" },
  "受理": { en: "Accept", id: "Terima" },
  "回复": { en: "Reply", id: "Balas" },
  "完结": { en: "Resolve", id: "Selesaikan" },
  "催办": { en: "Remind", id: "Ingatkan" },
  "激活": { en: "Reactivate", id: "Aktifkan kembali" },
  "驳回": { en: "Reject", id: "Tolak" },
  "仓库退货状态查询": { en: "Warehouse Return Status Lookup", id: "Pencarian Status Retur Gudang" },
  "输入平台订单号即可，系统会自动判断仓库和查询时间。": { en: "Enter a platform order number. The system will identify the warehouse and query period automatically.", id: "Masukkan nomor pesanan platform. Sistem akan menentukan gudang dan periode pencarian secara otomatis." },
  "需要看哪一单就查哪一单。结果直接来自仓库WMS，本系统不批量同步、不保存退货数据。": { en: "Look up only the return you need. Results come directly from the warehouse WMS and are neither bulk-synced nor stored here.", id: "Cari hanya retur yang diperlukan. Hasil berasal langsung dari WMS gudang dan tidak disinkronkan massal atau disimpan di sini." },
  "实时按需查询": { en: "Live on-demand lookup", id: "Pencarian langsung sesuai kebutuhan" },
  "查询后不留存": { en: "Not stored after lookup", id: "Tidak disimpan setelah pencarian" },
  "查询类型": { en: "Lookup type", id: "Jenis pencarian" },
  "平台原订单号": { en: "Platform order number", id: "Nomor pesanan platform" },
  "WMS退货单号": { en: "WMS return number", id: "Nomor retur WMS" },
  "退货物流单号": { en: "Return tracking number", id: "Nomor resi retur" },
  "输入平台后台订单号": { en: "Enter the platform order number", id: "Masukkan nomor pesanan platform" },
  "输入仓库退货单号 / RMA号": { en: "Enter warehouse return / RMA number", id: "Masukkan nomor retur gudang / RMA" },
  "输入客户退回的物流单号": { en: "Enter the customer's return tracking number", id: "Masukkan nomor resi retur pelanggan" },
  "查询WMS": { en: "Search WMS", id: "Cari di WMS" },
  "取消查询": { en: "Cancel lookup", id: "Batalkan pencarian" },
  "收起辅助条件": { en: "Hide additional filters", id: "Sembunyikan filter tambahan" },
  "补选仓库": { en: "Select warehouse", id: "Pilih gudang" },
  "选择仓库和时间": { en: "Select warehouse and period", id: "Pilih gudang dan periode" },
  "系统会先尝试自动识别；无法定位时再补充条件，不会扫描全部仓库。": { en: "The system identifies the warehouse first. Add conditions only when needed; all warehouses will never be scanned.", id: "Sistem akan mengidentifikasi gudang terlebih dahulu. Tambahkan kondisi hanya bila diperlukan; semua gudang tidak akan dipindai." },
  "查询仓库": { en: "Warehouse", id: "Gudang" },
  "由系统自动识别": { en: "Identify automatically", id: "Identifikasi otomatis" },
  "快捷范围": { en: "Quick range", id: "Rentang cepat" },
  "近30天": { en: "Last 30 days", id: "30 hari terakhir" },
  "近90天": { en: "Last 90 days", id: "90 hari terakhir" },
  "单次最多90天": { en: "Maximum 90 days per lookup", id: "Maksimal 90 hari per pencarian" },
  "退货单号": { en: "Return number", id: "Nomor retur" },
  "原订单号": { en: "Original order", id: "Pesanan asli" },
  "物流单号": { en: "Tracking number", id: "Nomor resi" },
  "退货状态": { en: "Return status", id: "Status retur" },
  "在途中": { en: "In transit", id: "Dalam perjalanan" },
  "已到仓待处理": { en: "Received—awaiting processing", id: "Tiba—menunggu diproses" },
  "已重新上架": { en: "Restocked", id: "Disimpan kembali" },
  "已报废": { en: "Scrapped", id: "Dimusnahkan" },
  "混合处理": { en: "Mixed handling", id: "Penanganan campuran" },
  "实收数量": { en: "Received", id: "Diterima" },
  "重新上架数量": { en: "Restocked", id: "Disimpan kembali" },
  "报废数量": { en: "Scrapped", id: "Dimusnahkan" },
  "不良品": { en: "Defective", id: "Barang rusak" },
  "待处理数量": { en: "Pending", id: "Menunggu" },
  "创建仓库工单": { en: "Create warehouse ticket", id: "Buat tiket gudang" },
  "重新查询": { en: "Search again", id: "Cari lagi" },
  "订单号": { en: "Order number", id: "Nomor pesanan" },
  "店铺": { en: "Store", id: "Toko" },
  "平台": { en: "Platform", id: "Platform" },
  "负责人": { en: "Owner", id: "Penanggung jawab" },
  "操作": { en: "Actions", id: "Tindakan" },
  "上一页": { en: "Previous", id: "Sebelumnya" },
  "下一页": { en: "Next", id: "Berikutnya" },
  "导入 CSV": { en: "Import CSV", id: "Impor CSV" },
  "导出 CSV": { en: "Export CSV", id: "Ekspor CSV" },
  "下载完整 CSV": { en: "Download full CSV", id: "Unduh CSV lengkap" },
  "卡片": { en: "Cards", id: "Kartu" },
  "列表": { en: "List", id: "Daftar" },
  "产品基础信息": { en: "Product details", id: "Detail produk" },
  "加入选品清单": { en: "Add to selection", id: "Tambah ke daftar pilihan" },
  "复制 SKU": { en: "Copy SKU", id: "Salin SKU" },
  "复制附件链接": { en: "Copy attachment link", id: "Salin tautan lampiran" },
  "下载附件清单": { en: "Download attachment list", id: "Unduh daftar lampiran" },
  "关闭产品详情": { en: "Close product details", id: "Tutup detail produk" },
  "数据加载中": { en: "Loading data", id: "Memuat data" },
  "加载中": { en: "Loading", id: "Memuat" },
  "请稍候": { en: "Please wait", id: "Harap tunggu" },
};

const patterns: Array<{ pattern: RegExp; en: string; id: string }> = [
  { pattern: /^订单\s*(\d+)\s*天前。请先同步后再用于备货、补货或经营复盘判断。$/, en: "Orders are $1 days old. Sync before using them for stock planning, replenishment, or business review.", id: "Data pesanan berumur $1 hari. Sinkronkan sebelum digunakan untuk perencanaan stok, pengisian ulang, atau evaluasi bisnis." },
  { pattern: /^订单\s*(\d+)\s*天前。用于备货或经营复盘前建议先完成同步。$/, en: "Orders are $1 days old. Sync before stock planning or business review.", id: "Data pesanan berumur $1 hari. Sinkronkan sebelum perencanaan stok atau evaluasi bisnis." },
  { pattern: /^订单\s*(\d+)\s*天前$/, en: "Orders are $1 days old", id: "Data pesanan berumur $1 hari" },
  { pattern: /^(\d[\d,]*)\s*个可见商品\s*·\s*不含仓库孤儿 SKU$/, en: "$1 visible products · excludes uncatalogued warehouse SKUs", id: "$1 produk terlihat · tidak termasuk SKU gudang tanpa katalog" },
  { pattern: /^(.*)\s*·\s*(\d[\d,]*)\s*条未纳入$/, en: "$1 · $2 lines excluded", id: "$1 · $2 baris tidak disertakan" },
  { pattern: /^产品风险\s*(\d[\d,]*)\s*\/\s*未建档\s*(\d[\d,]*)$/, en: "Product risks $1 / uncatalogued $2", id: "Risiko produk $1 / belum terdaftar $2" },
  { pattern: /^(\d[\d,]*)\s*项$/, en: "$1 items", id: "$1 item" },
  { pattern: /^(.+)\s+动销诊断$/, en: "$1 movement diagnosis", id: "$1 diagnosis pergerakan" },
  { pattern: /^库存 SKU\s*(\d[\d,]*)，近 90 天订单\s*(\d[\d,]*)，已匹配订单\s*(\d[\d,]*)。$/, en: "Inventory SKUs $1; orders in the last 90 days $2; matched orders $3.", id: "SKU inventaris $1; pesanan 90 hari terakhir $2; pesanan cocok $3." },
  { pattern: /^净建议备货\s*(\d[\d,]*)，请确认采纳、放弃或创建备货计划。$/, en: "Net recommended stock $1. Accept, dismiss, or create a stock plan.", id: "Rekomendasi stok bersih $1. Terima, abaikan, atau buat rencana persediaan." },
  { pattern: /^覆盖\s*(\d+)\s*\/\s*(\d+)\s*个仓库；当前结论以最弱依赖为准。$/, en: "Coverage: $1 of $2 warehouses; the conclusion uses the weakest dependency.", id: "Cakupan: $1 dari $2 gudang; kesimpulan mengikuti dependensi terlemah." },
  { pattern: /^(\d[\d,]*)\s*个阻断$/, en: "$1 blockers", id: "$1 kendala" },
  { pattern: /^生成于\s*(.+)$/, en: "Generated at $1", id: "Dibuat pada $1" },
  { pattern: /^下一次：(.+)$/, en: "Next: $1", id: "Berikutnya: $1" },
  { pattern: /^(\d[\d,]*)\s*项数据按不同周期自动更新，页面只读取已准备好的快照。$/, en: "$1 datasets update on separate schedules; pages read prepared snapshots only.", id: "$1 kumpulan data diperbarui menurut jadwal berbeda; halaman hanya membaca snapshot yang siap." },
  { pattern: /^(\d[\d,]*)\s*项待处理$/, en: "$1 pending", id: "$1 tertunda" },
  { pattern: /^(\d[\d,]*)\s*项更新中$/, en: "$1 updating", id: "$1 sedang diperbarui" },
  { pattern: /^(\d[\d,]*)\s*个仓库订单失败，今日订单可能不完整$/, en: "$1 warehouse order syncs failed; today's orders may be incomplete", id: "$1 sinkronisasi pesanan gudang gagal; pesanan hari ini mungkin tidak lengkap" },
  { pattern: /^(\d[\d,]*)\s*种币种$/, en: "$1 currencies", id: "$1 mata uang" },
  { pattern: /^预计日出库\s*(\d[\d,]*)$/, en: "Estimated daily outbound $1", id: "Perkiraan keluar harian $1" },
  { pattern: /^覆盖仓库\s*(\d[\d,]*)$/, en: "Warehouses covered $1", id: "Gudang tercakup $1" },
  { pattern: /^最近订单同步\s*(.+)$/, en: "Last order sync $1", id: "Sinkronisasi pesanan terakhir $1" },
  { pattern: /^(\d[\d,]*)\s*个仓库\s*·\s*(.+)$/, en: "$1 warehouses · $2", id: "$1 gudang · $2" },
  { pattern: /^(\d[\d,]*)\s*条样例$/, en: "$1 samples", id: "$1 contoh" },
  { pattern: /^(\d[\d,]*)\s*单\s+(.+)$/, en: "$1 orders · $2", id: "$1 pesanan · $2" },
  { pattern: /^(\d[\d,]*)\s*单$/, en: "$1 orders", id: "$1 pesanan" },
  { pattern: /^部分仓库订单正在后台继续同步：(.+)。同步完成后刷新本页即可看到补齐数据。$/, en: "Some warehouse orders are still syncing in the background: $1. Refresh this page after completion to view the complete data.", id: "Sebagian pesanan gudang masih disinkronkan di latar belakang: $1. Muat ulang halaman ini setelah selesai untuk melihat data lengkap." },
  { pattern: /^(.+)。同步完成后刷新本页即可看到补齐数据。$/, en: "$1. Refresh this page after completion to view the complete data.", id: "$1. Muat ulang halaman ini setelah selesai untuk melihat data lengkap." },
  { pattern: /^(\d[\d,]*)\s*个 SKU$/, en: "$1 SKUs", id: "$1 SKU" },
  { pattern: /^(\d[\d,]*)\s*个风险$/, en: "$1 risks", id: "$1 risiko" },
  { pattern: /^(\d+)天$/, en: "$1 days", id: "$1 hari" },
  { pattern: /^(\d+)日\s*([\d.]+)$/, en: "$1-day $2", id: "$1 hari $2" },
  { pattern: /^(\d+)日$/, en: "$1-day", id: "$1 hari" },
  { pattern: /^当前显示\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*条(?:记录)?。?$/, en: "Showing $1 of $2 records.", id: "Menampilkan $1 dari $2 catatan." },
  { pattern: /^当前显示\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)$/, en: "Showing $1 of $2", id: "Menampilkan $1 dari $2" },
  { pattern: /^每页\s*(\d[\d,]*)\s*条$/, en: "$1 per page", id: "$1 per halaman" },
  { pattern: /^第\s*(\d+)\s*\/\s*(\d+)\s*页$/, en: "Page $1 of $2", id: "Halaman $1 dari $2" },
  { pattern: /^增长\s*([\d.]+)%$/, en: "Up $1%", id: "Naik $1%" },
  { pattern: /^下降\s*([\d.]+)%$/, en: "Down $1%", id: "Turun $1%" },
  { pattern: /^(\d{4}-\d{2}-\d{2})\s*快照$/, en: "$1 snapshot", id: "Snapshot $1" },
  { pattern: /^(\d[\d,]*)\s*件在途$/, en: "$1 units in transit", id: "$1 unit dalam perjalanan" },
  { pattern: /^(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*件已估值$/, en: "$1 / $2 units valued", id: "$1 / $2 unit dinilai" },
  { pattern: /^([¥$]?[\d,.]+)万$/, en: "$1×10K", id: "$1×10 ribu" },
  { pattern: /^共\s*(\d[\d,]*)\s*valid periods$/, en: "$1 valid periods", id: "$1 periode valid" },
  { pattern: /^(\d[\d,]*)\s*个待补$/, en: "$1 missing", id: "$1 belum lengkap" },
  { pattern: /^共\s*(\d[\d,]*)\s*个 SKU × 国家$/, en: "$1 SKU × country combinations", id: "$1 kombinasi SKU × negara" },
  { pattern: /^已对比\s*(\d{4})年(\d{1,2})月\s*与\s*(\d{4})年(\d{1,2})月$/, en: "Compared $1-$2 with $3-$4", id: "Membandingkan $2/$1 dengan $4/$3" },
  { pattern: /^已对比\s*(.+)\s*与\s*(.+)$/, en: "Compared $1 with $2", id: "Membandingkan $1 dengan $2" },
  { pattern: /^(\d{4})年(\d{1,2})月$/, en: "$1-$2", id: "$2/$1" },
  { pattern: /^恶化\s*(\d[\d,]*)$/, en: "Deteriorated $1", id: "Memburuk $1" },
  { pattern: /^(\d[\d,]*)\s*行$/, en: "$1 rows", id: "$1 baris" },
  { pattern: /^每行\s*(\d+)\s*个产品$/, en: "$1 products per row", id: "$1 produk per baris" },
  { pattern: /^Slow-moving\s*(\d[\d,]*)\s*\/\s*滞销\s*(\d[\d,]*)$/, en: "Slow-moving $1 / dead stock $2", id: "Pergerakan lambat $1 / stok mati $2" },
  { pattern: /^改善\s*(\d[\d,]*)\s*\/\s*恶化\s*(\d[\d,]*)$/, en: "Improved $1 / deteriorated $2", id: "Membaik $1 / memburuk $2" },
  { pattern: /^匹配订单行\s*(\d[\d,]*)$/, en: "Matched order lines $1", id: "Baris pesanan cocok $1" },
  { pattern: /^未匹配订单行\s*(\d[\d,]*)$/, en: "Unmatched order lines $1", id: "Baris pesanan tidak cocok $1" },
  { pattern: /^未匹配出库\s*(\d[\d,]*)$/, en: "Unmatched outbound $1", id: "Keluar tidak cocok $1" },
  { pattern: /^期初\s*([\d,]+)\s*－\s*出库\s*([\d,]+)\s*＝\s*理论\s*([\d,]+)$/, en: "Opening $1 − outbound $2 = theoretical $3", id: "Awal $1 − keluar $2 = teoretis $3" },
  { pattern: /^实际期末\s*([\d,]+)$/, en: "Actual closing $1", id: "Penutupan aktual $1" },
  { pattern: /^订单缓存未完整覆盖\s*(.+)\s*至\s*(.+)，当前差异仅供排查参考。$/, en: "The order cache does not fully cover $1 to $2; current variances are for investigation only.", id: "Cache pesanan tidak sepenuhnya mencakup $1 hingga $2; selisih saat ini hanya untuk pemeriksaan." },
  { pattern: /^来自同舟供应链数智化系统，已同步\s*(\d[\d,]*)\s*条记录，覆盖\s*(\d[\d,]*)\s*个仓库。$/, en: "Synced $1 records covering $2 warehouses from the Tongzhou Digital Supply Chain.", id: "$1 catatan dari Sistem Rantai Pasok Digital Tongzhou telah disinkronkan dan mencakup $2 gudang." },
  { pattern: /^GMT\+8\s*·\s*当前\s*(.+)$/, en: "GMT+8 · Current $1", id: "GMT+8 · Saat ini $1" },
  { pattern: /^上班时间\s*(.+?)\s*-\s*(.+?)。$/, en: "Opening hours $1 - $2.", id: "Jam buka $1 - $2." },
  { pattern: /^当前待办\s*(\d[\d,]*)$/, en: "Current pending $1", id: "Tugas saat ini $1" },
  { pattern: /^本次读取\s*(.+)$/, en: "Loaded at $1", id: "Dimuat pada $1" },
  { pattern: /^(\d[\d,]*)\s*项进行中$/, en: "$1 in progress", id: "$1 sedang berjalan" },
  { pattern: /^(\d[\d,]*)\s*行可发$/, en: "$1 lines ready to ship", id: "$1 baris siap dikirim" },
  { pattern: /^(.+)\s*个待处理$/, en: "$1 pending", id: "$1 tertunda" },
  { pattern: /^(\d[\d,]*)\s*张在产单$/, en: "$1 active production orders", id: "$1 order produksi aktif" },
  { pattern: /^(\d[\d,]*)\s*张需跟进或核查$/, en: "$1 require follow-up or review", id: "$1 perlu ditindaklanjuti atau diperiksa" },
  { pattern: /^(\d[\d,]*)\s*张$/, en: "$1 orders", id: "$1 order" },
  { pattern: /^已进行\s*(\d[\d,]*)\s*天$/, en: "In progress for $1 days", id: "Berjalan selama $1 hari" },
  { pattern: /^(.+)\s*开单$/, en: "Opened $1", id: "Dibuka $1" },
  { pattern: /^(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*项$/, en: "$1 of $2 items", id: "$1 dari $2 item" },
  { pattern: /^(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*项\s*·\s*含待核查单$/, en: "$1 of $2 items · includes orders requiring review", id: "$1 dari $2 item · termasuk order yang perlu diperiksa" },
  { pattern: /^已逾期\s*(\d[\d,]*)\s*天$/, en: "Overdue by $1 days", id: "Terlambat $1 hari" },
  { pattern: /^更新于\s*(.+)$/, en: "Updated $1", id: "Diperbarui $1" },
  { pattern: /^数据截至\s*(.+)$/, en: "Data through $1", id: "Data hingga $1" },
  { pattern: /^(\d[\d,]*)\s*条(?:\s*SKU\s*)?行$/, en: "$1 lines", id: "$1 baris" },
  { pattern: /^(\d[\d,]*)\s*条订单行$/, en: "$1 order lines", id: "$1 baris pesanan" },
  { pattern: /^(\d[\d,]*)\s*个店铺$/, en: "$1 stores", id: "$1 toko" },
  { pattern: /^(\d[\d,]*)\s*个平台$/, en: "$1 platforms", id: "$1 platform" },
  { pattern: /^(\d[\d,]*)\s*单$/, en: "$1 orders", id: "$1 pesanan" },
  { pattern: /^Filter\s*(\d+)\s*ms\s*·\s*版本\s*(.+)$/, en: "Filter $1 ms · version $2", id: "Filter $1 ms · versi $2" },
  { pattern: /^版本\s*(.+)$/, en: "version $1", id: "versi $1" },
  { pattern: /^Source lines\s*(\d[\d,]*)\s*行\s*·\s*分析事实\s*(\d[\d,]*)\s*rows$/, en: "Source lines $1 · analysis facts $2 rows", id: "Baris sumber $1 · fakta analisis $2 baris" },
  { pattern: /^([\d.]+)%\s*贡献$/, en: "$1% contribution", id: "kontribusi $1%" },
  { pattern: /^未完成仓库：(.+)。系统已保留上一份完整快照，本批次不会覆盖正式数据。$/, en: "Incomplete warehouses: $1. The previous complete snapshot is retained; this batch will not overwrite official data.", id: "Gudang belum selesai: $1. Snapshot lengkap sebelumnya dipertahankan; batch ini tidak akan menimpa data resmi." },
  { pattern: /^金额覆盖\s*([\d.]+)%$/, en: "Amount coverage $1%", id: "Cakupan nilai $1%" },
  { pattern: /^毛利同口径成本\s*(.+)\s*·\s*已识别成本覆盖\s*([\d.]+)%$/, en: "Comparable gross-profit cost $1 · identified-cost coverage $2%", id: "Biaya laba kotor sebanding $1 · cakupan biaya teridentifikasi $2%" },
  { pattern: /^同口径收入\s*(.+)\s*·\s*成本\s*(.+)\s*·\s*毛利率\s*([\d.]+)%\s*·\s*覆盖\s*([\d.]+)%$/, en: "Comparable revenue $1 · cost $2 · gross margin $3% · coverage $4%", id: "Pendapatan sebanding $1 · biaya $2 · margin kotor $3% · cakupan $4%" },
  { pattern: /^(\d[\d,]*)\s*SKU\s*·\s*([\d.]+)%\s*贡献$/, en: "$1 SKUs · $2% contribution", id: "$1 SKU · kontribusi $2%" },
  { pattern: /^已识别\s*(.+)\s*·\s*覆盖\s*([\d.]+)%$/, en: "Identified $1 · coverage $2%", id: "Teridentifikasi $1 · cakupan $2%" },
  { pattern: /^成本覆盖\s*([\d.]+)%$/, en: "Cost coverage $1%", id: "Cakupan biaya $1%" },
  { pattern: /^(\d[\d,]*)\s*件\s*·\s*(\d[\d,]*)\s*SKU$/, en: "$1 units · $2 SKUs", id: "$1 unit · $2 SKU" },
  { pattern: /^已收录\s*(\d[\d,]*)\s*个网页工具，按\s*(\d[\d,]*)\s*个分类归档。$/, en: "$1 web tools across $2 categories.", id: "$1 alat web dalam $2 kategori." },
  { pattern: /^(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*个仓库已授权$/, en: "$1 of $2 warehouses authorized", id: "$1 dari $2 gudang terotorisasi" },
  { pattern: /^(\d[\d,]*)\s*个模板$/, en: "$1 templates", id: "$1 templat" },
  { pattern: /^最近发送：(.+)$/, en: "Last sent: $1", id: "Terakhir dikirim: $1" },
  { pattern: /^(\d[\d,]*)\s*个账号$/, en: "$1 accounts", id: "$1 akun" },
  { pattern: /^(\d[\d,]*)\s*项有效权限$/, en: "$1 effective permissions", id: "$1 izin efektif" },
  { pattern: /^(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*条$/, en: "$1 of $2 records", id: "$1 dari $2 catatan" },
  { pattern: /^(\d+)\s*\/\s*行$/, en: "$1 / row", id: "$1 / baris" },
  { pattern: /^(\d[\d,]*)\s*个平台订单号$/, en: "$1 platform order numbers", id: "$1 nomor pesanan platform" },
  { pattern: /^API Key 只允许调用只读 Agent 索引及明确声明的分析接口，并实时继承当前账号“(.+)”的角色和停用状态。$/, en: "API keys can call only the read-only Agent index and explicitly listed analysis endpoints, and inherit account “$1” role and active status.", id: "API key hanya dapat memanggil indeks Agent hanya-baca dan endpoint analisis yang tercantum, serta mengikuti peran dan status aktif akun “$1”." },
  { pattern: /^最近更新：?\s*(.+)$/, en: "Last updated: $1", id: "Terakhir diperbarui: $1" },
  { pattern: /^(\d[\d,]*)\s*条$/, en: "$1 items", id: "$1 item" },
  { pattern: /^共\s*(\d[\d,]*)\s*条$/, en: "$1 items total", id: "Total $1 item" },
  { pattern: /^(\d[\d,]*)\s*个$/, en: "$1", id: "$1" },
  { pattern: /^(\d[\d,]*)\s*件$/, en: "$1 pcs", id: "$1 unit" },
  { pattern: /^(\d[\d,]*)\s*天前$/, en: "$1 days ago", id: "$1 hari lalu" },
  { pattern: /^第\s*(\d+)\s*页$/, en: "Page $1", id: "Halaman $1" },
  { pattern: /^第\s*(\d+)\s*步$/, en: "Step $1", id: "Langkah $1" },
  { pattern: /^再加载\s*(\d+)\s*个$/, en: "Load $1 more", id: "Muat $1 lagi" },
  { pattern: /^继续显示（剩余\s*(\d[\d,]*)\s*条）$/, en: "Show more ($1 remaining)", id: "Tampilkan lagi ($1 tersisa)" },
  { pattern: /^加入组合 SKU 计算器：(.+)$/, en: "Add $1 to the bundle SKU calculator", id: "Tambahkan $1 ke kalkulator SKU bundel" },
];

export function normalizeUiLocale(value?: string): UiLocale {
  const locale = String(value || "").toLowerCase().replace("_", "-");
  if (locale === "en" || locale.startsWith("en-")) return "en";
  if (locale === "id" || locale.startsWith("id-") || locale === "in" || locale.startsWith("in-")) return "id";
  return "zh-CN";
}

export function intlLocale(locale: UiLocale) {
  if (locale === "en") return "en-US";
  if (locale === "id") return "id-ID";
  return "zh-CN";
}

export function translate(locale: UiLocale, source: string) {
  if (locale === "zh-CN" || !source) return source;
  const direct = messages[source];
  if (direct) return direct[locale];
  for (const rule of patterns) {
    if (rule.pattern.test(source)) return source.replace(rule.pattern, rule[locale]);
  }
  return source;
}

type I18nContextValue = {
  locale: UiLocale;
  intlLocale: string;
  t: (source: string) => string;
};

const I18nContext = React.createContext<I18nContextValue>({
  locale: "zh-CN",
  intlLocale: "zh-CN",
  t: (source) => source,
});

let runtimeLocale: UiLocale = "zh-CN";

export function I18nProvider({ locale, children }: { locale: UiLocale; children: React.ReactNode }) {
  runtimeLocale = locale;
  const value = React.useMemo<I18nContextValue>(() => ({
    locale,
    intlLocale: intlLocale(locale),
    t: (source) => translate(locale, source),
  }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return React.useContext(I18nContext);
}

const sourceText = new WeakMap<Text, string>();
const lastAppliedText = new WeakMap<Text, string>();
const sourceAttributes = new WeakMap<Element, Map<string, string>>();
const lastAppliedAttributes = new WeakMap<Element, Map<string, string>>();
const translatedAttributes = ["placeholder", "title", "aria-label", "alt"] as const;

function withPreservedSpacing(value: string, locale: UiLocale) {
  const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match || !match[2]) return value;
  return `${match[1]}${translate(locale, match[2])}${match[3]}`;
}

function shouldSkip(element: Element | null) {
  return Boolean(element?.closest("script, style, code, pre, textarea, [contenteditable='true'], [data-i18n-skip]"));
}

function shouldSkipAttributes(element: Element | null) {
  return Boolean(element?.closest("script, style, code, pre, [contenteditable='true'], [data-i18n-skip]"));
}

function translateTextNode(node: Text, locale: UiLocale) {
  if (shouldSkip(node.parentElement)) return;
  const current = node.data;
  const lastApplied = lastAppliedText.get(node);
  let source = sourceText.get(node);
  if (!source || (lastApplied !== undefined && current !== lastApplied)) {
    source = current;
    sourceText.set(node, source);
  }
  const next = locale === "zh-CN" ? source : withPreservedSpacing(source, locale);
  lastAppliedText.set(node, next);
  if (next !== current) node.data = next;
}

function translateElementAttributes(element: Element, locale: UiLocale) {
  if (shouldSkipAttributes(element)) return;
  let sources = sourceAttributes.get(element);
  let applied = lastAppliedAttributes.get(element);
  if (!sources) {
    sources = new Map();
    sourceAttributes.set(element, sources);
  }
  if (!applied) {
    applied = new Map();
    lastAppliedAttributes.set(element, applied);
  }
  for (const attribute of translatedAttributes) {
    if (!element.hasAttribute(attribute)) continue;
    const current = element.getAttribute(attribute) || "";
    const lastApplied = applied.get(attribute);
    let source = sources.get(attribute);
    if (!source || (lastApplied !== undefined && current !== lastApplied)) {
      source = current;
      sources.set(attribute, source);
    }
    const next = locale === "zh-CN" ? source : translate(locale, source);
    applied.set(attribute, next);
    if (next !== current) element.setAttribute(attribute, next);
  }
}

function translateTree(root: Node, locale: UiLocale) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text, locale);
    return;
  }
  if (!(root instanceof Element) && !(root instanceof DocumentFragment)) return;
  if (root instanceof Element) translateElementAttributes(root, locale);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) translateTextNode(current as Text, locale);
    else translateElementAttributes(current as Element, locale);
    current = walker.nextNode();
  }
}

/**
 * Compatibility bridge for the legacy screens that still contain literal
 * Chinese labels. New components should use useI18n(); this bridge keeps the
 * existing operational pages consistent while they are migrated gradually.
 */
export function LegacyUiTranslator() {
  const { locale } = useI18n();

  React.useLayoutEffect(() => {
    document.documentElement.lang = localeOptions.find((item) => item.value === locale)?.htmlLang || "zh-CN";
    document.title = translate(locale, "同舟供应链中台");
    const root = document.getElementById("root");
    if (root) translateTree(root, locale);
  }, [locale]);

  React.useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return undefined;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") translateTextNode(record.target as Text, runtimeLocale);
        if (record.type === "attributes") translateElementAttributes(record.target as Element, runtimeLocale);
        for (const node of record.addedNodes) translateTree(node, runtimeLocale);
      }
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      characterDataOldValue: true,
      attributes: true,
      attributeFilter: [...translatedAttributes],
    });
    return () => observer.disconnect();
  }, []);

  return null;
}
