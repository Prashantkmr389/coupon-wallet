/* Coupon Wallet service worker
   App-shell caching only. Coupon data lives in IndexedDB and is
   never cached here — bumping CACHE never touches user data. */

const CACHE = 'coupon-wallet-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './shared/expiry.mjs',
  './shared/savings.mjs',
  './shared/ics.mjs',
  './shared/coupon-parser.mjs'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cross-origin (e.g. Google Fonts): network first, fall back to cache.
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Same-origin: cache first, so the app opens instantly and offline.
  event.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

/* ---------------- Web Push Notifications ---------------- */

// Same UTC-safe day math as the app so counts agree everywhere.
function daysUntil(dateStr){
  var p=String(dateStr).split('-').map(Number);
  if(!p[0]) return -9999;
  var exp=Date.UTC(p[0],p[1]-1,p[2]);
  var n=new Date();
  var today=Date.UTC(n.getFullYear(),n.getMonth(),n.getDate());
  return Math.round((exp-today)/86400000);
}

// Server sends bare pushes (no encrypted payload); the real numbers come
// from the local mirror of the wallet, which the app keeps in sync.
function readCoupons(){
  return new Promise(function(resolve){
    if(!self.indexedDB){ resolve([]); return; }
    try{
      var req=indexedDB.open('coupon-wallet',1);
      req.onerror=function(){ resolve([]); };
      req.onsuccess=function(){
        var db=req.result;
        try{
          var r=db.transaction('coupons','readonly').objectStore('coupons').getAll();
          r.onerror=function(){ resolve([]); };
          r.onsuccess=function(){ resolve(r.result||[]); };
        }catch(e){ resolve([]); }
      };
    }catch(e){ resolve([]); }
  });
}

function buildReminderPayload(coupons){
  var spendable=coupons.filter(function(c){
    return c && c.expiry_date && !(c.used && !c.reusable);
  });
  var tomorrow=spendable.filter(function(c){ return daysUntil(c.expiry_date)===1; }).length;
  var week=spendable.filter(function(d){
    var x=daysUntil(d.expiry_date);
    return x>=0 && x<=7;
  }).length;

  if(tomorrow>0){
    return {
      title:'🎟 '+tomorrow+' coupon'+(tomorrow===1?'':'s')+' expire'+(tomorrow===1?'s':'')+' tomorrow!',
      body: week>tomorrow ? 'Plus '+(week-tomorrow)+' more this week. Open Coupon Wallet to copy a code before checkout.' :
                           'Open Coupon Wallet to copy a code before checkout.'
    };
  }
  if(week>0){
    return {
      title:'🎟 '+week+' coupon'+(week===1?'':'s')+' expiring this week',
      body:'Open Coupon Wallet to see which ones.'
    };
  }
  return { title:'Coupon Wallet Reminder', body:'You have a coupon expiring soon!' };
}

self.addEventListener('push', event => {
  event.waitUntil(
    Promise.resolve().then(function(){
      // Explicit payloads win when present; bare nudges get computed copy.
      if(event.data){
        try{
          var json=event.data.json();
          if(json && (json.title || json.body)){
            return { title:json.title||'Coupon Wallet Reminder', body:json.body||'' };
          }
          return { title:'Coupon Wallet Reminder', body:event.data.text() };
        }catch(e){
          return { title:'Coupon Wallet Reminder', body:event.data.text() };
        }
      }
      return readCoupons().then(buildReminderPayload);
    }).then(function(payload){
      var options={
        body:payload.body,
        icon:'./icon-192.png',
        badge:'./icon-192.png',
        data:payload.url||'./index.html'
      };
      return self.registration.showNotification(payload.title,options);
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const urlToOpen = event.notification.data || './index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});
