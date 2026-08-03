# Ovid Calculator — Araştırma Notları ve Yol Haritası

Bu dosya, dünyanın en çok kullanılan hesap makinesi sitelerinin incelenmesinden
çıkan bulguları, projedeki eksikleri ve gelecek fikirleri kalıcı olarak saklar.
Amaç: bir sonraki oturumda sıfırdan araştırma yapmak zorunda kalmamak.

Araştırma tarihi: Ağustos 2026.

---

## 1. Rakip analizi — kim, ne kadar, neden?

| Site | Trafik (2026) | Kazandıran şey |
|---|---|---|
| **calculator.net** | ~35–58M ziyaret/ay, Matematik kategorisinde **#1** | ~200 özel hesaplayıcı, kayıt yok, tek sayfa, anında cevap |
| **Desmos** | ~11M | Gerçek zamanlı görselleştirme, çoklu ifade listesi |
| **Symbolab** | Yüksek | **Adım adım çözüm** — sadece cevabı değil, yolu da gösteriyor |
| **RapidTables** | Yüksek | Genişlik: birim çevirici + referans tablolar tek adreste |
| **Soulver / Numi / CalcTape / InstaCalc** | Niş ama sadık | Doğal dil, "tape" defter modeli, isimli değişkenler, her adım düzenlenebilir |

### Neden bu kadar çok kullanılıyorlar? (çıkarılan ilkeler)

1. **Sıfır sürtünme.** Kayıt yok, açılış ekranı yok, reklam duvarı yok.
   Kullanıcı geliyor, sayıyı giriyor, cevabı alıyor.
2. **Organik arama.** calculator.net trafiğinin %75'i organik aramadan geliyor.
   Her hesaplayıcının kendi sayfası + o konuyu anlatan içeriği var.
3. **Mobil öncelikli.** calculator.net trafiğinin **%62.8'i mobil**.
   Hız ve responsive tasarım doğrudan elde tutma oranına etki ediyor.
4. **Eğitici içerik.** Sadece sonuç değil, arkasındaki formülü de anlatıyorlar.
   Bu hem SEO hem güven yaratıyor.
5. **Tek amaç, net tasarım.** Dikkat dağıtan öğe yok.

### Kullanıcıların en çok şikâyet ettiği şeyler

- Hızlı yazınca tuşların kaydedilmemesi
- Az önce ne girdiğini görememek
- **Yanlış sayı girince baştan başlamak zorunda kalmak (geri alma yok)**
- Hata kurtarma zayıflığı
- Yüzde ve negatif sayı dışına çıkılamaması

> Sonuç: kullanıcılar özellik sayısından çok **güvenilirlik, hata kurtarma ve
> ekranın netliği** üzerinden karar veriyor.

---

## 2. Bu projede ŞU AN yapılmış olanlar

### Mimari
- [x] `eval()` / `Function()` tamamen kaldırıldı → **tokenizer + shunting-yard + AST** motoru
- [x] Sayılar `Quantity` tipine taşındı: değer + hata payı + boyut vektörü
- [x] RPN'den **AST** kuruluyor; adım adım indirgeme bunun üstünde çalışıyor
- [x] Doğru operatör önceliği: `2^3^2 = 512` (sağdan birleşme), `-2^2 = -4`
- [x] Örtük çarpma: `2π`, `2(3+4)`, `2sin(30)`
- [x] Canlı önizleme için parantezler otomatik kapatılıyor
- [x] Servis çalışanı (service worker) + manifest → **çevrimdışı çalışır, kurulabilir (PWA)**

