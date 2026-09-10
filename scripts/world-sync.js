/* ============================================================================
 * 世界同步装置 (lh-world-sync) v1.1.0
 * ----------------------------------------------------------------------------
 * 功能：把一个世界当作「主世界」保存配置快照；新世界一键读回。
 * v1.1.0：按外部代码审阅（12 条）逐条核验后修复（核验结论：11 条属实，1 条已
 *   在 v1.0.9 修掉）。本轮改动：
 *   ① 【会出错】新世界漏恢复。模块勾选列表原先只由「当前世界已有的 Setting」
 *      生成，主快照里有、本世界还没写过的模块根本不出现在列表里 → 永远恢复
 *      不了（而底层 applySnapshot 其实支持创建不存在的 Setting，能力被前面的
 *      选择过滤掉了）。改为 当前世界 ∪ 主快照 的并集，行尾标注「来自主快照」。
 *   ② 【会出错】「全选」盖掉单独取消。全选默认勾选且只做单向联动，用户取消
 *      某个模块后再点恢复仍会把该模块恢复。改为 selection 永远读子项勾选，
 *      子项变化反向维护全选的 checked / indeterminate。
 *   ③ 【会出错】「从文件导入」名不副实。原先只把当前世界恢复成该快照，不写
 *      服务器主快照（README 却写成跨服务器迁移手段）。改为导入时二选一：
 *      设为主快照 / 仅恢复本世界。
 *   ④ 恢复范围（按模块勾选）存为世界级偏好 nsScope，「保存范围」后自动提醒
 *      与状态检测都遵守它（此前自动提醒自己造了一套接近全选的选择）。
 *   ⑤ 抽 buildSelection()：手动恢复 / 自动提醒 / 文件导入 / 状态检测四条路径
 *      共用同一套选择规则。原先自动路径 `if (ns !== "core")` 排除整个 core，
 *      手动路径不排除 → 会出现「状态栏一直报差异、自动恢复永不处理」。
 *      现在只特殊处理 core.moduleConfiguration，其余 core.* 一并纳入勾选。
 *   ⑥ parseSnapshot 增强校验（app / schema / key 类型 / 重复键 / modules 结构）
 *      + describeSnapshotCompat：系统版本与缺失模块数提示。
 *   ⑦ 回档账本加 status / rolledBackAt / after：回档过一次会标注，并在
 *      「恢复之后又被人工改过」时提示仍要覆盖。
 *   ⑧ 轻量操作锁 operation-lock.json：两个 GM 同时恢复时后进入者被拒。
 *      ⚠ 文件锁不是原子的（无 CAS），靠「写后回读 operationId」判定归属，
 *      属尽力而为；崩溃后由 30 秒 TTL 自动失效，不会死锁。
 *   ⑨ 所有写入口统一 assertGM()（原先只有 UI 层限制，window 接口裸奔）。
 *   ⑩ 工程卫生：isJSONEqual 改稳定序列化（对象键序不同不再算差异）、
 *      escapeHtml 补引号转义（该函数被用在 value="…" 属性上下文）、
 *      删除死代码 storageList() / getItemValue()、CSS 头版本号同步。
 * v1.0.9：修复「回档账本跨世界串数据」。原实现把账本固定写进 apply-log.json
 *   且只记世界标题（标题可重复、可改名），于是：A 世界恢复 → B 世界恢复
 *   （账本被覆盖）→ 回 A 点「回档」，写进 A 的是 B 的旧值。实测复现：服务器
 *   上账本归属「银爪月影」而主快照归属「初始世界（数据）」，账本里含 5.6KB 的
 *   core.moduleConfiguration（模块启用列表），一旦跨世界回档就会把别的世界的
 *   模块开关照搬过来，刷新页面后一堆模块开开关关对不上。
 *   对策：① 账本按世界分区 {schema:2, worlds:{"<worldId>":{...}}}，worldId 取
 *   game.world.id（官方同源用法：client/documents/abstract/client-document.mjs:943
 *   worldId: game.world.id），不受世界改名影响；
 *   ② 回档只读本世界那一格，读不到就拒绝（不写任何东西）；
 *   ③ 旧版单条格式账本一律不认领（宁可不回档，也不乱写）；
 *   ④ 回档确认弹窗显示「记录归属：<世界名> · 写入时间」。
 * v1.0.8：修复导出文件名丢失（下载成 blob UUID、无扩展名）。根因=FVTT
 *   全局 click 监听（client/game.mjs:2018 → :2049 _onClickHyperlink）对
 *   任何 a[href] 执行 preventDefault + window.open，把 <a download> 干掉。
 *   对策：捕获阶段截断传播 + bubbles:false 的 MouseEvent 派发，并在面板里
 *   额外提供一个手动下载链接兜底。
 * v1.0.7：导出文件名改为 world-snapshot-20260909-1231.json 这类干净格式
 *   （本地时间、无 T/Z/冒号），导出后面板直接显示实际文件名便于核对。
 * v1.0.6：全界面文案规范化（面向通用发布：去掉口语化措辞，统一为
 *   「基准快照 / 恢复 / 差异」等规范表述）；修复「导出快照」在新标签页
 *   打开 blob 文档并卡死的问题——MIME 改为 application/octet-stream 强制
 *   下载、导出用紧凑 JSON、撤销 objectURL 延后到 60 秒。
 * v1.0.5：面板瘦身——主界面只剩「存主世界 / 恢复主世界 / 回档」三个按钮，
 *   细调恢复范围、文件导入导出、自动提醒全部收进「高级」折叠区（默认收起）；
 *   模块列表补中文显示名（如 calendaria → 日历），不再是看不懂的英文 ID。
 * v1.0.4：应用后自动刷新页面（不必手动 F5）；默认忽略
 *   foundry-mcp-bridge.lastActivity 等心跳键（否则每次进世界都提示假差异）。
 * v1.0.3：自动应用/面板默认同步「模组启用状态」，用户关掉的模块跟着主世界
 *   一起恢复（刷新页面后生效）。
 *   ① 存主世界：当前世界全部 world 级设置 → 快照文件（模块 storage 目录）
 *   ② 自动提醒：进世界（GM）发现主快照且与本世界有差异 → 弹窗问是否应用
 *   ③ 按模块勾选：面板里按命名空间勾选同步范围（含「模块启用列表」可选项）
 *   ④ 文件导入导出：快照可下载/上传/剪贴板，跨服务器搬家
 *   ⑤ 回档：每次应用自动记 applyLog（改了什么/关了什么），按日志精确恢复
 *
 * 机制出处（FVTT 13.351 源码，F:\BaiduSyncdisk\FVTT\...\resources\app\)：
 *   - world 级设置 = Setting 文档集合，game.settings.storage.get("world")
 *     （client/helpers/client-settings.mjs:42-47，CONST.SETTING_SCOPES.WORLD
 *     = new foundry.documents.collections.WorldSettings(worldSettings)）
 *   - 未注册键 game.settings.set/get 直接抛错（client-settings.mjs:271
 *     '"${id}" is not a registered game setting'）→ 读写必须走 storage 全集，
 *     批量写入走 Setting 文档静态 updateDocuments/createDocuments
 *   - Setting 文档 schema：key(=namespace.key), value(JSONField), user
 *     （common/documents/setting.mjs:39-48）；core.permissions GM-only（:57）
 *   - 快照存模块目录：manifest "persistentStorage": true +
 *     FilePicker.uploadPersistent(packageId, path, file, ...)
 *     （client/applications/apps/file-picker.mjs:505-513；
 *      manifest 字段 common/packages/base-package.mjs:394）
 *   - 设置菜单入口 registerMenu 的 type 须为 FormApplication/ApplicationV2
 *     子类（client-settings.mjs:189-192）
 *   - 复制一律 game.clipboard.copyPlainText（HTTP 服务器 navigator.clipboard
 *     undefined；client/core/clipboard.js:19-34）
 *   血泪教训参照：01_跑团工具\FVTT技术资料\搓怪物做效果做mod任何时候，
 *   看到了一定要看仔细看\（开工方法论/CSS面板配置/教学视频库优化篇）
 * ==========================================================================*/
"use strict";

/* ============================ 版本与探针 ============================ */
const MODULE_ID = "lh-world-sync";
const MODULE_VERSION = "1.1.0";
window.__WSYNC_VER = MODULE_VERSION; // 探针：控制台输入 window.__WSYNC_VER 验版本

/* ============================ 常量 ============================ */
// 快照文件（固定名覆盖写，游戏内无删除 API，旧文件不清理）
const STORAGE_DIR = "modules/lh-world-sync/storage";
const MASTER_FILE = "world-snapshot-master.json";
const APPLOG_FILE = "apply-log.json";
// 回档账本 schema 2（v1.0.9）：账本按世界分区，A/B 世界不再互相覆盖
const APPLOG_SCHEMA = 2;
// 操作锁（v1.1.0）：两个 GM 同时恢复时，后进入者被拒。
// 注意：文件锁不是原子操作（没有 CAS），靠「写后回读 operationId」判定归属，
// 属尽力而为；TTL 到期自动失效，所以崩溃/关页面不会留下永久死锁。
const LOCK_FILE = "operation-lock.json";
const LOCK_TTL_MS = 30000;
// 恢复范围偏好（世界级设置）：{ mode:"all"|"custom", ns:{}, includeModuleConfig }
const SCOPE_SETTING = "nsScope";
// 当前世界的稳定标识：world.id 不随世界改名而变
// （官方同源用法：client/documents/abstract/client-document.mjs:943
//   worldId: game.world.id —— 官方导出文档时就是用 world.id 标世界归属）
function currentWorldId() {
  const id = game.world?.id;
  return id ? String(id) : String(game.world?.title ?? "unknown");
}
// 默认排除键（导出+导入双端防御；导入侧无视一切强制跳过）。
// foundry-mcp-bridge.lastActivity 是心跳时间戳：每次刷新页面都会变，
// 同步它没有意义，还会让「恢复主世界」每次都提示一条假差异——默认忽略。
const EXCLUDE_DEFAULT = ["core.time", "core.permissions", "foundry-mcp-bridge.lastActivity"];
// 判断键是否属于「不参与同步」的默认排除集合（与用户设置取并集）
function isExcludedKey(key) {
  const user = (game.settings.get(MODULE_ID, "excludeKeys") || []);
  return EXCLUDE_DEFAULT.includes(key) || user.includes(key);
}
// 侧边栏按钮（挂在右侧 tab 区「设置」齿轮之后，用户指定位置）
const BTN_ID = "wsync-side-btn";
const BTN_ICON = "fa-solid fa-arrows-rotate";

