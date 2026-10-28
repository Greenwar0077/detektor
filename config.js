// Konfiguracja warstw mapy. Ten plik możesz edytować (np. dodać własne mapy historyczne).
//
// Typy warstw:
//   'xyz'   – kafelki z szablonem adresu {z}/{x}/{y}
//   'wms'   – usługa WMS (np. Geoportal)
//   'image' – pojedynczy obraz z podanymi granicami [[południe, zachód], [północ, wschód]]
//
// Adresy usług Geoportalu pochodzą ze stron geoportal.gov.pl (ortofotomapa, NMT).
// Nazwa warstwy 'Raster' dla ortofotomapy jest do potwierdzenia w GetCapabilities usługi.
// Jeśli któraś warstwa się nie ładuje, aplikacja pokaże ostrzeżenie, a licznik błędów
// zobaczysz w menu: Dane → Diagnostyka warstw.

export const CONFIG = {
  // Widok startowy (gdy nie ma jeszcze zapisanego): środek Polski.
  start: { lat: 52.1, lng: 19.4, zoom: 6 },
  maxZoom: 20,

  // Podkłady widoczne w oknie Warstwy. Cieniowanie LiDAR (nmt-base) jest też nakładane
  // na pozostałe podkłady przełącznikiem „LiDAR”.
  base: [
    {
      id: 'osm',
      name: 'Mapa (OpenStreetMap)',
      type: 'xyz',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxNativeZoom: 19,
      attribution: '© OpenStreetMap'
    },
    {
      id: 'orto',
      name: 'Ortofotomapa',
      // WMTS: gotowe kafelki 256 px w EPSG:3857 (potwierdzone w GetCapabilities), dużo szybsze niż WMS GetMap.
      type: 'xyz',
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?service=WMTS&request=GetTile&version=1.0.0&layer=ORTOFOTOMAPA&style=default&format=image/jpeg&tilematrixset=EPSG:3857&tilematrix=EPSG:3857:{z}&tilerow={y}&tilecol={x}',
      maxNativeZoom: 19,
      attribution: '© GUGiK (geoportal.gov.pl)'
    },
    {
      id: 'orto-hr',
      name: 'Ortofotomapa HR (wysoka rozdzielczość, nie wszędzie)',
      // WMTS tylko w EPSG:2180 (kafelki 512 px), przeliczany na mapę internetową jak LiDAR.
      type: 'wmts2180',
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/HighResolution',
      layer: 'ORTOFOTOMAPA',
      profile: 'hr',
      format: 'image/jpeg',
      maxNativeZoom: 19,
      attribution: '© GUGiK (geoportal.gov.pl)'
    },
    {
      id: 'nmt-base',
      name: 'Sam LiDAR (cieniowanie terenu)',
      type: 'wmts2180',
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WMTS/ShadedRelief',
      layer: 'ISOK_Cien',
      format: 'image/jpeg',
      minZoom: 9,
      maxNativeZoom: 19,
      attribution: '© GUGiK (geoportal.gov.pl)'
    }
  ],

  // Nazwy i adresy: włączane jednym przełącznikiem w oknie Warstwy (wszystkie wpisy naraz).
  // Nazwy warstw i obsługa EPSG:3857 potwierdzone w GetCapabilities obu usług.
  overlays: [
    {
      id: 'nazwy-prng',
      name: 'Nazwy: miejscowości i obiekty (PRNG GUGiK)',
      type: 'wms',
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGiK/PRNG/WMS/GeographicalNames',
      layers:
        'M1_UrzedoweNazwyMiejscowosci,M2_PozostaleNazwyMiejscowosci,O1_UrzedoweNazwyObiektowFizjograficznych,O2_ZestandaryzowaneNazwyObiektowFizjograficznych',
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      minZoom: 11,
      attribution: '© GUGiK (PRNG)'
    },
    {
      id: 'adresy-kina',
      name: 'Ulice i numery domów (KINA GUGiK)',
      type: 'wms',
      url: 'https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaNumeracjiAdresowej',
      layers: 'A08_Ulice_Linie,A07_Punkty_adresowe', // punkty adresowe widać od skali 1:5000
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      minZoom: 15,
      attribution: '© GUGiK (PRG)'
    }
  ],

  // Mapy historyczne (po georeferencji, patrz README). Przykład do odkomentowania:
  historical: [
    // {
    //   id: 'wig-goniadz-1930',
    //   name: 'WIG 1:100 000 Goniądz (1930)',
    //   type: 'xyz',
    //   url: 'tiles/wig-goniadz-1930/{z}/{x}/{y}.png',
    //   minZoom: 8,
    //   maxNativeZoom: 15,
    //   tms: false,
    //   opacity: 0.8,
    //   attribution: 'WIG, Polona'
    // }
  ]
};
