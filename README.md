# Detektor 0.8.0

Mapa + GPS + dziennik znalezisk dla poszukiwacza. Aplikacja webowa (PWA), instaluje się na Androidzie z Chrome. Dane zostają w telefonie.

## Co potrafi

- **Wyjścia:** każde wyjście w teren ma własną nazwę, trasę GPS i bibliotekę znalezisk. Start: „Nowe wyjście” (nazwa opcjonalna, nagrywanie trasy można wyłączyć). W trakcie wyjścia na dole są „Znalezisko” i „Pauza” trasy; zakończenie i notatka są na karcie wyjścia (lewy przycisk). Biblioteka wyjść: przycisk „Wyjścia” (gdy nic nie trwa) albo Menu. Z karty wyjścia: pokaż tylko to wyjście na mapie, eksport GPX/GeoJSON, usunięcie.
- Znaleziska dodane przez przytrzymanie palca na mapie poza wyjściem trafiają do „Szybkich znalezisk” z danego dnia.
- Przerwane wyjście (zamknięta aplikacja, odświeżona strona) wznawia się samo; wyjście starsze niż 12 godzin zamyka się automatycznie.
- Mapa: OpenStreetMap, ortofotomapa Geoportalu (zwykła i HR), sam LiDAR, przełącznik LiDAR z suwakiem mieszania na dowolnym podkładzie (0 = sam podkład, ok. 50 = podkład z cieniowaniem terenu, 100 = sam LiDAR), nazwy miejscowości, ulice i numery domów (PRNG, KINA).
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

Wgraj zmienione pliki do repozytorium (Add file → Upload files, nadpisz). Przy zmianie plików zmień też numer w `CACHE` w `sw.js` (obecnie `detektor-v11`)., inaczej telefon może jeszcze przez chwilę pokazywać starą wersję.

## Komputer

Aplikacja działa też w Chrome/Edge na komputerze pod tym samym adresem (można ją zainstalować z paska adresu). Przytrzymanie palca na mapie to tam prawy przycisk myszy. Dane są osobne dla każdej przeglądarki: przenosisz je kopią zapasową JSON (ale mapy ze skanów w kopii nie ma). GPS na komputerze jest zwykle mało dokładny.

## Ważne

- **Dane są tylko w telefonie.** Wyczyszczenie danych witryny w Chrome albo odinstalowanie aplikacji je kasuje. Rób kopię zapasową (Menu → Kopia zapasowa) po każdym wyjściu w teren. Plik trafia do Pobranych.
- **GPS przy wygaszonym ekranie** zwykle się zatrzymuje (ograniczenie przeglądarki). Przy nagrywaniu śladu aplikacja prosi o blokadę wygaszania ekranu.
- Mapy wymagają internetu. Tryb offline (zapisywanie kafelków na wyjazd) to kolejny etap.
- Nazwy warstw Geoportalu (`Raster`) i dostępność usług nie były sprawdzone z poziomu serwera testowego. Jeśli warstwa nie ładuje się, aplikacja pokaże komunikat, a w Menu → Diagnostyka warstw zobaczysz licznik błędów. Wtedy wyślij mi zrzut ekranu.

## Mapy historyczne ze skanu (np. WIG z Mapstera)

1. Pobierz skan arkusza (JPG lub PNG) na telefon.
2. Warstwy → Mapy historyczne → **Dodaj mapę ze skanu**. Skan zostanie zmniejszony do ok. 4800 px i zapisany w telefonie.
3. **Dopasowanie na punktach:** przesuń mapę, aż celownik stanie na rozpoznawalnym miejscu skanu (skrzyżowanie, kościół, most) → „Dalej” → przesuń mapę na to samo miejsce w terenie (ortofotomapa) → „Przypnij”. Pierwszy punkt przesuwa skan, drugi (daleko od pierwszego) ustawia skalę i obrót, trzeci poprawia przekrzywienie. Suwak reguluje przezroczystość skanu.
4. „Gotowe” zapisuje mapę. Potem: przycisk **Retro** włącza/wyłącza mapę, **⇔** uruchamia kurtynę (po lewej stara mapa, po prawej dzisiejsza), w Warstwach jest suwak przezroczystości, „Dopasuj ponownie” i „Usuń”.

Skany są tylko w telefonie i nie wchodzą do kopii zapasowej. Mapster udostępnia je „do użytku niekomercyjnego”: nie wgrywaj ich do publicznego repozytorium.

Gotowe kafelki (z własnego skryptu) nadal można podpiąć w `historical` w `config.js` (typ `xyz`).