/* ============================ 主题 ============================ */
const THEMES = [
  { id: "deep",      name: "深空蓝" },
  { id: "bluewhite", name: "蓝白" },
  { id: "purgreen",  name: "琉璃绿" },
  { id: "gold",      name: "鎏金" },
  { id: "mint",      name: "薄荷" }
];
// 主题选择 = 本机选择（client 级，玩家可以点圆点换自己的视角）
const THEME_SETTING = "theme";
const THEME_BY_ID = Object.fromEntries(THEMES.map(t => [t.id, t.name]));

/* ============================ 设置注册 ============================ */
Hooks.on("init", () => {
  // 自动提醒开关：默认开；「不再自动提醒」写 false；面板/设置页都可改回
  game.settings.register(MODULE_ID, "autoPrompt", {
    name: "进入世界时自动提醒",
    hint: "开启后，GM 进入世界时若发现与主世界基准存在差异，会自动弹窗询问是否恢复。",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  // 主题：本机
  game.settings.register(MODULE_ID, THEME_SETTING, {
    name: "面板主题",
    hint: "同步面板的配色方案，每位用户可自行选择。",
    scope: "client",
    config: false,
    type: String,
    default: "deep"
  });
  // 高级：不参与恢复的设置（世界级，逗号分隔文本，GM 专用）
  game.settings.register(MODULE_ID, "excludeKeys", {
    name: "不参与恢复的设置",
    hint: "逗号分隔的设置键，这些键不会被保存到快照、也不会被恢复。默认排除 core.time（世界时间）、core.permissions（权限）与 foundry-mcp-bridge.lastActivity（模组心跳）。",
    scope: "world",
    config: false,
    restricted: true,
    type: Array,
    default: EXCLUDE_DEFAULT
  });
  // 恢复范围偏好（世界级，v1.1.0）：面板里点「保存范围」写入，自动提醒也遵守。
  // mode:"all" = 全部模块都跟随恢复；mode:"custom" = 只恢复 ns 里勾选的模块。
  game.settings.register(MODULE_ID, SCOPE_SETTING, {
    name: "恢复范围",
    hint: "这个世界每次恢复主世界时包含哪些模块。默认全部；在面板里取消勾选并点「保存范围」后，进入世界的自动提醒也会遵守这个范围。",
    scope: "world",
    config: false,
    restricted: true,
    type: Object,
    default: { mode: "all", ns: {}, includeModuleConfig: true }
  });
});

/* ============================ 工具 ============================ */
const norm = (p) => String(p).replace(/\\/g, "/").replace(/^\/+/, "");
const getTheme = () => game.settings.get(MODULE_ID, THEME_SETTING) || "deep";
const setTheme = (t) => game.settings.set(MODULE_ID, THEME_SETTING, t).then(() => {
  const winEl = $("#wsync-panel-win, .wsync-app");
  winEl.each((i, el) => {
    const $w = $(el);
    $w.attr("data-theme", t);
  });
});
// 稳定序列化（键名排序）：JSON.stringify 对 {a:1,b:2} 与 {b:2,a:1} 给出不同结果，
// 直接拿来深比较会把「同值不同键序」误判成差异，导致假差异（审阅第 12 条）。
function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}
const isJSONEqual = (a, b) => (a === b) || (stableStringify(a) === stableStringify(b));
// HTML 转义：除 &<> 外必须转引号——本函数被用在 value="…" / download="…"
// 这类属性上下文，值里若含引号会破坏属性边界（审阅第 12 条）。
const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const shortVal = (v) => {
  const s = (typeof v === "string") ? v : JSON.stringify(v);
  if (s == null) return "null";
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
};
const notify = {
  ok: (m) => ui.notifications.info(m, { console: false }),
  warn: (m) => ui.notifications.warn(m, { console: false }),
  err: (m) => ui.notifications.error(m, { console: false })
};
const copyText = (text) => game.clipboard.copyPlainText(text);
// 文件名时间戳：world-snapshot-20260909-1231.json
// 用本地时间、不含 T/Z/冒号，任何操作系统都不会因非法字符丢扩展名
const stamp = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

/* ---------- storage 目录读写（官方 uploadPersistent / browse / fetch） ---------- */
async function storageEnsureDir() {
  // 服务端 upload 不会自动建目录（dist/files/local.mjs upload 对 target 目录 existsSync 检查），
  // 必须先 createDirectory；若失败（权限/位置禁止）会真实上抛，让面板报错而不是静默继续。
  try {
    await FilePicker.createDirectory("data", STORAGE_DIR);
  } catch (e) { /* 目录已存在时 mkdirSync 抛 EEXIST，属正常 */ }
  // 目录确实可用才继续（browse 在目录不可访问时抛错）
  await FilePicker.browse("data", STORAGE_DIR, {});
}
async function storageWrite(name, text) {
  await storageEnsureDir();
  // 金标准（wss SettingsCompiler.js saveAgnosticToFile）：uploadPersistent 的 path 参数必须是
  // storage 内的「目录」路径（空串=根），文件名由 File 构造器第二个参数提供；传文件名会被服务端
  // 当作目录做 existsSync 检查而报 "Target directory ... does not exist"。
  const file = new File([text], name, { type: "application/json" });
  const res = await FilePicker.uploadPersistent(MODULE_ID, "", file, {}, { notify: false });
  if (!res?.path) throw new Error("快照写入失败:" + JSON.stringify(res));
  return res.path;
}
async function storageRead(name) {
  const url = "/" + norm(STORAGE_DIR) + "/" + name;
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.text();
  } catch (e) { return null; }
}
/* ---------- 权限与操作锁（v1.1.0） ---------- */
// 所有写入口统一守卫（审阅第 10 条）：原先只有 UI 层限制，
// window.lhWorldSync.applySnapshot / rollback 对所有人生效。
function assertGM() {
  if (game.user?.isGM) return true;
  console.warn("[lh-world-sync] 已拒绝：该操作仅限 GM（当前用户：" + (game.user?.name ?? "?") + "）");
  try { notify.err("只有 GM 可以执行世界同步操作。"); } catch (e) { /* 忽略 */ }
  return false;
}
// 轻量操作锁：两个 GM 同时点「恢复」时后进入者被拒绝。
// 实现说明（这是尽力而为的锁，不是严格互斥锁，别当分布式锁用）：
//   ① 读现有锁 → 未过期且属于别人 = 直接拒绝；
//   ② 写入自己的 operationId → 回读校验：若 operationId 已不是自己，说明
//      有人在我之后又写了一次 → 我放弃（后写者赢）；
//   ③ TTL 30 秒，持有者崩溃/关页面后自动失效，不会留下死锁。
async function acquireLock(opName) {
  const now = Date.now();
  const text = await storageRead(LOCK_FILE);
  if (text) {
    try {
      const l = JSON.parse(text);
      if (l?.expiresAt > now && l.worldId === currentWorldId() && l.userId !== game.user.id) {
        return { ok: false, holder: l };
      }
    } catch (e) { /* 坏文件按无锁处理 */ }
  }
  const lock = {
    operationId: foundry.utils.randomID(),
    op: opName,
    worldId: currentWorldId(),
    worldTitle: game.world?.title ?? "",
    userId: game.user.id,
    userName: game.user.name ?? "",
    startedAt: new Date(now).toISOString(),
    expiresAt: now + LOCK_TTL_MS
  };
  await storageWrite(LOCK_FILE, JSON.stringify(lock, null, 2));
  const back = await storageRead(LOCK_FILE);
  try {
    const l2 = JSON.parse(back);
    if (l2?.operationId !== lock.operationId) return { ok: false, holder: l2 };
  } catch (e) { /* 回读失败不强求，继续执行 */ }
  return { ok: true, lock };
}
async function releaseLock(lock) {
  if (!lock?.operationId) return;
  try {
    const text = await storageRead(LOCK_FILE);
    const l = JSON.parse(text);
    if (l?.operationId === lock.operationId) {
      await storageWrite(LOCK_FILE, JSON.stringify({ ...l, releasedAt: new Date().toISOString(), expiresAt: 0 }, null, 2));
    }
  } catch (e) { /* 忽略 */ }
}

/* ---------- 世界设置全集读写 ---------- */
function collectWorldSettings() {
  const store = game.settings.storage.get("world");
  const out = new Map(); // key -> { value, doc }
  for (const doc of store.values()) {
    if (doc.user) continue;                 // user 级设置（玩家个人）不导出
    const key = doc?.key;
    if (!key || isExcludedKey(key)) continue;
    if (key.startsWith(MODULE_ID + ".")) continue; // 本模块自指键
    out.set(key, { value: doc.value, doc });
  }
  return out;
}
function getSettingDoc(key) {
  return game.settings.storage.get("world").getSetting(key, null);
}

