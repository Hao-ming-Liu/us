import {createCloud} from './cloud.js';
import {createDemo} from './demo.js';
import {exportBackup} from './media.js';
import {mountJournal} from './journal.js';

const app = document.querySelector('#app');
let cloud, active, cleanup, generation = 0;

function reset() {
  generation++;
  cleanup?.();
  cleanup = undefined;
  app.replaceChildren();
  return generation;
}

function entry(title, description) {
  reset();
  app.innerHTML = `<div class="entry">
    <header class="entry-mast"><div class="entry-brand"><img src="./assets/seal.svg" alt="">us</div>
      <span class="entry-lock"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>双人纪念册</span></header>
    <div class="entry-grid"><figure class="entry-figure"><img src="./assets/arrival.jpg" alt="夕阳照进站台，一列火车正在停靠">
      <figcaption class="entry-caption"><span>等你到站</span><span>Photo · Hanvin Cheong</span></figcaption></figure>
    <section class="entry-panel"><h1></h1><p class="entry-intro"></p><div id="actions"></div>
      <p class="entry-msg" role="status" aria-live="polite"></p></section></div>
    <footer class="entry-foot">us · 我们的纪念册</footer></div>`;
  app.querySelector('h1').textContent = title;
  app.querySelector('.entry-intro').textContent = description;
  return app.querySelector('#actions');
}

function showError(error) {
  const status = app.querySelector('.entry-msg');
  if (status) status.textContent = error?.message || '连接失败，请稍后重试。';
}

function bindBusy(button, action, form) {
  const listener = async event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    try { await action(); }
    catch (error) { if (button.isConnected) showError(error); }
    finally { button.disabled = false; }
  };
  (form || button).addEventListener(form ? 'submit' : 'click', listener);
}

function button(parent, label, action, cls = 'entry-secondary') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = cls;
  element.textContent = label;
  parent.append(element);
  bindBusy(element, action);
  return element;
}

function signIn() {
  active = undefined;
  const panel = entry('打开我们的纪念册', cloud
    ? '登录后，接着写下上次见面没说完的事。'
    : '用两位虚构人物的纪念册，体验一次见面、一封信和彼此的留言。');
  if (cloud) {
    panel.innerHTML = `<form class="entry-form"><label>邮箱<input name="email" type="email" autocomplete="username" required></label>
      <label>密码<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="entry-button">登录纪念册</button></form>`;
    const form = panel.querySelector('form');
    bindBusy(form.querySelector('button'), async () => {
      await cloud.login(form.elements.email.value.trim(), form.elements.password.value);
      if (form.isConnected) await resume();
    }, form);
  } else {
    button(panel,'以小满的身份体验', () => openDemo(0), 'entry-button');
  }
  const row = document.createElement('div');
  row.className = 'entry-demo';
  panel.append(row);
  if (cloud) button(row,'体验示例纪念册', () => openDemo(0), 'entry-link');
  button(row,'以阿川的身份体验', () => openDemo(1), 'entry-link');
  if (!cloud) {
    const note = document.createElement('p');
    note.className = 'entry-note';
    note.textContent = '本地演示 · 内容保存在此浏览器。连接私人空间后可登录并跨设备同步。';
    row.append(note);
  }
}

async function openDemo(person) {
  const store = await createDemo(person);
  await journal(store, true);
}

async function leave(store, demo) {
  if (demo) store.close();
  else await store.logout();
  history.replaceState(null, '', location.pathname + location.search);
  if (demo && cloud?.user) await resume();
  else signIn();
}

async function journal(store, demo) {
  const version = reset();
  active = store;
  const root = document.createElement('div');
  app.append(root);
  try {
    const dispose = await mountJournal(root, store, {
      demo, onLogout: () => leave(store,demo), onBackup: () => exportBackup(store)
    });
    if (typeof dispose === 'function') {
      if (version === generation) cleanup = dispose;
      else dispose();
    }
  } catch(error) {
    if (version !== generation) return;
    const panel = entry('纪念册暂时无法打开','请检查网络，或稍后再试。');
    button(panel,'重新打开', () => journal(store,demo),'entry-button');
    button(panel,'返回登录', () => leave(store,demo),'entry-link');
    showError(error);
  }
}

async function resume() {
  if (!cloud?.user) { signIn(); return; }
  const version = generation;
  const identity = cloud.user.id;
  const state = await cloud.pairStatus();
  if (version !== generation || cloud.user?.id !== identity) return;
  if (state === 'paired') return journal(cloud, false);
  active = cloud;
  const details = {
    owner: '生成一次性邀请码，私下分享给你的伴侣。配对后就能共同记录。',
    invited: '输入伴侣发给你的一次性邀请码。',
    waiting: '等伴侣生成邀请码后，点击刷新配对状态。',
    denied: '这个账号没有收到此纪念册的邀请。'
  };
  const panel = entry('连接两个人的空间', details[state] || '请刷新配对状态。');
  if (state === 'owner') {
    const code = document.createElement('output');
    code.className = 'entry-code';
    button(panel,'生成邀请码',async () => { code.textContent = await cloud.createInvite(); },'entry-button');
    panel.append(code);
  }
  if (state === 'invited') {
    panel.innerHTML = `<form class="entry-form"><label>邀请码<input name="code" required autocomplete="off"></label>
      <button class="entry-button">接受邀请</button></form>`;
    const form = panel.querySelector('form');
    bindBusy(form.querySelector('button'), async () => {
      await cloud.acceptInvite(form.elements.code.value.trim()); await resume();
    }, form);
  }
  const row = document.createElement('div');
  row.className = 'entry-demo';
  panel.append(row);
  button(row,'刷新配对状态',resume,'entry-link');
  button(row,'退出账号',() => leave(cloud,false),'entry-link');
}

async function start() {
  try {
    cloud = await createCloud();
    if (cloud) cloud.onAuthChange(() => {
      if (active && active !== cloud) return;
      reset();
      active = undefined;
      resume().catch(error => {
        const panel = entry('账号状态已变更','重新连接后即可打开当前账号的空间。');
        button(panel,'重新连接',() => location.reload(),'entry-button');
        showError(error);
      });
    });
    await resume();
  } catch(error) {
    const panel = entry('连接暂时中断','请检查网络和私人空间的配置后重试。');
    button(panel,'重新连接', () => location.reload(),'entry-button');
    button(panel,'进入本地演示',() => openDemo(0),'entry-link');
    showError(error);
  }
}
start();
