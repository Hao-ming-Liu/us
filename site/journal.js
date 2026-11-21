import { prepareMedia } from './media.js';
import { renderCurve, mountCurve } from './curve.js';
import { orderedPosts } from './order.js';
import { renderFilm, mountFilm, renderFilmSettings, mountFilmSettings } from './film.js';
import { mountDrawer } from './drawer.js';
import { mountMeetingPhotos } from './meeting-photos.js';

const navigation = [
  ['home', '纪念册', 'book'],
  ['inbox', '信箱', 'mail'],
  ['anniversaries', '纪念日', 'calendar'],
  ['account', '空间设置', 'account'],
];
const editorTitles = { meeting: '记录一次见面', post: '写一篇帖子', comment: '写下感想', message: '写留言', anniversary: '添加纪念日', letter: '写一封未来信' };
const icons = {
  book: '<path d="M5 6.3 6 4.7a2 2 0 0 1 1.8-1h8.6a2 2 0 0 1 1.8 1L19 6"/><rect x="3" y="7" width="18" height="14" rx="3.5"/><path d="m6.2 17 3.1-3.3 3.5 2.8 3.2-4 2 2"/><circle cx="8" cy="11" r=".8" fill="currentColor" stroke="none"/>',
  mail: '<rect x="2.5" y="5" width="19" height="14.5" rx="3.5"/><path d="m4 7 6.7 5.1a2.2 2.2 0 0 0 2.6 0L20 7"/>',
  calendar: '<rect x="3.5" y="5.2" width="17" height="15.3" rx="3.4"/><path d="M4 10h16M8 3v4M16 3v4"/><rect x="7.1" y="13" width="3.3" height="3.2" rx="1" fill="currentColor" stroke="none"/>',
  letter: '<path d="m3.5 10 8.5-6.5 8.5 6.5v10h-17zM3.5 10l8.5 6 8.5-6"/>',
  pen: '<path d="m14.8 5.1 4.1 4.1M4 20l4.9-1.1L20 7.8a1.6 1.6 0 0 0 0-2.3L18.5 4a1.6 1.6 0 0 0-2.3 0L5.1 15.1z"/>',
  arrow: '<path d="M4 12h15m-5.6-5.6L19 12l-5.6 5.6"/>',
  back: '<path d="M20 12H5m5.6-5.6L5 12l5.6 5.6"/>',
  account: '<path d="M4 7h7m5 0h4M4 17h3m6 0h7"/><circle cx="13.5" cy="7" r="2.6"/><circle cx="10" cy="17" r="2.6"/>',
  add: '<path d="M5 12h14M12 5v14"/>',
  attachment: '<path d="m8 13 7-7a3.2 3.2 0 0 1 4.5 4.5l-9 9a5 5 0 1 1-7-7l9-9"/>',
};
const icon = (name) => `<svg class="jr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
function h(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function path(...parts) { return '#journal/' + parts.filter(Boolean).map(part => encodeURIComponent(part)).join('/'); }
function route() {
  if (!location.hash.startsWith('#journal/')) return ['home'];
  try { return location.hash.slice(9).split('?')[0].split('/').filter(Boolean).map(decodeURIComponent); }
  catch { return ['missing']; }
}
function link(label, parts, style = 'jr-link', glyph) {
  return `<a class="${style}" href="${h(path(...parts))}">${glyph ? icon(glyph) : ''}<span>${h(label)}</span></a>`;
}
const calendar = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const mailTypes = { message: '留言', letter: '未来信' };
const mailDefaults = { type: 'all', order: 'desc', from: '', to: '' };
function deliveryTime(row) {
  const sent = Date.parse(row.created_at);
  if (row.kind !== 'letter') return sent;
  const endOfDate = Date.parse(row.data.date + 'T00:00:00+08:00') + 86400000;
  return Math.max(sent, endOfDate);
}
function chinaTimestamp(time) {
  return `${calendar.format(time)} ${clock.format(time)}`;
}
function today() { return calendar.format(new Date()); }
function recordDate(row) {
  if (row.data.date) return row.data.date.slice(0, 10);
  const created = new Date(row.created_at);
  return Number.isNaN(created.getTime()) ? '' : calendar.format(created);
}
function dateText(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-');
  return year && month && day ? `${year}年${Number(month)}月${Number(day)}日` : '';
}
function compareEvent(a, b) {
  return recordDate(a).localeCompare(recordDate(b)) || eventTime(a).localeCompare(eventTime(b)) || String(a.created_at).localeCompare(String(b.created_at));
}
function eventTime(row) { return row.data.time || row.data.date?.slice(11, 16) || ''; }
const mostRecent = (a, b) => -compareEvent(a, b);
function daysFrom(date) { return Math.round((Date.parse(today() + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000); }
function elapsed(date) {
  const days = daysFrom(date);
  return days === 0 ? '就是今天' : days > 0 ? `已经 ${days} 天` : `还有 ${-days} 天`;
}
function isAnniversary(row) {
  const date = recordDate(row);
  return date.length === 10 && date <= today() && date.slice(5) === today().slice(5);
}
function media(item, label, isCover = false) {
  if (!item?.path) return '';
  const video = (item.type || '').startsWith('video/');
  const attrs = `data-media="${h(item.path)}" class="${isCover ? 'jr-cover' : 'jr-inline-media'}"`;
  return video ? `<video ${attrs} controls playsinline preload="metadata" aria-label="${h(label)}"></video>` : `<img ${attrs} alt="${h(label)}" loading="${isCover ? 'eager' : 'lazy'}">`;
}
function gallery(row) {
  return (row.data.media || []).map((item, i) => media(item, `${row.data.title || row.data.signature || '感想'}的附件 ${i + 1}`)).join('');
}
function pageHeader(title, action = '') {
  return `<div class="jr-page-head"><h1 tabindex="-1">${h(title)}</h1>${action}</div>`;
}
function empty(title, description, action = '') {
  return `<div class="jr-empty"><h3>${h(title)}</h3><p>${h(description)}</p>${action}</div>`;
}
const back = (label, parts) => link(label, parts, 'jr-back', 'back');
const primary = (label, parts, glyph = 'pen') => link(label, parts, 'jr-button jr-primary', glyph);

export async function mountJournal(root, store, { onLogout, onBackup, demo = false } = {}) {
  root.__closeJournal?.();
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  const host = document.createElement('div');
  host.className = 'journal';
  root.replaceChildren(host);
  host.innerHTML = `<a class="jr-skip" href="#jr-main">跳至正文</a>
    <header class="jr-top"><div class="jr-top-inner">
    <a class="jr-brand" href="${path('home')}"><img src="./assets/seal.svg" alt=""><span>us</span></a>
    <span class="space-name">${demo ? '体验空间' : '双人空间'}</span>
    </div></header>
    <button type="button" class="edge-handle" aria-label="打开导航" aria-controls="us-navigation" aria-expanded="false"><i></i><i></i></button>
    <nav id="us-navigation" class="glass-drawer" aria-label="页面导航" inert>${navigation.map(([id, title, glyph]) => `<a href="${path(id)}" data-tab="${id}">${icon(glyph)}<span>${title}</span></a>`).join('')}</nav>
    <div class="jr-notice" role="status" aria-live="polite"></div>
    <section class="jr-main" id="jr-main" tabindex="-1"><p class="jr-loading">正在翻开纪念册…</p></section>`;
  const main = host.querySelector('#jr-main');
  mountDrawer(host, signal);
  let releaseScreen;
  let rows = [], revision = 0, request = 0, busy = false, initialized = false;
  const readRequests = new Set();
  const openedLetters = new Set();
  let filters = { ...mailDefaults };
  const urls = new Map();
  const activeUploads = new WeakMap();
  const submissions = new WeakMap();
  const active = () => !signal.aborted && host.isConnected;
  let noticeTimer;
  function dispose() { clearTimeout(noticeTimer); releaseScreen?.(); lifecycle.abort(); urls.clear(); rows = []; }
  root.__closeJournal = dispose;
  function notify(message, duration = 0) {
    clearTimeout(noticeTimer);
    host.querySelector('.jr-notice').textContent = message || '';
    if (duration) noticeTimer = setTimeout(() => notify(''), duration);
  }
  const find = (kind, id) => rows.find(row => row.kind === kind && row.id === id);
  const all = kind => rows.filter(row => row.kind === kind);
  const mine = row => row.author_id === store.user.id;
  const unread = row => !mine(row) && !row.data.read;
  const correspondenceRows = () => rows.filter(row => Object.hasOwn(mailTypes, row.kind));
  const author = row => mine(row) ? '我' : '对方';
  function authorColor(row) {
    const participants = [...new Set([...(store.memberIds || []), store.user.id, ...rows.map(r => r.author_id)])].sort();
    return participants.indexOf(row.author_id) === 0 ? 'olive' : 'red';
  }
  function byline(row) {
    return `<span class="jr-byline"><i class="jr-dot jr-${authorColor(row)}" aria-hidden="true"></i>${author(row)}</span>`;
  }
  function entryRow(row, subtext, showTime = false) {
    const data = row.data;
    const date = recordDate(row);
    const stamp = showTime && eventTime(row) ? `${date} · ${eventTime(row)}` : date;
    return `<a class="jr-entry" href="${path(row.kind, row.id)}"><span class="jr-entry-date">${h(stamp)}</span><span class="jr-entry-text"><span class="jr-entry-title">${h(data.title)}</span>${subtext ? `<span class="jr-entry-sub">${h(subtext)}</span>` : ''}</span><span class="jr-entry-end">${icon('arrow')}</span></a>`;
  }
  function alerts() {
    const messages = correspondenceRows().filter(unread).sort((a, b) => deliveryTime(b) - deliveryTime(a));
    const dates = all('anniversary').filter(isAnniversary);
    if (!(messages.length || dates.length)) return '';
    return `<aside class="jr-alerts" aria-label="今日提醒">${messages.map(r => `<a href="${path(r.kind, r.id)}">${icon('mail')}<span><strong>新${mailTypes[r.kind]}</strong> 收于 ${chinaTimestamp(deliveryTime(r))}（北京时间）</span>${icon('arrow')}</a>`).join('')}${dates.map(r => `<a href="${path('anniversaries')}">${icon('calendar')}<span><strong>今天是纪念日</strong> ${h(r.data.title)}</span>${icon('arrow')}</a>`).join('')}</aside>`;
  }
  function home() {
    const memories = rows.filter(r => r.kind === 'meeting' || (r.kind === 'post' && !r.data.meetingId)).sort(mostRecent);
    return `<div class="home-heading">${pageHeader('我们的纪念册', primary('写些什么', ['compose']))}</div>${renderFilm(rows)}${alerts()}
      <div class="jr-section-head"><h2>回忆目录</h2><span>${memories.length} 段回忆</span></div>
      ${memories.length ? memories.map(r => entryRow(r, r.kind === 'meeting' ? `见面记录 · ${all('post').filter(p => p.data.meetingId === r.id).length} 篇帖子` : '独立日常')).join('') : empty('目录等你来写', '收到礼物、一次通话，也可以单独写成日常。', link('写一篇日常', ['write', 'post'], 'jr-link', 'pen'))}`;
  }
  function compose() {
    return `${back('纪念册', ['home'])}${pageHeader('写些什么')}<div class="jr-choices">${[
      ['meeting', '见面'],
      ['post', '小小的随笔']
    ].map(([kind, title]) => `<a class="jr-choice" href="${path('write', kind)}"><h2>${title}</h2>${icon('arrow')}</a>`).join('')}</div>`;
  }
  function meeting(row) {
    return renderCurve(row, orderedPosts(row, all('post').filter(p => p.data.meetingId === row.id)));
  }
  function post(row) {
    const parent = row.data.meetingId && find('meeting', row.data.meetingId);
    const comments = all('comment').filter(c => c.data.postId === row.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return `${parent ? back(parent.data.title, ['meeting', parent.id]) : back('纪念册', ['home'])}
      ${pageHeader(row.data.title)}<div class="jr-meta">${dateText(recordDate(row))} ${h(eventTime(row))} ${byline(row)}</div>
      <article class="jr-article">${media(row.data.cover, '帖子封面', true)}${row.data.summary ? `<p class="jr-lede">${h(row.data.summary)}</p>` : ''}<p class="jr-prose">${h(row.data.body)}</p>${gallery(row)}</article>
      <div class="jr-section-head"><h2>两个人的感想</h2>${primary('写下感想', ['write', 'comment', row.id])}</div>
      <div class="jr-comments">${comments.map(r => `<article class="jr-comment jr-${authorColor(r)}"><div class="jr-meta">${byline(r)}<time>${dateText(recordDate(r))}</time></div><p class="jr-prose">${h(r.data.body)}</p>${gallery(r)}<footer>—— ${h(r.data.signature)}</footer></article>`).join('') || empty('这篇还没有感想', '写下你记得的另一个细节，给这次的自己起个落款。')}</div>`;
  }
  function inboxUrl() {
    const params = new URLSearchParams();
    for (const key of Object.keys(filters)) {
      if (filters[key] !== mailDefaults[key]) params.set(key, filters[key]);
    }
    return path('inbox') + (params.size ? '?' + params : '');
  }
  function readFilterUrl() {
    const params = new URLSearchParams(location.hash.split('?')[1]);
    if (!params.size) return;
    filters = {
      type: Object.hasOwn(mailTypes, params.get('type')) ? params.get('type') : 'all',
      order: params.get('order') === 'asc' ? 'asc' : 'desc',
      from: /^\d{4}-\d{2}-\d{2}$/.test(params.get('from')) ? params.get('from') : '',
      to: /^\d{4}-\d{2}-\d{2}$/.test(params.get('to')) ? params.get('to') : '',
    };
  }
  function mailStatus(row) {
    const pending = mine(row) && row.kind === 'letter' && deliveryTime(row) > Date.now();
    if (pending) return '我寄出的 · 待送达';
    if (mine(row)) return '我寄出的 · ' + (row.data.read ? '对方已读' : '对方未读');
    return '对方寄来的 · ' + (row.data.read ? '已读' : '未读');
  }
  function deliveryLabel(row) {
    return mine(row) && row.kind === 'letter' && deliveryTime(row) > Date.now() ? '预计送达' : '送达';
  }
  function mailRow(row) {
    const time = deliveryTime(row);
    return `<a class="jr-mail-row" href="${path(row.kind, row.id)}"><span class="jr-mail-mark">${icon(row.kind === 'letter' ? 'letter' : 'mail')}</span><span class="jr-mail-label"><strong>${mailTypes[row.kind]}</strong><small>${mailStatus(row)}</small></span><span class="jr-mail-date">${deliveryLabel(row)} <time datetime="${new Date(time).toISOString()}">${chinaTimestamp(time)}</time></span>${icon('arrow')}</a>`;
  }
  function inbox() {
    const actions = `<div class="jr-mail-actions">${primary('写留言', ['write', 'message'])}${link('写未来信', ['write', 'letter'], 'jr-button', 'letter')}</div>`;
    return `${pageHeader('信箱', actions)}
      <div class="jr-mail-controls" role="group" aria-label="信箱筛选">
        <fieldset class="jr-kind-choice"><legend class="jr-sr">内容类型</legend>${Object.entries({ all: '全部', ...mailTypes }).map(([value, name]) => `<label><input type="radio" name="type" value="${value}" ${filters.type === value ? 'checked' : ''}><span>${name}</span></label>`).join('')}</fieldset>
        <div class="jr-mail-tools"><label>送达顺序<select name="order"><option value="desc" ${filters.order === 'desc' ? 'selected' : ''}>从新到旧</option><option value="asc" ${filters.order === 'asc' ? 'selected' : ''}>从旧到新</option></select></label>
          <label>开始日期<input name="from" type="date" value="${h(filters.from)}" aria-describedby="jr-mail-hint"></label>
          <label>结束日期<input name="to" type="date" value="${h(filters.to)}" aria-describedby="jr-mail-hint"></label>
          <button type="button" class="jr-filter-reset" data-action="reset-filters">重置筛选</button></div>
      </div><p id="jr-mail-hint" class="jr-mail-hint" role="status"></p><div class="jr-mail-results"></div>`;
  }
  function paintInbox() {
    const invalid = filters.from && filters.to && filters.from > filters.to;
    const items = correspondenceRows().filter(row => {
      const day = calendar.format(deliveryTime(row));
      return !invalid && (filters.type === 'all' || filters.type === row.kind) &&
        (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to);
    }).sort((a, b) => {
      const cmp = deliveryTime(a) - deliveryTime(b) || a.id.localeCompare(b.id);
      return filters.order === 'asc' ? cmp : -cmp;
    });
    const hint = main.querySelector('#jr-mail-hint');
    hint.textContent = invalid ? '开始日期晚于结束日期，请调整日期或重置筛选。' : `共 ${items.length} 封 · 按北京时间的送达日期筛选，含起止两日。`;
    hint.classList.toggle('jr-range-error', Boolean(invalid));
    main.querySelectorAll('.jr-mail-tools input').forEach(el => el.setAttribute('aria-invalid', String(Boolean(invalid))));
    main.querySelector('.jr-mail-results').innerHTML = invalid ? '' : items.map(mailRow).join('') || empty('这里还没有信件', '可以写一则留言，或调整筛选条件查看其他信件。');
  }
  function correspondence(row) {
    const heading = mailTypes[row.kind];
    const meta = `<div class="jr-meta">${byline(row)}<span>${deliveryLabel(row)} · ${chinaTimestamp(deliveryTime(row))}（北京时间）</span></div>`;
    const backLink = back('信箱', ['inbox']);
    if (row.kind === 'letter' && !openedLetters.has(row.id)) {
      return `${backLink}${pageHeader(heading)}<div class="jr-envelope-view">${meta}
        <button type="button" class="jr-envelope" data-action="open-letter" data-id="${h(row.id)}" aria-label="拆开这封未来信">
          <span class="jr-envelope-flap" aria-hidden="true"></span><span class="jr-envelope-seal" aria-hidden="true">us</span>
          <span class="jr-envelope-prompt">${icon('letter')}拆开这封信</span>
        </button></div>`;
    }
    return `${backLink}<article class="jr-letter">${pageHeader(row.data.title || heading)}${meta}<p class="jr-prose">${h(row.data.body)}</p></article>`;
  }
  function anniversaries() {
    const dates = all('anniversary').sort((a, b) => Number(isAnniversary(b)) - Number(isAnniversary(a)) || compareEvent(a, b));
    return `${pageHeader('纪念日', primary('添加纪念日', ['write', 'anniversary'], 'add'))}
      ${dates.map(r => `<article class="jr-anniversary"><div><time>${dateText(recordDate(r))}</time><h2>${h(r.data.title)}</h2></div><div class="jr-day-count">${isAnniversary(r) ? '<small>今天是纪念日</small>' : ''}${h(elapsed(recordDate(r)))}</div></article>`).join('') || empty('把特别的日子记在这里', '记下开始的那一天。每年同一天，纪念册首页都会提醒你。')}`;
  }
  function account() {
    return `${pageHeader('空间设置')}<dl class="jr-settings"><div><dt>当前账号</dt><dd>${h(store.user.name || store.user.email || '体验账号')}</dd></div><div><dt>空间类型</dt><dd>${demo ? '本机体验空间' : '私密双人空间'}</dd></div><div><dt>媒体用量</dt><dd data-usage>正在读取…</dd></div></dl>
      ${renderFilmSettings()}
      <div class="jr-account-action"><div><h2>备份纪念册</h2><p>下载当前可读的文字和媒体，留一份在自己的电脑上。</p></div><button type="button" class="jr-button" data-action="backup">导出备份</button></div>
      <div class="jr-account-action"><div><h2>${demo ? '离开体验空间' : '退出账号'}</h2></div><button type="button" class="jr-button" data-action="logout">${demo ? '返回登录页' : '退出登录'}</button></div>`;
  }
  function input(name, title, options = {}) {
    const { type = 'text', value = '', required = false, hint = '', accept = '', multiple = false, max, min = '', rows: lines = 5 } = options;
    const shared = `id="jr-f-${name}" name="${name}" ${required ? 'required' : ''} ${hint ? `aria-describedby="jr-h-${name}"` : ''} ${max ? `maxlength="${max}"` : ''}`;
    const field = type === 'textarea' ? `<textarea ${shared} rows="${lines}">${h(value)}</textarea>` : `<input ${shared} type="${type}" ${type === 'file' ? `accept="${accept}" ${multiple ? 'multiple' : ''}` : `value="${h(value)}" ${min ? `min="${h(min)}"` : ''}`}>`;
    return `<div class="jr-field"><label for="jr-f-${name}">${title}${!required ? '<span>选填</span>' : ''}</label>${hint ? `<p id="jr-h-${name}">${hint}</p>` : ''}${field}</div>`;
  }
  const parents = { meeting: 'home', post: 'home', message: 'inbox', anniversary: 'anniversaries', letter: 'inbox' };
  function parentRoute(kind, id) {
    return kind === 'comment' ? ['post', id] : kind === 'post' && id ? ['meeting', id] : [parents[kind] || 'home'];
  }
  function editor(kind, id) {
    if (!Object.hasOwn(editorTitles, kind) || (kind === 'comment' && !find('post', id)) || (kind === 'post' && id && !find('meeting', id))) return missing();
    const dated = ['meeting', 'post', 'anniversary', 'letter'].includes(kind);
    const withSummary = kind === 'meeting' || kind === 'post';
    const withBody = ['post', 'comment', 'message', 'letter'].includes(kind);
    const title = kind === 'post' ? (id ? '补写见面事件' : '写一篇日常') : editorTitles[kind];
    const returnTo = parentRoute(kind, id);
    return `${back('返回', returnTo)}${pageHeader(title)}<form class="jr-form" data-editor="${h(kind)}" data-parent="${h(id || '')}">
      ${!['comment', 'message', 'letter'].includes(kind) ? input('title', kind === 'anniversary' ? '纪念日名称' : '标题', { required: true }) : ''}
      ${dated ? input('date', kind === 'letter' ? '约定日期' : kind === 'anniversary' ? '开始日期' : '发生日期', { type: 'date', required: true, value: today(), min: kind === 'letter' ? today() : '', hint: kind === 'letter' ? '按北京时间，约定日期过去后的零点起，对方可以拆信。' : '' }) : ''}
      ${kind === 'post' ? input('time', '发生时间', { type: 'time' }) : ''}
      ${withSummary ? input('summary', '摘要', { type: 'textarea', rows: 2 }) : ''}
      ${withBody ? input('body', kind === 'comment' ? '感想' : '正文', { type: 'textarea', required: kind !== 'comment' }) : ''}
      ${withSummary ? input('cover', '封面照片', { type: 'file', accept: 'image/*' }) : ''}
      ${['post', 'comment'].includes(kind) ? input('media', kind === 'post' ? '照片或短视频' : '照片', { type: 'file', accept: kind === 'post' ? 'image/*,video/*' : 'image/*', multiple: true }) : ''}
      ${kind === 'comment' ? input('signature', '这次的落款', { required: true, hint: '每条感想有自己的署名，例如「开心的小猪」。' }) : ''}
      <p class="jr-form-status" aria-live="polite" role="status"></p><div class="jr-form-actions"><button class="jr-button jr-primary" type="submit">${kind === 'letter' ? '封存这封信' : '保存'}</button>${link('取消', returnTo)}</div></form>`;
  }
  function missing() { return `${pageHeader('这页暂时无法打开')}${empty('没有可查看的记录', '回到纪念册，查看你们当前共享的内容。', back('回到纪念册', ['home']))}`; }
  function render(moveFocus = false) {
    if (!active() || !initialized) return;
    const version = ++revision;
    releaseScreen?.();
    releaseScreen = undefined;
    let [page = 'home', id, parentId] = route();
    if (page === 'messages' || page === 'letters') {
      filters = { ...mailDefaults, type: page === 'messages' ? 'message' : 'letter' };
      page = 'inbox';
      history.replaceState(history.state, '', inboxUrl());
    }
    if (page === 'inbox') {
      readFilterUrl();
      if (location.hash !== inboxUrl()) history.replaceState(history.state, '', inboxUrl());
    }
    const tabs = { meeting: 'home', post: 'home', compose: 'home', message: 'inbox', letter: 'inbox' };
    const tab = page === 'write' ? parents[id] || 'home' : tabs[page] || page;
    host.querySelectorAll('[data-tab]').forEach(el => {
      if (el.dataset.tab === tab) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    const row = find(page, id);
    host.dataset.screen = page;
    const screens = { home, compose, inbox, anniversaries, account };
    if (Object.hasOwn(screens, page)) main.innerHTML = screens[page]();
    else if (page === 'write') main.innerHTML = editor(id, parentId);
    else if (page === 'meeting' && row) main.innerHTML = meeting(row);
    else if (page === 'post' && row) main.innerHTML = post(row);
    else if ((page === 'message' || page === 'letter') && row) main.innerHTML = correspondence(row);
    else main.innerHTML = missing();
    if (page === 'inbox') paintInbox();
    if (page === 'home') releaseScreen = mountFilm(main, rows, store);
    if (page === 'meeting' && row) {
      const stopPhotos = mountMeetingPhotos(main, row, rows, store);
      const stopCurve = mountCurve(main, {
        onInsert(beforeId) {
          location.hash = path('write', 'post', row.id) + '?before=' + encodeURIComponent(beforeId ?? '');
        },
        async onMove(postId, beforeId) {
          await store.movePost(row.id, postId, beforeId);
          if (active() && revision === version) {
            await refresh();
            if (active() && route()[0] === 'meeting' && route()[1] === row.id && initialized) {
              const moved = main.querySelector(`.cv-stop[data-id="${CSS.escape(postId)}"]`);
              moved?.querySelector('.cv-grip')?.focus({ preventScroll: true });
              notify('已保存新的事件顺序。', 2800);
            }
          }
        },
        onError(error) { notify(error?.message || '顺序保存失败，请重试。'); }
      });
      releaseScreen = () => { stopPhotos(); stopCurve(); };
    }
    if (moveFocus) {
      main.querySelector('h1')?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        main.animate([{ opacity: .82, translate: '0 5px' }, { opacity: 1, translate: '0 0' }],
          { duration: 180, easing: 'ease-out' });
      }
    }
    for (const element of main.querySelectorAll('[data-media]')) hydrateMedia(element, version);
    if (page === 'account') {
      releaseScreen = mountFilmSettings(main, store);
      showUsage(version);
    }
    if ((page === 'message' || (page === 'letter' && openedLetters.has(id))) && row && unread(row) && !readRequests.has(id)) markRead(row);
  }
  async function hydrateMedia(element, version) {
    const key = element.dataset.media;
    try {
      let cached = urls.get(key);
      if (!cached || cached.expiry < Date.now()) {
        cached = { promise: Promise.resolve(store.mediaUrl(key)), expiry: Date.now() + 4 * 60 * 1000 };
        urls.set(key, cached);
      }
      const url = await cached.promise;
      if (active() && version === revision) {
        const resolved = new URL(url, document.baseURI);
        if (!['https:', 'http:', 'blob:', 'data:'].includes(resolved.protocol)) throw new Error('附件地址无效');
        element.src = resolved.href;
      }
    } catch {
      urls.delete(key);
      if (active() && version === revision) {
        const failure = document.createElement('span');
        failure.className = 'jr-media-error';
        failure.textContent = '附件载入失败，请刷新后重试。';
        element.replaceWith(failure);
      }
    }
  }
  async function markRead(row) {
    readRequests.add(row.id);
    try {
      await store.markRead(row.id);
      const current = find(row.kind, row.id);
      if (current) current.data.read = true;
      if (active() && ['home', 'inbox'].includes(route()[0] || 'home')) render();
    } catch {
      if (active()) notify('阅读状态同步失败，请重新打开这封信件重试。');
    } finally { readRequests.delete(row.id); }
  }
  async function showUsage(version) {
    const el = main.querySelector('[data-usage]');
    try {
      const used = await store.usage();
      if (active() && revision === version) {
        const size = used < 1024 * 1024 ? `${Math.ceil(used / 1024)} KB` : `${(used / (1024 * 1024)).toFixed(1)} MB`;
        el.textContent = demo ? size : `${size} / 1 GB${used >= 800000000 ? '，空间即将用满，建议导出备份。' : ''}`;
      }
    } catch { if (active() && revision === version) el.textContent = '暂时无法读取用量'; }
  }
  async function refresh({ moveFocus = false } = {}) {
    const current = ++request;
    try {
      const result = await store.list();
      if (!active() || current !== request) return;
      rows = result;
      initialized = true;
      render(moveFocus);
    } catch (error) {
      if (!active() || current !== request) return;
      rows = [];
      initialized = false;
      releaseScreen?.();
      releaseScreen = undefined;
      ++revision;
      main.innerHTML = `${pageHeader('纪念册暂时无法读取')}<p>${h(error?.message || '请检查网络后重试。')}</p><div class="jr-form-actions"><button class="jr-button" data-action="retry">重新读取</button><button class="jr-button" data-action="logout">返回登录页</button></div>`;
    }
  }
  async function attachment(file, form, message) {
    let uploaded = activeUploads.get(form);
    if (!uploaded) { uploaded = new Map(); activeUploads.set(form, uploaded); }
    if (uploaded.has(file)) return uploaded.get(file);
    message.textContent = `正在处理 ${file.name}…`;
    const prepared = await prepareMedia(file);
    if (!active()) throw new Error('空间已关闭');
    const storedPath = await store.upload(prepared);
    const item = { path: storedPath, type: prepared.type };
    uploaded.set(file, item);
    return item;
  }
  async function save(event) {
    const form = event.target.closest('form[data-editor]');
    if (!form) return;
    event.preventDefault();
    if (busy) return;
    const kind = form.dataset.editor;
    const parent = form.dataset.parent;
    const data = {};
    const message = form.querySelector('.jr-form-status');
    const submit = form.querySelector('[type=submit]');
    const controls = [...form.elements].filter(el => el.name && el.type !== 'file');
    for (const el of controls) {
      const value = el.value.trim();
      if (!value && el.required) { el.setCustomValidity('请填写这一项。'); el.reportValidity(); return; }
      if (value) data[el.name] = value;
    }
    const cover = form.elements.namedItem('cover')?.files?.[0];
    const mediaFiles = [...(form.elements.namedItem('media')?.files || [])];
    if (kind === 'comment' && !data.body && !mediaFiles.length) {
      message.textContent = '请写下感想，或选一张照片。';
      form.elements.namedItem('body').focus();
      return;
    }
    if ((cover && !cover.type.startsWith('image/')) || (kind === 'comment' && mediaFiles.some(f => !f.type.startsWith('image/')))) {
      message.textContent = '封面和感想附件请选择图片文件。';
      return;
    }
    if (kind === 'post' && parent) {
      data.meetingId = parent;
      const placement = new URLSearchParams(location.hash.split('?')[1]);
      if (placement.has('before')) data.beforeId = placement.get('before') || null;
    }
    if (kind === 'comment') data.postId = parent;
    if (kind === 'message') data.read = false;
    busy = true;
    [...form.elements].forEach(el => { el.disabled = true; });
    try {
      if (cover) data.cover = await attachment(cover, form, message);
      if (mediaFiles.length) {
        data.media = [];
        for (const file of mediaFiles) data.media.push(await attachment(file, form, message));
      }
      if (!active()) return;
      message.textContent = '正在保存…';
      const payload = JSON.stringify(data);
      let submission = submissions.get(form);
      if (submission?.payload !== payload) {
        submission = { payload, id: crypto.randomUUID() };
        submissions.set(form, submission);
      }
      const result = await store.add(kind, data, submission.id);
      if (!active()) return;
      const created = typeof result === 'string' ? result : result?.id;
      const stillEditing = main.contains(form);
      const dest = kind === 'post' && parent ? ['meeting', parent] :
        created && (kind === 'post' || kind === 'meeting') ? [kind, created] : parentRoute(kind, parent);
      if (stillEditing) {
        history.replaceState(history.state, '', path(...dest));
        notify(kind === 'letter' ? '未来信已封存。' : '已保存。');
      }
      if (stillEditing || route()[0] !== 'write') await refresh({ moveFocus: stillEditing });
    } catch (error) {
      message.textContent = error?.message || '保存失败，请重试。';
    } finally {
      busy = false;
      if (active() && main.contains(form)) {
        [...form.elements].forEach(el => { el.disabled = false; });
        submit.focus();
      }
    }
  }
  host.addEventListener('input', event => { event.target.setCustomValidity?.(''); }, { signal });
  host.addEventListener('change', event => {
    const field = event.target;
    if (!field.closest('.jr-mail-controls') || !Object.hasOwn(mailDefaults, field.name)) return;
    filters[field.name] = field.value;
    history.replaceState(history.state, '', inboxUrl());
    paintInbox();
  }, { signal });
  host.addEventListener('submit', save, { signal });
  host.addEventListener('click', async event => {
    if (event.target.closest('.jr-skip')) {
      event.preventDefault();
      main.focus();
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      if (button.dataset.action === 'reset-filters') {
        filters = { ...mailDefaults };
        history.replaceState(history.state, '', inboxUrl());
        render();
        main.querySelector('[data-action="reset-filters"]').focus();
      } else if (button.dataset.action === 'open-letter') {
        const id = button.dataset.id;
        openedLetters.add(id);
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          button.classList.add('jr-opening');
          await new Promise(resolve => setTimeout(resolve, 320));
        }
        const [page, currentId] = route();
        if (active() && page === 'letter' && id === currentId) {
          render();
          main.querySelector('.jr-letter')?.classList.add('jr-unfolded');
          main.querySelector('h1')?.focus({ preventScroll: true });
        }
      } else if (button.dataset.action === 'logout') {
        await onLogout();
      } else if (button.dataset.action === 'backup') {
        notify('正在整理文字和媒体…');
        await onBackup();
        if (active()) notify('备份已生成，请查看浏览器下载。');
      } else if (button.dataset.action === 'retry') { await refresh(); }
    } catch (error) { if (active()) notify(error?.message || '操作失败，请再试一次。'); }
    finally { if (active()) button.disabled = false; }
  }, { signal });
  window.addEventListener('hashchange', () => { if (active()) { notify(''); render(true); } }, { signal });
  document.addEventListener('visibilitychange', () => {
    if (active() && !document.hidden && route()[0] !== 'write' && !busy) refresh();
  }, { signal });
  await refresh();
  return dispose;
}