/* ---------- 快照组装 ---------- */
function buildSnapshot() {
  const all = collectWorldSettings();
  const settings = [...all.entries()].map(([key, { value }]) => ({ key, value }));
  const modVersions = {};
  for (const m of game.modules.values()) {
    if (m.active) modVersions[m.id] = m.version;
  }
  return {
    schema: 1,
    app: MODULE_ID,
    appVersion: MODULE_VERSION,
    sourceWorld: game.world?.title ?? game.world?.id ?? "",
    sourceWorldId: currentWorldId(),
    savedAt: new Date().toISOString(),
    systemId: game.system?.id ?? "",
    systemVersion: game.system?.version ?? "",
    coreVersion: game.version ?? "",
    modules: modVersions,
    settings
  };
}
// 快照校验（v1.1.0 增强，审阅第 7 条）：
// 硬性拒绝——非 JSON / 非对象 / app 不符 / schema 比本模块新 / settings 非数组 /
// 条目结构非法 / key 非字符串或不含点 / 重复 key / modules 结构非法。
// 软性提示——系统与版本差异交给 describeSnapshotCompat()，展示后由用户决定。
function parseSnapshot(text) {
  let snap;
  try { snap = JSON.parse(text); }
  catch (e) { throw new Error("不是合法的 JSON 文件"); }
  if (!snap || typeof snap !== "object" || Array.isArray(snap)) throw new Error("快照内容不是对象");
  if (snap.app !== MODULE_ID) throw new Error("这不是本模块导出的快照（app 字段不是 " + MODULE_ID + "）");
  if (snap.schema !== 1) {
    if (typeof snap.schema === "number" && snap.schema > 1) {
      throw new Error("快照格式版本 v" + snap.schema + " 比本模块支持的 v1 新，请先升级模块再导入");
    }
    console.warn("[lh-world-sync] 快照缺少 schema 字段，按 v1 处理");
  }
  if (!Array.isArray(snap.settings)) throw new Error("快照缺少设置清单（settings 不是数组）");
  const seen = new Set();
  for (const item of snap.settings) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("设置清单里存在非法条目");
    if (typeof item.key !== "string" || !item.key.includes(".")) throw new Error("设置清单里存在非法键：" + String(item.key));
    if (seen.has(item.key)) throw new Error("快照里有重复的设置键：" + item.key);
    seen.add(item.key);
  }
  if (snap.modules != null && (typeof snap.modules !== "object" || Array.isArray(snap.modules))) {
    throw new Error("快照的 modules 字段结构非法");
  }
  return snap;
}
// 版本/环境差异提示（只提示，不阻断，交给用户决定）
function describeSnapshotCompat(snap) {
  const notes = [];
  const sysNow = game.system?.id ?? "";
  const sysSnap = snap.systemId ?? "";
  if (sysSnap && sysNow && sysSnap !== sysNow) {
    notes.push(`快照来自 <b>${escapeHtml(sysSnap)}</b> 系统，当前世界是 <b>${escapeHtml(sysNow)}</b>`);
  } else if (snap.systemVersion && game.system?.version && snap.systemVersion !== game.system.version) {
    notes.push(`系统版本不同：快照 ${escapeHtml(snap.systemVersion)} → 当前 ${escapeHtml(game.system.version)}`);
  }
  if (snap.coreVersion && game.version && snap.coreVersion !== game.version) {
    notes.push(`Foundry 版本不同：快照 ${escapeHtml(snap.coreVersion)} → 当前 ${escapeHtml(game.version)}`);
  }
  const snapMods = Object.keys(snap.modules ?? {});
  if (snapMods.length) {
    const missing = snapMods.filter(id => !game.modules.get(id));
    const inactive = snapMods.filter(id => { const m = game.modules.get(id); return m && !m.active; });
    if (missing.length) notes.push(`快照里有 <b>${missing.length}</b> 个模组当前服务器未安装（${escapeHtml(missing.slice(0, 5).join("、"))}${missing.length > 5 ? " 等" : ""}）`);
    if (inactive.length) notes.push(`快照里有 <b>${inactive.length}</b> 个模组当前是关闭状态`);
  }
  return notes;
}

/* ---------- 差异 ---------- */
// selection: { ns: { [ns]: true }, includeModuleConfig: bool }
function diffSnapshot(snap, selection) {
  const current = new Map([...collectWorldSettings().entries()].map(([k, v]) => [k, v.value]));
  const changed = [];
  const nsCount = {};
  for (const item of snap.settings) {
    const key = item.key;
    if (isExcludedKey(key)) continue;       // 排除键永不参与差异（心跳等无意义键）
    const ns = key.split(".")[0];
    if (key === "core.moduleConfiguration") {
      if (!selection?.includeModuleConfig) continue;
    } else if (selection?.ns && !selection.ns[ns]) continue;
    const cur = current.has(key) ? current.get(key) : undefined;
    if (!isJSONEqual(cur, item.value)) {
      changed.push({ key, from: cur, to: item.value });
      nsCount[ns] = (nsCount[ns] || 0) + 1;
    }
  }
  return { changed, nsCount };
}
function summaryText(changed) {
  const nsCount = {};
  for (const c of changed) {
    const ns = c.key.split(".")[0];
    nsCount[ns] = (nsCount[ns] || 0) + 1;
  }
  const parts = Object.entries(nsCount).sort((a, b) => b[1] - a[1]);
  const head = parts.slice(0, 8).map(([ns, n]) => escapeHtml(ns) + " × " + n).join("、");
  const more = parts.length > 8 ? " 等" + parts.length + " 个模块" : "";
  return { head, more, total: changed.length, nsCount };
}

