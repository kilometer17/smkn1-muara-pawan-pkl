# Keamanan SIMON PKL

Laporkan masalah keamanan kepada pengelola aplikasi sekolah dan jangan menuliskan data siswa, kata sandi, atau lampiran pribadi pada issue publik.

Praktik minimum sebelum aplikasi dipakai:

- Isi `SESSION_SECRET` dengan nilai acak yang panjang.
- Gunakan kata sandi unik untuk setiap akun.
- Jalankan melalui HTTPS jika dapat diakses melalui internet.
- Batasi akses server dan folder `data` serta `uploads`.
- Cadangkan data secara berkala.
- Segera nonaktifkan akun pengguna yang tidak lagi terkait dengan PKL.
- Periksa lampiran sebelum dibuka pada komputer sekolah.

Aplikasi tidak memiliki akun bawaan dan tidak mengumpulkan data lokasi/GPS.
