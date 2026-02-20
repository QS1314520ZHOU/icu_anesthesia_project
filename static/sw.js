// Service Worker for ICU 项目管理 PWA
const CACHE_NAME = 'icu-pm-v2-rescue';
const STATIC_ASSETS = [
    '/',
    '/api/force_static/style.css',
    '/api/force_static/js/main.js',
    '/api/force_static/js/api.js',
    '/api/force_static/manifest.json'
];

// 安装 - 缓存静态资源
self.addEventListener('install', event => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// 激活 - 清理旧缓存
self.addEventListener('activate', event => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// 请求拦截 - 网络优先策略
self.addEventListener('fetch', event => {
    // 跳过非 GET 请求
    if (event.request.method !== 'GET') {
        return;
    }

    // API 请求 - 网络优先
    if (event.request.url.includes('/api/')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // 缓存成功的响应
                    if (response.status === 200) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // 网络失败时返回缓存
                    return caches.match(event.request);
                })
        );
        return;
    }

    // 静态资源 - 缓存优先
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    // 后台更新缓存
                    fetch(event.request).then(response => {
                        if (response.status === 200) {
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(event.request, response);
                            });
                        }
                    }).catch(() => { });
                    return cachedResponse;
                }
                return fetch(event.request);
            })
    );
});

// 推送通知处理
self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'ICU 项目管理';
    const options = {
        body: data.body || '您有新的通知',
        icon: '/static/icons/icon-192.png',
        badge: '/static/icons/badge-72.png',
        tag: data.tag || 'default',
        data: data.data || {}
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// 通知点击处理
self.addEventListener('notificationclick', event => {
    event.notification.close();

    const url = event.notification.data.url || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(clientList => {
            // 如果已有窗口打开，聚焦它
            for (const client of clientList) {
                if (client.url === url && 'focus' in client) {
                    return client.focus();
                }
            }
            // 否则打开新窗口
            if (clients.openWindow) {
                return clients.openWindow(url);
            }
        })
    );
});

console.log('[SW] Service Worker loaded');