/* ---------- 写入（批量，官方文档 API） ---------- */
function settingDocumentClass() {
  return foundry.utils.getDocumentClass("Setting");
}
function describeChange(from, to) {
  const falsy = (v) => v === false || v === null || v === undefined || v === 0 || (Array.isArray(v) && !v.length) || (v && typeof v === "object" && !Object.keys(v).length);
  if (falsy(from) && !falsy(to)) return "→开启";
  if (!falsy(from) && falsy(to)) return "→关闭";
  return "→修改";
}
// 回档账本（v1.0.9 起按世界分区）：
// { schema: 2, worlds: { "<worldId>": { ts, worldId, worldTitle, appVersion, prev } } }
// prev = { key: { present, value } }；present:false 表示该键在恢复前并不存在。
function emptyApplyLogStore() { return { schema: APPLOG_SCHEMA, worlds: {} }; }
// 读整个账本容器。旧版单条格式（无 schema/worlds）一律不认领：
// 宁可不回档，也不能把来源不明的旧值写进当前世界。
async function readApplyLogStore() {
  const text = await storageRead(APPLOG_FILE);
  if (!text) return emptyApplyLogStore();
  try {
    const raw = JSON.parse(text);
    if (raw && raw.schema === APPLOG_SCHEMA && raw.worlds && typeof raw.worlds === "object") return raw;
    console.warn("[lh-world-sync] 检测到旧格式账本（无世界分区），已忽略，不再作为回档依据");
    return emptyApplyLogStore();
  } catch (e) { return emptyApplyLogStore(); }
}
// 写入时只覆盖「本世界」那一格，其他世界的记录原样保留
async function writeApplyLog(prevMap, afterMap) {
  const store = await readApplyLogStore();
  const wid = currentWorldId();
  store.worlds[wid] = {
    ts: new Date().toISOString(),
    worldId: wid,
    worldTitle: game.world?.title ?? "",
    appVersion: MODULE_VERSION,
    // status: pending（尚未回档）/ rolled-back（已回档过一次，再次回档会二次确认）
    // after：本次恢复「写入的值」，用于发现「恢复之后又被人工改过」的情况
    status: "pending",
    rolledBackAt: null,
    after: afterMap ? Object.fromEntries([...afterMap.entries()]) : {},
    prev: Object.fromEntries([...prevMap.entries()].map(([k, v]) => [k, { present: v.present, value: v.value }]))
  };
  await storageWrite(APPLOG_FILE, JSON.stringify(store, null, 2));
}
// 回档成功后就地标记（审阅第 8 条：原实现可无限重复回档，几天后再点一次仍写旧值）
async function markLogRolledBack() {
  const store = await readApplyLogStore();
  const wid = currentWorldId();
  const e = store.worlds?.[wid];
  if (!e) return;
  e.status = "rolled-back";
  e.rolledBackAt = new Date().toISOString();
  await storageWrite(APPLOG_FILE, JSON.stringify(store, null, 2));
}
// 回档前自检：哪些键在「上次恢复之后」又被人改过（当前值 ≠ 账本记的 after）
function findDriftedKeys(log) {
  const cur = collectWorldSettings();
  const drifted = [];
  for (const [key, after] of Object.entries(log.after ?? {})) {
    const now = cur.has(key) ? cur.get(key).value : undefined;
    if (!isJSONEqual(now, after)) drifted.push(key);
  }
  return drifted;
}
// 只返回「当前世界」的账本条目；读不到 = 本世界没有可回档记录
async function readApplyLog() {
  const store = await readApplyLogStore();
  const entry = store.worlds?.[currentWorldId()];
  return (entry && entry.prev) ? entry : null;
}
// 展示用时间：ISO → 本地 2026-09-10 01:03（ISO 串人读不了）
function formatTs(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso ?? "");
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function applySnapshot(snap, selection) {
  // 写入口守卫（审阅第 10 条）：window.lhWorldSync.applySnapshot 对所有人生效
  if (!assertGM()) return { applied: [], skipped: 0, denied: true };
  const diff = diffSnapshot(snap, selection);
  if (!diff.changed.length) return { applied: [], skipped: 0 };
  // 操作锁（审阅第 9 条）：另一个 GM 正在恢复时拒绝进入；TTL 30 秒自动失效
  const got = await acquireLock("apply");
  if (!got.ok) {
    const h = got.holder ?? {};
    const who = h.userName || h.userId || "另一位 GM";
    const when = h.startedAt ? formatTs(h.startedAt) : "";
    console.warn("[lh-world-sync] 恢复被拒：已有进行中的恢复操作", h);
    notify.warn(`已有进行中的恢复操作（${who}${when ? " 于 " + when + " 开始" : ""}），请稍后再试。若对方已中断，30 秒后会自动解锁。`);
    return { applied: [], skipped: 0, locked: true };
  }
  try {
    const SettingDoc = settingDocumentClass();
    const currentMap = collectWorldSettings();
    const prevMap = new Map();   // key -> { present, value }：恢复前的值
    const afterMap = new Map();  // key -> value：本次恢复写入的值（供漂移检测）
    for (const c of diff.changed) {
      if (currentMap.has(c.key)) prevMap.set(c.key, { present: true, value: currentMap.get(c.key).value });
      else prevMap.set(c.key, { present: false, value: undefined });
      afterMap.set(c.key, c.to);
    }
    // 写账本（任何写入之前；失败=直接报错，未动任何设置）
    await writeApplyLog(prevMap, afterMap);

    const updates = [];
    const creates = [];
    for (const c of diff.changed) {
      const doc = currentMap.get(c.key)?.doc;
      const json = JSON.stringify(c.to);
      if (doc?._id) updates.push({ _id: doc._id, value: json });
      else creates.push({ key: c.key, user: null, value: json });
    }
    try {
      if (updates.length) await SettingDoc.updateDocuments(updates, {});
      if (creates.length) await SettingDoc.createDocuments(creates, {});
    } catch (e) {
      // 失败自动回滚：按账本把已写入的键恢复
      console.error("lh-world-sync apply failed, rolling back", e);
      try {
        for (const c of diff.changed) {
          const p = prevMap.get(c.key);
          const doc = getSettingDoc(c.key);
          if (!p.present) {
            if (doc?._id) await SettingDoc.deleteDocuments([doc._id], {});
          } else if (doc?._id) {
            await SettingDoc.updateDocuments([{ _id: doc._id, value: JSON.stringify(p.value) }], {});
          } else {
            await SettingDoc.createDocuments([{ key: c.key, user: null, value: JSON.stringify(p.value) }], {});
          }
        }
      } catch (e2) { console.error("lh-world-sync rollback failed", e2); }
      throw e;
    }
    return { applied: diff.changed, skipped: 0 };
  } finally {
    await releaseLock(got.lock);
  }
}
// 回档：按 applyLog 恢复
async function rollbackApplyLog() {
  if (!assertGM()) return null;
  const log = await readApplyLog();
  if (!log?.prev) return null;
  // 纵深防御：账本必须属于当前世界（readApplyLog 已按 worldId 只取本世界的格子，
  // 这里再核一次 worldId，防止将来改动绕过这道门）
  if (log.worldId && String(log.worldId) !== currentWorldId()) {
    console.warn("[lh-world-sync] 回档被拒：账本属于其他世界", log.worldId);
    return null;
  }
  const SettingDoc = settingDocumentClass();
  const restored = [];
  for (const [key, p] of Object.entries(log.prev)) {
    const doc = getSettingDoc(key);
    if (!p.present) {
      if (doc?._id) {
        await SettingDoc.deleteDocuments([doc._id], {});
        restored.push({ key, action: "删除（恢复为键不存在）", value: undefined });
      } else restored.push({ key, action: "已不存在（无需处理）", value: undefined });
    } else {
      if (doc?._id) await SettingDoc.updateDocuments([{ _id: doc._id, value: JSON.stringify(p.value) }], {});
      else await SettingDoc.createDocuments([{ key, user: null, value: JSON.stringify(p.value) }], {});
      restored.push({ key, action: "恢复", value: p.value });
    }
  }
  // 回档成功 → 就地标记账本已消费（审阅第 8 条：原实现可无限重复回档）
  try { await markLogRolledBack(); } catch (e) { console.error("lh-world-sync mark rolled-back failed", e); }
  return { log, restored };
}

/* ============================ 面板 HTML ============================ */
// 命名空间 → 好认的名字（模块显示名 / 系统名；找不到就留空）
function nsFriendlyName(ns) {
  try {
    if (game.system?.id === ns) return game.system.title || "";
    const m = game.modules?.get(ns);
    return m?.title || "";
  } catch (e) { return ""; }
}
// 模块勾选列表（v1.1.0 修复审阅第 2 条）：集合 = 当前世界 ∪ 主快照。
// 原实现只看当前世界已有的 Setting → 「主快照里有、本世界还没写过设置」的模块
// 根本不出现在列表里，于是永远恢复不了；而底层 applySnapshot 明明支持创建
// 不存在的 Setting（能力被前面的选择过滤掉了）。新世界恢复正是核心场景。
function nsCheckboxListHTML(snapNs, pref) {
  const curCount = {};
  for (const key of collectWorldSettings().keys()) {
    if (key === "core.moduleConfiguration") continue;
    const ns = key.split(".")[0];
    curCount[ns] = (curCount[ns] || 0) + 1;
  }
  const curNs = new Set(Object.keys(curCount));
  const extraNs = [...(snapNs ?? new Set())].filter(n => !curNs.has(n) && n !== "core");
  const all = [...curNs, ...extraNs].sort();
  const mode = pref?.mode ?? "all";
  const rows = all.map(n => {
    const friendly = nsFriendlyName(n);
    const fromSnap = !curNs.has(n);
    const checked = mode === "all" ? true : !!pref?.ns?.[n];
    const cnt = fromSnap ? "来自主快照" : (curCount[n] + " 键");
    const label = escapeHtml(n)
      + (friendly ? `<em class="wsync-ns-title">${escapeHtml(friendly)}</em>` : "")
      + (fromSnap ? `<em class="wsync-ns-title">（当前世界还没有它的设置 · 来自主快照）</em>` : "");
    return `
    <label class="wsync-ns-row">
      <input type="checkbox" data-ns="${escapeHtml(n)}" value="${escapeHtml(n)}"${checked ? " checked" : ""}>
      <span class="wsync-ns-name">${label}</span>
      <span class="wsync-ns-count">${cnt}</span>
    </label>`;
  }).join("");
  return { rows, count: all.length, extra: extraNs.length };
}
function panelContentHTML(snapNs, pref) {
  const { rows, count, extra } = nsCheckboxListHTML(snapNs, pref);
  const mode = pref?.mode ?? "all";
  const allChecked = mode === "all";
  const modCfgChecked = mode === "all" ? true : pref?.includeModuleConfig !== false;
  const scopeNow = mode === "all"
    ? "全部模块"
    : "自定义（" + Object.keys(pref?.ns ?? {}).filter(k => pref.ns[k]).length + " 个模块）";
  return `
  <div class="wsync-body">
    <div class="wsync-status" id="wsync-status">正在读取主世界基准信息…</div>
    <div class="wsync-theme-row">
      <span class="wsync-theme-label">主题</span>
      ${THEMES.map(t => `<span class="wsync-theme-dot" data-theme-dot="${t.id}" title="${t.name}" style="--dot:var(--wsync-accent)"></span>`).join("")}
      <span class="wsync-theme-current" id="wsync-theme-name">${THEME_BY_ID[getTheme()] || getTheme()}</span>
    </div>
    <div class="wsync-main-hint">
      <div><b>存主世界</b>：将当前世界的全部设置与模组启用状态保存为基准快照。</div>
      <div><b>恢复主世界</b>：将当前世界恢复为基准快照的状态（设置与模组启用状态），完成后自动刷新页面。</div>
      <div><b>回档</b>：撤销上一次恢复，返回恢复前的状态。</div>
    </div>
    <details class="wsync-adv">
      <summary>高级选项（恢复范围 / 快照文件 / 自动提醒）</summary>
      <div class="wsync-adv-body">
        <div class="wsync-adv-row">
          <button class="wsync-btn" data-act="preview"><i class="fa-solid fa-eye"></i> 查看差异</button>
          <button class="wsync-btn" data-act="files"><i class="fa-solid fa-folder-open"></i> 快照文件（导出 / 导入）</button>
        </div>
        <div class="wsync-sec-title">恢复范围（勾选＝该模块的设置跟随主世界基准恢复）
          <button class="wsync-btn wsync-btn-mini" data-act="save-scope" title="把这个范围存成这个世界的长期偏好，进世界自动提醒也按它执行"><i class="fa-solid fa-floppy-disk"></i> 保存范围</button>
        </div>
        <div class="wsync-ns-list" id="wsync-ns-list">
          <label class="wsync-ns-row"><input type="checkbox" id="wsync-ns-all" value="*"${allChecked ? " checked" : ""}><span class="wsync-ns-name"><b>全选</b></span><span class="wsync-ns-count">${count} 个模块</span></label>
          ${rows}
          <label class="wsync-ns-row wsync-ns-modcfg"><input type="checkbox" id="wsync-modcfg" value="modcfg"${modCfgChecked ? " checked" : ""}><span class="wsync-ns-name">模组启用状态<em class="wsync-ns-title">对应「设置 → 管理模组」中的开关</em></span><span class="wsync-ns-count">随快照恢复</span></label>
        </div>
        <div class="wsync-scope-hint" id="wsync-scope-hint">当前范围：<b>${scopeNow}</b>${extra ? " · 其中 " + extra + " 个模块本世界还没有它的设置（来自主快照）" : ""} · 改动后点「保存范围」，会存成这个世界的长期偏好——「恢复主世界」与进世界自动提醒都按它执行。</div>
        <label class="wsync-ns-row wsync-ns-autoprompt"><input type="checkbox" id="wsync-autoprompt"><span class="wsync-ns-name">进入世界时自动提醒<em class="wsync-ns-title">关闭后仅在手动点击「恢复主世界」时执行恢复</em></span></label>
        <div class="wsync-sec-title">不参与恢复的设置（通常无需修改）</div>
        <div class="wsync-adv-edit">
          <input type="text" id="wsync-excl" value="${escapeHtml((game.settings.get(MODULE_ID, "excludeKeys") || []).join(","))}" placeholder="core.time,core.permissions,foundry-mcp-bridge.lastActivity">
          <button class="wsync-btn" data-act="save-excl">保存</button>
        </div>
      </div>
    </details>
  </div>`;
}
// 生成选择（v1.1.0 修复审阅第 4 条）：永远读子项勾选。
// 原实现「全选默认勾选 + 只做单向联动」会让单独取消失效——用户取消了
// midi-qol，生成 selection 时仍因「全选」把每个 ns 都写成 true。
function selectionFromPanel($h) {
  const sel = { ns: {}, includeModuleConfig: false };
  $h.find(".wsync-ns-row input[data-ns]:checked").each((i, el) => { sel.ns[el.dataset.ns] = true; });
  sel.includeModuleConfig = !!$h.find("#wsync-modcfg").is(":checked");
  return sel;
}
// 子项变化 → 反向维护「全选」的 checked / indeterminate（否则全选永远打勾）
function syncAllCheckbox($h) {
  const $subs = $h.find(".wsync-ns-row input[data-ns]");
  const total = $subs.length;
  const checked = $subs.filter(":checked").length;
  const $all = $h.find("#wsync-ns-all");
  $all.prop("checked", total > 0 && checked === total);
  $all.prop("indeterminate", checked > 0 && checked < total);
}

