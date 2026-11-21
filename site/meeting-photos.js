function photoPaths(meeting, records) {
  const posts = records.filter(row => row.kind === 'post' && row.data.meetingId === meeting.id);
  const postIds = new Set(posts.map(row => row.id));
  const comments = records.filter(row => row.kind === 'comment' && postIds.has(row.data.postId));
  const paths = new Set();
  for (const row of [meeting, ...posts, ...comments]) {
    for (const media of [row.data.cover, ...(row.data.media || [])]) {
      if (media?.type?.startsWith('image/') && media.path) paths.add(media.path);
    }
  }
  return [...paths];
}

export function mountMeetingPhotos(container, meeting, records, store) {
  const layers = [...container.querySelectorAll('.cv-backdrop img')];
  const toggle = container.querySelector('.cv-photo-toggle');
  const pending = photoPaths(meeting, records);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const controller = new AbortController();
  const { signal } = controller;
  let current = 0, timer, paused = reduce.matches;
  const fallback = new URL('./assets/arrival.jpg', import.meta.url).href;

  function controls() {
    toggle.hidden = pending.length < 2;
    toggle.textContent = paused ? '播放背景照片' : '暂停背景轮播';
  }
  function schedule() {
    clearTimeout(timer);
    if (!signal.aborted && !document.hidden && !paused && pending.length > 1)
      timer = setTimeout(advance, 8000);
  }
  let loading = false;
  async function advance() {
    if (loading) return;
    loading = true;
    const image = layers[1 - current];
    while (!signal.aborted) {
      const path = pending.shift();
      try {
        const src = path ? await store.mediaUrl(path) : fallback;
        if (signal.aborted) return;
        image.src = src;
        await image.decode();
        if (signal.aborted) return;
        image.classList.add('visible');
        layers[current].classList.remove('visible');
        current = 1 - current;
        if (path) pending.push(path);
        break;
      } catch {
        if (!path) break;
      }
    }
    loading = false;
    if (!signal.aborted) { controls(); schedule(); }
  }
  toggle.addEventListener('click', () => { paused = !paused; controls(); schedule(); }, { signal });
  reduce.addEventListener('change', () => { paused = reduce.matches; controls(); schedule(); }, { signal });
  document.addEventListener('visibilitychange', schedule, { signal });
  advance();
  return () => { clearTimeout(timer); controller.abort(); };
}
