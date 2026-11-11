const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

/* ---------------- Works data ---------------- */
// [category, image, title, layout]
const projects = [
  ['3d', 'assets/img/interior.jpg', 'Interior Visualization', 'wide'],
  ['3d', 'assets/img/wine-glass.jpg', 'Wine Glass Render', ''],
  ['graphic', 'assets/img/movie-poster.jpg', 'Movie Poster', 'tall'],
  ['3d', 'assets/img/bedroom.jpg', 'Bedroom Design', 'wide'],
  ['graphic', 'assets/img/timeless-auto.jpg', 'Timeless Auto', ''],
  ['graphic', 'assets/img/auto-brochure.jpg', 'Automotive Brochure', ''],
  ['ui', 'assets/img/ui-login.jpg', 'Login UI', 'tall'],
  ['ui', 'assets/img/ui-dashboard.jpg', 'Dashboard UI', 'tall'],
  ['ui', 'assets/img/ui-mobile.jpg', 'Mobile Interface', 'tall'],
];
const LABEL = { '3d': '3D Render', graphic: 'Graphic Design', ui: 'UI / UX' };

$('#portfolio').innerHTML = projects.map(([type, img, title, layout], i) => `
  <article class="card ${type} ${layout} reveal" tabindex="0" data-index="${i}" aria-label="Open ${title}">
    <img src="${img}" alt="${title}" loading="lazy">
    <div class="card-meta">
      <div><span>${LABEL[type]}</span><h3>${title}</h3></div>
      <i class="arrow" aria-hidden="true">&rarr;</i>
    </div>
  </article>`).join('');

/* ---------------- Loader ---------------- */
window.addEventListener('load', () => setTimeout(() => $('#loader').classList.add('hide'), 500));
$('#year').textContent = new Date().getFullYear();

/* ---------------- Cursor ---------------- */
const cursor = $('.cursor');
document.addEventListener('mousemove', e => {
  cursor.classList.add('on');
  cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%,-50%)`;
});
document.addEventListener('mouseleave', () => cursor.classList.remove('on'));
document.addEventListener('mouseover', e => {
  cursor.classList.toggle('big', !!e.target.closest('a, button, .card'));
  // hide the custom cursor inside the 3D viewport (Blender feel)
  cursor.style.opacity = e.target.closest('.v-viewport') ? '0' : '';
});

/* ---------------- Nav ---------------- */
const nav = $('.nav'), toggle = $('.nav-toggle'), menu = $('.nav nav');
toggle.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', open);
  menu.classList.toggle('open', open);
});
menu.addEventListener('click', e => {
  if (e.target.tagName === 'A') { toggle.setAttribute('aria-expanded', false); menu.classList.remove('open'); }
});

const sections = [...$$('main section[id]')];
const onScroll = () => {
  const h = document.documentElement;
  $('#progress').style.width = (h.scrollTop / (h.scrollHeight - h.clientHeight) * 100) + '%';
  nav.classList.toggle('scrolled', scrollY > 30);
  let current = '';
  sections.forEach(sec => { if (scrollY >= sec.offsetTop - 200) current = sec.id; });
  $$('.nav nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + current));
};
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------------- Filters ---------------- */
$$('.filter').forEach(btn => btn.addEventListener('click', () => {
  $$('.filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const f = btn.dataset.filter;
  $$('#portfolio .card').forEach(card =>
    card.classList.toggle('hide', !(f === 'all' || card.classList.contains(f))));
}));

/* ---------------- Lightbox ---------------- */
const modal = $('#modal');
let current = 0;
const visibleIdx = () => [...$$('#portfolio .card:not(.hide)')].map(c => +c.dataset.index);
const show = i => {
  current = i;
  const [type, img, title] = projects[i];
  $('#modal-img').src = img;
  $('#modal-img').alt = title;
  $('#modal-title').textContent = title;
  $('#modal-tag').textContent = LABEL[type];
};
const step = d => {
  const list = visibleIdx(), pos = list.indexOf(current);
  show(list[(pos + d + list.length) % list.length]);
};
const openModal = i => { show(i); modal.classList.add('open'); document.body.style.overflow = 'hidden'; $('#close').focus(); };
const closeModal = () => { modal.classList.remove('open'); document.body.style.overflow = ''; };

$('#portfolio').addEventListener('click', e => {
  const card = e.target.closest('.card');
  if (card) openModal(+card.dataset.index);
});
$('#portfolio').addEventListener('keydown', e => {
  const card = e.target.closest('.card');
  if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openModal(+card.dataset.index); }
});
$('#close').onclick = closeModal;
$('.m-prev').onclick = () => step(-1);
$('.m-next').onclick = () => step(1);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => {
  if (!modal.classList.contains('open')) return;
  if (e.key === 'Escape') closeModal();
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
});

/* ---------------- Reveal on scroll ---------------- */
$$('.section-head, .hero-text, .hero-frame, .about-copy, .stats, .skills li, #contact h2, .contact-links, .viewer')
  .forEach(el => el.classList.add('reveal'));
const io = new IntersectionObserver(entries => entries.forEach(en => {
  if (en.isIntersecting) { en.target.classList.add('show'); io.unobserve(en.target); }
}), { threshold: .08 });
$$('.reveal').forEach(el => {
  // anything already on screen at load shows right away
  if (el.getBoundingClientRect().top < innerHeight) el.classList.add('show');
  else io.observe(el);
});

/* ---------------- Counters ---------------- */
const counterIO = new IntersectionObserver(entries => entries.forEach(en => {
  if (!en.isIntersecting) return;
  counterIO.unobserve(en.target);
  const el = en.target, target = +el.dataset.target, t0 = performance.now(), dur = 1400;
  const tick = now => {
    const p = Math.min(1, (now - t0) / dur), eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), { threshold: .6 });
$$('.counter').forEach(c => counterIO.observe(c));