/* ---------- 统一选择规则（v1.1.0，审阅第 5、6 条） ---------- */
// 读「恢复范围」偏好（世界级设置 nsScope）。缺失/损坏一律按「全部」，保持老行为。
function readScopePref() {
  let raw = null;
  try { raw = game.settings.get(MODULE_ID, SCOPE_SETTING); } catch (e) { raw = null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { mode: "all", ns: {}, includeModuleConfig: true };
  }
  return {
    mode: raw.mode === "custom" ? "custom" : "all",
    ns: (raw.ns && typeof raw.ns === "object" && !Array.isArray(raw.ns)) ? { ...raw.ns } : {},
    includeModuleConfig: raw.includeModuleConfig !== false
  };
}
// 由「快照 + 偏好」生成 selection：手动恢复 / 进世界自动提醒 / 文件导入 /
// 状态检测四条路径共用这一套规则（原先自动路径 `if (ns !== "core")` 排除
// 整个 core，手动路径不排除 → 状态栏一直报差异而自动恢复永不处理）。
// 现在只有 core.moduleConfiguration 走独立开关，其余 core.* 与别的模块同等对待。
function buildSelection(snap, pref = readScopePref()) {
  const sel = { ns: {}, includeModuleConfig: false };
  const snapNs = new Set();
  let hasModCfg = false;
  for (const item of (snap?.settings ?? [])) {
    const ns = String(item.key).split(".")[0];
    snapNs.add(ns);
    if (item.key === "core.moduleConfiguration") hasModCfg = true;
  }
  const picked = Object.keys(pref.ns).filter(k => pref.ns[k]);
  // custom 模式下一个模块都没勾 → 视为全部（否则会出现「恢复什么都没有」的困惑）
  if (pref.mode === "all" || !picked.length) {
    for (const ns of snapNs) sel.ns[ns] = true;
  } else {
    for (const ns of picked) sel.ns[ns] = true;
  }
  sel.includeModuleConfig = hasModCfg && pref.includeModuleConfig !== false;
  return { sel, snapNs, hasModCfg };
}
// 把面板勾选存成偏好：全勾 + 带模块开关 → mode:"all"（这样以后新装的模块也跟随）
async function saveScopePref(sel, totalNs) {
  const picked = Object.keys(sel.ns).filter(k => sel.ns[k]).length;
  const isAll = picked >= totalNs && sel.includeModuleConfig;
  const pref = isAll
    ? { mode: "all", ns: {}, includeModuleConfig: true }
    : { mode: "custom", ns: { ...sel.ns }, includeModuleConfig: !!sel.includeModuleConfig };
  await game.settings.set(MODULE_ID, SCOPE_SETTING, pref);
  return pref;
}

/* ============================ 报告/确认弹窗 ============================ */
function openDiffDialog(changed, options = {}) {
  const s = summaryText(changed);
  // 环境/版本差异提示（审阅第 7 条）：只提示不阻断，由用户决定
  const compat = options.snap ? describeSnapshotCompat(options.snap) : [];
  const compatHTML = compat.length
    ? `<div class="wsync-compat">环境提示（不影响执行，仅供参考）：<br>· ${compat.join("<br>· ")}</div>`
    : "";
  const lines = changed.slice(0, 120).map(c => {
    const tag = describeChange(c.from, c.to);
    return `<div class="wsync-diff-row"><code>${escapeHtml(c.key)}</code><span class="wsync-diff-tag">${tag}</span><div class="wsync-diff-vals"><span class="wsync-v-now">${escapeHtml(shortVal(c.from))}</span><span class="wsync-v-arrow">→</span><span class="wsync-v-master">${escapeHtml(shortVal(c.to))}</span></div></div>`;
  }).join("");
  const trimmed = changed.length > 120 ? `<div class="wsync-diff-more">…还有 ${changed.length - 120} 项（完整清单见「导出快照」）</div>` : "";
  const buttons = {
    apply: {
      icon: "<i class=\"fa-solid fa-check\"></i>",
      label: options.applyLabel || "恢复主世界",
      callback: async () => { dlg.close(); await proceedApplySnap(changed); }
    },
    cancel: {
      icon: "<i class=\"fa-solid fa-xmark\"></i>",
      label: "取消",
      callback: () => dlg.close()
    }
  };
  const dlg = new Dialog({
    title: "恢复主世界 · 确认",
    content: `<div class="wsync-body"><div class="wsync-diff-summary">主世界基准与当前世界存在 <b>${changed.length}</b> 处差异（${s.head}${s.more}）。以下为差异清单，确认后执行恢复。</div>${compatHTML}${lines}${trimmed}</div>`,
    buttons,
    render: ($h) => { styleWindow($h); },
    close: () => {}
  }, { classes: ["dialog", "wsync-app"], width: 640 });
  dlg.render(true);
  return dlg;
}
async function proceedApplySnap(changed) {
  // 从上次选择重建 selection：直接以 changed 涉及的键为字典（由调用方传入 diff 对象）
  if (!changed?.__sel) { notify.err("缺少选择信息"); return; }
  const snap = changed.__snap;
  try {
    const res = await applySnapshot(snap, changed.__sel);
    if (!res.applied.length) { notify.ok("当前世界与主世界基准一致，无需恢复。"); return; }
    // 记录「刚才应用过」：刷新后跳过一轮自动提醒，避免弹窗自问自答
    try { sessionStorage.setItem("wsync.justApplied", Date.now()); } catch (e) {}
    openApplyReportDialog(res.applied);
  } catch (e) {
    console.error(e);
    notify.err("恢复失败，已自动回滚：" + (e?.message || e));
  }
}
function openApplyReportDialog(applied) {
  const hasModCfg = applied.some(c => c.key === "core.moduleConfiguration");
  const lines = applied.slice(0, 150).map(c => {
    const tag = describeChange(c.from, c.to);
    return `<div class="wsync-diff-row"><code>${escapeHtml(c.key)}</code><span class="wsync-diff-tag">${tag}</span><div class="wsync-diff-vals"><span class="wsync-v-now">${escapeHtml(shortVal(c.from))}</span><span class="wsync-v-master">→</span><span class="wsync-v-now">${escapeHtml(shortVal(c.to))}</span></div></div>`;
  }).join("");
  const trimmed = applied.length > 150 ? `<div class="wsync-diff-more">…还有 ${applied.length - 150} 项</div>` : "";
  // 自动刷新：3 秒后重新加载页面（mod 开关要刷新才生效），无需手动 F5
  setTimeout(() => window.location.reload(), 3000);
  new Dialog({
    title: "恢复完成 · 页面即将自动刷新",
    content: `<div class="wsync-body"><div class="wsync-diff-summary">已恢复 <b>${applied.length}</b> 项设置。${hasModCfg ? "<b>模组启用状态已一并恢复</b>（此前被关闭的模组将重新启用）。" : ""}<br>页面将在 3 秒后自动刷新并生效，无需手动操作。如需撤销，可在刷新完成后于面板中点击「回档」。</div>${lines}${trimmed}</div>`,
    buttons: {
      close: { icon: "<i class=\"fa-solid fa-xmark\"></i>", label: "确定", callback: () => {} }
    },
    render: ($h) => { styleWindow($h); }
  }, { classes: ["dialog", "wsync-app"], width: 640 }).render(true);
}
function openRollbackDialog() {
  (async () => {
    const log = await readApplyLog();
    if (!log) {
      new Dialog({
        title: "回档",
        content: `<div class="wsync-body"><div class="wsync-diff-summary">本世界（${escapeHtml(game.world?.title ?? "")}）暂无可回档记录。回档记录按世界分开保存，且仅在执行过「恢复主世界」之后才会生成。</div></div>`,
        buttons: { close: { icon: "<i class=\"fa-solid fa-xmark\"></i>", label: "关闭", callback: () => {} } },
        render: ($h) => styleWindow($h)
      }, { classes: ["dialog", "wsync-app"], width: 520 }).render(true);
      return;
    }
    const entries = Object.entries(log.prev);
    const lines = entries.slice(0, 120).map(([key, p]) => {
      const after = !p.present ? "删除该键（恢复为不存在）" : "恢复为 " + shortVal(p.value);
      return `<div class="wsync-diff-row"><code>${escapeHtml(key)}</code><span class="wsync-diff-tag">回档</span><div class="wsync-diff-vals"><span class="wsync-v-now">${escapeHtml(after)}</span></div></div>`;
    }).join("");
    const trimmed = entries.length > 120 ? `<div class="wsync-diff-more">…还有 ${entries.length - 120} 项</div>` : "";
    // v1.1.0（审阅第 8 条）：把「这份账本的状态」摆在明处
    const drift = findDriftedKeys(log);
    const warns = [];
    if (log.status === "rolled-back") {
      warns.push(`<b>这份记录已经回档过一次</b>（${escapeHtml(formatTs(log.rolledBackAt || log.ts))}）——再点一次会把同一份旧值再写一遍。`);
    }
    if (drift.length) {
      warns.push(`自上次恢复之后，其中 <b>${drift.length}</b> 项又被改动过（${escapeHtml(drift.slice(0, 3).join("、"))}${drift.length > 3 ? " 等" : ""}）——回档会覆盖这些改动。`);
    }
    const warnHTML = warns.length ? `<div class="wsync-compat">${warns.join("<br>")}</div>` : "";
    const dlg = new Dialog({
      title: "回档 · 恢复到上次恢复前",
      content: `<div class="wsync-body"><div class="wsync-diff-summary"><b>记录归属：${escapeHtml(log.worldTitle || currentWorldId())}</b> · 写入时间 ${escapeHtml(formatTs(log.ts))} · 共 ${entries.length} 项。<br>回档仅还原这些设置，此后手动修改的其他设置不受影响。</div>${warnHTML}${lines}${trimmed}</div>`,
      buttons: {
        do: { icon: "<i class=\"fa-solid fa-rotate-left\"></i>", label: "执行回档", callback: async () => { dlg.close(); await doRollback(); } },
        cancel: { icon: "<i class=\"fa-solid fa-xmark\"></i>", label: "取消", callback: () => dlg.close() }
      },
      render: ($h) => styleWindow($h)
    }, { classes: ["dialog", "wsync-app"], width: 640 });
    dlg.render(true);
  })();
}
async function doRollback() {
  try {
    const res = await rollbackApplyLog();
    if (!res) { notify.warn("暂无可回档记录。"); return; }
    const lines = res.restored.slice(0, 150).map(r => `<div class="wsync-diff-row"><code>${escapeHtml(r.key)}</code><span class="wsync-diff-tag">${escapeHtml(r.action)}</span></div>`).join("");
    const trimmed = res.restored.length > 150 ? `<div class="wsync-diff-more">…还有 ${res.restored.length - 150} 项</div>` : "";
    new Dialog({
      title: "回档完成 · 恢复了什么",
      content: `<div class="wsync-body"><div class="wsync-diff-summary">已回档 ${res.restored.length} 项：上次恢复所改动的设置已全部还原。</div>${lines}${trimmed}</div>`,
      buttons: { close: { icon: "<i class=\"fa-solid fa-xmark\"></i>", label: "关闭", callback: () => {} } },
      render: ($h) => styleWindow($h)
    }, { classes: ["dialog", "wsync-app"], width: 640 }).render(true);
  } catch (e) {
    console.error(e);
    notify.err("回档失败：" + (e?.message || e));
  }
}