## Struktura

```
index.html  config.js  sw.js  manifest.webmanifest
css/app.css
js/app.js  store.js  geo.js  data.js  exporters.js  wmts2180.js  scanlayer.js
lib/leaflet/   (Leaflet 1.9.4, licencja BSD-2)
icons/
```

Źródła map: © OpenStreetMap contributors, © GUGiK (geoportal.gov.pl). OSM ma politykę użycia kafelków: do własnego użytku w porządku, nie do masowego pobierania.


## Nowości w 0.4.0 / 0.4.1

- **0.6.0**: miejsce zaczyna się od punktu (przytrzymaj mapę / prawy przycisk → „Dodaj miejsce tutaj”; to samo menu ma „Dodaj znalezisko tutaj”). Granica jednym dotknięciem = ekran. Zapis offline z wyborem zakresu (ekran / granica) i warstw (ortofotomapa, LiDAR); OSM wyłączony z pobierania zgodnie z polityką serwerów OSM.
- **0.6.1**: odchudzone menu w drzewko (zwijane sekcje): karta miejsca ma na górze nazwę, ołówek (edycja nazwy/statusu/priorytetu) i X, pod spodem podsumowanie znalezisk; granica, notatki, mapy, wyjścia, znaleziska i usuwanie są w swoich zwijanych sekcjach. Zapis offline: „Zakres” i „Co zapisać” rozwijane osobno. To samo w menu głównym (Dane, Ustawienia itd.).
- **0.6.2**: warstwy mapy w drzewku: podkłady z miniaturami, zwijane Dodatki i Mapy historyczne, sekcja „Widoczność” (znaleziska, trasy, miejsca, granica wybranego miejsca). Granica miejsca rysuje się tylko dla wybranego miejsca, reszta to sama pinezka. Poprawiony błąd „[object HTMLParagraphElement]” w karcie miejsca.
- **0.7.0**: podkłady zawsze widoczne (bez zwijania). Menu → „Szukaj miejsca” (nazwa miejscowości przez Nominatim albo współrzędne, te działają offline). Menu długiego dotknięcia ma „Nawiguj” i „Kopiuj”. Lista znalezisk z filtrem kategorii.
- **0.8.0**: lupka (szukanie) w lewym górnym rogu zamiast w menu; podkłady jako poziome wiersze z miniaturą z boku; menu prawego przycisku: Linijka (punkty celownikiem lub „Ja”, suma i azymut odcinka), Kompas (azymut i odległość do punktu, strzałka względem kierunku telefonu z czujnika), Nawiguj, Kopiuj. Przycisk Kompas jest też w karcie znaleziska.
- **0.5.0**: zakładka **Miejsca** (przycisk ze szpilką na mapie): granica rysowana punktami, status, priorytet, notatka z kontekstem historycznym, przypisane mapy historyczne i wyjścia (wyjście rozpoczęte w granicy przypisuje się samo). „Zapisz offline” upraszczone: obszar z ekranu albo granica miejsca, przybliżenia do 18, z szacunkiem MB. Miejsca są w kopii zapasowej.
- **0.4.4**: LiDAR także na ortofotomapie HR; w menu „Narzędzia testowe”: przykładowa wyprawa ([TEST]) i jej usuwanie.
- **0.4.3**: ortofotomapa HR przez WMTS (EPSG:2180, przeliczany jak LiDAR), usunięta wolna ortofotomapa WMS. HR nie ma wariantu z LiDAR-em. **0.4.2**: naprawa zawieszającej się kolejki kafelków.
- **0.4.1**: ortofotomapa przez WMTS (gotowe kafelki, szybciej); stara wersja WMS zostaje jako „zapasowa”.

- **Szybsza i pewniejsza mapa**: kafelki Geoportalu idą przez kolejkę (4 naraz) z ponawianiem po błędzie, a obejrzane kafelki zapisują się w telefonie (do ok. 4000), więc kolejne wejście na ten sam teren ładuje się od razu. Jakość ortofotomapy bez zmian.
- **Mapa offline** (Menu → Pobierz widoczny obszar): zapisuje kafelki aktualnych warstw dla wybranych przybliżeń. Wymaga zainstalowanej aplikacji (po drugim otwarciu). Jeśli serwer nie zezwala na zapis (CORS), aplikacja o tym poinformuje.
- **Pozycjonowanie skanu**: minimum 2 punkty.
- **Przypomnienie o kopii zapasowej** po 7 dniach (raz na dobę).
