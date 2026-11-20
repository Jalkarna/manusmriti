/* The listening score: one chapter at a time, verse-synced to its track. */
(function () {
  const $ = (id) => document.getElementById(id);
  const audio = $('audio');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const two = (n) => String(n).padStart(2, '0');
  const devaDigits = (n, w = 2) => String(n).replace(/\d/g, (d) => '०१२३४५६७८९'[+d]).padStart(w, '०');
  const clock = (s) => (!Number.isFinite(s) || s < 0 ? '0:00' : Math.floor(s / 60) + ':' + two(Math.floor(s % 60)));

  const state = { chapters: [], ch: null, cues: [], lines: new Map(), active: null, singing: null, follow: false, followOffAt: 0, serial: 0 };

  const barRef = $('barRef');
  const bar = document.querySelector('.bar');
  const transport = $('transport');
  const playBtn = $('play');
  const playIcon = $('playIcon');
  const rail = $('rail');
  const fill = $('fill');
  const knob = $('knob');
  const timeEl = $('time');
  const rateSel = $('rate');
  const tpVoice = $('tpVoice');

  /* ── reveal ─────────────────────────────────────────── */
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  const watchReveals = () => document.querySelectorAll('.rv:not(.in)').forEach((el) => io.observe(el));

  /* ── chapter list ───────────────────────────────────── */
  const spine = $('spine');
  function renderSpine() {
    spine.replaceChildren(...state.chapters.map((ch) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.n = ch.n;
      b.innerHTML = '<span class="nu" lang="sa"></span><span class="ct"></span>';
      b.querySelector('.nu').textContent = devaDigits(ch.n);
      b.querySelector('.ct').textContent = ch.audio
        ? (ch.recorded === ch.verses ? 'HEARD' : ch.recorded + '/' + ch.verses)
        : ch.verses + ' ŚL';
      b.setAttribute('aria-label', 'Adhyāya ' + ch.n + ', ' + ch.verses + ' ślokas' + (ch.audio ? ', recording available' : ', text only'));
      b.onclick = () => loadChapter(ch.n, true);
      li.append(b);
      return li;
    }));
  }

  function markSpine(n) {
    for (const b of spine.querySelectorAll('button')) b.setAttribute('aria-current', String(+b.dataset.n === n));
  }

  /* ── verse stream ───────────────────────────────────── */
  function wordSpans(line, text) {
    const words = text.split(/\s+/).filter(Boolean);
    const total = words.reduce((a, w) => a + w.length, 0) || 1;
    let run = 0;
    for (const w of words) {
      const span = document.createElement('span');
      span.className = 'w';
      span.textContent = w;
      span.dataset.from = (run / total).toFixed(4);
      span.dataset.to = ((run + w.length) / total).toFixed(4);
      run += w.length;
      line.append(span);
      line.append(document.createTextNode(' '));
    }
  }

  function renderChapter(data, meta) {
    state.lines.clear();
    const frag = document.createDocumentFragment();
    const cuesByVerse = new Map();
    for (const cue of state.cues) {
      if (!cuesByVerse.has(cue.verse)) cuesByVerse.set(cue.verse, []);
      cuesByVerse.get(cue.verse).push(cue);
    }
    for (const row of data.verses) {
      const art = document.createElement('article');
      art.className = 'sloka';
      art.id = 'v' + row.v;
      art.setAttribute('role', 'listitem');
      art.dataset.verse = row.v;
      const heard = cuesByVerse.has(row.v);
      art.dataset.audio = String(heard);
      if (!heard) art.tabIndex = -1;
      const ref = document.createElement('span');
      ref.className = 'sloka-ref';
      ref.textContent = devaDigits(data.n) + '.' + devaDigits(row.v, 3);
      const body = document.createElement('div');
      body.className = 'sloka-body';
      row.sa.forEach((text, i) => {
        const p = document.createElement('p');
        p.className = 'line';
        p.lang = 'sa';
        wordSpans(p, text);
        const d = document.createElement('span');
        d.className = 'danda';
        d.textContent = i === row.sa.length - 1 ? '॥' : '।';
        p.append(d);
        state.lines.set(row.v + '-' + i, p);
        body.append(p);
        const r = document.createElement('p');
        r.className = 'iast';
        r.lang = 'sa-Latn';
        r.textContent = row.iast[i];
        body.append(r);
      });
      art.append(ref, body);
      art.onclick = () => seekVerse(row.v, heard);
      frag.append(art);
    }
    const stream = $('stream');
    stream.replaceChildren(frag);
    stream.dataset.swap = 'false';
    if (!reduced) {
      for (const [i, art] of [...stream.children].entries()) art.style.setProperty('--i', Math.min(i, 14));
      stream.dataset.swap = 'true';
    }

    $('chNum').textContent = devaDigits(data.n);
    $('chName').textContent = 'Adhyāya ' + ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][data.n - 1];
    const mins = meta && meta.duration ? Math.round(meta.duration / 60) : null;
    const recorded = state.cues.length ? new Set(state.cues.map((c) => c.verse)).size : 0;
    $('chMeta').textContent = [
      data.verses.length + ' ślokas',
      mins ? mins + ' min of audio' : null,
      recorded ? (recorded === data.verses.length ? 'complete recording' : recorded + ' of ' + data.verses.length + ' recorded') : 'text only'
    ].filter(Boolean).join(' · ');

    const links = $('chLinks');
    links.replaceChildren();
    if (meta && meta.film) {
      const a = document.createElement('a');
      a.href = meta.film;
      a.textContent = 'Chapter film ↗';
      a.target = '_blank';
      a.rel = 'noopener';
      links.append(a);
    }
    if (meta && meta.cues) {
      const a = document.createElement('a');
      a.href = meta.cues;
      a.textContent = 'Timing manifest ↗';
      a.target = '_blank';
      a.rel = 'noopener';
      links.append(a);
    }
    watchReveals();
  }

  /* ── transport ──────────────────────────────────────── */
  function buildTicks(meta) {
    const box = $('ticks');
    box.replaceChildren();
    if (!meta || !meta.duration || !state.cues.length) return;
    const step = state.cues.length > 90 ? 4 : 1;
    const frag = document.createDocumentFragment();
    state.cues.forEach((cue, i) => {
      if (i % step) return;
      const t = document.createElement('i');
      t.style.left = (cue.start / meta.duration * 100).toFixed(3) + '%';
      t.dataset.on = String(cue.line === 0);
      frag.append(t);
    });
    box.append(frag);
  }

  function paintTransport() {
    const d = Number.isFinite(audio.duration) ? audio.duration : 0;
    const frac = d ? audio.currentTime / d : 0;
    fill.style.width = (frac * 100).toFixed(3) + '%';
    knob.style.left = (frac * 100).toFixed(3) + '%';
    timeEl.textContent = clock(audio.currentTime) + ' / ' + clock(d);
    rail.setAttribute('aria-valuenow', Math.round(frac * 100));
    rail.setAttribute('aria-valuetext', clock(audio.currentTime) + ' of ' + clock(d));
    const playing = !audio.paused && !audio.ended;
    playIcon.setAttribute('d', playing ? 'M7 4h3.6v16H7zm6.4 0H17v16h-3.6z' : 'M8 5.5v13L19 12z');
    playBtn.setAttribute('aria-label', playing ? 'Pause recitation' : 'Play recitation');
    transport.dataset.state = playing ? 'playing' : 'idle';
    if (window.Lattice) window.Lattice.setPlaying(playing);
  }

  function setActive(verse, line, t) {
    const art = document.getElementById('v' + verse);
    if (!art) return;
    if (state.active !== art) {
      state.active && state.active.classList.remove('active');
      art.classList.add('active');
      state.active = art;
      barRef.textContent = 'ADHYĀYA ' + devaDigits(state.ch.n) + ' · ŚLOKA ' + devaDigits(verse, 3);
      barRef.dataset.live = 'true';
      if (state.follow && state.scrollFollow && art.dataset.audio === 'true') {
        const box = art.getBoundingClientRect();
        const vh = innerHeight;
        if (box.top < vh * 0.25 || box.bottom > vh * 0.78) {
          art.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
        }
      }
    }
    const key = verse + '-' + line;
    const current = state.lines.get(key) || null;
    if (current !== state.singing) {
      if (state.singing) for (const w of state.singing.querySelectorAll('.w.lit')) w.classList.remove('lit');
      state.singing = current;
    }
    if (current && t !== undefined) {
      const cue = state.cues.find((c) => c.verse === verse && c.line === line);
      const p = cue && cue.end > cue.start ? Math.min(1, Math.max(0, (t - cue.start) / (cue.end - cue.start))) : 1;
      for (const w of current.querySelectorAll('.w')) {
        const on = p >= +w.dataset.from + 0.0001;
        if (on !== w.classList.contains('lit')) w.classList.toggle('lit', on);
      }
    }
  }

  function clearSinging() {
    if (state.singing) for (const w of state.singing.querySelectorAll('.w.lit')) w.classList.remove('lit');
    state.singing = null;
  }

  function sync() {
    paintTransport();
    if (!state.cues.length) return;
    const t = audio.currentTime;
    const cue = state.cues.find((c) => c.start <= t && t < c.end);
    if (cue) setActive(cue.verse, cue.line, t);
    else if (state.active) {
      const prev = state.cues.find((c) => c.end <= t);
      if (prev) { setActive(prev.verse, prev.line, prev.end); clearSinging(); }
    }
  }

  function updateLevel() {
    if (!window.Lattice) return;
    const t = audio.currentTime;
    const cue = state.cues.find((c) => c.start <= t && t < c.end);
    window.Lattice.setLevel(cue ? 1 : 0.22);
  }

  /* ── audio wiring ───────────────────────────────────── */
  for (const ev of ['timeupdate', 'seeked', 'durationchange']) audio.addEventListener(ev, sync);
  for (const ev of ['loadedmetadata', 'play', 'pause', 'ended']) audio.addEventListener(ev, paintTransport);
  audio.addEventListener('loadedmetadata', () => { audio.playbackRate = +rateSel.value; });
  audio.addEventListener('play', () => { state.scrollFollow = true; });
  audio.addEventListener('error', () => {
    if (audio.getAttribute('src')) tpVoice.textContent = 'TRACK UNAVAILABLE';
  });
  playBtn.onclick = async () => {
    if (audio.paused) {
      try { await audio.play(); } catch (e) { if (e.name !== 'AbortError') tpVoice.textContent = 'PLAYBACK BLOCKED'; }
    } else audio.pause();
  };
  rateSel.onchange = () => { audio.playbackRate = +rateSel.value; };
  let dragging = false;
  const seekTo = (e) => {
    const box = rail.getBoundingClientRect();
    if (!Number.isFinite(audio.duration)) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    audio.currentTime = frac * audio.duration;
    sync();
  };
  rail.addEventListener('pointerdown', (e) => { dragging = true; rail.setPointerCapture(e.pointerId); seekTo(e); });
  rail.addEventListener('pointermove', (e) => { if (dragging) seekTo(e); });
  rail.addEventListener('pointerup', () => { dragging = false; });
  rail.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + (e.key === 'ArrowRight' ? 5 : -5)));
    }
  });

  function seekVerse(verse, heard) {
    state.scrollFollow = true;
    if (!heard) {
      state.follow = false;
      const art = document.getElementById('v' + verse);
      if (art) { state.active && state.active.classList.remove('active'); art.classList.add('active'); state.active = art; barRef.textContent = 'ADHYĀYA ' + devaDigits(state.ch.n) + ' · ŚLOKA ' + devaDigits(verse, 3); }
      return;
    }
    const cue = state.cues.find((c) => c.verse === verse);
    if (cue) {
      audio.currentTime = cue.start;
      state.follow = true;
      if (audio.paused) audio.play().catch(() => {});
      sync();
    }
  }

  /* ── chapter loading ────────────────────────────────── */
  async function json(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('Could not load ' + url);
    return r.json();
  }

  async function loadChapter(n, scroll) {
    const version = ++state.serial;
    const meta = state.chapters.find((c) => c.n === n);
    state.ch = null; state.cues = [];
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    tpVoice.textContent = 'LOADING';
    $('stream').replaceChildren();
    const data = await json('data/ch/' + two(n) + '.json').catch((e) => e);
    if (version !== state.serial) return;
    if (data instanceof Error) { barRef.textContent = 'CHAPTER UNAVAILABLE'; return; }
    if (meta && meta.cues) {
      const cues = await json(meta.cues).catch(() => []);
      if (version !== state.serial) return;
      state.cues = cues;
    }
    state.ch = data;
    renderChapter(data, meta);
    buildTicks(meta);
    markSpine(n);
    if (meta && meta.audio && state.cues.length) {
      audio.src = meta.audio;
      audio.load();
      tpVoice.textContent = 'VĀGDHENU · SYNTHETIC';
      tpVoice.dataset.off = 'false';
      playBtn.disabled = false;
    } else {
      tpVoice.textContent = 'TEXT ONLY';
      tpVoice.dataset.off = 'true';
      playBtn.disabled = true;
    }
    paintTransport();
    const first = state.cues.length ? state.cues[0] : null;
    if (first) setActive(first.verse, first.line, first.start);
    else if (data.verses.length) {
      const art = document.getElementById('v' + data.verses[0].v);
      if (art) { art.classList.add('active'); state.active = art; }
      barRef.textContent = 'ADHYĀYA ' + devaDigits(n) + ' · ŚLOKA ' + devaDigits(data.verses[0].v, 3);
    }
    if (scroll) $('edition').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }

  /* ── global interactions ────────────────────────────── */
  $('begin').onclick = () => {
    const ch = state.chapters.find((c) => c.audio) || state.chapters[0];
    loadChapter(ch.n, true).then(() => {
      if (state.cues.length) { audio.currentTime = state.cues[0].start; audio.play().catch(() => {}); }
    });
  };
  $('sampleFilm').onclick = async () => {
    const lib = await json('data/library.json').catch(() => null);
    if (lib && lib.sample && lib.sample.film) location.href = lib.sample.film;
  };

  let programmatic = 0;
  addEventListener('scroll', () => {
    if (programmatic) return;
    bar.dataset.stuck = String(scrollY > 24);
    const past = scrollY > innerHeight * 0.55;
    transport.dataset.state = (audio.paused && !past) ? 'down' : (audio.paused ? 'idle' : 'playing');
  }, { passive: true });
  for (const ev of ['wheel', 'touchmove']) addEventListener(ev, () => {
    if (programmatic) return;
    state.followOffAt = performance.now();
    state.follow = false;
  }, { passive: true });

  addEventListener('keydown', (e) => {
    if (e.target.matches('input,select,textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); playBtn.click(); return; }
    if (!state.ch) return;
    const current = state.active ? +state.active.dataset.verse : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = Math.max(1, Math.min(state.ch.verses.length, current + (e.key === 'ArrowRight' ? 1 : -1)));
      seekVerse(next, state.cues.some((c) => c.verse === next));
      document.getElementById('v' + next)?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = state.chapters.findIndex((c) => c.n === state.ch.n);
      const j = Math.max(0, Math.min(state.chapters.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (j !== i) loadChapter(state.chapters[j].n, true);
    }
  });

  setInterval(() => {
    if (performance.now() - state.followOffAt > 7000 && !state.follow) state.follow = true;
    updateLevel();
    if (!audio.paused) sync();
  }, 220);

  /* ── boot ───────────────────────────────────────────── */
  (async () => {
    const lib = await json('data/library.json');
    state.chapters = lib.chapters;
    renderSpine();
    const rows = $('sourceRows');
    rows.replaceChildren(...lib.sources.map((s) => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td></td><td><a></a></td>';
      tr.children[0].textContent = devaDigits(s.n);
      tr.children[1].textContent = String(s.count).padStart(3, '0');
      const a = tr.querySelector('a');
      a.href = 'https://sa.wikisource.org/w/index.php?oldid=' + s.rev;
      a.textContent = String(s.rev);
      return tr;
    }));
    if (lib.sample && lib.sample.film) $('sampleFilm').href = lib.sample.film;
    watchReveals();
    const start = lib.chapters.find((c) => c.audio) || lib.chapters[0];
    await loadChapter(start.n, false);
  })().catch((e) => { barRef.textContent = 'EDITION UNAVAILABLE'; console.error(e); });
})();
