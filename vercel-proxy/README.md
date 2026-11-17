# AirSense API proxy (Vercel)

Meneruskan semua permintaan ke Cloudflare Worker `airsense-alert-api`.
Dipakai karena `*.workers.dev` diblokir sebagian operator seluler (mis. XL),
sedangkan `*.vercel.app` tidak.

Deploy:

    cd vercel-proxy
    npx vercel deploy --prod

Setelah itu alamat `https://<proyek>.vercel.app` dipakai sebagai:
- `EXPO_PUBLIC_ALERT_API_URL` di `.env.local` aplikasi
- `PUBLIC_BASE_URL` di `wearable-alert-api/wrangler.jsonc`
