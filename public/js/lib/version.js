// js/lib/version.js
// ============================================================
// Sello de version. Sube este numero cada vez que hagas cambios
// para verificar (abajo a la derecha en la pantalla) que Vercel
// ya sirvio la version nueva y no una cacheada.
// ============================================================
export const APP_VERSION = 'v1.4.3';
export const APP_BUILD = '2026-08-20 · fix showModal hoisting'

function injectBadge() {
  if (document.getElementById('appVersionBadge')) return;
  const el = document.createElement('div');
  el.id = 'appVersionBadge';
  el.textContent = `${APP_VERSION}`;
  el.title = APP_BUILD;
  Object.assign(el.style, {
    position: 'fixed', bottom: '8px', right: '10px', zIndex: '9999',
    font: '600 11px system-ui, sans-serif', color: 'rgba(255,255,255,.55)',
    background: 'rgba(0,0,0,.35)', padding: '3px 8px', borderRadius: '8px',
    backdropFilter: 'blur(6px)', pointerEvents: 'none', letterSpacing: '.3px',
  });
  document.body.appendChild(el);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectBadge);
} else {
  injectBadge();
}
