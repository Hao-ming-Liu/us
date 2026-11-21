const shanghaiDay = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

function eventDate(post) {
  if (post.data.date) return post.data.date.slice(0, 10);
  const created = Date.parse(post.created_at);
  return Number.isFinite(created) ? shanghaiDay.format(created) : '';
}

function eventTime(post) {
  return post.data.time || post.data.date?.slice(11, 16) || '';
}

export function orderedPosts(meeting, posts) {
  const saved = Array.isArray(meeting.data.eventOrder) ? meeting.data.eventOrder : [];
  const ranks = new Map();
  for (const id of saved) if (!ranks.has(id)) ranks.set(id, ranks.size);
  return posts.filter(post => post.kind === 'post' && post.data.meetingId === meeting.id)
    .sort((a, b) => (ranks.get(a.id) ?? ranks.size) - (ranks.get(b.id) ?? ranks.size)
      || eventDate(a).localeCompare(eventDate(b)) || eventTime(a).localeCompare(eventTime(b))
      || Date.parse(a.created_at) - Date.parse(b.created_at)
      || String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id));
}

export function placePost(meeting, posts, postId, beforeId) {
  const order = orderedPosts(meeting, posts).map(post => post.id);
  if (!order.includes(postId) || (beforeId !== null && !order.includes(beforeId))) {
    throw new Error('所选事件不在这次见面中，请刷新后重试。');
  }
  if (postId === beforeId) return meeting;
  const next = order.filter(id => id !== postId);
  next.splice(beforeId === null ? next.length : next.indexOf(beforeId), 0, postId);
  return { ...meeting, data: { ...meeting.data, eventOrder: next } };
}
