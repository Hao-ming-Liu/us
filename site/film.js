const fallbackPhoto = new URL('./assets/arrival.jpg', import.meta.url).href;
const durations = [6, 10, 15];
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }) : null;
const mounted = new WeakMap();

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function excerpt(body) {
  const text = String(body || '').trim().replace(/\s+/g, ' ');
  const clusters = segmenter ? Array.from(segmenter.segment(text), x => x.segment)
    : text.match(/\p{Regional_Indicator}{2}|\P{Mark}[\p{Mark}\uFE0F\p{Emoji_Modifier}]*(?:\u200d\P{Mark}[\p{Mark}\uFE0F\p{Emoji_Modifier}]*)*|\p{Mark}/gu) || [];
  return clusters.length > 20 ? clusters.slice(0, 20).join('') + '…' : text;
}
function recordDate(row) {
  return row?.data.date?.slice(0, 10) || row?.created_at?.slice(0, 10) || '';
}

function framesFrom(rows) {
  const posts = rows.filter(r => r.kind === 'post');
  const memories = rows.filter(r => r.kind === 'meeting' || r.kind === 'post');
  const comments = rows.filter(r => r.kind === 'comment' && r.data.postId);
  const postMap = new Map(posts.map(r => [r.id, r]));
  const byParent = new Map();
  function relate(id, comment) {
    if (!byParent.has(id)) byParent.set(id, []);
    byParent.get(id).push(comment);
  }
  for (const comment of comments) {
    if (!comment.data.body?.trim()) continue;
    relate(comment.data.postId, comment);
    const meetingId = postMap.get(comment.data.postId)?.data.meetingId;
    if (meetingId) relate(meetingId, comment);
  }
  const frames = [];
  const seen = new Set();
  function append(row, owner) {
    for (const asset of [row.data.cover, ...(row.data.media || [])]) {
      if (!asset?.path || !asset.type?.startsWith('image/') || seen.has(asset.path)) continue;
      seen.add(asset.path);
      frames.push({ path: asset.path, row: owner, comments: byParent.get(owner.id) || [] });
    }
  }
  memories.sort((a, b) => recordDate(b).localeCompare(recordDate(a)) || String(b.created_at).localeCompare(String(a.created_at)));
  for (const row of memories) append(row, row);
  for (const comment of comments) {
    const post = postMap.get(comment.data.postId);
    if (post) append(comment, post);
  }
  if (!frames.length) {
    const row = memories[0];
    frames.push({ path: null, row, comments: byParent.get(row?.id) || [] });
  }
  return frames;
}

const paths = {
  previous: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  next: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  pause: '<path d="M9 6.5v11M15 6.5v11" stroke-width="3"/>',
  play: '<path d="m8 5 10.5 7L8 19z" fill="currentColor" stroke="none"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
};
const icon = key => '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">' + paths[key] + '</svg>';

function info(frame) {
  const row = frame.row;
  const isMeeting = row?.kind === 'meeting';
  const title = row?.data.title || '我们的纪念册';
  const date = recordDate(row);
  const url = row ? '#journal/' + row.kind + '/' + encodeURIComponent(row.id) : '#journal/write/meeting';
  return '<h2>' + escape(title) + '</h2>' +
    (date ? '<p class="film-date"><time datetime="' + escape(date) + '">' + escape(date.replaceAll('-', ' . ')) + '</time><span></span>' + (isMeeting ? '见面记录' : '事件手记') + '</p>' : '') +
    '<a class="film-open" href="' + escape(url) + '">' + (row ? '翻开这段回忆' : '记录第一次见面') + icon('arrow') + '</a>';
}
function bubbles(frame) {
  return frame.comments.slice(0, 2).map(({ data }) => '<a class="film-bubble" href="#journal/post/' + escape(encodeURIComponent(data.postId)) +
    '"><span class="film-quotation" aria-hidden="true">“</span><span>' + escape(excerpt(data.body)) + '</span>' +
    (data.signature ? '<small>— ' + escape(data.signature) + '</small>' : '') + '</a>').join('');
}
function control(action, label, symbol) {
  return '<button type="button" class="film-key" data-film-action="' + action + '" aria-label="' + label + '" title="' + label + '">' + icon(symbol) + '</button>';
}

export function renderFilm(rows) {
  const frames = framesFrom(rows);
  return '<section class="film" aria-label="回忆放映室" aria-roledescription="照片轮播">' +
    '<div class="film-screen" aria-hidden="true"><img class="film-photo is-current" alt="" src="' + escape(fallbackPhoto) + '"><img class="film-photo" alt=""></div>' +
    '<div class="film-quotes"></div>' +
    '<div class="film-foot"><div class="film-caption">' + info(frames[0]) + '</div>' +
    '<div class="film-deck" aria-label="放映控制"><span class="film-count"><b>01</b><i>/</i><span>' + String(frames.length).padStart(2, '0') + '</span></span>' +
    control('previous', '上一张照片', 'previous') + control('toggle', '暂停自动放映', 'pause') + control('next', '下一张照片', 'next') + '</div></div></section>';
}

function preferences(key) {
  const defaults = { auto: !matchMedia('(prefers-reduced-motion: reduce)').matches, quotes: true, duration: 10, index: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    return {
      auto: typeof saved.auto === 'boolean' ? saved.auto : defaults.auto,
      quotes: typeof saved.quotes === 'boolean' ? saved.quotes : true,
      duration: durations.includes(saved.duration) ? saved.duration : defaults.duration,
      index: Number.isSafeInteger(saved.index) && saved.index >= 0 ? saved.index : 0,
    };
  } catch { return defaults; }
}

