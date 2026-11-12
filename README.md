# transport

Web remote untuk sesi Command Code. Satu file mod mengirim sesi ke relay Cloudflare (Worker + Durable Object), dan web menampilkan daftar sesi, history dari `.jsonl` lokal, stream live, serta dialog permission dan pertanyaan.

Spesifikasi lengkap ada di [PRD transport — Web Remote untuk Command Code.md](./PRD%20transport%20%E2%80%94%20Web%20Remote%20untuk%20Command%20Code.md).

## Struktur

```text
mod/src/                source mod (types, util, acp, jsonl, format, client, index)
dist/transport.ts       bundle satu file untuk Command Code (gitignored)
scripts/install-mod.mjs copy bundle ke ~/.commandcode/mods
workers/protocol.ts     tipe pesan relay, agent, dan web
workers/durable.ts      Durable Object: routing agent <-> browser
workers/app.ts          entry Worker: /ws, /agent, lalu React Router
app/                    UI React Router + Tailwind
app/components/ui/      komponen shadcn/ui (radix-nova)
app/components/transport/
                        layout dashboard + pattern AI Elements
app/lib/                WS client, reducer, `cn`
scripts/relay-check.mjs uji relay dengan agent dan browser palsu
scripts/mod-check.mts   uji mod lewat jiti terhadap relay yang berjalan
```

## Jalankan

```bash
npm install
npm run dev
```

Kalau shell kamu menyetel `NODE_ENV=production`, npm melewati devDependencies; pakai `NODE_ENV=development npm install --include=dev`.

Dev server mencetak port-nya (biasanya `http://localhost:5173`). Kalau port itu terpakai, Vite memilih port lain.

## Pakai mod

Build bundle lalu install sebagai mod user:

```bash
npm run mod:update
```

Perintah itu menjalankan:

- `mod:build` — esbuild membundel `mod/src/index.ts` jadi satu file `dist/transport.ts`.
- `mod:install` — menyalin bundle ke `~/.commandcode/mods/transport.ts`.

Setelah itu mod dimuat otomatis di sesi `cmd` baru; tidak perlu `--mod` lagi.

Command Code hot-reload mod saat file di `~/.commandcode/mods/` berubah. Target `/transport` dan `agentId` disimpan di `cmd.state`, jadi instance baru otomatis reconnect dan memakai identitas yang sama. Kalau sesi kamu masih memakai build sebelum perilaku ini ada, jalankan `/transport <host>` sekali lagi; setelah itu reload berikutnya tidak memutus sesi dari web.

```text
/transport localhost:5173
```

Host tanpa skema memakai `wss://`. Untuk `localhost`/`127.0.0.1` mod memakai `ws://` agar bisa jalan di dev server.

Untuk mencoba tanpa install: `cmd --mod ./dist/transport.ts`.

Perintah ini hanya menerima host; tidak ada `/transport off`. Hentikan dengan menutup proses `cmd` (atau `/exit`).

## UI

UI memakai shadcn/ui preset `radix-nova` dengan layout dashboard: `SidebarProvider` + `Sidebar` yang bisa collapse, `SidebarInset`, dan header dengan `SidebarTrigger`. Konfigurasi ada di `components.json`, token warna di `app/app.css`.

Pattern AI Elements dipakai untuk thread dan langkah agent:

- `MessageScroller` + `MessageScrollerProvider autoScroll` untuk feed.
- `Message` + `Bubble` untuk pesan user, `Message` + `MessageContent` untuk balasan agent.
- `Trace` untuk reasoning, tool call, dan plan.
- `CodeBlock` untuk output tool.
- `Item` untuk konfirmasi permission.
- `Questionnaire` untuk `ask_user_question`.
- `InputGroup` untuk composer.
- `Streamdown` untuk markdown balasan agent (GFM, tabel, task list, code block).

Semua dirakit di `app/components/transport/`; `app/routes/home.tsx` hanya menyusun layout. Tambah komponen baru dengan:

```bash
npx shadcn@latest add dialog
```

Paket `shadcn` ada di devDependencies karena `app/app.css` mengimpor layer Tailwind-nya saat build. Helper `cn` di `app/lib/utils.ts` meneruskan `cn` dari paket `cn` yang dipakai komponen.

## Uji

Dengan dev server berjalan di port 5174:

```bash
BASE=ws://localhost:5174 npm run test:relay
BASE=ws://localhost:5174 npm run test:mod
```

`test:relay` memeriksa routing, presence, error, dan siklus sesi. `test:mod` membangun bundle lebih dulu, lalu memuatnya lewat jiti persis seperti host, dan memeriksa pemetaan event, history dari `.jsonl`, serta round-trip permission dan question.

## Deploy

```bash
npm run deploy
```

Worker menyajikan UI, `/ws`, dan `/agent`. Durable Object memakai satu instance `idFromName("global")` dan tidak menulis ke storage.

**Fase 1 belum punya autentikasi.** `/ws` dan `/agent` terbuka bagi siapa pun yang tahu URL, sehingga siapa pun bisa membaca transkrip dan menjalankan agent. Jalankan hanya lokal atau lewat tunnel sementara; jangan pasang di domain publik permanen sebelum fase 2 (lihat PRD bagian Keamanan).

## Batasan fase 1

- Tidak ada auth, origin check, atau rate limit.
- Plan approval dari web memakai injeksi stdin Ink (`unshift` + `readable`): Approve → `Ctrl+A` (exit) atau `1` (enter), Cancel → `Esc`/`2`. Terminal tetap bisa menjawab.
- Safety permission: Deny langsung dari hook; Allow dari web diteruskan ke prompt TUI dengan injeksi key `1`.
- `cmd.ui.confirm` dari mod lain dan interrupt tetap hanya di terminal.
- `ask_user_question` mendukung pilihan dan free text dari web; "discuss instead" tidak.
- Relay tidak menyimpan apa pun; sesi hilang saat socket putus dan muncul lagi setelah reconnect.
- Composer nonaktif selama agent busy; pesan baru bisa dikirim setelah run selesai.
