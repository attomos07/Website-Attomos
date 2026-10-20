/* Attomos Academy — cursos de idiomas con videos de TikTok y YouTube (vanilla JS) */
(function () {
  'use strict';

  // =====================================================================
  // DATOS — agrega cursos y videos aquí.
  //   slug:        identificador en la URL (/academy/<slug>)
  //   image:       imagen de la tarjeta del curso
  //   fallbackImage: imagen alterna por si la principal no carga
  //   videos[].url:         link del video (TikTok o YouTube)
  //   videos[].title:       título que se muestra (si lo dejas vacío se intenta
  //                         tomar el de TikTok/YouTube)
  // =====================================================================
  const COURSES = [
    {
      slug: 'ruso',
      title: 'Ruso',
      nativeTitle: 'Русский язык',
      level: 'Principiante',
      image: '/static/img/academy/flag-ru.svg',
      fallbackImage: 'https://upload.wikimedia.org/wikipedia/commons/f/f3/Flag_of_Russia.svg',
      videos: [
        {
          url: 'https://www.tiktok.com/@sasharusssim/video/7685885478154882317',
          title: '',
        },
      ],
    },
    {
      slug: 'japones',
      title: 'Japonés',
      nativeTitle: '日本語',
      level: 'Principiante',
      image: '/static/img/academy/flag-jp.svg',
      fallbackImage: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9e/Flag_of_Japan.svg/1280px-Flag_of_Japan.svg.png',
      videos: [
        {
          url: 'https://www.youtube.com/watch?v=VOI5-AIxexI',
          title: '',
        },
      ],
    },
  ];

  const BASE_PATH = '/academy';

  const els = {
    coursesView: document.getElementById('coursesView'),
    courseView: document.getElementById('courseView'),
    courseGrid: document.getElementById('courseGrid'),
    videoGrid: document.getElementById('videoGrid'),
    backBtn: document.getElementById('backBtn'),
    compactBack: document.getElementById('compactBack'),
    compactTitle: document.getElementById('compactTitle'),
    headerImg: document.getElementById('courseHeaderImg'),
    eyebrow: document.getElementById('courseEyebrow'),
    title: document.getElementById('courseTitle'),
    meta: document.getElementById('courseMeta'),
  };

  const ICON_EXTERNAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';

  // ---------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Devuelve los datos para incrustar un video de TikTok o YouTube. */
  function parseVideo(url) {
    const str = String(url);
    const tt = str.match(/tiktok\.com\/@([^/?#]+)\/video\/(\d+)/);
    if (tt) {
      const cleanUrl = `https://www.tiktok.com/@${tt[1]}/video/${tt[2]}`;
      return {
        platform: 'tiktok',
        platformName: 'TikTok',
        id: tt[2],
        author: '@' + tt[1],
        cleanUrl,
        embedSrc: `https://www.tiktok.com/player/v1/${tt[2]}?description=0&music_info=0&rel=0&native_context_menu=0`,
        oembed: `https://www.tiktok.com/oembed?url=${encodeURIComponent(cleanUrl)}`,
      };
    }
    const yt = str.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    if (yt) {
      const cleanUrl = `https://www.youtube.com/watch?v=${yt[1]}`;
      return {
        platform: 'youtube',
        platformName: 'YouTube',
        id: yt[1],
        author: 'YouTube',
        cleanUrl,
        embedSrc: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0&modestbranding=1&playsinline=1`,
        oembed: `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`,
        landscape: !/shorts\//.test(str),
      };
    }
    return null;
  }

  function videoCount(n) {
    return `${n} ${n === 1 ? 'video' : 'videos'}`;
  }

  function withTransition(fn) {
    if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.startViewTransition(fn);
    } else {
      fn();
    }
  }

  // ---------------------------------------------------------------------
  // Vista 1: cursos
  // ---------------------------------------------------------------------

  function renderCourses() {
    els.courseGrid.innerHTML = COURSES.map((c, i) => `
      <button type="button" class="course-card" role="listitem" data-slug="${escapeHtml(c.slug)}" style="animation-delay:${i * 60}ms">
        <div class="course-media">
          <span class="course-badge glass">${escapeHtml(c.level)}</span>
          <img src="${escapeHtml(c.image)}" data-fallback="${escapeHtml(c.fallbackImage || '')}" alt="Bandera del curso de ${escapeHtml(c.title)}" loading="lazy">
        </div>
        <div class="course-body">
          <h2 class="course-name">${escapeHtml(c.title)}</h2>
          <p class="course-native">${escapeHtml(c.nativeTitle || '')}</p>
          <div class="course-foot">
            <span>${videoCount(c.videos.length)}</span>
            <span class="arrow" aria-hidden="true">›</span>
          </div>
        </div>
      </button>`).join('');
  }

  els.courseGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.course-card');
    if (card) navigate(card.dataset.slug);
  });

  // ---------------------------------------------------------------------
  // Vista 2: videos de un curso
  // ---------------------------------------------------------------------

  function renderCourse(course) {
    els.headerImg.dataset.fallback = course.fallbackImage || '';
    els.headerImg.src = course.image;
    els.headerImg.alt = `Bandera del curso de ${course.title}`;
    els.eyebrow.textContent = course.nativeTitle || 'Curso';
    els.title.textContent = course.title;
    els.meta.textContent = `${course.level} · ${videoCount(course.videos.length)}`;
    els.compactTitle.textContent = course.title;
    document.title = `${course.title} — Attomos Academy`;

    if (!course.videos.length) {
      els.videoGrid.innerHTML = '<div class="empty-state">Pronto agregaremos videos a este curso.</div>';
      return;
    }

    els.videoGrid.innerHTML = course.videos.map((v, i) => {
      const tt = parseVideo(v.url);
      if (!tt) return '';
      const title = v.title || `Lección ${i + 1}`;
      return `
        <article class="video-card" style="animation-delay:${i * 60}ms">
          <div class="video-frame${tt.landscape ? ' is-landscape' : ''}">
            <iframe
              src="${escapeHtml(tt.embedSrc)}"
              title="${escapeHtml(title)}"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowfullscreen></iframe>
          </div>
          <div class="video-body">
            <span class="video-num">Lección ${i + 1}</span>
            <h3 class="video-title" data-video-title="${tt.id}" data-has-title="${v.title ? '1' : '0'}">${escapeHtml(title)}</h3>
            <p class="video-author" data-video-author="${tt.id}">${escapeHtml(tt.author)}</p>
            <div class="video-actions">
              <a class="btn btn-secondary" href="${escapeHtml(tt.cleanUrl)}" target="_blank" rel="noopener noreferrer">${ICON_EXTERNAL}Ver en ${tt.platformName}</a>
            </div>
          </div>
        </article>`;
    }).join('');

    fillTitlesFromTikTok(course);
  }

  /** Completa título (si no tiene) y autor desde el oEmbed de TikTok/YouTube. */
  function fillTitlesFromTikTok(course) {
    course.videos.forEach((v) => {
      const tt = parseVideo(v.url);
      if (!tt) return;
      fetch(tt.oembed)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          if (!v.title && data.title) {
            const clean = data.title.replace(/\s*#\S+/g, '').trim();
            if (clean) {
              v.title = clean.length > 90 ? clean.slice(0, 87) + '…' : clean;
              const el = els.videoGrid.querySelector(`[data-video-title="${tt.id}"]`);
              if (el) el.textContent = v.title;
            }
          }
          if (tt.platform === 'youtube' && data.author_name) {
            const el = els.videoGrid.querySelector(`[data-video-author="${tt.id}"]`);
            if (el) el.textContent = data.author_name;
          }
        })
        .catch(() => { /* sin oEmbed: se queda "Lección N" */ });
    });
  }

  // ---------------------------------------------------------------------
  // Navegación (/academy y /academy/<slug>)
  // ---------------------------------------------------------------------

  function slugFromPath() {
    const rest = location.pathname.replace(/\/+$/, '').slice(BASE_PATH.length).replace(/^\//, '');
    return rest ? decodeURIComponent(rest.split('/')[0]) : '';
  }

  function show(slug) {
    const course = COURSES.find((c) => c.slug === slug);
    if (course) {
      renderCourse(course);
      els.coursesView.hidden = true;
      els.courseView.hidden = false;
      els.compactBack.hidden = false;
    } else {
      els.courseView.hidden = true;
      els.coursesView.hidden = false;
      els.compactBack.hidden = true;
      els.compactTitle.textContent = 'Attomos Academy';
      document.title = 'Attomos Academy';
      els.videoGrid.innerHTML = ''; // detiene la reproducción de los videos
    }
    window.scrollTo(0, 0);
    onScroll();
  }

  function navigate(slug) {
    const url = slug ? `${BASE_PATH}/${encodeURIComponent(slug)}` : BASE_PATH;
    if (location.pathname !== url) history.pushState({ slug }, '', url);
    withTransition(() => show(slug));
  }

  function goBack() {
    if (history.state && history.state.slug) history.back();
    else navigate('');
  }

  els.backBtn.addEventListener('click', goBack);
  els.compactBack.addEventListener('click', goBack);
  window.addEventListener('popstate', () => withTransition(() => show(slugFromPath())));

  // ---------------------------------------------------------------------
  // Scroll: colapso del título grande
  // ---------------------------------------------------------------------

  let ticking = false;

  function onScroll() {
    const p = Math.min(Math.max((window.scrollY - 8) / 80, 0), 1);
    document.documentElement.style.setProperty('--p', p.toFixed(3));
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onScroll);
    }
  }, { passive: true });

  // Si una portada no carga, usa la imagen alterna
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.dataset.fallback || img.dataset.usedFallback) return;
    img.dataset.usedFallback = '1';
    img.src = img.dataset.fallback;
  }, true);

  // ---------------------------------------------------------------------
  renderCourses();
  show(slugFromPath());
})();
/* Capa iOS 27: las tarjetas de curso se inclinan siguiendo el cursor */
(function () {
  'use strict';
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduce) return;
  const grid = document.getElementById('courseGrid');
  if (!grid) return;
  grid.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.course-card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    card.classList.add('is-tilting');
    card.style.setProperty('--ry', (px * 8).toFixed(2) + 'deg');
    card.style.setProperty('--rx', (-py * 7).toFixed(2) + 'deg');
  });
  grid.addEventListener('pointerout', (e) => {
    const card = e.target.closest('.course-card');
    if (!card || card.contains(e.relatedTarget)) return;
    card.classList.remove('is-tilting');
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  });
})();

/* Capa iOS 27: ondita al tocar "Cursos" y "Ver en YouTube / TikTok" */
(function () {
  'use strict';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.back-btn, .video-actions .btn');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const dot = document.createElement('span');
    dot.className = 'ios-ripple';
    dot.style.left = (e.clientX - r.left) + 'px';
    dot.style.top = (e.clientY - r.top) + 'px';
    btn.appendChild(dot);
    dot.addEventListener('animationend', () => dot.remove(), { once: true });
  });
})();