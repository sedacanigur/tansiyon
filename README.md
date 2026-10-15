# Tansiyon Takip

Telefondan açılan, uygulama gibi çalışan kişisel tansiyon kayıt sistemi.
LGS panelinle aynı yapıda: Cloudflare Workers üzerinde çalışır ve her ölçümü doğrudan Notion'a yazar.

## Verilerin yeri: Notion → Tansiyon sayfası

- **Tansiyon Ölçümleri:** Her ölçüm bir satırdır. Fotoğraf da satıra eklenir. Satıra şunlar yazılır:
  - tarih ve saat
  - büyük ve küçük tansiyon, nabız
  - aç/tok durumu ve ölçülen kol (sol/sağ, varsayılan sol)
  - ESH sınıfı
  - konum ve harita bağlantısı
  - dış sıcaklık, nem ve hava durumu
  - not
  - okuma güveni
- **Tansiyon Ayarlar:** Uyarı sınırları. Uygulamanın Ayarlar sekmesinden ya da doğrudan Notion'dan değiştirilebilir.

Notion'da satırları düzenleyebilir, kendi görünümlerinizi (takvim, grafik, filtre) ekleyebilirsiniz.
Sütun adlarını değiştirmeyin; değiştirirseniz `worker/lib/notion.js` içindeki adları da aynen güncelleyin.

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
worker/lib/notion.js    Notion bağlantısı ve sütun adları
wrangler.jsonc          Cloudflare ayarları (Notion tablo kimlikleri burada)
```

## Kurulum (GitHub + Cloudflare, komut satırı gerekmez)

### 1) Notion erişimi
- **NOTION_TOKEN:** LGS panelinde kullandığınız Notion entegrasyonunu kullanabilirsiniz; anahtarı aynıdır.
  Yeni entegrasyon açmak isterseniz notion.so/my-integrations adresinden açın. Anahtar `ntn_` ile başlar.
- **Erişim izni:** Notion'da **Tansiyon** sayfasını açın → sağ üstte **•••** → **Connections** → entegrasyonunuzu seçip onaylayın.
  Bu tek işlemle iki tablo da (Ölçümler ve Ayarlar) erişime açılır.

### 2) GitHub
1. github.com üzerinde yeni bir repo açın: adı `tansiyon-takip`, görünürlüğü **Private**, seçenekleri boş bırakın.
2. "uploading an existing file" bağlantısına tıklayın.
3. Bu klasörün **içindekileri** sürükleyip bırakın ve **Commit changes**'a basın.

### 3) Cloudflare'i repoya bağlayın
1. dash.cloudflare.com → **Workers & Pages** → **Create** → **Import a repository**.
2. `tansiyon-takip` reposunu seçin. Proje adı `tansiyon-takip` olmalı.
3. Build command boş kalsın. Deploy command: `npx wrangler deploy`.
4. **Save and Deploy**'a basın.

Daha önce `npx wrangler deploy` ile oluşturulmuş bir `tansiyon-takip` worker'ı varsa yeni proje açmayın:
o worker'da **Settings → Build → Connect** ile repoya bağlayın.

### 4) Gizli değerleri ekleyin
Worker → **Settings** → **Variables and Secrets** → **Add**. Type olarak **Secret** seçip üç değeri ayrı ayrı ekleyin:
- `APP_PASSWORD`: uygulamaya giriş şifreniz
- `NOTION_TOKEN`: 1. adımdaki Notion anahtarı
- `ANTHROPIC_API_KEY`: fotoğraf okuma anahtarı. Almak için:
  1. console.anthropic.com adresinde hesap açın.
  2. **Billing** bölümünden birkaç dolar kredi yükleyin.
  3. **API Keys** bölümünden yeni anahtar oluşturun. Anahtar `sk-ant-` ile başlar.

  Bu anahtar girilmezse fotoğraf yine kaydedilir, değerleri siz yazarsınız.

### 5) Açın ve telefona ekleyin
1. **Settings → Domains & Routes** bölümünde `workers.dev` satırı Disabled görünüyorsa **Enable**'a basın.
2. `https://tansiyon.<hesap-adınız>.workers.dev` adresini telefonda Chrome ile açıp giriş yapın.
3. Chrome menüsü (⋮) → **Ana ekrana ekle**.
4. İlk fotoğrafta **kamera** ve **konum** izni verin. Konum izni olmadan sıcaklık ve yer bilgisi kaydedilmez.

### Güncelleme
GitHub'da bir dosyayı değiştirip commit etmeniz yeterli. Cloudflare bir iki dakikada otomatik yeniden yayınlar;
durumu **Deployments** sekmesinden izleyebilirsiniz. Verileriniz Notion'da olduğu için güncellemelerden etkilenmez.

`CLAUDE_MODEL` gibi düz ayarları `wrangler.jsonc` dosyasından değiştirin, Cloudflare panelinden değil.
Panelden değiştirilen düz değerleri bir sonraki commit dosyadaki değerle ezer. Secret'lar bundan etkilenmez.

## Maliyet

- **Cloudflare Workers:** Kişisel kullanımda ücretsiz plan yeterli.
- **Notion:** Fotoğraflar Notion'a yüklenir; her biri yaklaşık 150–250 KB tutar. Ücretsiz Notion planında dosya başına 5 MB sınırı var, bu fotoğraflar için yeterli.
- **Claude ile okuma:** Varsayılan model `claude-sonnet-5-5`. Ölçüm başına yaklaşık 0,5 sent, günde 5 ölçümle ayda yaklaşık 0,75 dolar.
  Daha ucuzu için `wrangler.jsonc` içinde `CLAUDE_MODEL` değerini `claude-haiku-5-5` yapıp commit edin. Haiku çok daha ucuzdur ama bulanık fotoğraflarda daha sık yanılabilir.
- **Hava durumu (Open-Meteo) ve konum adı (OpenStreetMap):** Ücretsiz, anahtar gerekmez.

## Yedek

- **Excel yedeği:** Rapor sekmesindeki **Excel (CSV)** düğmesi.
- **Tam yedek (fotoğraflar dahil):** Notion'da Tansiyon sayfası → **•••** → **Export**.

## Bilgisayarda deneme (isteğe bağlı)

1. `.dev.vars.example` dosyasını `.dev.vars` adıyla kopyala ve içindeki değerleri doldur.
2. `npm install` ve ardından `npx wrangler dev` çalıştır.
3. Tarayıcıda `http://localhost:8787` adresini aç.

## Notlar

- **Okuma hataları:** Fotoğraftaki değerleri yapay zekâ okur. Kayıttan sonra değerler büyük harflerle gösterilir; yanlışsa **Düzelt** ile değiştir. Okuma emin değilse uygulama "Değerleri kontrol edin" uyarısı verir.
- **Uyarılar:** Bilgilendirme amaçlıdır, tanı koymaz. Acil değer ve belirti varsa 112.