### Özellikler
- [x] **Belirsizlik aritmetiği** (`±σ` tuşu) — hata payı yayılımı
- [x] **Birim farkındalıklı hesap** — "Birimler" panelinden birim ekle
- [x] **Warp modu** (`⇢` çipi) — sonucu adım adım göster
- [x] **Canlı önizleme** — `=` basmadan sonuç görünür (soluk cyan), basınca kesinleşir
- [x] Bilimsel pad (açılır/kapanır `fx`): sin, cos, tan + `2nd` ile asin/acos/atan, ln, log, 10ˣ, x^y, 1/x, n!, mod, π, e, rnd
- [x] **DEG / RAD** geçişi (kalıcı)
- [x] **Geri al / ileri al** (`↶ ↷`, Ctrl+Z / Ctrl+Y) — en büyük kullanıcı şikâyetine cevap
- [x] Bellek: MC / MR / M+ / M− + göstergesi
- [x] **Birim çevirici**: uzunluk, kütle, zaman, hız, veri, alan, hacim, sıcaklık (ışık yılı, AU, ışık hızı dahil)
- [x] **Evrensel sabitler kütüphanesi**: c, g, G, h, Nₐ, AU, ly, pc, M☉, R⊕, φ — tıkla, ifadeye eklensin
- [x] Sekmeli yan panel: Geçmiş / Sabitler / Çevirici
- [x] Geçmiş kalıcı (localStorage, 50 kayıt), tıklayınca sonucu geri yükler
- [x] Sonuca tıklayınca panoya kopyalama
- [x] Ses aç/kapa + modern tık ve onay sesleri
- [x] Binlik ayırıcı ve bilimsel gösterim (`6.6743×10^-11`)
- [x] Erişilebilirlik: `aria-live` ile sonuç duyurusu, `:focus-visible`, `prefers-reduced-motion`
- [x] Akıcı responsive (clamp tabanlı), 320px'e kadar taşma yok
- [x] Yavaş/veri tasarrufu bağlantılarda 16MB video otomatik atlanıyor

---

## 3. EKSİKLER — öncelik sırasıyla

### Yüksek öncelik
1. **Video 16 MB.** Mobil trafiğin %62'si düşünülürse bu çok ağır.
   Yapılacak: 1–2 MB'a sıkıştır (WebM/VP9 + H.264 fallback), `poster` ekle.
   Şu an sadece "yavaş bağlantı" tespitinde atlanıyor — bu bir yama, çözüm değil.
