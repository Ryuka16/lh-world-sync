/* ============================================================================
 * 世界同步装置 (lh-world-sync) v1.0.8
 * ----------------------------------------------------------------------------
 * 功能：把一个世界当作「主世界」保存配置快照；新世界一键读回。
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
const MODULE_VERSION = "1.0.8";
window.__WSYNC_VER = MODULE_VERSION; // 探针：控制台输入 window.__WSYNC_VER 验版本

/* ============================ 常量 ============================ */
// 快照文件（固定名覆盖写，游戏内无删除 API，旧文件不清理）
const STORAGE_DIR = "modules/lh-world-sync/storage";
const MASTER_FILE = "world-snapshot-master.json";
const APPLOG_FILE = "apply-log.json";
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
const isJSONEqual = (a, b) => (a === b) || (JSON.stringify(a) === JSON.stringify(b));
const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
async function storageList() {
  try {
    const data = await FilePicker.browse("data", STORAGE_DIR, {});
    return (data?.files || []).map(f => f.name);
  } catch (e) { return []; }
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
function getItemValue(key) {
  const doc = getSettingDoc(key);
  return doc ? doc.value : undefined;
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
    savedAt: new Date().toISOString(),
    systemId: game.system?.id ?? "",
    systemVersion: game.system?.version ?? "",
    coreVersion: game.version ?? "",
    modules: modVersions,
    settings
  };
}
function parseSnapshot(text) {
  const snap = JSON.parse(text);
  if (!snap || snap.app !== MODULE_ID || !Array.isArray(snap.settings)) {
    throw new Error("不是有效的主世界快照（app/settings 字段缺失）");
  }
  return snap;
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
// applyLog: { ts, sourceWorld, appVersion, prev: { key: { present, value } } }
async function writeApplyLog(prevMap) {
  const log = {
    ts: new Date().toISOString(),
    sourceWorld: game.world?.title ?? "",
    appVersion: MODULE_VERSION,
    prev: Object.fromEntries([...prevMap.entries()].map(([k, v]) => [k, { present: v.present, value: v.value }]))
  };
  await storageWrite(APPLOG_FILE, JSON.stringify(log, null, 2));
}
async function readApplyLog() {
  const text = await storageRead(APPLOG_FILE);
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}
async function applySnapshot(snap, selection) {
  const diff = diffSnapshot(snap, selection);
  if (!diff.changed.length) return { applied: [], skipped: 0 };
  const SettingDoc = settingDocumentClass();
  const currentMap = collectWorldSettings();
  const prevMap = new Map();   // key -> { present, value }
  for (const c of diff.changed) {
    if (currentMap.has(c.key)) prevMap.set(c.key, { present: true, value: currentMap.get(c.key).value });
    else prevMap.set(c.key, { present: false, value: undefined });
  }
  // 写账本（任何写入之前；失败=直接报错，未动任何设置）
  await writeApplyLog(prevMap);

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
}
// 回档：按 applyLog 恢复
async function rollbackApplyLog() {
  const log = await readApplyLog();
  if (!log?.prev) return null;
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
function nsCheckboxListHTML() {
  const all = collectWorldSettings();
  const nsCount = {};
  for (const key of all.keys()) {
    if (key === "core.moduleConfiguration") continue;
    const ns = key.split(".")[0];
    nsCount[ns] = (nsCount[ns] || 0) + 1;
  }
  const ns = Object.keys(nsCount).sort();
  const rows = ns.map(n => {
    const friendly = nsFriendlyName(n);
    const label = escapeHtml(n) + (friendly ? `<em class="wsync-ns-title">${escapeHtml(friendly)}</em>` : "");
    return `
    <label class="wsync-ns-row">
      <input type="checkbox" data-ns="${escapeHtml(n)}" value="${escapeHtml(n)}" checked>
      <span class="wsync-ns-name">${label}</span>
      <span class="wsync-ns-count">${nsCount[n]} 键</span>
    </label>`;
  }).join("");
  return { rows, count: ns.length };
}
function panelContentHTML() {
  const { rows, count } = nsCheckboxListHTML();
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
        <div class="wsync-sec-title">恢复范围（勾选＝该模块的设置跟随主世界基准恢复）</div>
        <div class="wsync-ns-list" id="wsync-ns-list">
          <label class="wsync-ns-row"><input type="checkbox" id="wsync-ns-all" value="*" checked><span class="wsync-ns-name"><b>全选</b></span><span class="wsync-ns-count">${count} 个模块</span></label>
          ${rows}
          <label class="wsync-ns-row wsync-ns-modcfg"><input type="checkbox" id="wsync-modcfg" value="modcfg" checked><span class="wsync-ns-name">模组启用状态<em class="wsync-ns-title">对应「设置 → 管理模组」中的开关</em></span><span class="wsync-ns-count">随快照恢复</span></label>
        </div>
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
function selectionFromPanel($h) {
  const sel = { ns: {}, includeModuleConfig: false };
  const all = $h.find("#wsync-ns-all").is(":checked");
  if (all) {
    $h.find(".wsync-ns-row input[data-ns]").each((i, el) => { sel.ns[el.dataset.ns] = true; });
  } else {
    $h.find(".wsync-ns-row input[data-ns]:checked").each((i, el) => { sel.ns[el.dataset.ns] = true; });
  }
  sel.includeModuleConfig = !!$h.find("#wsync-modcfg").is(":checked");
  return sel;
}

/* ============================ 报告/确认弹窗 ============================ */
function openDiffDialog(changed, options = {}) {
  const s = summaryText(changed);
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
    content: `<div class="wsync-body"><div class="wsync-diff-summary">主世界基准与当前世界存在 <b>${changed.length}</b> 处差异（${s.head}${s.more}）。以下为差异清单，确认后执行恢复。</div>${lines}${trimmed}</div>`,
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
        content: `<div class="wsync-body"><div class="wsync-diff-summary">暂无可回档记录。仅在执行过「恢复主世界」之后才会生成回档记录。</div></div>`,
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
    const dlg = new Dialog({
      title: "回档 · 恢复到上次恢复前",
      content: `<div class="wsync-body"><div class="wsync-diff-summary">上次恢复：${escapeHtml(log.sourceWorld)} · ${escapeHtml(log.ts)} · 共 ${entries.length} 项。回档仅还原这些设置，此后手动修改的其他设置不受影响。</div>${lines}${trimmed}</div>`,
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
async function openSnapImportDialog(snap) {
  // 导入的快照视作「主世界快照」：先预览差异再应用
  const sel = { ns: {}, includeModuleConfig: false };
  for (const item of snap.settings) {
    const ns = item.key.split(".")[0];
    if (ns !== "core") sel.ns[ns] = true;
    if (item.key === "core.moduleConfiguration") sel.includeModuleConfig = true;
  }
  const diff = diffSnapshot(snap, sel);
  const dlg = openDiffDialog(diff.changed, { applyLabel: "恢复为该快照" });
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
    const dlg2 = openDiffDialog(diff.changed);
    diff.changed.__sel = sel;
    diff.changed.__snap = snap;
    return dlg2;
  } catch (e) { console.error(e); notify.err("快照读取失败:" + (e?.message || e)); }
}
function openSyncPanel() {
  const content = panelContentHTML();
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
      // 全选联动
      $h.find("#wsync-ns-all").on("change", (ev) => {
        const on = ev.currentTarget.checked;
        $h.find(".wsync-ns-row input[data-ns]").prop("checked", on);
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
      const sel = { ns: {}, includeModuleConfig: true };
      for (const item of snap.settings) sel.ns[item.key.split(".")[0]] = true;
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
  const sel = { ns: {}, includeModuleConfig: true };
  for (const item of snap.settings) {
    const ns = item.key.split(".")[0];
    if (ns !== "core") sel.ns[ns] = true;
  }
  const diff = diffSnapshot(snap, sel);
  if (!diff.changed.length) return;
  diff.changed.__sel = sel;
  diff.changed.__snap = snap;
  const s = summaryText(diff.changed);
  const dlg = new Dialog({
    title: "检测到与主世界基准的差异",
    content: `<div class="wsync-body">
      <div class="wsync-prompt-banner">当前世界与主世界基准（<b>${escapeHtml(snap.sourceWorld)}</b>）存在 <b>${diff.changed.length}</b> 处差异（${s.head}${s.more}）。</div>
      <div class="wsync-prompt-hint">点击「恢复主世界」后，设置与模组启用状态将全部恢复为基准值，完成后页面自动刷新。如需先查看差异清单，可在右侧边栏「世界同步」面板中点击「查看差异」。</div>
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
window.lhWorldSync = {
  version: MODULE_VERSION,
  openPanel: openSyncPanel,
  buildSnapshot,
  diffSnapshot,
  applySnapshot,
  rollback: rollbackApplyLog
};
console.log(`lh-world-sync v${MODULE_VERSION} loaded (window.__WSYNC_VER=${window.__WSYNC_VER})`);
