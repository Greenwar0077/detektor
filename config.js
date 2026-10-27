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
      name: 'Ortofotomapa (Geoportal)',
      type: 'wms',
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution',
      layers: 'Raster',
      format: 'image/jpeg',
      attribution: '© GUGiK (geoportal.gov.pl)'
    },
    {
      id: 'orto-hr',
      name: 'Ortofotomapa HR (Geoportal, tylko część kraju, często jak standardowa)',
      type: 'wms',
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution',
      layers: 'Raster',
      format: 'image/jpeg',
      attribution: '© GUGiK (geoportal.gov.pl)'
    }
    ,{
      id: 'nmt-base',
      name: 'NMT: cieniowanie terenu jako podkład (LiDAR)',
      type: 'wms',
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WMS/ShadedRelief',
      layers: 'Raster',
      format: 'image/jpeg',
      version: '1.3.0',
      crs: '4326',
      attribution: '© GUGiK (geoportal.gov.pl)'
    }
  ],

  overlays: [
    {
      id: 'nmt',
      name: 'NMT: cieniowanie terenu (LiDAR)',
      type: 'wms',
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WMS/ShadedRelief',
      layers: 'Raster',
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      crs: '4326', // ta usługa nie obsługuje EPSG:3857 (potwierdzone w GetCapabilities)
      opacity: 0.75,
      attribution: '© GUGiK (geoportal.gov.pl)'
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