2. **Adım adım çözüm yok** (Symbolab'ın kazandıran özelliği).
   İşlem önceliğinin nasıl çözüldüğünü göstermek eğitim değeri katar.
3. **Tek sayfa = tek anahtar kelime.** calculator.net'in gücü yüzlerce ayrı
   sayfadan geliyor. Organik trafik hedefleniyorsa alt sayfalar şart.
4. **Test altyapısı yok.** Motor artık ciddi bir parser; birim testleri (Vitest/Jest)
   ve CI eklenmeli. Şu an testler elle Playwright ile yapılıyor.

### Orta öncelik
5. Klavyeden `sin`, `sqrt` gibi fonksiyon adlarını yazabilmek
6. İfade içinde imleç ile düzenleme (şu an sadece sondan silinebilir)
7. Geçmişi dışa aktarma (CSV / paylaşılabilir link)
8. Çoklu dil (TR/EN) — şu an arayüz Türkçe sabit
9. Tema seçenekleri (nebula / derin uzay / yüksek kontrast)
10. Hesap makinesi durumunu URL'de saklama (paylaşılabilir hesap)

### Düşük öncelik
11. Haptik geri bildirim (mobil `navigator.vibrate`)
12. Sesli giriş
13. Widget / gömülebilir iframe sürümü

---

## 4. İNOVASYON — kimsede olmayan fikirler

Ovid'in teması uzay. Bu bir dekorasyon olarak kalmamalı, **ürün tezine**
dönüşmeli. Tez: *"büyüklük mertebeleriyle düşünenler için hesap makinesi."*

### ✅ A. Belirsizlik (hata payı) aritmetiği — YAPILDI
`5.2±0.1 × 3` → `15.6 ± 0.3`. Gauss hata yayılımı, her işlem için analitik
türevlerle (fonksiyonlar dahil). Hiçbir popüler web hesap makinesinde yok.
Hata payı, kendi büyüklüğüne göre anlamlı basamağa yuvarlanıyor.

### ✅ B. Birim farkındalıklı aritmetik — YAPILDI
`5 km + 300 m` → `5.3 km`. `100 km / 2 h` → `50 km/h`. `2m × 3m` → `6 m^2`.
Boyut vektörü [uzunluk, kütle, zaman, veri] ile gerçek boyut analizi;
uyumsuz birimler (`5km + 3kg`) hata veriyor, `km/km` sadeleşiyor.

### ✅ E. Warp modu — YAPILDI
`=` basınca `2 + 3 × 4` → `2 + 12` → `14` şeklinde adım adım sadeleşiyor.
AST üzerinde soldan-içten indirgeme, yani insanın izlediği sıra.
Symbolab'ın eğitim değeri + Ovid'in uzay dili.

### C. "Ne olurdu?" kaydırıcıları — SIRADA
İfadedeki bir sayıya dokun → kaydırıcıya dönüşsün, sonuç canlı değişsin.
Desmos'un grafik sezgisini basit aritmetiğe taşır. Keşif aracı hâline gelir.
*Not: AST altyapısı artık hazır, bu fikir çok daha kolay uygulanabilir.*

### D. Takımyıldız geçmişi
Her hesap arka planda bir yıldıza dönüşsün; yıldıza tıklayınca o hesap geri gelsin.
Geçmişi listeden **mekânsal hafızaya** çevirir — temayla birebir örtüşür.

### F. Kozmik ölçek çevirisi
Sonucun yanında sezgisel karşılığı: "1.2×10¹² m ≈ Güneş'ten 8 AU uzaklık".
Birim motoru hazır olduğu için artık kolay: sonucun boyutuna bakıp
tanıdık bir sabite oranla.

### G. Yörünge mekaniği paketi
Kaçış hızı, delta-v (Tsiolkovsky), yörünge periyodu, ışığın yol süresi.
Birim farkındalıklı motor bunun için doğru temeli zaten sağlıyor.

### Neden bu kombinasyon eşsiz?
Piyasada üç grup var: (1) genel amaçlı devler (calculator.net), (2) eğitim
çözücüleri (Symbolab), (3) defter tipi niş araçlar (Soulver).
**Hiçbiri "bilimsel kesinlik + keşif + uzay yerelliği"ni birleştirmiyor.**
A + B + C + G kombinasyonu savunulabilir, taklit edilmesi zor bir konum yaratır.

---

## 5. İkinci tur araştırma — kullanıcıların gerçek şikâyetleri (Ağu 2026)

Apple/Samsung/Windows forumlarından ve uygulama yorumlarından derlenen
somut şikâyetler. Bunlar "keşke" değil, insanların yazdığı gerçek sorunlar:

1. **"Ne yazdığımı göremiyorum"** — geçmiş/ifade satırı olmaması. ✅ bizde var
2. **"Kopyalayamıyorum"** — Samsung tabletlerde hesabı kopyalamak imkânsız;
   dokununca seçiliyor, tekrar dokununca seçim kalkıyor. ✅ bizde tek tıkla kopya
3. **"Tuşlar ve yazılar çok küçük"** — az gören kullanıcılar için erişilemez.
   ❌ **eksik**: yazı boyutu ayarı yok
4. **"Güncelleme normal işlevi kaldırıp kimsenin istemediği tuhaf özellikler
   getirdi"** — özellik şişmesi uyarısı. Bizim `fx` katlama yaklaşımımız doğru.
5. **"Hesap makinesini başka uygulama kullanırken küçültemiyorum"** — PWA
   olarak kurulabilir olmamız bunu kısmen çözüyor. ✅

### Bilimsel/mühendislik tarafında karşılanmayan ihtiyaçlar

6. **Anlamlı basamak (significant figures)** — standart hesap makineleri onlarca
   ondalık basamak verip **"sahte hassasiyet"** yaratıyor; sonuç, ölçümün gerçek
   hassasiyetini yansıtmıyor. Bizim belirsizlik motorumuz bunun yarısını zaten
   çözdü; bir "sig-fig modu" doğal devamı.
7. **Tam kesir (exact fraction) aritmetiği** — `1/3 + 1/6` → `1/2` (0.5 değil).
   Kesirli form **yuvarlanmış yaklaşık değil, tam değeri** verir. Devirli ondalığı
   kesre çevirme de aranıyor. ❌ **eksik** — en güçlü sıradaki aday.
8. **Asal çarpanlara ayırma / OBEB / OKEK** — devasa arama hacmi, onlarca
   siteye tek başına trafik getiriyor. ❌ **eksik**
9. **Taban dönüşümü (ikilik/onaltılık)** — yazılımcı kitlesi. ❌ **eksik**
10. **Liste istatistiği** — ortalama, medyan, standart sapma. ❌ **eksik**

> Ortak tema: **hassasiyet dürüstlüğü**. Belirsizlik + birim + anlamlı basamak +
> tam kesir birleşince ortaya "sana yalan söylemeyen hesap makinesi" çıkıyor.
> Bu, ücretsiz web'de kimsenin sahiplenmediği bir konum.

---

## 6. Görev Merkezi — topluluk sistemi (YAPILDI)

### Neden böyle tasarlandı
Site statik (GitHub Pages), arkada sunucu yok. Sahte bir "canlı skor tablosu"
yapmak yerine üç katmanlı, gerçekten çalışan bir yapı kuruldu:

1. **Yerel önce** — kullanıcı adı ve katkılar `localStorage`'da. Anında çalışır,
   çevrimdışı çalışır, kayıt gerektirmez.
2. **Gerçek gönderim kanalı** — "GitHub'a gönder" önceden doldurulmuş bir issue
   açar. Token yok, sunucu yok, ama katkı gerçekten bize ulaşır.
3. **Onur Panosu** — `contributors.json` dosyasından okunur. Bir katkı kabul
   edilince bu dosyaya işlenir. Yani pano **gerçekten paylaşılan** bir veridir.

### Oyunlaştırma kararları (araştırmaya dayalı)
- Araştırma: *"gamification'ın başarısız olmasının en büyük nedeni ekiplerin
  strateji yerine mekanikle başlaması."* Buradaki strateji: **kaliteli öneri
  toplamak**. Bu yüzden gönderi 10 XP, **kabul edilen katkı 100 XP** — ödül
  hacimde değil, işe yararlıkta.
- Araştırma: *"kullanıcıların %74'ü skor tablosunda yarışmaktan hoşlanıyor"*
  ama *"güncellenmeyen pano ihmal sinyali verir"* → pano tek bir JSON
  dosyasından besleniyor, bakımı bir satırlık iş.
- Rütbeler uzay temalı: Çaylak → Mürettebat → Pilot → Kaptan → Komutan →
  Yıldız Amirali. Rozetlerde **kıtlık** ilkesi: "Yıldız Kâşifi" yalnızca
  katkısı kabul edilenlere.

### ✅ İsimli yıldızlar — YAPILDI
Kabul edilen her katkı arka planda **isimli bir yıldıza** dönüşüyor.
Konum, kişinin adından türetilen bir hash ile belirleniyor; yani yıldız her
ziyarette aynı yerde — "onun yıldızı" olması bunu gerektiriyor.
Üzerine gelince (veya dokununca) ad beliriyor.

Teknik notlar:
- Yıldız katmanı `z-index: -1`, yani her şeyin arkasında — tuşları kapatmıyor.
- `.main-section` yalnızca ortalama kabı olduğu için `pointer-events: none`
  yapıldı; aksi halde tüm alanı yakalayıp yıldızları erişilmez kılıyordu.
- Konumlar orta sütundan uzak tutuluyor (sol %4–26 / sağ %72–94).

### Kalan iş
- [ ] Haftalık/aylık pano segmentasyonu (araştırma önerisi)
- [ ] Aynı öneriye oy verme (şu an sunucusuz mümkün değil; GitHub issue
      reaksiyonları bunu zaten sağlıyor)

---

## 6b. Önden temizlenen şikâyetler (YAPILDI)

Araştırmada tespit edilen ve bizim sitede de çıkabilecek sorunlar,
kullanıcı şikâyet etmeden önce kapatıldı:

| Olası şikâyet | Çözüm |
|---|---|
| "Tuşlar ve yazılar çok küçük" | Üst bardaki **A / A+ / A++** düğmesi; tuş ve yazı boyutu üç kademe, tercih kalıcı |
| Ekran okuyucu tuşları anlamsız okuyor (⌫, ±, √) | Tüm sembol tuşlarına `aria-label` |
| Klavye kullanıcısı modalda kayboluyor | Görev Merkezi'nde **odak tuzağı** + kapanınca odak geri döner |
| "Yanlışlıkla geçmişimi sildim" | Geçmiş temizleme ve katkı silme artık **onay soruyor** |
| Safari gizli sekmede uygulama çöküyor | `localStorage` erişimi try/catch ile sarıldı; başarısızsa bellekte devam eder |
| "Uzun sonucu göremiyorum" | Sonuç kırpılmak yerine **kademeli küçülüyor**, çok uzunsa alt satıra iniyor |
| "sin yazamıyorum, tuş aramak zorundayım" | Klavyeden fonksiyon adı ve birim yazılabiliyor (`sin(30)`, `5km+300m`) |

Not: Büyük boyut modu ilk denemede üst barı taşırıp yatay kaydırma yaratıyordu;
boyutlandırma yalnızca tuş takımına uygulanacak şekilde sınırlandırıldı
(üst bar kontrolleri içerik değil, arayüz kromu).

---

## 7. Kaynaklar

- Similarweb — Matematik kategorisi sıralaması ve calculator.net trafiği
- Semrush — calculator.net trafik analizi
- Jolyti — calculator.net başarı hikâyesi analizi
- LetsCalc — 2026'da beklenen akıllı hesap makinesi özellikleri
- Calc9 — hesap makinesi UI/UX ilkeleri
- W3C WAI — ARIA22, `role="status"` ile sonuç duyurma
- Soulver / CalcTape / InstaCalc — doğal dil ve tape modeli örnekleri
