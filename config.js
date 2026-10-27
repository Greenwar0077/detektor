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
      type: 'wms',
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution',
      layers: 'Raster',
      format: 'image/jpeg',
      attribution: '© GUGiK (geoportal.gov.pl)'
    },
    {
      id: 'orto-hr',
      name: 'Ortofotomapa HR (wysoka rozdzielczość, nie wszędzie)',
      type: 'wms',
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution',
      layers: 'Raster',
      format: 'image/jpeg',
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

  // Nazwy i adresy: włączane jednym przełącznikiem „Nazwy” (wszystkie wpisy naraz).
  overlays: [
    {
      id: 'nazwy-emuia',
      name: 'Nazwy: miejscowości, ulice, place (EMUiA GUGiK)',
      type: 'wms',
      url: 'https://emuia.gugik.gov.pl/wmsproxy/emuia/wms',
      layers: 'emuia:layer_miejscowosci_labels,emuia:layer_ulice_labels,emuia:layer_place_labels',
      format: 'image/png',
      transparent: true,
      version: '1.1.1',
      attribution: '© GUGiK (EMUiA)'
    },
    {
      id: 'adresy-kina',
      name: 'Adresy: numery domów i ulice (Geoportal)',
      type: 'wms',
      url: 'https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaNumeracjiAdresowej',
      layers: 'prg-ulice,prg-adresy',
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
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
