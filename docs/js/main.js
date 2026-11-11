/* Insomniacs Bot — Website JS */

// ── Nav mobile toggle ──────────────────────────────────
const navToggle = document.querySelector('.nav-toggle');
const navLinks  = document.querySelector('.nav-links');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', navLinks.classList.contains('open'));
  });

  // Close menu when a link is clicked
  navLinks.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => navLinks.classList.remove('open'));
  });
}

// ── Clean URLs: /commands.html → /commands, /index.html → / ──
if (location.protocol.startsWith('http') && location.pathname.endsWith('.html')) {
  const clean = location.pathname.replace(/(index)?\.html$/, '');
  history.replaceState(null, '', clean + location.search + location.hash);
}

// ── Mark active nav link ───────────────────────────────
const pagePath = location.pathname.replace(/(index)?\.html$/, '').replace(/\/$/, '') || '/';
document.querySelectorAll('.nav-links a').forEach(link => {
  const href = (link.getAttribute('href') || '').replace(/\/$/, '') || '/';
  link.classList.toggle('active', href === pagePath);
});

// Commands page search/filter lives in commands.js

// ── Copy code blocks ────────────────────────────────────
document.querySelectorAll('pre').forEach(block => {
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.title = 'Copy';
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>`;

  block.style.position = 'relative';
  block.appendChild(btn);

  btn.addEventListener('click', async () => {
    const code = block.textContent.replace(/\n?$/, '');
    try {
      await navigator.clipboard.writeText(code);
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>`;
      btn.style.color = 'var(--green)';
      setTimeout(() => {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>`;
        btn.style.color = '';
      }, 2000);
    } catch {}
  });
});

/* inline style for copy buttons (added dynamically) */
const style = document.createElement('style');
style.textContent = `
  .copy-btn {
    position: absolute; top: 8px; right: 8px;
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: 6px; padding: 5px 7px;
    color: var(--muted); cursor: pointer;
    display: flex; align-items: center;
    opacity: 0; transition: opacity 0.15s, color 0.15s, background 0.15s;
  }
  pre:hover .copy-btn { opacity: 1; }
  .copy-btn:hover { color: var(--text); background: var(--surface); }
`;
document.head.appendChild(style);