/* ============================ 文件导入导出 ============================ */
// 触发浏览器下载（绕开 FVTT 的全局超链接拦截）
// 出处（FVTT 13.351 源码）：client/game.mjs:2018
//   document.addEventListener("click", this._onClickHyperlink.bind(this))  ← 冒泡阶段
//   client/game.mjs:2049-2055 _onClickHyperlink：
//     const a = event.target.closest("a[href]"); if(!a...) return;
//     event.preventDefault(); window.open(a.href, "_blank");
//   → 任何 a[href] 的点击都被 preventDefault 并改走 window.open，导致：
//     ① <a download> 的文件名失效（下载下来是 blob UUID、没有扩展名）；
//     ② MIME 为 application/json 时 blob 被当网页打开（大文件卡死）。
// 对策（双保险）：
//   ① 在 a 自身捕获阶段 stopPropagation —— document 的冒泡监听收不到；
//   ② 用 bubbles:false 的 MouseEvent 派发 —— 事件根本不冒泡到 document。
//   默认行为（按 download 属性下载）不受 stopPropagation 影响，只有 preventDefault 才会取消。
// 返回值 false = 仍被某个处理器 preventDefault（极少见）→ 调用方提示改用「复制全文」。
function triggerDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  a.addEventListener("click", (ev) => ev.stopPropagation(), true);
  document.body.appendChild(a);
  let notPrevented = true;
  try {
    notPrevented = a.dispatchEvent(new MouseEvent("click", { bubbles: false, cancelable: true, view: window }));
  } catch (e) {
    try { a.click(); } catch (e2) { /* 忽略 */ }
  }
  a.remove();
  return notPrevented;
}
function openFilePanel() {
  const dlg = new Dialog({
    title: "世界同步装置 · 文件",
    content: `<div class="wsync-body">
      <div class="wsync-file-note">快照保存在模块 storage 目录，所有世界共享读取。可导出文件下载到本地或复制全文，用于跨服务器迁移。</div>
      <div class="wsync-file-btns">
        <button class="wsync-btn" data-file="export-snap">导出快照（下载文件）</button>
        <button class="wsync-btn" data-file="copy-full">复制快照全文</button>
        <button class="wsync-btn" data-file="import-file">从文件导入</button>
        <button class="wsync-btn" data-file="paste-snap">粘贴快照</button>
      </div>
      <div class="wsync-file-msg" id="wsync-file-msg"></div>
      <div class="wsync-file-link" id="wsync-file-link"></div>
    </div>`,
    buttons: { close: { icon: "<i class=\"fa-solid fa-xmark\"></i>", label: "关闭", callback: () => {} } },
    render: ($h) => {
      styleWindow($h);
      const msg = $h.find("#wsync-file-msg");
      const setMsg = (ok, t) => msg.html(`<span class="wsync-file-${ok ? "ok" : "err"}">${escapeHtml(t)}</span>`);
      $h.find("[data-file=export-snap]").on("click", async () => {
        try {
          // 紧凑 JSON：9MB 级数据带缩进会翻倍并拖慢生成/下载
          const text = JSON.stringify(buildSnapshot());
          const fname = `world-snapshot-${stamp()}.json`;
          // MIME 必须是 octet-stream：application/json 会被浏览器内联渲染（大文件卡死）
          const url = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
          const ok = triggerDownload(url, fname);
          // 兜底：面板里再给一个手动下载链接（同样带捕获阶段截断，避免被 FVTT 拦截）
          const $link = $h.find("#wsync-file-link");
          $link.html(`<a class="wsync-dl" href="${url}" download="${escapeHtml(fname)}">手动保存：${escapeHtml(fname)}</a> <span class="wsync-dl-tip">（链接 60 秒内有效）</span>`);
          const linkEl = $link.find("a")[0];
          if (linkEl) linkEl.addEventListener("click", (ev) => ev.stopPropagation(), true);
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          setMsg(ok, ok
            ? `已导出：${fname}。若浏览器未自动下载，请点下方链接手动保存。`
            : "已触发导出但被页面脚本拦截，请点下方链接手动保存。");
        } catch (e) { setMsg(false, "导出失败:" + (e?.message || e)); }
      });
      $h.find("[data-file=copy-full]").on("click", async () => {
        try { copyText(JSON.stringify(buildSnapshot(), null, 2)); setMsg(true, "快照全文已复制到剪贴板。"); }
        catch (e) { setMsg(false, "复制失败:" + (e?.message || e)); }
      });
      $h.find("[data-file=import-file]").on("click", () => {
        const input = document.createElement("input");
        input.type = "file"; input.accept = ".json,application/json";
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return;
          try {
            const snap = parseSnapshot(await f.text());
            openSnapImportDialog(snap);
          } catch (e) { setMsg(false, "导入失败:" + (e?.message || e)); }
        };
        input.click();
      });
      $h.find("[data-file=paste-snap]").on("click", () => {
        new Dialog({
          title: "粘贴快照",
          content: `<div class="wsync-body"><textarea id="wsync-paste-area" class="wsync-paste" placeholder="将快照 JSON 内容粘贴到此处（Ctrl+V）"></textarea></div>`,
          buttons: {
            go: { icon: "<i class=\"fa-solid fa-check\"></i>", label: "导入", callback: (h) => {
              const t = $(h).find("#wsync-paste-area").val();
              try { openSnapImportDialog(parseSnapshot(t)); }
              catch (e) { notify.err("快照解析失败:" + (e?.message || e)); }
            } },
            cancel: { icon: "<i class=\"fa-solid fa-xmark\"></i>", label: "取消", callback: () => {} }
          },
          render: ($h) => styleWindow($h)
        }, { classes: ["dialog", "wsync-app"], width: 560 }).render(true);
      });
    }
  }, { classes: ["dialog", "wsync-app"], width: 560 });
  dlg.render(true);
}
// 导入快照（v1.1.0 修复审阅第 3 条）：原实现只把当前世界恢复成该快照、不写
// 服务器主快照，但 README 把导入描述成「跨服务器迁移」手段，语义对不上。
// 现在导入时二选一：设为主快照（写 MASTER_FILE）/ 仅恢复本世界。
async function openSnapImportDialog(snap) {
  const n = snap.settings.length;
  const when = snap.savedAt ? formatTs(snap.savedAt) : "未知时间";
  const notes = describeSnapshotCompat(snap);
  const notesHTML = notes.length ? `<div class="wsync-compat">环境提示：<br>· ${notes.join("<br>· ")}</div>` : "";
  const info = `<div class="wsync-diff-summary">快照来源：<b>${escapeHtml(snap.sourceWorld || "未知世界")}</b> · 保存于 ${escapeHtml(when)} · 共 <b>${n}</b> 项设置。</div>${notesHTML}`;
  let dlg;
  dlg = new Dialog({
    title: "导入快照 · 请选择",
    content: `<div class="wsync-body">
      ${info}
      <div class="wsync-main-hint">
        <div><b>设为主快照</b>：把这份快照存到服务器（<b>会覆盖现有主快照</b>），此后所有世界都以它为基准。跨服务器搬家用这个。</div>
        <div><b>仅恢复本世界</b>：只把当前世界恢复成这份快照，不动服务器上的主快照。自己留底、临时回滚用这个。</div>
      </div>
    </div>`,
    buttons: {
      asMaster: { icon: "<i class=\"fa-solid fa-database\"></i>", label: "设为主快照", callback: async () => {
        dlg.close();
        if (!assertGM()) return;
        try {
          await storageWrite(MASTER_FILE, JSON.stringify(snap, null, 2));
          notify.ok(`已设为主快照（来源：${snap.sourceWorld || "未知世界"}，${n} 项）。`);
        } catch (e) { console.error(e); notify.err("写入主快照失败:" + (e?.message || e)); return; }
        new Dialog({
          title: "主快照已更新",
          content: `<div class="wsync-body"><div class="wsync-diff-summary">服务器主快照已替换为这份快照。<br>是否<b>现在就把当前世界也恢复成它</b>？</div></div>`,
          buttons: {
            yes: { icon: "<i class=\"fa-solid fa-check\"></i>", label: "立即恢复本世界", callback: () => { restoreFromSnap(snap); } },
            no: { icon: "<i class=\"fa-solid fa-xmark\"></i>", label: "稍后再说", callback: () => {} }
          },
          render: ($h) => styleWindow($h)
        }, { classes: ["dialog", "wsync-app"], width: 520 }).render(true);
      } },
      restoreOnly: { icon: "<i class=\"fa-solid fa-rotate-right\"></i>", label: "仅恢复本世界", callback: () => { dlg.close(); restoreFromSnap(snap); } },
      cancel: { icon: "<i class=\"fa-solid fa-xmark\"></i>", label: "取消", callback: () => dlg.close() }
    },
    render: ($h) => styleWindow($h)
  }, { classes: ["dialog", "wsync-app"], width: 620 });
  dlg.render(true);
  return dlg;
}
// 把本世界恢复成给定快照（导入路径）。走统一选择规则，不再硬编码排除 core。
function restoreFromSnap(snap) {
  const { sel } = buildSelection(snap, readScopePref());
  const diff = diffSnapshot(snap, sel);
  if (!diff.changed.length) { notify.ok("当前世界与这份快照一致，无需恢复。"); return; }
  const dlg = openDiffDialog(diff.changed, { applyLabel: "恢复为该快照", snap });
  diff.changed.__sel = sel;
  diff.changed.__snap = snap;
  return dlg;
}

