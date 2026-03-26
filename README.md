# SahamMe — Daftar Saham Indonesia (Netlify-ready)

Ringkas: situs statis yang menampilkan kutipan saham Indonesia secara realtime menggunakan TradingView Market Overview widget. Sebelumnya proyek menggunakan polling terhadap Yahoo Finance; sekarang frontend menggunakan widget TradingView sehingga pembaruan data bersifat realtime tanpa perlu refresh manual.

Files:
- [index.html](index.html)
- [main.js](main.js)
- [styles.css](styles.css)
- [tickers.json](tickers.json)
- [netlify.toml](netlify.toml)
- [netlify/functions/yahoo-quote.js](netlify/functions/yahoo-quote.js)


Cara deploy ke Netlify:

1. Push repo ini ke GitHub/GitLab/Bitbucket.
2. Buat site baru di Netlify dan connect ke repo.
3. Netlify otomatis akan menemukan `netlify.toml` dan menyajikan `index.html` dari root; functions berada di `netlify/functions`.

Local dev (opsional):

Install Netlify CLI kemudian jalankan:

```powershell
npm install -g netlify-cli
netlify dev
```

Notes:
- Frontend sekarang menggunakan TradingView Market Overview widget (embed) untuk data realtime. Widget memuat data langsung dari TradingView dan tidak memerlukan polling.
- Kami tetap menyertakan fungsi Netlify (`netlify/functions/yahoo-quote.js`) sebagai fallback/proxy untuk Yahoo Finance jika Anda ingin data alternatif.
