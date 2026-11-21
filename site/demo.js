import { placePost } from './order.js';

const PEOPLE = [
  { id: "demo-xiaoman", email: "xiaoman@example.invalid", name: "小满" },
  { id: "demo-achuan", email: "achuan@example.invalid", name: "阿川" },
];
const COVER = "assets/arrival.jpg";
const PARCEL_COVER = "assets/citrus.jpg";
const SAMPLE_MEDIA = new Set([COVER, PARCEL_COVER]);
const KINDS = new Set(["meeting", "post", "comment", "message", "anniversary", "letter"]);
const shanghaiDay = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

function exampleEntries() {
  const entries = [];
  const add = (id, kind, person, time, data) => entries.push({
    id, kind, author_id: PEOPLE[person].id,
    created_at: new Date(time + "+08:00").toISOString(), data,
  });
  add("demo-reunion", "meeting", 0, "2026-10-17T08:12:00", {
    title: "在秋天的杭州见面", date: "2026-10-17", summary: "两张车票，把这个周末折在一起。",
    body: "从周六早上的站台，到周日傍晚的回程。", cover: { path: COVER, type: "image/jpeg" },
  });
  add("demo-arrival", "post", 1, "2026-10-17T11:15:00", {
    title: "出站口的那一眼", date: "2026-10-17", time: "09:40", meetingId: "demo-reunion",
    summary: "人群散开的那一刻，我先看见了你手里的桂花。",
    body: "列车到站前，你发来一句「慢慢走」。\n\n我还是把步子走得很快。快到闸机时，你举了举手里的花，像在好多好多陌生人里给我画了一个小小的坐标。",
    cover: { path: COVER, type: "image/jpeg" }, media: [],
  });
  add("demo-breakfast", "post", 0, "2026-10-18T08:15:00", {
    title: "最后一只小笼包", date: "2026-10-18", time: "07:45", meetingId: "demo-reunion",
    summary: "那家早点铺的蒸笼很小，刚好够我们分。",
    body: "你说最后一个归我，我说那就一人一半。窗外的自行车叮铃一声，老板又端上来一碗热豆浆。", media: [],
  });
  add("demo-parcel", "post", 0, "2026-10-12T19:12:00", {
    title: "从另一座城寄来的秋天", date: "2026-10-12", time: "17:20",
    summary: "打开包裹，最先掉出来的是那张手写的小纸条。",
    body: "橘子被整整齐齐地码成两排。纸条上写着，要挑有太阳的那个下午吃。我把纸条贴到了冰箱上。", media: [],
    cover: { path: PARCEL_COVER, type: "image/jpeg" },
  });
  add("demo-margin", "comment", 0, "2026-10-17T21:24:00", {
    postId: "demo-arrival", body: "其实我提前了二十分钟到，偷偷排练了好几次挥手。", signature: "捧花的小满", media: [],
  });
  add("demo-answer", "comment", 1, "2026-10-18T10:08:00", {
    postId: "demo-arrival", body: "难怪一下子就看见了。下次换我捧花。", signature: "正在看车票的阿川", media: [],
  });
  add("demo-note", "message", 1, "2026-11-06T19:10:00", {
    body: "今天经过时问了老板，他说冬天也不歇。下次我们再去，一起从第一笼等起。", read: false,
  });
  add("demo-note-two", "message", 0, "2026-11-05T20:00:00", {
    body: "那一小枝桂花已经夹进书里了。翻到它的那一页，就又回到了站台。", read: false,
  });
  add("demo-anniversary", "anniversary", 0, "2025-05-20T18:30:00", {
    title: "第一次牵手", date: "2025-05-20", body: "回家的桥很短，我们来回走了两遍。",
  });
  add("demo-open-letter", "letter", 0, "2026-09-07T21:15:00", {
    date: "2026-10-01", body: "读到这封信的时候，梧桐叶应该开始变黄了。愿我们都还有时间看看窗外。", read: false,
  });
  add("demo-sealed-letter", "letter", 1, "2026-10-20T20:15:00", {
    date: "2027-03-20", body: "记得去年秋天我们说，春天想去看一次花。希望寄出这封信的人已经买好了车票。", read: false,
  });
  return entries;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("liangren-fictional-demo-v1", 2);
    request.onupgradeneeded = event => {
      const db = request.result;
      if (event.oldVersion < 1) {
        const records = db.createObjectStore("entries", { keyPath: "id" });
        db.createObjectStore("files");
        for (const row of exampleEntries()) records.add(row);
      }
      db.createObjectStore("submissions", { keyPath: ["author", "requestId"] });
      const records = request.transaction.objectStore("entries");
      const parcel = records.get("demo-parcel");
      parcel.onsuccess = () => {
        const row = parcel.result;
        if (row?.kind === "post" && !row.data.cover) {
          row.data.cover = { path: PARCEL_COVER, type: "image/jpeg" };
          records.put(row);
        }
      };
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(new Error("无法打开本机演示空间，请检查浏览器的存储权限。"));
  });
}

function transaction(db, name, mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    let result, failure;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || (tx.error?.name === "QuotaExceededError"
      ? new Error("浏览器存储空间不足，无法保存。") : new Error("本机演示数据读写失败，请重试。")));
    run(tx.objectStore(Array.isArray(name) ? name[0] : name), value => { result = value; }, error => {
      failure = error;
      tx.abort();
    });
  });
}