/* ============================ 主面板 ============================ */
function styleWindow($h) {
  const winEl = $h.closest(".window-app");
  if (winEl?.length) {
    winEl.addClass("wsync-themed");
    winEl.attr("data-theme", getTheme());
  }
}
// 读主快照 → 按面板勾选算差异 → 打开「恢复主世界 · 确认」弹窗
// （主界面按钮与高级区「查看差异」共用这一条路径：先展示差异清单，再决定是否恢复）
async function openRestoreConfirm($body) {
  const text = await storageRead(MASTER_FILE);
  if (!text) { notify.warn("尚未保存主世界快照。请先点击「存主世界」，或从文件导入快照。"); return; }
  try {
    const snap = parseSnapshot(text);
    const sel = selectionFromPanel($body);
    const diff = diffSnapshot(snap, sel);
    if (!diff.changed.length) { notify.ok("当前世界与主世界基准一致，无需恢复。"); return; }
    const dlg2 = openDiffDialog(diff.changed, { snap });
    diff.changed.__sel = sel;
    diff.changed.__snap = snap;
    return dlg2;
  } catch (e) { console.error(e); notify.err("快照读取失败:" + (e?.message || e)); }
}
async function openSyncPanel() {
  // 面板本来只给 GM 用（按钮 + 设置菜单 restricted），但 window.lhWorldSync.openPanel
  // 对所有人可见 → 这里补守卫（审阅第 10 条）
  if (!assertGM()) return;
  // 先读主快照：模块勾选列表要包含「主快照里有、本世界还没写过设置」的模块
  // （审阅第 2 条：新世界恢复的核心场景，原实现看不到这些模块）
  const snapNs = new Set();
  try {
    const text = await storageRead(MASTER_FILE);
    if (text) {
      const snap = parseSnapshot(text);
      for (const item of snap.settings) snapNs.add(String(item.key).split(".")[0]);
    }
  } catch (e) {
    console.warn("lh-world-sync: 主快照读取失败，恢复范围列表只列当前世界的模块", e);
  }
  const pref = readScopePref();
  const content = panelContentHTML(snapNs, pref);
  const dlg = new Dialog({
    title: "世界同步装置",
    content,
    buttons: {
      save: { icon: "<i class=\"fa-solid fa-floppy-disk\"></i>", label: "存主世界", callback: async (h, evt) => {
        evt?.preventDefault?.();
        try {
          const snap = buildSnapshot();
          const path = await storageWrite(MASTER_FILE, JSON.stringify(snap, null, 2));
          const n = snap.settings.length;
          notify.ok(`已保存主世界快照：${n} 项设置（${path}）`);
          refreshStatus();
        } catch (e) { console.error(e); notify.err("保存失败:" + (e?.message || e)); }
      } },
      apply: { icon: "<i class=\"fa-solid fa-check\"></i>", label: "恢复主世界", callback: async (h, evt) => {
        evt?.preventDefault?.();
        await openRestoreConfirm($(h));
      } },
      rollback: { icon: "<i class=\"fa-solid fa-rotate-left\"></i>", label: "回档", callback: (h, evt) => {
        evt?.preventDefault?.();
        openRollbackDialog();
      } },
      close: { icon: "<i class=\"fa-solid fa-xmark\"></i>", label: "关闭", callback: () => {} }
    },
    render: ($h) => {
      styleWindow($h);
      refreshStatus();
      // 高级区：看差异 / 文件面板
      $h.find("[data-act=preview]").on("click", () => { openRestoreConfirm($h); });
      $h.find("[data-act=files]").on("click", () => { openFilePanel(); });
      // 主题圆点
      $h.find("[data-theme-dot]").on("click", async (ev) => {
        const t = ev.currentTarget.dataset.themeDot;
        await setTheme(t);
        $h.find("#wsync-theme-name").text(THEME_BY_ID[t] || t);
        $h.find("[data-theme-dot]").toggleClass("wsync-theme-active", (i, el) => el.dataset.themeDot === t);
      });
      $h.find("[data-theme-dot]").each((i, el) => {
        if (el.dataset.themeDot === getTheme()) $(el).addClass("wsync-theme-active");
      });
      // 全选 ↔ 子项 双向联动（v1.1.0：子项变化必须反向维护全选状态，
      // 否则「全选」永远打勾 → 单独取消某个模块不生效，审阅第 4 条）
      $h.find("#wsync-ns-all").on("change", (ev) => {
        const on = ev.currentTarget.checked;
        $h.find(".wsync-ns-row input[data-ns]").prop("checked", on);
        $h.find("#wsync-ns-all").prop("indeterminate", false);
      });
      $h.find(".wsync-ns-row input[data-ns]").on("change", () => syncAllCheckbox($h));
      syncAllCheckbox($h);
      // 保存恢复范围 → 世界级偏好 nsScope（v1.1.0，审阅第 6 条：
      // 此前勾选只对「这一次手动恢复」有效，自动提醒自己造了一套接近全选的范围）
      $h.find("[data-act=save-scope]").on("click", async (ev) => {
        ev.preventDefault();
        const sel = selectionFromPanel($h);
        const total = $h.find(".wsync-ns-row input[data-ns]").length;
        try {
          const pref2 = await saveScopePref(sel, total);
          const picked = Object.keys(pref2.ns).filter(k => pref2.ns[k]).length;
          $h.find("#wsync-scope-hint").html(pref2.mode === "all"
            ? "当前范围：<b>全部模块</b> · 已保存。此后「恢复主世界」与进世界自动提醒都按它执行。"
            : `当前范围：<b>自定义（${picked} 个模块）</b> · 已保存。此后「恢复主世界」与进世界自动提醒都按它执行。`);
          notify.ok("恢复范围已保存为这个世界的长期偏好。");
          refreshStatus();
        } catch (e) { console.error(e); notify.err("保存范围失败:" + (e?.message || e)); }
      });
      // 排除键保存
      $h.find("[data-act=save-excl]").on("click", async () => {
        const raw = $h.find("#wsync-excl").val() || "";
        const keys = raw.split(",").map(s => s.trim()).filter(Boolean);
        try {
          await game.settings.set(MODULE_ID, "excludeKeys", keys);
          notify.ok("已保存不参与恢复的设置：" + keys.join("、"));
        } catch (e) { notify.err("保存失败:" + (e?.message || e)); }
      });
      // 自动提醒开关
      $h.find("#wsync-autoprompt").on("change", async (ev) => {
        try {
          await game.settings.set(MODULE_ID, "autoPrompt", ev.currentTarget.checked);
          notify.ok(ev.currentTarget.checked ? "自动提醒已开启：进入世界发现差异时会弹窗。" : "自动提醒已关闭。可在模块设置或本面板中重新开启。");
        } catch (e) { notify.err("设置失败:" + (e?.message || e)); }
      });
    },
    close: () => {}
  }, { classes: ["dialog", "wsync-app", "wsync-panel"], width: 660, resizable: false, minimizable: false });
  dlg.render(true);

  async function refreshStatus() {
    const $h = $(".wsync-app.wsync-panel").first();
    if (!$h.length) return;
    const $s = $h.find("#wsync-status");
    try {
      const text = await storageRead(MASTER_FILE);
      if (!text) {
        $s.html("<span class=\"wsync-status-none\">尚未保存主世界快照。请先在一个配置齐全的世界中点击「存主世界」。</span>");
        return;
      }
      const snap = parseSnapshot(text);
      const n = snap.settings.length;
      // 统一选择规则（v1.1.0）：状态检测也用「已保存的恢复范围」，
      // 不再自己造一套含 core.* 的全选范围（否则会出现「一直报差异、
      // 自动恢复永不处理」，审阅第 5 条）
      const { sel } = buildSelection(snap, readScopePref());
      const diff = diffSnapshot(snap, sel);
      let when = snap.savedAt;
      try { when = new Date(snap.savedAt).toLocaleString(); } catch (e) {}
      const base = `基准来源：<b>${escapeHtml(snap.sourceWorld)}</b> · 保存于 ${escapeHtml(when)} · 共 ${n} 项设置`;
      $s.html(diff.changed.length
        ? `当前世界与主世界基准存在 <b class="wsync-diff-has">${diff.changed.length}</b> 处差异。<br>${base}`
        : `当前世界与主世界基准一致。<br>${base}`);
      const $ap = $h.find("#wsync-autoprompt");
      if ($ap.length) $ap.prop("checked", game.settings.get(MODULE_ID, "autoPrompt"));
    } catch (e) {
      $s.html("<span class=\"wsync-status-none\">主世界基准读取失败：" + escapeHtml(e?.message || e) + "</span>");
    }
  }
}

