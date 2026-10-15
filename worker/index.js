// Tansiyon Takip — Cloudflare Worker
// Arayüz public/ klasöründen sunulur; bu dosya yalnızca /api/* isteklerini karşılar.
// Ölçümler ve fotoğraflar Notion'daki "Tansiyon Ölçümleri" tablosuna yazılır.
//
// Ortam:
//   ASSETS                          statik dosyalar (wrangler.jsonc)
//   NOTION_DATA_SOURCE_ID           Tansiyon Ölçümleri tablosu (var)
//   NOTION_SETTINGS_DATA_SOURCE_ID  Tansiyon Ayarlar tablosu (var)
//   CLAUDE_MODEL, TIMEZONE          (var)
//   APP_PASSWORD                    giriş şifresi (secret)
//   NOTION_TOKEN                    Notion entegrasyon anahtarı (secret)
//   ANTHROPIC_API_KEY               fotoğraf okuma için Claude API anahtarı (secret)

import {
  P, SETTINGS_PROPS, MEAL_TO_NOTION, MEAL_FROM_NOTION, SOURCE_TO_NOTION, SOURCE_FROM_NOTION,
  CONF_TO_NOTION, CONF_FROM_NOTION, notionFetch, queryAll, uploadFile,
  num, text, sel, url as urlOf, check, dateStart, firstFileUrl,
  wTitle, wText, wNum, wSel, wUrl, wCheck,
} from "./lib/notion.js";

const COOKIE = "tt_oturum";
const SESSION_DAYS = 180;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // istemci zaten ~300 KB'a küçültüyor

const DEFAULT_SETTINGS = {
  warn_sys: 135, warn_dia: 85,     // ev ölçümünde hipertansiyon sınırı (ESH)
  crisis_sys: 180, crisis_dia: 120, // acil değer
  low_sys: 90, low_dia: 60,         // düşük tansiyon
  pulse_high: 100, pulse_low: 50,
};

// ---------------------------------------------------------------- yardımcılar

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const err = (message, status = 400, extra = {}) => json({ error: message, ...extra }, status);

