// Notion API yardımcıları ve tablo şeması.
// Sütun adları 15 Ekim 2026'da Notion'daki gerçek tablolardan okunarak (Enlem/Boylam kaldırıldı, Kol eklendi) buraya kopyalandı.
// Notion'da bir sütunun adını değiştirirseniz buradaki adı da aynen değiştirin;
// ad harf harf eşleşmezse Notion o alanı yok sayar.

export const NOTION_VERSION = "2025-09-03";
const BASE = "https://api.notion.com/v1";

// "Tansiyon Ölçümleri" tablosunun sütunları
export const P = {
  title: "Ölçüm",
  date: "Tarih",
  sys: "Büyük (SYS)",
  dia: "Küçük (DIA)",
  pulse: "Nabız",
  meal: "Aç/Tok",          // select: Aç | Tok
  cls: "Sınıf",            // select: ESH sınıfı
  place: "Konum",
  temp: "Dış sıcaklık (°C)",
  humidity: "Nem (%)",
  weather: "Hava",
  note: "Not",
  source: "Kaynak",        // select: Fotoğraf | Fotoğraf + elle | Elle
  confidence: "Okuma güveni", // select: Yüksek | Orta | Düşük
  edited: "Düzeltildi",    // checkbox
  arm: "Kol",             // select: Sol kol | Sağ kol
  map: "Harita",           // url (konumun Google Maps bağlantısı)
  photo: "Fotoğraf",       // files
};

// "Tansiyon Ayarlar" tablosunun sütunları (uygulama ilk satırı kullanır)
export const SETTINGS_PROPS = {
  warn_sys: "Yüksek büyük",
  warn_dia: "Yüksek küçük",
  crisis_sys: "Acil büyük",
  crisis_dia: "Acil küçük",
  low_sys: "Düşük büyük",
  low_dia: "Düşük küçük",
  pulse_high: "Nabız yüksek",
  pulse_low: "Nabız düşük",
};

export const MEAL_TO_NOTION = { ac: "Aç", tok: "Tok" };
export const MEAL_FROM_NOTION = { "Aç": "ac", "Tok": "tok" };
export const ARM_TO_NOTION = { sol: "Sol kol", sag: "Sağ kol" };
export const ARM_FROM_NOTION = { "Sol kol": "sol", "Sağ kol": "sag" };
export const SOURCE_TO_NOTION = { foto: "Fotoğraf", "foto+elle": "Fotoğraf + elle", elle: "Elle" };
export const SOURCE_FROM_NOTION = { "Fotoğraf": "foto", "Fotoğraf + elle": "foto+elle", "Elle": "elle" };
export const CONF_TO_NOTION = { yuksek: "Yüksek", orta: "Orta", dusuk: "Düşük" };
export const CONF_FROM_NOTION = { "Yüksek": "yuksek", "Orta": "orta", "Düşük": "dusuk" };

export async function notionFetch(env, path, options = {}) {
  if (!env.NOTION_TOKEN) {
    const e = new Error("NOTION_TOKEN tanımlı değil. Cloudflare'de Variables and Secrets bölümünden ekleyin.");
    e.status = 500;
    throw e;
  }
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      ...(options.body && typeof options.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = data?.message || `Notion hatası (HTTP ${res.status})`;
    if (res.status === 401) msg = "Notion anahtarı (NOTION_TOKEN) geçersiz.";
    if (res.status === 404 && data?.code === "object_not_found") {
      msg = "Notion tablosuna erişilemiyor. Tansiyon sayfasını entegrasyonunuzla paylaşın (••• → Connections).";
    }
    const e = new Error(msg);
    e.status = res.status >= 500 ? 502 : res.status === 429 ? 429 : 502;
    e.detail = data;
    throw e;
  }
  return data;
}

// Tüm sayfaları sayfalayarak çeker.
export async function queryAll(env, dataSourceId, body) {
  const out = [];
  let cursor;
  do {
    const data = await notionFetch(env, `/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({ ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    out.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return out;
}

// Fotoğrafı Notion'a yükler, sayfaya eklenecek file_upload id'sini döner.
export async function uploadFile(env, bytes, contentType, filename) {
  const created = await notionFetch(env, "/file_uploads", { method: "POST", body: "{}" });
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: contentType }), filename);
  await notionFetch(env, `/file_uploads/${created.id}/send`, { method: "POST", body: form });
  return created.id;
}

// ---- property okuyucular
export const num = (p) => (p && typeof p.number === "number" ? p.number : null);
export const text = (p) => (p?.rich_text || p?.title || []).map((t) => t.plain_text).join("") || null;
export const sel = (p) => p?.select?.name || null;
export const url = (p) => p?.url || null;
export const check = (p) => Boolean(p?.checkbox);
export const dateStart = (p) => p?.date?.start || null;
export function firstFileUrl(p) {
  const f = (p?.files || [])[0];
  if (!f) return null;
  return f.type === "file" ? f.file.url : f.external?.url || null;
}

// ---- property yazıcılar
export const wTitle = (s) => ({ title: [{ text: { content: String(s) } }] });
export const wText = (s) => ({ rich_text: s ? [{ text: { content: String(s).slice(0, 1900) } }] : [] });
export const wNum = (n) => ({ number: n === null || n === undefined ? null : n });
export const wSel = (s) => ({ select: s ? { name: s } : null });
export const wUrl = (s) => ({ url: s || null });
export const wCheck = (b) => ({ checkbox: Boolean(b) });