/* ============================ 自动提醒 ============================ */
async function autoPromptCheck() {
  if (!game.user.isGM) return;
  if (!game.settings.get(MODULE_ID, "autoPrompt")) return;
  // 刚应用过快照（刚刚刷新过页面）：跳过这一轮，不弹窗自问自答
  try { if (sessionStorage.getItem("wsync.justApplied")) { sessionStorage.removeItem("wsync.justApplied"); return; } } catch (e) {}
  const text = await storageRead(MASTER_FILE);
  if (!text) return;
  let snap;
  try { snap = parseSnapshot(text); } catch (e) { return; }
  // 统一选择规则（v1.1.0）：自动提醒遵守「已保存的恢复范围」。
  // 原实现自己造 sel 且 `if (ns !== "core")` 排除整个 core，与手动路径不一致
  // → 状态栏一直报差异、自动恢复却永不处理那些 core.* 键（审阅第 5 条）。
  const { sel } = buildSelection(snap, readScopePref());
  const diff = diffSnapshot(snap, sel);
  if (!diff.changed.length) return;
  diff.changed.__sel = sel;
  diff.changed.__snap = snap;
  const s = summaryText(diff.changed);
  const dlg = new Dialog({
    title: "检测到与主世界基准的差异",
    content: `<div class="wsync-body">
      <div class="wsync-prompt-banner">当前世界与主世界基准（<b>${escapeHtml(snap.sourceWorld)}</b>）存在 <b>${diff.changed.length}</b> 处差异（${s.head}${s.more}）。</div>
      <div class="wsync-prompt-hint">点击「恢复主世界」后，将按<b>已保存的恢复范围</b>把设置与模组启用状态恢复为基准值，完成后页面自动刷新。如需先看差异清单，可在右侧边栏「世界同步」面板点击「查看差异」；要改范围就在同一面板的高级选项里勾选后点「保存范围」。</div>
    </div>`,
    buttons: {
      apply: { icon: "<i class=\"fa-solid fa-check\"></i>", label: "恢复主世界", callback: async () => { dlg.close(); await proceedApplySnap(diff.changed); } },
      skip: { icon: "<i class=\"fa-solid fa-forward\"></i>", label: "暂不恢复", callback: () => { notify.ok("已暂不恢复。下次进入世界时会再次提醒。"); } },
      off: { icon: "<i class=\"fa-solid fa-ban\"></i>", label: "不再自动提醒", callback: async () => {
        await game.settings.set(MODULE_ID, "autoPrompt", false);
        notify.warn("已关闭自动提醒。可在「设置 → 世界同步装置」中重新开启。");
      } }
    },
    render: ($h) => {
      styleWindow($h);
      const $ap = $h.find("#wsync-autoprompt");
      if ($ap.length) $ap.prop("checked", game.settings.get(MODULE_ID, "autoPrompt"));
    },
    close: () => {}
  }, { classes: ["dialog", "wsync-app"], width: 620 });
  dlg.render(true);
}
Hooks.once("ready", () => {
  // 面板打开后支持后续操作；自动提醒延迟片刻，避免与世界初始化打架
  setTimeout(() => { autoPromptCheck().catch(e => console.error("lh-world-sync autoprompt", e)); }, 6000);
});

/* ============================ 侧边栏按钮（常驻轮询，挂在「设置」后） ============================ */
let wsyncBtnLogged = false;
function ensureSidebarButton() {
  setInterval(() => {
    // 锚点 = 右侧边栏 tab 区「设置」齿轮按钮（templates/sidebar/tabs.hbs：button[data-tab="settings"]）
    const $anchor = $("button[data-tab=\"settings\"]").first();
    if (!$anchor.length) return;
    if ($("#" + BTN_ID).length) return;
    const $li = $(`<li><button id="${BTN_ID}" type="button" class="ui-control plain icon ${BTN_ICON}" title="世界同步装置" aria-label="世界同步装置"></button></li>`);
    $li.find("button").on("click", () => openSyncPanel());
    $anchor.closest("li").after($li);
    if (!wsyncBtnLogged) {
      wsyncBtnLogged = true;
      console.log("lh-world-sync: 侧边栏按钮已挂载（常驻巡查，设置齿轮后） v" + MODULE_VERSION);
    }
  }, 1500);
}

/* ============================ 设置菜单入口 ============================ */
// registerMenu 要求 type 为 FormApplication/ApplicationV2 子类（client-settings.mjs:189-192）
// 这里做一个薄壳：render 时直接打开真正的 Dialog 面板（Dialog v1 金标准）
function registerMenuIfPossible() {
  const FA = foundry.appv1?.api?.FormApplication;
  if (!FA) { console.warn("lh-world-sync: appv1 FormApplication 不存在，设置菜单入口跳过（侧边栏按钮仍可用）"); return; }
  class SyncMenuApp extends FA {
    constructor(options = {}) { super(options); }
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, { id: "wsync-menu-shell", template: "", popOut: false });
    }
    getData() { return {}; }
    async _render(force, options) {
      openSyncPanel();
      return this;
    }
  }
  game.settings.registerMenu(MODULE_ID, "syncPanel", {
    name: "打开世界同步面板",
    label: "世界同步装置面板",
    hint: "打开主面板：存主世界、查看差异、恢复主世界、回档、快照文件导入导出。",
    icon: BTN_ICON,
    type: SyncMenuApp,
    restricted: true
  });
}

/* ============================ 启动 ============================ */
Hooks.on("init", () => { registerMenuIfPossible(); });
Hooks.on("ready", () => {
  if (game.user.isGM) ensureSidebarButton();
});
// 控制台接口：所有写操作在函数内部统一 assertGM()（审阅第 10 条）；
// readScopePref / buildSelection 一并暴露，便于排查「为什么这一项没被恢复」。
window.lhWorldSync = {
  version: MODULE_VERSION,
  openPanel: openSyncPanel,
  buildSnapshot,
  parseSnapshot,
  diffSnapshot,
  applySnapshot,
  rollback: rollbackApplyLog,
  readScopePref,
  buildSelection
};
console.log(`lh-world-sync v${MODULE_VERSION} loaded (window.__WSYNC_VER=${window.__WSYNC_VER})`);
