# SIMON PKL — SMK Negeri 1 Muara Pawan

Aplikasi web sederhana untuk mengelola dan memantau Praktik Kerja Lapangan (PKL) siswa SMK Negeri 1 Muara Pawan. Dibangun dengan Node.js 20+, Express, EJS, dan penyimpanan lokal berbasis JSON.

> Development by Nanang A.S

## Fitur

- Empat peran: administrator, guru pembimbing, pembimbing lapangan, dan siswa.
- Tahun pelajaran serta semester aktif dapat diganti.
- Data empat kompetensi keahlian:
  - Agribisnis Tanaman
  - Agribisnis Tanaman Pangan dan Hortikultura
  - Akuntansi
  - Agribisnis Ternak Unggas
- Pengelolaan akun, DUDI, pembimbing, dan kelompok siswa.
- Jurnal harian berisi kehadiran, jam kerja, kegiatan, hasil belajar, kendala, dan catatan.
- Lampiran foto, dokumen, dan video dengan validasi jenis serta ukuran.
- Verifikasi jurnal: disetujui atau perlu revisi.
- Portofolio siswa dalam PDF dengan cover otomatis.
- Rekap jurnal dalam CSV.
- Desain responsif untuk komputer dan ponsel.
- Tidak meminta atau menyimpan data lokasi/GPS siswa.

## Persyaratan

- Node.js 20 atau lebih baru.
- Windows 10/11, Linux, atau macOS.
- Ruang penyimpanan yang cukup untuk foto dan video.

Periksa versi:

```bash
node --version
npm --version
```

## Menjalankan di Windows

1. Unduh repositori melalui tombol **Code → Download ZIP**, lalu ekstrak.
2. Buka Command Prompt atau PowerShell pada folder aplikasi.
3. Pasang dependensi:

```powershell
npm install
```

4. Salin `.env.example` menjadi `.env`.
5. Buat nilai `SESSION_SECRET` yang acak:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

6. Tempel hasilnya setelah `SESSION_SECRET=` pada file `.env`.
7. Jalankan aplikasi:

```powershell
npm start
```

8. Buka [http://localhost:3000](http://localhost:3000).
9. Pada penggunaan pertama, aplikasi meminta pembuatan akun administrator. Tidak ada nama pengguna atau kata sandi bawaan.

Untuk mode pengembangan:

```powershell
npm run dev
```

## Akses dari jaringan sekolah

Server memakai `HOST=0.0.0.0`. Cari alamat IPv4 komputer server dengan `ipconfig`, lalu perangkat lain membuka:

```text
http://ALAMAT-IP-SERVER:3000
```

Contoh: `http://192.168.1.10:3000`.

Pastikan perangkat berada pada Wi-Fi/LAN yang sama dan Windows Firewall mengizinkan port 3000. Untuk penggunaan melalui internet, pasang HTTPS dan reverse proxy (misalnya Caddy atau Nginx).

## Struktur data

- `data/database.json`: akun, DUDI, kelompok, pengaturan, dan jurnal.
- `uploads/`: foto, dokumen, dan video.
- Kedua jenis data tersebut sengaja tidak dikirim ke Git.

Lakukan pencadangan berkala dengan menghentikan server, lalu salin folder `data` dan `uploads` ke media cadangan. Keduanya harus dipulihkan bersama agar hubungan jurnal dan lampiran tidak terputus.

## Batas unggahan

Nilai awal adalah 50 MB per file dan maksimal 6 file per jurnal. Ubah `MAX_FILE_MB` di `.env` bila diperlukan. Format yang diterima:

- Foto: JPG, PNG, WebP
- Dokumen: PDF, DOC, DOCX, XLS, XLSX
- Video: MP4, WebM, MOV

## Menjalankan dengan Docker

```bash
docker compose up -d --build
```

Aplikasi tersedia di `http://localhost:3000`. Volume Docker menyimpan database dan lampiran agar tidak hilang saat kontainer dibuat ulang.

## Mengganti identitas visual

Logo aplikasi berada di:

- `public/images/school-mark.svg`
- `public/images/smk-bisa.svg`
- `public/images/pkl-hero.svg`

Berkas dapat diganti dengan nama dan format yang sama. Hindari mengubah ukuran `viewBox` SVG agar tampilan tetap proporsional.

## Pengujian

```bash
npm test
npm run check
```

GitHub Actions juga menjalankan pengujian otomatis menggunakan Node.js 20 setiap kali kode dikirim.

## Catatan penggunaan

Versi ini sesuai untuk satu komputer/server sekolah dan pemakaian skala sederhana. Untuk pemakaian publik berskala besar, pindahkan penyimpanan ke PostgreSQL/object storage, gunakan HTTPS, penyimpanan sesi persisten, pemindaian malware unggahan, dan pencadangan otomatis.