const enc = new TextEncoder();

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameString(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Oturum anahtarı şifreden türetilir: şifre değişince tüm oturumlar düşer.
const sessionKey = (env) => "tansiyon-oturum:" + env.APP_PASSWORD;

async function makeSession(env) {
  const exp = Date.now() + SESSION_DAYS * 86400e3;
  return exp + "." + (await hmac(sessionKey(env), String(exp)));
}

async function isAuthed(request, env) {
  if (!env.APP_PASSWORD) return false;
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return sameString(sig, await hmac(sessionKey(env), exp));
}

function cookieHeader(value, maxAge) {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validValues(sys, dia, pulse) {
  if (sys === null || dia === null) return "Büyük ve küçük tansiyon değerleri gerekli.";
  if (sys < 50 || sys > 300) return "Büyük tansiyon 50–300 aralığında olmalı.";
  if (dia < 20 || dia > 200) return "Küçük tansiyon 20–200 aralığında olmalı.";
  if (sys <= dia) return "Büyük tansiyon küçük tansiyondan yüksek olmalı.";
  if (pulse !== null && (pulse < 20 || pulse > 250)) return "Nabız 20–250 aralığında olmalı.";
  return null;
}

const normMeal = (m) => (m === "ac" || m === "tok" ? m : null);

const tz = (env) => env.TIMEZONE || "Europe/Istanbul";
const dsId = (env) => {
  if (!env.NOTION_DATA_SOURCE_ID) throw Object.assign(new Error("NOTION_DATA_SOURCE_ID tanımlı değil (wrangler.jsonc)."), { status: 500 });
  return env.NOTION_DATA_SOURCE_ID;
};

// UTC anı, saat dilimi ofsetiyle yerel ISO metnine çevirir (Notion'da doğru saat görünsün diye).
function localIso(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const off = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

// ESH 2023 sınıfı (büyük ve küçük tansiyondan yüksek olan sınıf geçerli)
const CLASS_NAMES = ["Optimal", "Normal", "Yüksek normal", "Evre 1 hipertansiyon", "Evre 2 hipertansiyon", "Evre 3 hipertansiyon"];
function classify(sys, dia, s) {
  if (sys < s.low_sys || dia < s.low_dia) return "Düşük";
  const sc = sys >= 180 ? 5 : sys >= 160 ? 4 : sys >= 140 ? 3 : sys >= 130 ? 2 : sys >= 120 ? 1 : 0;
  const dc = dia >= 110 ? 5 : dia >= 100 ? 4 : dia >= 90 ? 3 : dia >= 85 ? 2 : dia >= 80 ? 1 : 0;
  return CLASS_NAMES[Math.max(sc, dc)];
}

// Open-Meteo hava kodu → Türkçe
function weatherText(code) {
  if (code === null || code === undefined) return null;
  if (code === 0) return "Açık";
  if (code === 1) return "Az bulutlu";
  if (code === 2) return "Parçalı bulutlu";
  if (code === 3) return "Kapalı";
  if (code === 45 || code === 48) return "Sisli";
  if (code >= 51 && code <= 57) return "Çisenti";
  if (code >= 61 && code <= 67) return "Yağmurlu";
  if (code >= 71 && code <= 77) return "Karlı";
  if (code >= 80 && code <= 82) return "Sağanak yağış";
  if (code === 85 || code === 86) return "Kar sağanağı";
  if (code >= 95) return "Gök gürültülü fırtına";
  return null;
}

// Notion sayfası → uygulamanın kullandığı kayıt
function toReading(page) {
  const p = page.properties || {};
  const photoUrl = firstFileUrl(p[P.photo]);
  return {
    id: page.id,
    created_at: dateStart(p[P.date]) || page.created_time,
    sys: num(p[P.sys]),
    dia: num(p[P.dia]),
    pulse: num(p[P.pulse]),
    meal: MEAL_FROM_NOTION[sel(p[P.meal])] || null,
    note: text(p[P.note]),
    lat: num(p[P.lat]),
    lon: num(p[P.lon]),
    place: text(p[P.place]),
    temp_c: num(p[P.temp]),
    humidity: num(p[P.humidity]),
    weather: text(p[P.weather]),
    source: SOURCE_FROM_NOTION[sel(p[P.source])] || null,
    ocr_confidence: CONF_FROM_NOTION[sel(p[P.confidence])] || null,
    edited: check(p[P.edited]) ? 1 : 0,
    has_photo: photoUrl ? 1 : 0,
    photo_url: photoUrl,
    notion_url: page.url,
  };
}

let settingsCache = null; // { at, value }
async function getSettings(env, fresh = false) {
  if (!fresh && settingsCache && Date.now() - settingsCache.at < 60e3) return settingsCache.value;
  const s = { ...DEFAULT_SETTINGS };
  let pageId = null;
  if (env.NOTION_SETTINGS_DATA_SOURCE_ID) {
    const data = await notionFetch(env, `/data_sources/${env.NOTION_SETTINGS_DATA_SOURCE_ID}/query`, {
      method: "POST", body: JSON.stringify({ page_size: 1 }),
    });
    const page = data.results[0];
    if (page) {
      pageId = page.id;
      for (const [k, name] of Object.entries(SETTINGS_PROPS)) {
        const v = num(page.properties[name]);
        if (v !== null) s[k] = v;
      }
    }
  }
  settingsCache = { at: Date.now(), value: s, pageId };
  return s;
}


// Fotoğraftaki tansiyon aleti ekranını Claude ile okur.
async function readMonitor(env, b64, mediaType) {
  if (!env.ANTHROPIC_API_KEY) {
    return { ok: false, reason: "Fotoğraf okuma için ANTHROPIC_API_KEY tanımlı değil. Değerleri elle girebilirsiniz." };
  }
  const tool = {
    name: "olcum_kaydet",
    description: "Tansiyon aletinin ekranından okunan değerleri kaydeder.",
    input_schema: {
      type: "object",
      properties: {
        okunabildi: { type: "boolean", description: "Ekrandaki tansiyon değerleri okunabildiyse true." },
        sistolik: { type: ["integer", "null"], description: "SYS — büyük tansiyon (mmHg)" },
        diyastolik: { type: ["integer", "null"], description: "DIA — küçük tansiyon (mmHg)" },
        nabiz: { type: ["integer", "null"], description: "PULSE / PUL — nabız (atım/dk). Ekranda yoksa null." },
        guven: { type: "string", enum: ["yuksek", "orta", "dusuk"], description: "Okumadan ne kadar emin olduğun." },
        aciklama: { type: "string", description: "Okunamadıysa ya da emin değilsen kısa Türkçe açıklama." },
      },
      required: ["okunabildi", "guven"],
    },
  };
  const prompt =
    "Bu fotoğraf evde kullanılan dijital bir tansiyon aletinin ekranı. Ekrandaki üç ölçüm değerini oku:\n" +
    "- SYS: sistolik (büyük) tansiyon, genellikle en üstte ve en büyük rakamlar, mmHg\n" +
    "- DIA: diyastolik (küçük) tansiyon, genellikle ortada, mmHg\n" +
    "- PULSE / PUL / kalp simgesi: nabız, genellikle en altta, atım/dk\n" +
    "Rakamlar yedi segmentli LCD rakamlardır; 1 ile 7, 0 ile 8, 5 ile 6 ve 9 karışabilir, dikkatli oku. " +
    "Tarih, saat, hafıza numarası (M, MEM), kullanıcı numarası veya pil göstergesi gibi diğer rakamları ölçüm sanma. " +
    "Fotoğraf yan veya ters çekilmiş olabilir. Ekran tansiyon aleti değilse ya da rakamlar okunamıyorsa okunabildi=false ver. " +
    "Sonucu olcum_kaydet aracıyla bildir.";

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.CLAUDE_MODEL || "claude-sonnet-5-5",
        max_tokens: 400,
        tools: [tool],
        tool_choice: { type: "tool", name: "olcum_kaydet" },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
            { type: "text", text: prompt },
          ],
        }],
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (e) {
    return { ok: false, reason: "Fotoğraf okuma servisine ulaşılamadı. Tekrar deneyin ya da değerleri elle girin." };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.log("anthropic error", res.status, body.slice(0, 500));
    const reason = res.status === 401
      ? "Claude API anahtarı geçersiz. ANTHROPIC_API_KEY ayarını kontrol edin."
      : res.status === 400 && body.includes("credit")
        ? "Claude API hesabında kredi yok. console.anthropic.com üzerinden kredi yükleyin."
        : `Fotoğraf okunamadı (servis hatası ${res.status}). Değerleri elle girebilirsiniz.`;
    return { ok: false, reason };
  }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === "tool_use");
  const out = block?.input || {};
  const sys = toInt(out.sistolik), dia = toInt(out.diyastolik), pulse = toInt(out.nabiz);
  if (!out.okunabildi || validValues(sys, dia, pulse)) {
    return {
      ok: false,
      reason: out.aciklama || "Ekrandaki değerler okunamadı. Ekranı düz ve yakından, parlama olmadan çekip tekrar deneyin.",
      partial: { sys, dia, pulse },
      raw: out,
    };
  }
  return { ok: true, sys, dia, pulse, confidence: out.guven || null, note: out.aciklama || null, raw: out };
}

