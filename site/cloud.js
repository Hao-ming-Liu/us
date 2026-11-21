import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const extensions = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'],
  ['image/gif', 'gif'], ['image/avif', 'avif'], ['video/mp4', 'mp4'],
  ['video/webm', 'webm'], ['video/quicktime', 'mov'],
]);

function unwrap({ data, error }) {
  if (!error) return data;
  if (error.code === 'invalid_credentials') throw new Error('邮箱或密码不正确。');
  if (error.code === 'email_not_confirmed') throw new Error('这个账号的邮箱尚未确认。');
  if (error.status === 429) throw new Error('尝试次数过多，请稍后再试。');
  if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
    throw new Error('暂时无法连接云空间，请检查网络后重试。');
  }
  throw new Error(error.message || '云空间暂时无法完成请求。');
}

export async function createCloud() {
  if (!SUPABASE_URL && !SUPABASE_PUBLISHABLE_KEY) return null;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('云空间配置不完整，请在 config.js 中填写项目网址和公开客户端密钥。');
  }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.95.3/+esm');
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  const bucket = client.storage.from('memory-media');
  const listeners = new Set();
  const mediaPromises = new Map();
  const objectUrls = new Set();
  const pendingSubmissions = new Map();
  let user = null;
  let generation = 0;

  function updateUser(next) {
    if ((next?.id ?? null) === (user?.id ?? null)) return;
    generation++;
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
    mediaPromises.clear();
    pendingSubmissions.clear();
    user = next ? { id: next.id, email: next.email } : null;
    // Auth 回调内不执行 Supabase 请求，以免和 SDK 自身的会话锁互相等待。
    for (const callback of listeners) setTimeout(() => callback(user), 0);
  }
  updateUser(unwrap(await client.auth.getSession()).session?.user);
  client.auth.onAuthStateChange((_event, session) => updateUser(session?.user));

  function assertCurrent(start) {
    if (!user || start !== generation) throw new Error('登录身份已变更，请重新打开此页。');
  }
  async function authorized(request) {
    const start = generation;
    assertCurrent(start);
    const response = await request;
    assertCurrent(start);
    return unwrap(response);
  }
  async function mediaBlob(path) {
    return authorized(bucket.download(path));
  }
  async function submit(operation, args, requestId) {
    // 表单重试会重新创建对象。按操作与内容复用待确认的提交编号。
    const draft = JSON.stringify([operation, args]);
    const id = requestId ?? pendingSubmissions.get(draft) ?? crypto.randomUUID();
    pendingSubmissions.set(draft, id);
    const row = await authorized(client.rpc(operation, { ...args, request_id: id }).single());
    if (pendingSubmissions.get(draft) === id) pendingSubmissions.delete(draft);
    return row;
  }

  return {
    get user() { return user; },
    onAuthChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    async login(email, password) {
      updateUser(unwrap(await client.auth.signInWithPassword({ email: email.trim(), password })).user);
      return user;
    },
    async logout() {
      unwrap(await client.auth.signOut({ scope: 'local' }));
      updateUser(null);
    },
    pairStatus() { return authorized(client.rpc('memory_pair_status')); },
    createInvite() { return authorized(client.rpc('memory_create_invite')); },
    acceptInvite(code) { return authorized(client.rpc('memory_accept_invite', { code })); },
    async list() {
      const start = generation;
      const records = [];
      let lastId = '';
      for (;;) {
        let query = client.from('memory_records').select('id,kind,author_id,created_at,data')
          .order('id').limit(300);
        if (lastId) query = query.gt('id', lastId);
        const page = await authorized(query);
        assertCurrent(start);
        if (!page.length) break;
        records.push(...page);
        lastId = page.at(-1).id;
      }
      return records.sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    add(kind, data, requestId) {
      return submit('memory_add_record', { record_kind: kind, payload: data }, requestId);
    },
    movePost(meetingId, postId, beforeId, requestId) {
      return submit('memory_move_post', { meeting_id: meetingId, post_id: postId, before_id: beforeId }, requestId);
    },
    markRead(id) { return authorized(client.rpc('memory_mark_read', { message_id: id })); },
    async upload(file) {
      assertCurrent(generation);
      const extension = extensions.get(file?.type);
      if (!extension) throw new Error('请选择 JPG、PNG、WebP、GIF、AVIF、MP4、WebM 或 MOV 文件。');
      if (!file.size || file.size > 25 * 1024 * 1024) throw new Error('单个文件应大于 0 且不超过 25 MiB。');
      const path = user.id + '/' + crypto.randomUUID() + '.' + extension;
      await authorized(bucket.upload(path, file, { contentType: file.type, cacheControl: '0', upsert: false }));
      return path;
    },
    mediaBlob,
    async mediaUrl(path) {
      const start = generation;
      assertCurrent(start);
      if (!mediaPromises.has(path)) {
        const promise = mediaBlob(path).then(blob => {
          assertCurrent(start);
          const url = URL.createObjectURL(blob);
          objectUrls.add(url);
          return url;
        }).catch(error => {
          if (generation === start) mediaPromises.delete(path);
          throw error;
        });
        mediaPromises.set(path, promise);
      }
      return mediaPromises.get(path);
    },
    usage() { return authorized(client.rpc('memory_usage')); },
  };
}
