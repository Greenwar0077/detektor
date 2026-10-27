# Detektor 0.1.5

Mapa + GPS + dziennik znalezisk dla poszukiwacza. Aplikacja webowa (PWA), instaluje się na Androidzie z Chrome. Dane zostają w telefonie.

## Co potrafi

- Mapa: OpenStreetMap, ortofotomapa Geoportalu (zwykła i wysokiej rozdzielczości), nakładka NMT (cieniowanie terenu).
- Twoja pozycja z dokładnością, tryb śledzenia, współrzędne w WGS84 i PL-1992 (do porównania z Geoportalem).
- Znaleziska: pozycja (GPS / środek mapy / wskazanie palcem), kategoria, znacznik „niebezpieczne”, głębokość, podłoże, sygnał wykrywacza, notatki, do 12 zdjęć.
- Przytrzymanie palca na mapie dodaje znalezisko w tym miejscu.
- Nagrywanie śladu (zapis co kilkanaście punktów, odzyskiwanie przerwanego śladu).
- Eksport: kopia zapasowa JSON ze zdjęciami, GeoJSON (QGIS), GPX.
- Miejsce na własne mapy historyczne (WIG 1930 itp.) w `config.js`.

## Uruchomienie: GitHub Pages (ok. 10 minut)

1. Załóż konto na github.com (jeśli nie masz).
2. Kliknij **New repository**. Nazwa np. `detektor`, ustaw **Public**, utwórz.
3. W repozytorium: **Add file → Upload files**. Wrzuć **zawartość** rozpakowanego folderu tak, żeby `index.html` leżał w głównym katalogu repozytorium (nie w podfolderze). Przeciągnij też foldery `css`, `js`, `lib`, `icons`. Kliknij **Commit changes**.
4. **Settings → Pages**. W „Build and deployment” wybierz Source: *Deploy from a branch*, Branch: `main`, folder `/ (root)`. Zapisz.
5. Po 1–2 minutach adres to `https://TWOJ-LOGIN.github.io/detektor/`.
6. Otwórz go w Chrome na Androidzie. Zezwól na lokalizację. Menu Chrome (trzy kropki) → **Zainstaluj aplikację** / **Dodaj do ekranu głównego**.

Wymagany jest https, GitHub Pages go zapewnia. Z `file://` lub zwykłego http GPS nie zadziała.

## Aktualizacja

Wgraj zmienione pliki do repozytorium (Add file → Upload files, nadpisz). Przy zmianie plików zmień też `CACHE = 'detektor-v1'` w `sw.js` na `detektor-v2` itd., inaczej telefon może jeszcze przez chwilę pokazywać starą wersję.

## Ważne

- **Dane są tylko w telefonie.** Wyczyszczenie danych witryny w Chrome albo odinstalowanie aplikacji je kasuje. Rób kopię zapasową (Menu → Kopia zapasowa) po każdym wyjściu w teren. Plik trafia do Pobranych.
- **GPS przy wygaszonym ekranie** zwykle się zatrzymuje (ograniczenie przeglądarki). Przy nagrywaniu śladu aplikacja prosi o blokadę wygaszania ekranu.
- Mapy wymagają internetu. Tryb offline (zapisywanie kafelków na wyjazd) to kolejny etap.
- Nazwy warstw Geoportalu (`Raster`) i dostępność usług nie były sprawdzone z poziomu serwera testowego. Jeśli warstwa nie ładuje się, aplikacja pokaże komunikat, a w Menu → Diagnostyka warstw zobaczysz licznik błędów. Wtedy wyślij mi zrzut ekranu.

## Dodawanie mapy historycznej (np. WIG Goniądz 1930)

1. Pobierz arkusz (np. z mapywig.org) jako obraz.
2. W QGIS: **Georeferencer**, wskaż 8–12 punktów kontrolnych (skrzyżowania, kościoły, mosty), transformacja Thin Plate Spline albo wielomianowa 2, układ EPSG:3857.
3. Wygeneruj kafelki: **Processing → Raster tools → Generate XYZ tiles (Directory)**, PNG, zoom 10–17, ze stałym tłem przezroczystym.
4. Skopiuj folder kafelków do `tiles/wig-goniadz-1930/` w repozytorium. Pamiętaj o limicie GitHub (ok. 1 GB na repozytorium, zalecane mniej); większe zbiory kafelków trzeba hostować gdzie indziej.
5. W `config.js` odkomentuj wpis w `historical` i dopasuj nazwę. Aplikacja pokaże warstwę w oknie Warstwy z suwakiem przezroczystości.

## Struktura

```
index.html  config.js  sw.js  manifest.webmanifest
css/app.css
js/app.js  store.js  geo.js  data.js  exporters.js
lib/leaflet/   (Leaflet 1.9.4, licencja BSD-2)
icons/
```

Źródła map: © OpenStreetMap contributors, © GUGiK (geoportal.gov.pl). OSM ma politykę użycia kafelków: do własnego użytku w porządku, nie do masowego pobierania.
