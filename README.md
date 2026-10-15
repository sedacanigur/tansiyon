# Tansiyon Takip

Telefondan açılan, uygulama gibi çalışan kişisel tansiyon kayıt sistemi.
LGS panelinle aynı yapıda: Cloudflare Workers üzerinde çalışır, `npx wrangler deploy` ile yayınlanır.

## Ne yapar

- **Fotoğraf çek:** Tansiyon aletinin ekranını çekersin; büyük (SYS), küçük (DIA) ve nabız değerlerini Claude okur.
- **Otomatik kayıt:** Fotoğrafın yüklendiği tarih ve saat, bulunduğun konum (semt/ilçe, il) ve o anki dış hava sıcaklığı ile nem kaydedilir. Fotoğraf da saklanır.
- **Aç / Tok:** Fotoğraftan önce istersen seçersin. Not da ekleyebilirsin (örn. "ilacı içtim").
- **İstediğin kadar ölçüm:** Günde sınır yok.
- **Rapor:** 7/30/90 gün ya da tüm zamanlar için:
  - uyarılar (acil değer, yüksek ortalama, yüksek/düşük ölçümler, nabız, yükselen trend, aç-tok farkı)
  - tansiyon ve nabız grafikleri
  - ESH sınıflandırma dağılımı
  - aç-tok ve günün saatine göre karşılaştırma
  - sıcaklık ile tansiyon ilişkisi
- **Dışa aktarma:** Excel'de açılan CSV dosyası ve yazdırılabilir rapor.
- **Düzeltme:** Okunan değer yanlışsa düzeltirsin. Fotoğraf okunamazsa değerleri elle yazarsın, fotoğraf yine kayda eklenir.
- **Uyarı sınırları:** Ayarlar sekmesinden değiştirilebilir. Varsayılan sınırlar şöyle (ESH ev ölçümü değerleri):

  | Sınır | Değer |
  |---|---|
  | Yüksek | 135/85 |
  | Acil | 180/120 |
  | Düşük | 90/60 |
  | Nabız | 50–100 |

## Dosyalar

```
public/index.html       arayüz (ölç, rapor, kayıtlar, ayarlar)
public/manifest...      ana ekrana ekleme (uygulama simgesi)
public/sw.js            ana ekrana ekleme için service worker
worker/index.js         API: giriş, kayıt, fotoğraf okuma, hava durumu, konum adı, CSV
wrangler.jsonc          Cloudflare ayarları
schema.sql              veritabanı yapısı (worker tabloları kendisi kurar, sadece bilgi için)
```

## Kurulum (bir kerelik, yaklaşık 10 dakika)

Bilgisayarında Node.js kurulu olmalı (LGS panelinde kullandığın ortam yeterli).
Bu klasörde bir komut penceresi aç.

### 1) Paketleri kur ve Cloudflare'e giriş yap
```
npm install
npx wrangler login
```

### 2) Veritabanını oluştur
```
npx wrangler d1 create tansiyon
```
Çıktıda `database_id = "...."` satırı olacak. Bu değeri kopyala.
`wrangler.jsonc` dosyasında `BURAYA_DATABASE_ID_YAPISTIRIN` yazan yere yapıştır.

### 3) Yayınla
```
npx wrangler deploy
```
Sonunda `https://tansiyon-takip.<hesap-adın>.workers.dev` adresi çıkar.

### 4) Şifreyi ve Claude API anahtarını gir
```
npx wrangler secret put APP_PASSWORD
npx wrangler secret put ANTHROPIC_API_KEY
```
Her komut değeri sorar; yapıştırıp Enter'a bas. Bu değerler kodda yazılı değildir, Cloudflare'de şifreli saklanır.

- **APP_PASSWORD:** Uygulamaya giriş şifren. Değiştirirsen açık olan tüm oturumlar kapanır.
- **ANTHROPIC_API_KEY:** Fotoğraf okuma için gerekli. Şöyle alınır:
  1. console.anthropic.com adresinde hesap aç.
  2. **Billing** bölümünden kredi yükle (5 dolar uzun süre yeter).
  3. **API Keys** bölümünden yeni anahtar oluştur. Anahtar `sk-ant-` ile başlar.

  Anahtar girilmezse uygulama yine çalışır: fotoğraf kaydedilir, değerleri elle yazarsın.

### 5) Telefona ekle
1. Telefonda Chrome ile adresi aç ve şifreyle giriş yap.
2. Chrome menüsü (⋮) → **Ana ekrana ekle**. Uygulama simgesiyle açılır.
3. İlk fotoğrafta tarayıcı **kamera** ve **konum** izni ister; ikisine de izin ver. Konum izni olmadan sıcaklık ve yer bilgisi kaydedilmez.

## Maliyet

- **Cloudflare (Workers + D1):** Kişisel kullanımda ücretsiz plan yeterli. D1'de 5 GB alan var; fotoğraf başına yaklaşık 150–250 KB yer tutar.
- **Claude ile okuma:** Varsayılan model `claude-sonnet-5-5`. Ölçüm başına yaklaşık 0,5 sent, günde 5 ölçümle ayda yaklaşık 0,75 dolar.
  Daha ucuzu için `wrangler.jsonc` içinde `CLAUDE_MODEL` değerini `claude-haiku-5-5` yapıp yeniden deploy et. Haiku çok daha ucuzdur ama bulanık fotoğraflarda daha sık yanılabilir.
- **Hava durumu (Open-Meteo) ve konum adı (OpenStreetMap):** Ücretsiz, anahtar gerekmez.

## Güncelleme ve yedek

- **Kod değişikliği:** Dosyaları güncelle ve tekrar `npx wrangler deploy` çalıştır. Veriler silinmez.
- **Excel yedeği:** Rapor sekmesindeki **Excel (CSV)** düğmesi.
- **Tam yedek (fotoğraflar dahil):**
  ```
  npx wrangler d1 export tansiyon --remote --output yedek.sql
  ```

## Bilgisayarda deneme (isteğe bağlı)

1. `.dev.vars.example` dosyasını `.dev.vars` adıyla kopyala ve içindeki şifreyi yaz.
2. `npx wrangler dev` çalıştır.
3. Tarayıcıda `http://localhost:8787` adresini aç.

## Notlar

- **Okuma hataları:** Fotoğraftaki değerleri yapay zekâ okur. Kayıttan sonra değerler büyük harflerle gösterilir; yanlışsa **Düzelt** ile değiştir. Okuma emin değilse uygulama "Değerleri kontrol edin" uyarısı verir.
- **Uyarılar:** Bilgilendirme amaçlıdır, tanı koymaz. Acil değer ve belirti varsa 112.
