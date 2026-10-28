# Detektor 0.2.0

Mapa + GPS + dziennik znalezisk dla poszukiwacza. Aplikacja webowa (PWA), instaluje się na Androidzie z Chrome. Dane zostają w telefonie.

## Co potrafi

- **Wyjścia:** każde wyjście w teren ma własną nazwę, trasę GPS i bibliotekę znalezisk. Start: „Nowe wyjście” (nazwa opcjonalna, nagrywanie trasy można wyłączyć). W trakcie wyjścia na dole są „Znalezisko” i „Pauza” trasy; zakończenie i notatka są na karcie wyjścia (lewy przycisk). Biblioteka wyjść: przycisk „Wyjścia” (gdy nic nie trwa) albo Menu. Z karty wyjścia: pokaż tylko to wyjście na mapie, eksport GPX/GeoJSON, usunięcie.
- Znaleziska dodane przez przytrzymanie palca na mapie poza wyjściem trafiają do „Szybkich znalezisk” z danego dnia.
- Przerwane wyjście (zamknięta aplikacja, odświeżona strona) wznawia się samo; wyjście starsze niż 12 godzin zamyka się automatycznie.
- Mapa: OpenStreetMap, ortofotomapa Geoportalu (zwykła i HR), sam LiDAR, przełącznik LiDAR z suwakiem siły na dowolnym podkładzie, nazwy miejscowości, ulice i numery domów (PRNG, KINA).
- Twoja pozycja z dokładnością, współrzędne w WGS84 i PL-1992.
- Znaleziska: pozycja, kategoria, znacznik „niebezpieczne”, głębokość, podłoże, sygnał, notatki, do 12 zdjęć (aparat wbudowany w aplikację, autozapis szkicu).
- Eksport: kopia zapasowa JSON ze zdjęciami (zawiera wyjścia), GeoJSON (QGIS), GPX.
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

Wgraj zmienione pliki do repozytorium (Add file → Upload files, nadpisz). Przy zmianie plików zmień też numer w `CACHE` w `sw.js` (obecnie `detektor-v8`)., inaczej telefon może jeszcze przez chwilę pokazywać starą wersję.

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
js/app.js  store.js  geo.js  data.js  exporters.js  wmts2180.js
lib/leaflet/   (Leaflet 1.9.4, licencja BSD-2)
icons/
```

Źródła map: © OpenStreetMap contributors, © GUGiK (geoportal.gov.pl). OSM ma politykę użycia kafelków: do własnego użytku w porządku, nie do masowego pobierania.
