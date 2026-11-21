# 接通两个人的私密空间

准备两个人各自的邮箱，为这个纪念站新建一个独立的 Supabase 项目。手机和电脑使用同一个项目网址。正式账号、密码和管理员密钥都保存在公开仓库之外。

## 创建两个账号

1. 在 Authentication 的 Sign In / Providers 设置中启用 Email，关闭 **Allow new users to sign up** 和匿名登录。
2. 进入 **Authentication → Users → Add user → Create new user**。填写第一人的邮箱与独立密码，勾选 **Auto Confirm User**。重复一次创建第二人的账号。两人各自保管自己的密码。[Supabase Auth 设置](https://supabase.com/docs/guides/auth/general-configuration)
3. 打开 **SQL Editor → New query**，复制并运行本目录的 [schema.sql](schema.sql)。它会创建记录表、邀请函数和私密的 `memory-media` 存储桶。重新执行同一脚本可保留已有内容。
4. 在 SQL Editor 新建查询，把下面的两个示例邮箱替换成刚才创建的邮箱，再执行一次。第一个邮箱属于邀请人，第二个属于接受邀请的人。脚本将邮箱解析为已确认的 Auth 用户 ID。遇到 `query returned no rows` 时检查邮箱拼写和确认状态。遇到 `couple_pkey` 重复时，说明这个项目已有一对账号。

```sql
select memory_private.provision('first@example.com', 'second@example.com');
```

## 连接网站并配对

已配置过旧版后台的项目，更新信箱功能时在 SQL Editor 重新运行本目录的 `schema.sql` 即可启用未来信已读回执。原有留言和信件保留，不需要重新配对。

1. 在项目的 **Connect** 面板或 **Settings → API Keys** 获取 **Project URL** 和 **Publishable key**。旧项目也可使用 `anon` 公钥。把两项分别填入 [site/config.js](../site/config.js) 的 `SUPABASE_URL` 和 `SUPABASE_PUBLISHABLE_KEY`。以 `sb_secret_` 开头的密钥、`service_role` 密钥和数据库密码仅供管理员使用。[客户端密钥说明](https://supabase.com/docs/guides/getting-started/api-keys)
2. 确认项目开启 Data API，且暴露的 schema 包含 `public`。`memory_private` 保留为内部 schema。如已部署网页，重新部署更新后的 `site/`。本地预览使用 HTTP 服务。正式网址使用 HTTPS。
3. 第一人在网站登录，生成邀请码，通过两人已有的私密渠道交给第二人。邀请码 24 小时有效，重新生成后旧码立即失效。第二人用指定邮箱和密码登录，粘贴邀请码完成配对。第一人刷新即可进入。
4. 用手机创建一篇带照片的帖子，在电脑用另一账号刷新后打开，补写一条带署名的感想。给对方写一封开启日期为今天的未来信，用对方账号确认列表和导出都没有这封信。上海时间次日 00:00 起，对方刷新后可以阅读。退出后在无痕窗口打开同一个帖子链接，页面会要求登录。

## 已有项目更新见面时间线

在 SQL Editor 重新运行本目录的 `schema.sql`，然后部署新版网页。已有见面的事件默认按发生日期、时间和创建时间排列。两个人都能选择新事件的插入位置，或移动已有事件。顺序保存在见面记录的 `data.eventOrder` 中，刷新或更换设备后仍然有效。旧版客户端补写且未指定位置的事件会保留，在已手动排列的事件之后按发生时间显示。

## 照片、视频和备份

网页会把照片缩放并转换为 JPEG。短视频支持 MP4 和 WebM，时长最多 60 秒、大小最多 20 MiB。私密存储桶另设 25 MiB 的单文件上限，项目级上传限制也须足以容纳所选文件。文件通过已登录会话读取，网页使用浏览器临时媒体地址，切换账号或退出后会回收这些地址。正式记录权限和未来信的开启日期由数据库校验。[私密存储与访问策略](https://supabase.com/docs/guides/storage/security/access-control) · [数据库行级权限](https://supabase.com/docs/guides/database/postgres/row-level-security)

在站内导出后，在电脑上打开备份并抽查实际照片或视频。备份包含该账号当时有权阅读的记录，包括自己写的未到期信件。请放在两人约定的私密位置。云空间的用量统计包含已经上传但尚未成功发布的文件。

如果一次发布中断，已上传的附件仍仅原上传者可见。管理员可运行下面的只读查询列出七天前上传、至今未关联记录的文件。与上传者核对并保留原件后，可在 Storage 面板按完整路径清理。[Supabase 文件删除说明](https://supabase.com/docs/guides/storage/management/delete-objects)

```sql
select o.name, o.created_at, o.metadata->>'size' as bytes
from storage.objects o
left join memory_private.attachments a on a.path = o.name
where o.bucket_id = 'memory-media'
  and a.path is null
  and o.created_at < now() - interval '7 days'
order by o.created_at;
```