export async function createDemo(person = 0) {
  const user = PEOPLE[Number(person)];
  if (!user) throw new Error("请选择一个演示身份。");
  const db = await openDatabase();
  const urls = new Map();
  const get = (name, key) => transaction(db, name, "readonly", (store, done) => {
    const req = store.get(key);
    req.onsuccess = () => done(req.result);
  });
  async function mediaBlob(path) {
    if (SAMPLE_MEDIA.has(path)) {
      const result = await fetch(new URL(path, import.meta.url));
      if (!result.ok) throw new Error("演示封面读取失败，请刷新重试。");
      return result.blob();
    }
    const blob = await get("files", path);
    if (!(blob instanceof Blob)) throw new Error("没有找到这份演示媒体。");
    return blob;
  }
  function close() {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    db.close();
  }

  function writeEntries(requestId, input, needsMeeting, change) {
    const names = requestId ? ["entries", "submissions"] : ["entries"];
    return transaction(db, names, "readwrite", (store, done, fail) => {
      const receipts = requestId && store.transaction.objectStore("submissions");
      const fingerprint = requestId && JSON.stringify(input);
      const apply = rows => {
        try {
          const result = change(store, rows);
          if (receipts) receipts.add({ author: user.id, requestId, fingerprint, recordId: result.id });
          done(result);
        } catch (error) { fail(error); }
      };
      const start = () => {
        if (!needsMeeting) return apply([]);
        const read = store.getAll();
        read.onsuccess = () => apply(read.result);
      };
      if (!receipts) return start();
      const previous = receipts.get([user.id, requestId]);
      previous.onsuccess = () => {
        if (!previous.result) return start();
        if (previous.result.fingerprint !== fingerprint) return fail(new Error("提交编号已用于其他操作。"));
        const read = store.get(previous.result.recordId);
        read.onsuccess = () => done(read.result);
      };
    });
  }

  function findMeeting(rows, id) {
    const meeting = rows.find(row => row.kind === "meeting" && row.id === id);
    if (!meeting) throw new Error("见面记录不存在。");
    return meeting;
  }
  return {
    user: { ...user }, memberIds: PEOPLE.map(person => person.id), demo: true, close, mediaBlob,
    async list() {
      const rows = await transaction(db, "entries", "readonly", (store, done) => {
        const req = store.getAll();
        req.onsuccess = () => done(req.result);
      });
      const today = shanghaiDay.format(new Date());
      return rows.filter(row => row.kind !== "letter" || row.author_id === user.id || row.data.date < today)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async add(kind, data, requestId) {
      if (!KINDS.has(kind)) throw new Error("未知的记录类型。");
      const input = ["add", kind, data];
      const { beforeId, ...fields } = data;
      data = fields;
      if (kind === "meeting") delete data.eventOrder;
      const inMeeting = kind === "post" && !!data.meetingId;
      if (beforeId !== undefined && !inMeeting) throw new Error("只能为见面中的事件指定位置。");
      if (kind === "message" || kind === "letter") {
        if (typeof data.body !== "string" || !data.body.trim()) throw new Error("请填写正文。");
        data = { ...data, read: false };
      }
      const row = { id: crypto.randomUUID(), kind, author_id: user.id, created_at: new Date().toISOString(), data };
      return writeEntries(requestId, input, inMeeting, (store, rows) => {
        if (inMeeting) {
          const meeting = findMeeting(rows, data.meetingId);
          if (beforeId !== undefined) store.put(placePost(meeting, [...rows, row], row.id, beforeId));
        }
        store.add(row);
        return row;
      });
    },
    movePost(meetingId, postId, beforeId, requestId) {
      return writeEntries(requestId, ["move", meetingId, postId, beforeId], true, (store, rows) => {
        const meeting = placePost(findMeeting(rows, meetingId), rows, postId, beforeId);
        store.put(meeting);
        return meeting;
      });
    },
    async markRead(id) {
      await transaction(db, "entries", "readwrite", store => {
        const req = store.get(id);
        req.onsuccess = () => {
          const row = req.result;
          const delivered = row?.kind === "message" ||
            (row?.kind === "letter" && row.data.date < shanghaiDay.format(new Date()));
          if (delivered && row.author_id !== user.id && !row.data.read) {
            row.data.read = true;
            store.put(row);
          }
        };
      });
    },
    async upload(file) {
      if (!(file instanceof Blob)) throw new Error("请选择一份媒体文件。");
      const path = "demo-media/" + crypto.randomUUID();
      await transaction(db, "files", "readwrite", store => store.add(file, path));
      return path;
    },
    async mediaUrl(path) {
      if (SAMPLE_MEDIA.has(path)) return new URL(path, import.meta.url).href;
      if (!urls.has(path)) {
        const blob = await mediaBlob(path);
        if (!urls.has(path)) urls.set(path, URL.createObjectURL(blob));
      }
      return urls.get(path);
    },
    async usage() {
      return transaction(db, "files", "readonly", (store, done) => {
        let bytes = 0;
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return done(bytes);
          bytes += cursor.value.size;
          cursor.continue();
        };
      });
    },
  };
}
