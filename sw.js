// App do Movimento BR-365: guarda a página no celular para abrir mesmo sem internet.
// Página e dados: busca primeiro na internet (para ter o mais novo) e, sem rede, usa o guardado.
// Fotos, ícones e mapa: usa o guardado e atualiza por trás.
const CACHE = 'br365-v4';
const BASE = ['./', 'index.html', 'dados.js', 'manifest.webmanifest', 'icones/icone-192.png', 'icones/icone-512.png', 'fotos/perfil.jpg', 'fotos/marcao_povo.jpg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.includes('overpass')) return; // desenho da estrada: só com internet
  const pagina = req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname) || url.pathname.endsWith('dados.js');
  if (pagina) {
    e.respondWith(fetch(req).then(r => {
      const copia = r.clone();
      caches.open(CACHE).then(c => c.put(url.pathname.endsWith('dados.js') ? 'dados.js' : req, copia));
      return r;
    }).catch(() => caches.match(url.pathname.endsWith('dados.js') ? 'dados.js' : req).then(r => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then(guardado => {
    const rede = fetch(req).then(r => {
      if (r.ok || r.type === 'opaque') { const copia = r.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
      return r;
    }).catch(() => guardado);
    return guardado || rede;
  }));
});
