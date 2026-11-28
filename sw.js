// Firebase Cloud Messaging: notificações push em segundo plano.
importScripts('https://www.gstatic.com/firebasejs/13.4.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/13.4.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCTPsOy1bmd3ob3oYfEhKDJIa3ZS2I8as",
  authDomain: "radar-br-365.firebaseapp.com",
  projectId: "radar-br-365",
  storageBucket: "radar-br-365.firebasestorage.app",
  messagingSenderId: "779247236992",
  appId: "1:779247236992:web:cb745ebc4e14c075b8b365"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || '🚨 Novo acidente na BR-365';
  const options = {
    body: data.body || 'Um novo acidente foi registrado. Toque para conferir os detalhes.',
    icon: 'icones/icone-192.png',
    badge: 'icones/icone-192.png',
    tag: data.tag || ('radar-br365-' + (data.id || Date.now())),
    renotify: false,
    data: {
      url: data.url || 'https://www.movimentobr365.com.br/#painel',
      accidentId: data.id || ''
    }
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || 'https://www.movimentobr365.com.br/#painel';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        if ('navigate' in client) client.navigate(target);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
    return undefined;
  }));
});

// App do Movimento BR-365: guarda a página no celular para abrir mesmo sem internet.
// Página e dados: busca primeiro na internet (para ter o mais novo) e, sem rede, usa o guardado.
// Fotos, ícones e mapa: usa o guardado e atualiza por trás.
const CACHE = 'br365-v12';
const BASE = ['./', 'index.html', 'dados.js', 'manifest.webmanifest', 'push.js', 'icones/icone-192.png', 'icones/icone-512.png', 'fotos/perfil.jpg', 'fotos/marcao_povo.jpg'];

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
  const pagina = req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname) || url.pathname.endsWith('dados.js') || url.pathname.endsWith('push.js');
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