// O anki dış hava sıcaklığı (Open-Meteo, ücretsiz, anahtar gerektirmez).
async function fetchWeather(lat, lon) {
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`;
    const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    const c = d.current || {};
    return {
      temp_c: toNum(c.temperature_2m),
      humidity: toNum(c.relative_humidity_2m),
      weather_code: toInt(c.weather_code),
    };
  } catch {
    return null;
  }
}

// Koordinattan semt / ilçe / il adı (OpenStreetMap Nominatim).
async function fetchPlace(lat, lon) {
  try {
    const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=tr&lat=${lat}&lon=${lon}`;
    const r = await fetch(u, {
      headers: { "User-Agent": "tansiyon-takip/1.0 (kisisel kullanim; cloudflare worker)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const a = (await r.json()).address || {};
    const parts = [
      a.suburb || a.neighbourhood || a.quarter || a.village,
      a.town || a.city_district || a.district || a.county,
      a.province || a.city || a.state,
    ].filter(Boolean);
    const uniq = parts.filter((p, i) => parts.indexOf(p) === i);
    return uniq.slice(-2).join(", ") || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- API

async function createReading(request, env) {
  let body;
  try { body = await request.json(); } catch { return err("Geçersiz istek."); }

  let sys = toInt(body.sys), dia = toInt(body.dia), pulse = toInt(body.pulse);
  const meal = normMeal(body.meal);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null;
  let lat = toNum(body.lat), lon = toNum(body.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) { lat = null; lon = null; }

  let photo = null, photoType = null, b64 = null;
  if (typeof body.image === "string" && body.image.length) {
    b64 = body.image.replace(/^data:[^,]+,/, "");
    photoType = ["image/jpeg", "image/png", "image/webp"].includes(body.image_type) ? body.image_type : "image/jpeg";
    try { photo = b64ToBytes(b64); } catch { return err("Fotoğraf okunamadı."); }
    if (photo.length > MAX_IMAGE_BYTES) return err("Fotoğraf çok büyük.");
  }

  const manual = sys !== null && dia !== null;
  if (!manual && !photo) return err("Fotoğraf ya da tansiyon değerleri gerekli.");

  const now = new Date(); // fotoğrafın yüklendiği an
  const stamp = localIso(now, tz(env));

  // Fotoğraf okuma, hava durumu, konum adı, ayarlar ve fotoğrafın Notion'a yüklenmesi aynı anda.
  const ext = photoType === "image/png" ? "png" : photoType === "image/webp" ? "webp" : "jpg";
  const [ocr, weather, place, settings, uploadId] = await Promise.all([
    manual ? null : readMonitor(env, b64, photoType),
    lat !== null ? fetchWeather(lat, lon) : null,
    lat !== null ? fetchPlace(lat, lon) : null,
    getSettings(env),
    photo ? uploadFile(env, photo, photoType, `tansiyon-${stamp.slice(0, 16).replace(/[:T]/g, "-")}.${ext}`) : null,
  ]);

  if (ocr && !ocr.ok) {
    // Fotoğraf yüklendi ama sayfaya bağlanmadı; Notion bağlanmamış yüklemeyi 1 saat sonra siler.
    return err(ocr.reason, 422, { code: "okunamadi", partial: ocr.partial || null });
  }
  if (ocr) { sys = ocr.sys; dia = ocr.dia; pulse = ocr.pulse; }

  const invalid = validValues(sys, dia, pulse);
  if (invalid) return err(invalid);

  const source = photo ? (manual ? "foto+elle" : "foto") : "elle";
  const properties = {
    [P.title]: wTitle(`${sys}/${dia}`),
    [P.date]: { date: { start: stamp } },
    [P.sys]: wNum(sys),
    [P.dia]: wNum(dia),
    [P.pulse]: wNum(pulse),
    [P.meal]: wSel(MEAL_TO_NOTION[meal]),
    [P.cls]: wSel(classify(sys, dia, settings)),
    [P.note]: wText(note),
    [P.source]: wSel(SOURCE_TO_NOTION[source]),
  };
  if (ocr?.confidence) properties[P.confidence] = wSel(CONF_TO_NOTION[ocr.confidence]);
  if (lat !== null) {
    properties[P.lat] = wNum(Math.round(lat * 1e5) / 1e5);
    properties[P.lon] = wNum(Math.round(lon * 1e5) / 1e5);
    properties[P.map] = wUrl(`https://www.google.com/maps?q=${lat.toFixed(5)},${lon.toFixed(5)}`);
  }
  if (place) properties[P.place] = wText(place);
  if (weather) {
    properties[P.temp] = wNum(weather.temp_c);
    properties[P.humidity] = wNum(weather.humidity);
    const wt = weatherText(weather.weather_code);
    if (wt) properties[P.weather] = wText(wt);
  }
  if (uploadId) {
    properties[P.photo] = { files: [{ type: "file_upload", file_upload: { id: uploadId }, name: `tansiyon-${sys}-${dia}.${ext}` }] };
  }

  const page = await notionFetch(env, "/pages", {
    method: "POST",
    body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: dsId(env) }, properties }),
  });
  return json({ reading: toReading(page), ocr_note: ocr?.note || null }, 201);
}

async function getPage(env, id) {
  if (!/^[0-9a-f-]{32,36}$/i.test(id)) return null;
  try {
    const page = await notionFetch(env, `/pages/${id}`, { method: "GET" });
    // yalnızca tansiyon tablosundaki sayfalar
    const parentDs = page.parent?.data_source_id || page.parent?.database_id;
    const want = dsId(env).replace(/-/g, "");
    if (page.archived || page.in_trash) return null;
    if (parentDs && parentDs.replace(/-/g, "") !== want && page.parent?.type === "data_source_id") return null;
    return page;
  } catch (e) {
    if (e.detail?.code === "object_not_found" || e.detail?.code === "validation_error") return null;
    throw e;
  }
}

async function updateReading(request, env, id) {
  const page = await getPage(env, id);
  if (!page) return err("Kayıt bulunamadı.", 404);
  const current = toReading(page);
  let body;
  try { body = await request.json(); } catch { return err("Geçersiz istek."); }

  const sys = "sys" in body ? toInt(body.sys) : current.sys;
  const dia = "dia" in body ? toInt(body.dia) : current.dia;
  const pulse = "pulse" in body ? toInt(body.pulse) : current.pulse;
  const meal = "meal" in body ? normMeal(body.meal) : current.meal;
  const note = "note" in body ? (String(body.note || "").trim().slice(0, 500) || null) : current.note;
  const invalid = validValues(sys, dia, pulse);
  if (invalid) return err(invalid);

  const valuesChanged = sys !== current.sys || dia !== current.dia || pulse !== current.pulse;
  const settings = await getSettings(env);
  const updated = await notionFetch(env, `/pages/${page.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [P.title]: wTitle(`${sys}/${dia}`),
        [P.sys]: wNum(sys),
        [P.dia]: wNum(dia),
        [P.pulse]: wNum(pulse),
        [P.meal]: wSel(MEAL_TO_NOTION[meal]),
        [P.cls]: wSel(classify(sys, dia, settings)),
        [P.note]: wText(note),
        [P.edited]: wCheck(current.edited || valuesChanged),
      },
    }),
  });
  return json({ reading: toReading(updated) });
}

async function deleteReading(env, id) {
  const page = await getPage(env, id);
  if (!page) return err("Kayıt bulunamadı.", 404);
  // Notion'da çöp kutusuna taşınır; 30 gün içinde Notion'dan geri alınabilir.
  await notionFetch(env, `/pages/${page.id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
  return json({ ok: true });
}

async function fetchReadings(env, days) {
  const filters = [{ property: P.sys, number: { is_not_empty: true } }];
  if (days && days > 0) {
    filters.push({ property: P.date, date: { on_or_after: new Date(Date.now() - days * 86400e3).toISOString() } });
  }
  const pages = await queryAll(env, dsId(env), {
    filter: { and: filters },
    sorts: [{ property: P.date, direction: "ascending" }],
  });
  return pages.map(toReading).filter((r) => r.sys !== null && r.dia !== null);
}

async function listReadings(url, env) {
  return json({ readings: await fetchReadings(env, toInt(url.searchParams.get("days"))) });
}

// Notion'daki fotoğraf bağlantıları 1 saat geçerli; süresi dolunca buradan tazelenir.
async function photo(env, id) {
  const page = await getPage(env, id);
  const u = page && firstFileUrl(page.properties[P.photo]);
  if (!u) return err("Fotoğraf yok.", 404);
  return new Response(null, { status: 302, headers: { location: u, "cache-control": "no-store" } });
}

async function exportCsv(env) {
  const zone = tz(env);
  const rows = await fetchReadings(env, 0);
  const dfmt = new Intl.DateTimeFormat("tr-TR", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const tfmt = new Intl.DateTimeFormat("tr-TR", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const n = (v) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
  const header = ["Tarih", "Saat", "Büyük (SYS)", "Küçük (DIA)", "Nabız", "Aç/Tok", "Konum", "Dış sıcaklık (°C)", "Nem (%)", "Hava", "Not", "Kaynak", "Enlem", "Boylam"];
  const lines = [header.join(";")];
  for (const r of rows) {
    const d = new Date(r.created_at);
    lines.push([
      dfmt.format(d), tfmt.format(d), r.sys, r.dia, r.pulse ?? "",
      r.meal === "ac" ? "Aç" : r.meal === "tok" ? "Tok" : "",
      cell(r.place), n(r.temp_c), n(r.humidity), cell(r.weather), cell(r.note), SOURCE_TO_NOTION[r.source] || "",
      n(r.lat), n(r.lon),
    ].join(";"));
  }
  const stampDay = new Date().toISOString().slice(0, 10);
  // Excel'in Türkçe karakterleri doğru açması için BOM; ayraç noktalı virgül.
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="tansiyon-${stampDay}.csv"`,
      "cache-control": "no-store",
    },
  });
}

async function saveSettings(request, env) {
  let body;
  try { body = await request.json(); } catch { return err("Geçersiz istek."); }
  if (!env.NOTION_SETTINGS_DATA_SOURCE_ID) return err("NOTION_SETTINGS_DATA_SOURCE_ID tanımlı değil (wrangler.jsonc).", 500);
  const props = {};
  for (const [k, name] of Object.entries(SETTINGS_PROPS)) {
    if (!(k in body)) continue;
    const v = toInt(body[k]);
    if (v === null || v < 20 || v > 300) return err("Eşik değerleri 20–300 aralığında olmalı.");
    props[name] = wNum(v);
  }
  await getSettings(env, true);
  const pageId = settingsCache.pageId;
  if (pageId) {
    await notionFetch(env, `/pages/${pageId}`, { method: "PATCH", body: JSON.stringify({ properties: props }) });
  } else {
    await notionFetch(env, "/pages", {
      method: "POST",
      body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: env.NOTION_SETTINGS_DATA_SOURCE_ID }, properties: { Ad: wTitle("Sınırlar"), ...props } }),
    });
  }
  return json({ settings: await getSettings(env, true) });
}

const failedLogins = new Map(); // isolate başına basit deneme sınırı

async function login(request, env) {
  if (!env.APP_PASSWORD) return err("Sunucuda APP_PASSWORD tanımlı değil. Kurulum adımlarına bakın.", 500);
  const ip = request.headers.get("cf-connecting-ip") || "?";
  const f = failedLogins.get(ip);
  if (f && f.count >= 8 && Date.now() - f.at < 15 * 60e3) {
    return err("Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.", 429);
  }
  let body;
  try { body = await request.json(); } catch { return err("Geçersiz istek."); }
  const given = String(body.password || "");
  const ok = sameString(await hmac("cmp", given), await hmac("cmp", env.APP_PASSWORD));
  if (!ok) {
    failedLogins.set(ip, { count: (f?.count || 0) + 1, at: Date.now() });
    await new Promise((r) => setTimeout(r, 600));
    return err("Şifre yanlış.", 401);
  }
  failedLogins.delete(ip);
  return json({ ok: true }, 200, { "set-cookie": cookieHeader(await makeSession(env), SESSION_DAYS * 86400) });
}

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/api/login" && method === "POST") return login(request, env);
  if (pathname === "/api/logout" && method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": cookieHeader("", 0) });
  }

  if (!(await isAuthed(request, env))) return err("Giriş yapmanız gerekiyor.", 401, { code: "giris" });

  if (pathname === "/api/me" && method === "GET") {
    return json({
      ok: true,
      timezone: tz(env),
      ocr: Boolean(env.ANTHROPIC_API_KEY),
      settings: await getSettings(env),
    });
  }
  if (pathname === "/api/readings" && method === "GET") return listReadings(url, env);
  if (pathname === "/api/readings" && method === "POST") return createReading(request, env);
  if (pathname === "/api/export.csv" && method === "GET") return exportCsv(env);
  if (pathname === "/api/settings" && method === "PUT") return saveSettings(request, env);

  let m = pathname.match(/^\/api\/readings\/([0-9a-fA-F-]{32,36})$/);
  if (m) {
    if (method === "PATCH") return updateReading(request, env, m[1]);
    if (method === "DELETE") return deleteReading(env, m[1]);
  }
  m = pathname.match(/^\/api\/photo\/([0-9a-fA-F-]{32,36})$/);
  if (m && method === "GET") return photo(env, m[1]);

  return err("Bulunamadı.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        console.log("api error", e && e.stack || e, e?.detail ? JSON.stringify(e.detail) : "");
        return err(e?.message || String(e), e?.status && e.status >= 400 ? e.status : 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