function savePreferences(key, prefs) {
  try { localStorage.setItem(key, JSON.stringify(prefs)); } catch { /* Storage is optional. */ }
}

export function renderFilmSettings() {
  return '<fieldset class="film-settings"><legend>首页放映</legend>' +
    '<label><span>自动轮播</span><input type="checkbox" data-film-pref="auto"></label>' +
    '<label><span>显示感想气泡</span><input type="checkbox" data-film-pref="quotes"></label>' +
    '<label><span>切换间隔</span><select data-film-pref="duration">' +
    durations.map(seconds => '<option value="' + seconds + '">' + seconds + ' 秒</option>').join('') +
    '</select></label></fieldset>';
}

export function mountFilmSettings(container, store) {
  const panel = container.querySelector('.film-settings');
  const key = 'us:film:' + store.user.id;
  const prefs = preferences(key);
  const { auto, quotes, duration } = Object.fromEntries(
    [...panel.querySelectorAll('[data-film-pref]')].map(field => [field.dataset.filmPref, field])
  );
  auto.checked = prefs.auto;
  quotes.checked = prefs.quotes;
  duration.value = prefs.duration;
  duration.disabled = !auto.checked;
  function change() {
    duration.disabled = !auto.checked;
    savePreferences(key, { ...preferences(key), auto: auto.checked, quotes: quotes.checked, duration: Number(duration.value) });
  }
  panel.addEventListener('change', change);
  return () => panel.removeEventListener('change', change);
}

export function mountFilm(container, rows, store) {
  const stage = container.matches('.film') ? container : container.querySelector('.film');
  if (!stage) return () => {};
  mounted.get(stage)?.();
  const frames = framesFrom(rows);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const key = 'us:film:' + store.user.id;
  const prefs = preferences(key);
  let index = Math.min(prefs.index, frames.length - 1), token = 0, timer = 0;
  let disposed = false, inView = true, activeLayer = 0;
  let focusedInside = false;
  const photos = [...stage.querySelectorAll('.film-photo')];
  const caption = stage.querySelector('.film-caption');
  const quotes = stage.querySelector('.film-quotes');
  const play = stage.querySelector('[data-film-action="toggle"]');
  const count = stage.querySelector('.film-count b');
  const ambient = stage.closest('.journal');
  const lifecycle = new AbortController();
  const listen = (target, event, handler) => target.addEventListener(event, handler, { signal: lifecycle.signal });
  function save() {
    savePreferences(key, { ...prefs, index });
  }
  function controls() {
    const multi = frames.length > 1;
    play.innerHTML = icon(prefs.auto && multi ? 'pause' : 'play');
    const label = prefs.auto && multi ? '暂停自动放映' : '开始自动放映';
    play.setAttribute('aria-label', label);
    play.title = label;
    for (const button of stage.querySelectorAll('.film-key')) button.disabled = !multi;
    stage.style.setProperty('--film-cycle', prefs.duration + 's');
    quotes.hidden = !prefs.quotes;
    stage.classList.toggle('film-paused', multi && !prefs.auto);
  }
  function schedule() {
    clearTimeout(timer);
    if (!disposed && frames.length > 1 && prefs.auto && !document.hidden && inView && !focusedInside) {
      timer = setTimeout(() => show(index + 1), prefs.duration * 1000);
    }
  }
  async function show(target) {
    clearTimeout(timer);
    index = (target + frames.length) % frames.length;
    const frame = frames[index];
    const version = ++token;
    const nextLayer = 1 - activeLayer;
    const image = photos[nextLayer];
    let url = fallbackPhoto;
    if (frame.path) {
      try { url = await store.mediaUrl(frame.path) || fallbackPhoto; } catch { /* Show the cover when a private file is unavailable. */ }
    }
    if (disposed || token !== version) return;
    image.src = url;
    try { await image.decode(); }
    catch {
      if (disposed || token !== version) return;
      image.src = fallbackPhoto;
      try { await image.decode(); } catch { /* The dark stage also supports text-only viewing. */ }
    }
    if (disposed || token !== version) return;
    if (image.naturalWidth) ambient?.style.setProperty('--film-ambient', 'url(' + JSON.stringify(image.src) + ')');
    image.classList.add('is-current');
    photos[activeLayer].classList.remove('is-current');
    activeLayer = nextLayer;
    caption.innerHTML = info(frame);
    quotes.innerHTML = bubbles(frame);
    count.textContent = String(index + 1).padStart(2, '0');
    controls();
    schedule();
  }
  listen(stage, 'click', event => {
    const action = event.target.closest('[data-film-action]')?.dataset.filmAction;
    if (action === 'toggle') {
      prefs.auto = !prefs.auto;
      if (prefs.auto) focusedInside = false;
      controls(); save(); schedule();
      return;
    }
    if (action === 'previous' || action === 'next') {
      show(index + (action === 'next' ? 1 : -1));
      save();
    }
  });
  listen(stage, 'focusin', event => {
    focusedInside = event.target.matches(':focus-visible');
    schedule();
  });
  listen(stage, 'focusout', event => {
    if (!stage.contains(event.relatedTarget)) focusedInside = false;
    schedule();
  });
  listen(document, 'visibilitychange', schedule);
  listen(reduce, 'change', () => {
    if (reduce.matches) prefs.auto = false;
    controls(); schedule();
  });
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    schedule();
  }) : null;
  observer?.observe(stage);
  controls();
  show(index);
  function dispose() {
    disposed = true;
    clearTimeout(timer);
    observer?.disconnect();
    lifecycle.abort();
    ambient?.style.removeProperty('--film-ambient');
    mounted.delete(stage);
  }
  mounted.set(stage, dispose);
  return dispose;
}
