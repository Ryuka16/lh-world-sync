/* ============================================================================
 * 世界同步装置 (lh-world-sync) v1.2.5
 * ----------------------------------------------------------------------------
 * 功能：把一个世界当作「主世界」保存配置快照；新世界一键读回。
 * v1.2.5：第四轮 —— 对 v1.2.4 那次修复本身做的独立盲审（v1.2.4 的 15 条可核验声明里
 *   12 条修好、2 条只修一半、1 条引入新问题）。这一轮的头号发现是致命的：
 *   ① 【致命】v1.2.4 新增的「跳过本机未安装模组的键」只加在写入循环里，而记账循环
 *      写在它前面、记的是全部差异键 → 账本把一个「本来不存在、这次也不会创建」的键
 *      记成 present:false，回档时按「恢复为键不存在」执行删除。若用户此后装了那个模组
 *      并配置过它，这份配置会被删掉且不可撤销（Foundry 没有文档/文件恢复 API）。
 *      修法：先算「真正会写什么」（plan），账本、报告、回滚、写入循环全部以它为准；
 *      并把判据抽成 isNsUnavailable()，让 diffSnapshot 共用同一个函数。
 *   ② 同源的第二、第三个病：报告按差异键计数 →「已恢复 N 项」虚报（只写 50 项却报 300）；
 *      漂移检测把每个被跳过的键恒判为「又被改动过」→ 真正的漂移被噪声淹没。一并修掉。
 *   ③ 【严重】v1.2.4 把会话闸加在「拿到文件锁之后」，而拒绝分支 return 在 try/finally
 *      之外 → 锁没人释放，带着 2 分钟 TTL 把其他 GM / 标签页全挡住，而实际没有任何操作在跑。
 *      修法：闸提到拿锁之前，锁与闸的释放放进同一个 finally。
 *   ④ 被闸拒绝后会补一句「当前世界与主世界基准一致，无需恢复」——把「没执行」讲成
 *      「没必要」（v1.2.1 修过一次同类问题，新增的 busy 形态没纳进去）。现在按
 *      「真的没差异」与「有差异但全被跳过（本机没装那些模组）」分别给话。
 *   ⑤ 「面板不再读两次快照」没生效：render 里仍 force 重读，覆盖了刚放进缓存的快照。
 *   ⑥ 零散：旧版合并账本的读失败也记进 applyLogReadError（原来会说「没有记录」）；
 *      重复文档警告加一次性门；面板「存主世界 / 保存范围」补写入口守卫；
 *      控制台 window.lhWorldSync.rollback 也过会话闸；锁相关通知里的「30 秒」改回真实值。
 * v1.2.4：第三轮 —— 两个独立盲审（看不到作者判断的审阅者）通读全文后的汇总修复。
 *   它们的价值恰在于「作者视角 ≠ 审阅者视角」：有两条是 v1.2.1 / v1.2.2 声称修过、
 *   实际只修了一半的路径，我自己重看两遍都没看出来。
 *   ① 回档账本「读失败」被当成「没有账本」（与 v1.2.2 修主快照时同一类错误因果）：
 *      现在读失败单独记 applyLogReadError —— 给用户看时说真话；写路径上直接拒绝覆盖
 *      （账本是唯一的撤销凭证，覆盖即永失：Foundry 没有删除/恢复文件的 API）。
 *   ② 回档路径「非 GM / 被锁 / 别的世界的账本」三种拒绝原来都返回 null，UI 一律弹
 *      「暂无可回档记录」—— 现在返回值分型（denied / locked / readError / foreign / empty），
 *      分别给话。v1.2.1 的同类修复当时只覆盖了恢复路径。
 *   ③ 主快照备份静默失效：backupMasterSnapshot 原来是「读失败 → null → 跳过备份」，
 *      而通知照样说「已保存」。现在返回结构化结果，读失败或备份写失败都中止本次覆盖。
 *   ④ 锁回读失败被当成「别人抢了锁」→ 假拒绝（JSON.parse(null) 不抛错、返回 null，
 *      于是 undefined !== 自己的 operationId）。现在只有解析出「明确的、不是自己的」
 *      operationId 才拒绝。
 *   ⑤ 同会话重入闸 beginOp / endOp：文件锁对同一 owner（同一浏览器会话）是放行的，
 *      自动提醒弹窗 + 面板弹窗可以并发恢复，账本被后写者覆盖、失败回滚还会互相踩。
 *      闸在 finally 里释放，中途抛错也不会卡死。
 *   ⑥ 同一 key 两套文档查找规则统一：collectWorldSettings 原来取「最后一份」、
 *      getSettingDoc 取「第一份」→ 存在重复文档时「恢复改的」与「回档还原的」不是同一份。
 *      现在统一取第一份（与官方 world-settings.mjs:36 的 find 一致）并 warn 提示清理。
 *   ⑦ parseSnapshot 补 value 字段校验（v1.2.0 首轮盲审就提过、我上一轮漏修）：
 *      缺 value → JSON.stringify(undefined) = undefined → 要么写入抛错，
 *      要么被 socket 序列化丢掉、变成「假成功 + 永久假差异」。
 *   ⑧ storageRead 的 r.text() 移入 try：原来连接在读完响应头后中断时，异常会逃到
 *      没有 catch 的调用点（openRestoreConfirm 首行 / 面板按钮回调）＝「点了没反应」。
 *   ⑨ 零散：面板自动提醒复选框按设置值渲染、且在任何早退前同步（原来「无快照 / 读失败」
 *      时恒显示未勾选，而真实默认是开）；主快照被导入覆盖后作废 statusSnapCache、
 *      面板不再读两次快照；恢复时跳过「本机未安装模组」的设置键（否则悬空键会随快照
 *      在服务器之间自我复制）；排除键面板写明「三项始终排除」并念出实际并集
 *      （原来删掉默认项也提示已保存）；autoPromptCheck 读失败改为明确提示；
 *      删掉 render 里永不执行的 #wsync-autoprompt 死代码；补 .wsync-v-arrow 样式。
 * v1.2.3：第二轮自查 —— 逐条重走《血的教训-代码审阅自检清单篇》14 项，
 *   并把「写入 / 读取 / 交互」三条全路径通读一遍（不是只看 diff）。
 *   这一轮最要紧的一句话：**查出了 v1.2.2 自己引入的一处回归**。
 *   ① 回归：applySnapshot 写 core.moduleConfiguration 时会经 keepSelfEnabled 补上本模块，
 *      但账本 afterMap 记的仍是「想要写的值」（原值）→ findDriftedKeys 拿它跟当前值比，
 *      永远不相等 → 回档弹窗误报「其中 N 项又被改动过」（清单第 1 项：状态模型不一致）。
 *      现在账本记「实际写进去的值」。
 *   ② 同一处改造的第二层：diffSnapshot 只规范化了一边。快照里本模块是关的、恢复时被
 *      强制保留为启用 → 当前值比快照多一项 → core.moduleConfiguration 永远判定为差异，
 *      每次进世界都弹一次假提醒（与 foundry-mcp-bridge.lastActivity 那次心跳假差异同一个病）。
 *      现在比较前两边都过一遍 keepSelfEnabled。
 *   ③ 回档、以及「回档失败后的还原」写回 moduleConfiguration 时同样保留本模块 ——
 *      否则账本里记着「本模块是关的」那种极端情况下，回档会把模块自己关掉。
 *   ④ 「已自动回滚到恢复前的状态」有时是假话：账本根本没写成时，世界一个字都没改。
 *      现在失败分三种（没开始 / 改了并回滚成功 / 改了且回滚也失败），三种说三句不同的话。
 *   ⑤ 账本读取失败被当成「本来就没有账本」，随后的写入会覆盖掉旧的回档记录 ——
 *      至少留一行 warn 说清「旧回档记录可能因此丢失」。
 *   ⑥ restoreFromSnap 与 openRestoreConfirm 先开弹窗、后挂 __sel/__snap，
 *      而弹窗里的按钮回调正是靠这两个字段工作（顺序反了 = 弹窗拿到没装配好的清单）。
 *      统一改成「先挂再开」（autoPromptCheck 一直是正确顺序）。
 *   ⑦ openDiffDialog 的标题与正文写死「主世界基准」，但它同时被「导入外部快照」复用
 *      → 那种场合是在说谎。现在按来源参数化（「这份快照」/「主世界基准」）。
 *   ⑧ keepSelfEnabled 在 diff 路径会被每次进世界调用，原来每次都 warn，改成只提示一次；
 *      另：用户手填的「不参与恢复的设置」列表进通知前补转义；修正两处过时文案与注释。
 * v1.2.2：一次独立盲审（另一名审阅者通读全文件、不看我的自查结论）又挑出 8 条
 *   我漏掉的真问题，逐条核实后全部修掉；另做若干加固。
 *   ① 面板的模块勾选列表把 core 命名空间永久剔除（nsCheckboxListHTML 里残留的
 *      `n !== "core"`）—— 新世界往往压根没有 core 这个 ns（core.time / core.permissions
 *      被默认排除、core.moduleConfiguration 又被单独跳过），于是列表里永远看不到 core 那一行；
 *      走面板的恢复会静默跳过全部 core.*，而状态栏 / 自动提醒却把它们算进差异
 *      →「恢复完还一直报差异」。现在 core 与其它命名空间同等对待。
 *   ② 「自定义范围但一个都没勾」：saveScopePref 存成 custom+0，buildSelection 却当
 *      「全部」、selectionFromPanel 又当「什么都不恢复」—— 同一份偏好三种含义。
 *      现在从源头拒绝保存空范围，点恢复时也会明确提示「范围是空的」。
 *   ③ storageRead 硬编码 "/modules/..."：服务器一旦配了路由前缀就必然 404，而 404 还被
 *      当成「还没有快照」。改用官方 getRoute（出处：public/scripts/foundry.mjs:1248-1255
 *      `function getRoute(path,{prefix}={})`，导出见同文件 :61351）；并把「文件不存在」
 *      与「读失败」分开 —— 后者记进 storageLastError，界面上说真话（5xx 不再被讲成
 *      「尚未保存主世界快照」，免得用户去重复存快照）。
 *   ④ 操作锁原来用 userId 判断「这是不是自己的锁」，同一个 GM 开两个标签页会双双放行。
 *      改用 sessionStorage 里的会话标识 owner（旧锁文件自动退回旧判定，向后兼容）。
 *   ⑤ 「已自动回滚」可能是假话：回滚自己失败被 catch 吞掉，外层照样那样提示。
 *      现在把回滚结果随错误上报，失败时明说「没还原成功，请勿刷新页面」。
 *   ⑥ 外来 / 手工改过的快照若含本模块自身键（lh-world-sync.*），写入阶段会因为
 *      「当前世界查不到这个文档」而走 createDocuments，造出同 key 的第二份 Setting。
 *      现在解析时直接拒收这类键；文档存在性判定也改用 getSettingDoc（不受导出过滤影响）。
 *   ⑦ 面板可被连点开出多个窗口，而状态刷新用全局选择器会写进「先开的那个」。
 *      面板改单例（已开则置顶），状态刷新只用自己这个窗口的元素（dlg.element）。
 *   ⑧ 回档报告把「本来就不存在、什么都没做」的项也算进「已回档 N 项」并宣称「已全部还原」。
 *      现在分两笔账如实报数。
 *   另加固：快照条目上限 20000（防损坏的超大 json）、通知条插值统一转义、
 *   恢复模组启用列表时强制保留本模块自身为启用（防止把自己关掉后 UI 入口消失）、
 *   账本文件名不再把中文压成下划线（两个中文世界名会撞成同一个账本）、
 *   主题圆点改用属性选择器（不再依赖 nth-of-type 与 DOM 顺序）。
 * v1.2.1：按《血的教训-代码审阅自检清单篇》14 项对 v1.2.0 逐条自查后修复 11 处：
 *   ① 覆盖主快照前先把旧的一份另存 world-snapshot-master.prev.json
 *      （第 14 项 写操作可逆性：原来点错一次就没有退路）
 *   ② 回档 rollbackApplyLog 补失败回滚 —— 原来循环里任一失败即抛出，已写部分不回滚、
 *      账本不标记，世界停在「半回档」而用户只看到一句「失败」（与恢复路径防护不对称）
 *   ③ 回档与恢复失败回滚改批量调用（原来逐条 updateDocuments/createDocuments/
 *      deleteDocuments，1300 项即 1300 次往返）
 *   ④ 被操作锁拒绝(locked)/被权限拒绝(denied) 时不再追问「当前世界与主世界基准一致，
 *      无需恢复」—— 那是把「没执行」讲成「没必要」
 *   ⑤ 侧边栏按钮插入后回读校验，失败返回 false 让兜底重试继续（原来无条件 return true，
 *      结构一变按钮永久消失且无任何提示）
 *   ⑥ 状态栏差异口径改为「面板当前勾选」，与点「恢复主世界」实际执行的范围同源；
 *      快照加缓存，改勾选只重算不重新下载
 *   ⑦ 存主世界 / 回档 / 导入设为主快照 三条写路径纳入同一把操作锁（原来只有恢复上锁）
 *   ⑧ 实际写入清单与弹窗预览同源（原来 applySnapshot 内部重新 diff，可能与用户看到的不同）
 *   ⑨ 恢复完成不再 3 秒无条件刷新：延长到 10 秒 + 立即刷新/稍后再刷新按钮，
 *      清单存进 sessionStorage，刷新后仍能在面板查看「上一次恢复改动了什么」
 *   ⑩ 差异标签不再把数值变化说成「开启/关闭」（原来 0 → 5 显示「→开启」）
 *   ⑪ 去掉 setTheme 里永远命不中的 #wsync-panel-win 选择器
 * v1.2.0：采纳审阅里我上一轮以「保守」为由拒绝的两条建议（现已按审阅意见改回，
 *   并各留一层兜底），外加系统声明放开：
 *   ① 侧边栏按钮不再永久轮询。原实现 setInterval(1500ms) 常驻查 DOM，审阅第 12 条
 *      认为该用官方渲染 hook。现改为 hook 驱动 —— hook 名 renderSidebar 的来历：
 *      ApplicationV2 渲染后按「render + 类名」派发（client/applications/api/
 *      application.mjs:1226-1233 #callHooks：Hooks.callAll(hookName.replace("{}",
 *      cls.name), ...)，render 事件的 hookName 为 "render"，见同文件:523），
 *      侧边栏类名 Sidebar（client/applications/sidebar/sidebar.mjs:23
 *      export default class Sidebar extends HandlebarsApplicationMixin(ApplicationV2)）
 *      → hook 名即 "renderSidebar"；另挂 sidebar.mjs:250 的 changeSidebarTab
 *      （切 tab 时 Hooks.callAll("changeSidebarTab", ui[tab])）。
 *      ⚠ 时机：侧边栏渲染发生在 ready 之前（client/game.mjs:772 initializeUI()，
 *      而 :787 才 Hooks.callAll("ready")；:992 ui.sidebar.render({force:true})），
 *      所以两个 Hooks.on 必须写在模块加载期（文件顶层），不能等 ready 再注册。
 *      兜底：万一两个 hook 都错过，做有限次重试（1 秒 × 最多 8 次，挂上即停），
 *      全文件不再有任何常驻定时器。
 *   ② 回档账本改为「每世界一个文件」apply-log-<worldId>.json。原先把所有世界写进
 *      同一个 apply-log.json —— v1.0.9 虽已按 worldId 分区，但仍要读整份文件、
 *      写入时还会重写别的世界的记录。现在只读自己那个文件、只写自己那个文件，
 *      世界之间物理隔离。旧文件 apply-log.json 只读不写也不删（一次性兼容：
 *      本世界条目若只存在于旧文件里，仍能读到并用于回档；迁移完成后由用户自行删除）。
 *   ③ 系统声明放开：module.json 的 relationships.systems 改为 []。原声明
 *      dnd5e 5.3.3 会让其他系统（如 PF2e）的世界把本模块从「启用模组」列表里
 *      直接过滤掉（官方依据：public/scripts/foundry.mjs:109351-109352 —— 声明了
 *      systems 且当前系统不在其中即 return arr 剔除）。本模块只读写 world 级
 *      Setting，与具体游戏系统无关。
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
 *      属尽力而为；崩溃后由 TTL 自动失效（v1.2.5 起为 2 分钟），不会死锁。
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
const MODULE_VERSION = "1.2.5";
window.__WSYNC_VER = MODULE_VERSION; // 探针：控制台输入 window.__WSYNC_VER 验版本

/* ============================ 常量 ============================ */
// 快照文件（固定名覆盖写，游戏内无删除 API，旧文件不清理）
const STORAGE_DIR = "modules/lh-world-sync/storage";
const MASTER_FILE = "world-snapshot-master.json";
// v1.2.1：覆盖主快照（存主世界 / 导入设为主快照）前，先把上一份原样另存到这里。
// 固定文件名，只保留最近一次；给「手滑点错」留一条退路。
const MASTER_PREV_FILE = "world-snapshot-master.prev.json";
// 回档账本文件名（v1.2.0 起每世界一个文件，只读自己那个、只写自己那个）。
// worldId 本身是 16 位字母数字，这里再做一次白名单过滤：currentWorldId() 在
// world.id 缺失时会退回世界标题（可能含空格/中文/斜杠），直接拿来拼文件名会非法。
const APPLOG_FILE_LEGACY = "apply-log.json"; // v1.0.9–v1.1.0 的合并账本：只读兼容，不写也不删
function applyLogFile() {
  // v1.2.2：白名单从「只允许字母数字」放宽为「只挡文件名非法字符」。
  // 原来世界标题里的中文会被整串压成下划线（「银爪月影」「红龙之影」都变成 ____），
  // 两个世界的账本会同名互串 —— 正是 v1.0.9 修掉的那类串数据。
  const safe = currentWorldId()
    .replace(/[\\/:*?"<>|]/g, "_")            // 文件名非法字符
    .replace(/\s+/g, "_")                      // 空白（免得 URL 里出现空格）
    .replace(/[\u0000-\u001f]/g, "")          // 控制字符
    .slice(0, 64);
  return "apply-log-" + (safe || "unknown") + ".json";
}
// 回档账本 schema 2（v1.0.9）：账本按世界分区，A/B 世界不再互相覆盖
const APPLOG_SCHEMA = 2;
// 操作锁（v1.1.0）：两个 GM 同时恢复时，后进入者被拒。
// 注意：文件锁不是原子操作（没有 CAS），靠「写后回读 operationId」判定归属，
// 属尽力而为；TTL 到期自动失效，所以崩溃/关页面不会留下永久死锁。
const LOCK_FILE = "operation-lock.json";
// v1.2.4：30 秒 → 2 分钟。千项级恢复（批量写入 + 账本写入 + 服务器往返）很容易
// 超过 30 秒，中途失锁 = 第二个流程可以插进来同时写设置与账本（前一次的撤销点被覆盖）。
// 代价是崩溃后要等 2 分钟才自动解锁，用「提示文案写清楚」换取「不会并发写坏」。
const LOCK_TTL_MS = 120000;
// 恢复范围偏好（世界级设置）：{ mode:"all"|"custom", ns:{}, includeModuleConfig }
const SCOPE_SETTING = "nsScope";
// 当前世界的稳定标识：world.id 不随世界改名而变
// （官方同源用法：client/documents/abstract/client-document.mjs:943
//   worldId: game.world.id —— 官方导出文档时就是用 world.id 标世界归属）
function currentWorldId() {
  const id = game.world?.id ?? game.world?._id;
  if (id) return String(id);
  // 兜底：世界文档缺 id（理论上不该发生）。用标题代替并在日志留痕 ——
  // 静默退化正是「账本串世界」这类事故的温床，宁可吵一点也要留下证据。
  console.warn("[lh-world-sync] 世界对象缺少 id，本次以标题作为世界标识：" + (game.world?.title ?? "?"));
  return String(game.world?.title ?? "unknown");
}
// 本浏览器会话的唯一标识（v1.2.2）：用于识别「同一个 GM 开了两个标签页」。
// 存 sessionStorage —— 同一标签页内刷新保持，不同标签页/窗口互不相同。
// 出处：sessionStorage 语义（每标签页独立），另一处同源用法见本文件 wsync.justApplied。
let _myOwner = null;
function myOwner() {
  if (_myOwner) return _myOwner;
  try {
    let v = sessionStorage.getItem("wsync.owner");
    if (!v) { v = foundry.utils.randomID(); sessionStorage.setItem("wsync.owner", v); }
    _myOwner = v;
  } catch (e) {
    _myOwner = "mem-" + foundry.utils.randomID();  // 隐私模式下 sessionStorage 可能不可用
  }
  return _myOwner;
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
  const winEl = $(".wsync-app");
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
// v1.2.1：一次会话只探一次 —— 原来每次 storageWrite 都跑一遍 createDirectory + browse
// （写快照、写锁、写账本各白跑两个请求）。失败时作废缓存，下次重新探测。
let storageDirReady = false;
async function storageEnsureDir() {
  if (storageDirReady) return;
  // 服务端 upload 不会自动建目录（dist/files/local.mjs upload 对 target 目录 existsSync 检查），
  // 必须先 createDirectory；若失败（权限/位置禁止）会真实上抛，让面板报错而不是静默继续。
  try {
    await FilePicker.createDirectory("data", STORAGE_DIR);
  } catch (e) { /* 目录已存在时 mkdirSync 抛 EEXIST，属正常 */ }
  // 目录确实可用才继续（browse 在目录不可访问时抛错）
  await FilePicker.browse("data", STORAGE_DIR, {});
  storageDirReady = true;
}
async function storageWrite(name, text) {
  await storageEnsureDir();
  // 金标准（wss SettingsCompiler.js saveAgnosticToFile）：uploadPersistent 的 path 参数必须是
  // storage 内的「目录」路径（空串=根），文件名由 File 构造器第二个参数提供；传文件名会被服务端
  // 当作目录做 existsSync 检查而报 "Target directory ... does not exist"。
  const file = new File([text], name, { type: "application/json" });
  let res;
  try {
    res = await FilePicker.uploadPersistent(MODULE_ID, "", file, {}, { notify: false });
  } catch (e) {
    // 目录可能被外部删除或权限变更：作废缓存，让下次写入重新探测一次
    storageDirReady = false;
    throw e;
  }
  if (!res?.path) {
    storageDirReady = false;
    throw new Error("快照写入失败:" + JSON.stringify(res));
  }
  return res.path;
}
// v1.2.2 两条修复（外部审阅）：
//   ① 路径改用官方 getRoute —— 它会自动带上服务器可能配置的路由前缀。
//      出处：public/scripts/foundry.mjs:1248-1255 `function getRoute(path,{prefix}={})`，
//      prefix 缺省取 globalThis.ROUTE_PREFIX；导出见同文件 :61351 `getRoute: getRoute`。
//      原实现硬编码 "/modules/..."：服务器一旦配了路由前缀就必然 404，
//      而 404 又被当成「还没有保存过快照」——用户看到的是错误的因果。
//   ② 不再把一切失败都当「文件不存在」：只有 404 才是真的不存在，
//      其余（HTTP 5xx / 断网）记进 storageLastError，让界面能说真话。
//      返回语义仍然是 null（不给十几个调用点引入新的异常路径）。
let storageLastError = null;
// v1.2.4：回档账本的「读取失败」必须与「文件本来就不存在」分开，两个用途：
//   ① 给用户看：读失败不能说成「本世界暂无可回档记录」（错误因果，会让人以为撤销点没了）；
//   ② 给写路径用：读失败时绝不能照写覆盖 —— 账本里存的是「上一次恢复前的值」，
//      是用户点「回档」的唯一凭证，服务器上没有它的备份，覆盖即永失。
let applyLogReadError = null;
async function storageRead(name) {
  const url = foundry.utils.getRoute(norm(STORAGE_DIR) + "/" + name);
  let r;
  try {
    r = await fetch(url, { cache: "no-store" });
  } catch (e) {
    storageLastError = "无法连接服务器（" + (e?.message || e) + "）";
    console.warn("[lh-world-sync] 读取失败：" + url, e);
    return null;
  }
  if (r.status === 404) { storageLastError = null; return null; }
  if (!r.ok) {
    storageLastError = "服务器返回 HTTP " + r.status + "（" + name + "）";
    console.warn("[lh-world-sync] 读取失败：" + url + " → HTTP " + r.status);
    return null;
  }
  // v1.2.4：读 body 必须包在 try 里。原来这行在函数内任何 try 之外，
  // 连接在「响应头已到、body 还没读完」时中断 → 异常直接逃到调用点；
  // 而 openRestoreConfirm 的首行、面板按钮回调都没有 catch，
  // 用户看到的现象是「点了没反应」（无提示、无日志）。
  try {
    const text = await r.text();
    storageLastError = null;
    return text;
  } catch (e) {
    storageLastError = "读取响应内容失败（" + (e?.message || e) + "）";
    console.warn("[lh-world-sync] 读取响应失败：" + url, e);
    return null;
  }
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
// v1.2.4：同一浏览器会话内的重入闸。
// 跨标签页靠文件锁（owner 不同）；但同一个会话里 owner 相同 → 文件锁会放行，
// 于是「自动提醒弹窗」和面板里的确认弹窗都开着时，先后点两下「恢复主世界」
// 可以让两个 applySnapshot 并发跑：各自算 prevMap、各自写账本，后写者覆盖前者的
// 撤销点；中途失败的自动回滚还可能把另一次刚写好的键按旧值盖回去。
let _opInFlight = null;
function beginOp(name) {
  if (_opInFlight) {
    console.warn("[lh-world-sync] 同会话重入已被挡下：" + _opInFlight);
    try { notify.warn("已有正在进行的操作（" + _opInFlight + "），请等它完成后再试。"); } catch (e) { /* 忽略 */ }
    return false;
  }
  _opInFlight = name;
  return true;
}
function endOp() { _opInFlight = null; }
// 轻量操作锁：两个 GM 同时点「恢复」时后进入者被拒绝。
// 实现说明（这是尽力而为的锁，不是严格互斥锁，别当分布式锁用）：
//   ① 读现有锁 → 未过期且属于别人 = 直接拒绝；
//   ② 写入自己的 operationId → 回读校验：若 operationId 已不是自己，说明
//      有人在我之后又写了一次 → 我放弃（后写者赢）；
//   ③ TTL 2 分钟（v1.2.5 起），持有者崩溃/关页面后自动失效，不会留下死锁。
async function acquireLock(opName) {
  const now = Date.now();
  const text = await storageRead(LOCK_FILE);
  if (text) {
    try {
      const l = JSON.parse(text);
      // v1.2.2：判定「这是不是我自己持有的锁」改用 owner（浏览器会话标识），
      // 不再用 userId —— 同一个 GM 开两个标签页时 userId 相同，原来第二个标签页
      // 会直接放行，两个流程各自算账本、各自写设置。
      // 旧锁文件没有 owner 字段 → 退回旧的 userId 判定（向后兼容；TTL 到期自然过期）。
      const sameOwner = l?.owner ? (l.owner === myOwner()) : (l?.userId === game.user.id);
      if (l?.expiresAt > now && l.worldId === currentWorldId() && !sameOwner) {
        return { ok: false, holder: l };
      }
    } catch (e) { /* 坏文件按无锁处理 */ }
  } else if (storageLastError) {
    // 读不到锁文件（5xx/断网）时按无锁放行，但必须留痕：这是「尽力而为的锁」
    console.warn("[lh-world-sync] 锁文件读取异常，本次跳过互斥检查：" + storageLastError);
  }
  const lock = {
    operationId: foundry.utils.randomID(),
    op: opName,
    worldId: currentWorldId(),
    worldTitle: game.world?.title ?? "",
    userId: game.user.id,
    userName: game.user.name ?? "",
    owner: myOwner(),
    startedAt: new Date(now).toISOString(),
    expiresAt: now + LOCK_TTL_MS
  };
  // v1.2.3：写锁失败不能把整个操作拖死。锁是「尽力而为」的互斥手段（见上面读锁失败的分支），
  // 服务器磁盘满 / 目录权限变更时，若因为写不进一个锁文件就拒绝恢复世界，是本末倒置——
  // 而且用户看到的是「快照写入失败」，完全指不到「锁」这个真正的原因。
  try {
    await storageWrite(LOCK_FILE, JSON.stringify(lock, null, 2));
  } catch (e) {
    console.warn("[lh-world-sync] 锁文件写入失败，本次跳过互斥检查继续执行：" + (e?.message || e));
    return { ok: true, lock: null };
  }
  // v1.2.4：回读不可用时必须放行。JSON.parse(null) 不抛错、返回 null，
  // 于是 l2?.operationId（undefined）!== 自己的 → 自己刚写的锁把自己判成「别人的锁」，
  // 用户看到「已有进行中的世界同步操作（另一位 GM）」——注释写的是「不强求」，实现是反的。
  // 只有解析出「明确的、且不是自己的」operationId 才算真的被别人抢了锁。
  const back = await storageRead(LOCK_FILE);
  if (back) {
    try {
      const l2 = JSON.parse(back);
      if (l2?.operationId && l2.operationId !== lock.operationId) return { ok: false, holder: l2 };
    } catch (e) { /* 内容坏了同样按「读不到」处理，放行 */ }
  }
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
// v1.2.1：让「存主世界 / 回档 / 导入设为主快照」与「恢复」共用同一把锁。
// 拿不到锁时提示并返回 { locked: true }，调用方据此直接收手（别当成「无需执行」）。
async function withOpLock(opName, fn) {
  // v1.2.4：同会话重入闸（存主快照 / 导入设为主快照 这两条写路径）
  if (!beginOp(opName === "snapshot" ? "存主快照" : opName)) return { busy: true };
  try {
    const got = await acquireLock(opName);
    if (!got.ok) {
      const h = got.holder ?? {};
      const who = h.userName || h.userId || "另一位 GM";
      const when = h.startedAt ? formatTs(h.startedAt) : "";
      console.warn("[lh-world-sync] 操作被拒：已有进行中的世界同步操作", h);
      notify.warn(`已有进行中的世界同步操作（${escapeHtml(who)}${when ? " 于 " + when + " 开始" : ""}），请稍后再试。若对方已中断，约 2 分钟后会自动解锁。`);
      return { locked: true };
    }
    try { return await fn(); } finally { await releaseLock(got.lock); }
  } finally {
    endOp();
  }
}
// 覆盖主快照前的备份。
// v1.2.4：返回值从「路径或 null」改成结构化结果。原来「读取失败」与「本来没有旧快照」
// 都返回 null → 备份被静默跳过，而通知照样说「已保存主世界快照」，
// 用户以为有退路（README 承诺过 .prev 文件），实际旧快照已被覆盖且没有任何副本。
async function backupMasterSnapshot() {
  try {
    const old = await storageRead(MASTER_FILE);
    if (!old) {
      if (storageLastError) return { ok: false, reason: "readError", detail: storageLastError };
      return { ok: true, path: null };   // 确实没有旧快照，无需备份
    }
    const path = await storageWrite(MASTER_PREV_FILE, old);
    return { ok: true, path };
  } catch (e) {
    console.warn("[lh-world-sync] 主快照备份失败", e);
    return { ok: false, reason: "writeError", detail: (e?.message || String(e)) };
  }
}

/* ---------- 世界设置全集读写 ---------- */
// v1.2.5：重复文档只警告一次 —— collectWorldSettings 每次算差异都会跑
// （进世界、每次勾选变化、每次状态刷新），否则控制台会被同一句话刷屏。
let _dupKeyWarned = false;
function collectWorldSettings() {
  const store = game.settings.storage.get("world");
  const out = new Map(); // key -> { value, doc }
  for (const doc of store.values()) {
    if (doc.user) continue;                 // user 级设置（玩家个人）不导出
    const key = doc?.key;
    if (!key || isExcludedKey(key)) continue;
    if (key.startsWith(MODULE_ID + ".")) continue; // 本模块自指键
    // v1.2.4：同一 key 只认「第一份」文档 —— 必须与官方的查找规则一致
    // （client/documents/collections/world-settings.mjs:36
    //   getSetting(key,user) = find(s => s.key===key && s.user===user)，读的是第一份）。
    // 原来这里用 set 覆盖（留下最后一份），而写入/回档走 getSettingDoc（第一份）：
    // 世界上一旦存在重复 key 的文档，「恢复改的」与「回档还原的」就是两份不同文档。
    if (out.has(key)) {
      if (!_dupKeyWarned) {
        _dupKeyWarned = true;
        console.warn("[lh-world-sync] 本世界存在重复的设置文档（同一个 key 有多份）：" + key
          + "；已统一按第一份处理，建议清理重复文档。");
      }
      continue;
    }
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
  // v1.2.2：条目数量上限。一份损坏或恶意的超大 json 会一路走到写入阶段
  // （长时间白屏 + 海量 Setting 写入，中途失败只剩「已回滚」的残局）。
  if (snap.settings.length > 20000) {
    throw new Error("快照条目过多（" + snap.settings.length + " 项，上限 20000），疑似文件损坏，已拒绝导入");
  }
  const seen = new Set();
  for (const item of snap.settings) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("设置清单里存在非法条目");
    if (typeof item.key !== "string" || !item.key.includes(".")) throw new Error("设置清单里存在非法键：" + String(item.key));
    // v1.2.4：value 字段必须存在且可写入。
    // 缺 value 时 JSON.stringify(undefined) === undefined，一路走到 updateDocuments
    // 才抛 "must be a serialized JSON string"（common/data/fields.mjs:3013-3014）；
    // 更糟的一种走法是 undefined 属性被 socket 序列化直接丢掉 → 服务端收到一次空更新，
    // 而报告弹窗照样说「已恢复 N 项」、账本照样记账 = 永久性的假成功 + 永久假差异。
    if (!("value" in item)) throw new Error("快照条目缺少 value 字段：" + item.key);
    if (item.value === undefined || typeof item.value === "function") {
      throw new Error("快照条目的 value 无法写入（" + typeof item.value + "）：" + item.key);
    }
    if (seen.has(item.key)) throw new Error("快照里有重复的设置键：" + item.key);
    // v1.2.2：拒绝本模块自身的设置键。collectWorldSettings 导出时会跳过它们，
    // 所以本模块产出的快照不会有；外来 / 手工改过的快照若带着
    // lh-world-sync.nsScope 这类键，写入阶段会因为「当前世界查不到这个文档」
    // 而走 createDocuments，造出同 key 的第二份 Setting 文档（取哪份不确定）。
    if (item.key.startsWith(MODULE_ID + ".")) {
      throw new Error("快照里含本模块自身的设置键（" + item.key + "），已拒绝导入");
    }
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
    // v1.2.5：本机没装的模组，其键恢复时也不会被创建（见 applySnapshot），
    // 所以不能算差异 —— 否则「恢复 → 立刻又报差异 → 再恢复」永不收敛。
    if (isNsUnavailable(key)) continue;
    const ns = key.split(".")[0];
    if (key === "core.moduleConfiguration") {
      if (!selection?.includeModuleConfig) continue;
    } else if (selection?.ns && !selection.ns[ns]) continue;
    // v1.2.3：两边都过一遍 keepSelfEnabled 再比。
    // 否则「快照里本模块是关的 → 恢复时被强制保留为启用 → 当前值比快照多一项」
    // 会让 core.moduleConfiguration 永远判定为差异，每次进世界都弹一次假提醒
    // （和当年 foundry-mcp-bridge.lastActivity 那次心跳假差异同一个病）。
    const cur = keepSelfEnabled(key, current.has(key) ? current.get(key) : undefined);
    const to = keepSelfEnabled(key, item.value);
    if (!isJSONEqual(cur, to)) {
      changed.push({ key, from: cur, to });
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
  // v1.2.1：只有两端都是「布尔语义」才说开启/关闭。原实现按 falsy 判断，
  // 会把数值 0 → 5、空字符串 → "abc" 都标成「→开启」，属于误导。
  const boolish = (v) => v === true || v === false || v === null || v === undefined;
  if (boolish(from) && boolish(to)) {
    if (!from && to) return "→开启";
    if (from && !to) return "→关闭";
  }
  if (Array.isArray(from) && Array.isArray(to)) {
    if (to.length > from.length) return "→增加项";
    if (to.length < from.length) return "→减少项";
  }
  return "→修改";
}
// 回档账本（v1.0.9 起按世界分区）：
// { schema: 2, worlds: { "<worldId>": { ts, worldId, worldTitle, appVersion, prev } } }
// prev = { key: { present, value } }；present:false 表示该键在恢复前并不存在。
function emptyApplyLogStore() { return { schema: APPLOG_SCHEMA, worlds: {} }; }
// 读整个账本容器。文件 = apply-log-<worldId>.json（只可能含本世界一格）。
// 兼容：新文件不存在时，从旧版合并账本 apply-log.json 里取本世界那一格
// （只读不写；下次恢复会落到新文件，旧文件保持原样由用户自行删除）。
async function readApplyLogStore() {
  const text = await storageRead(applyLogFile());
  // v1.2.4：读完立刻捕获本次读取的结果 —— 下面读旧版账本还会调用 storageRead，
  // 而 storageLastError 是单变量、会被覆写，晚一步读就等于读错（拿到别人的结果）。
  applyLogReadError = text ? null : storageLastError;
  if (text) {
    try {
      const raw = JSON.parse(text);
      if (raw && raw.schema === APPLOG_SCHEMA && raw.worlds && typeof raw.worlds === "object") return raw;
      console.warn("[lh-world-sync] 本世界账本文件格式异常，已忽略（不作为回档依据）");
    } catch (e) {
      console.warn("[lh-world-sync] 本世界账本文件解析失败，已忽略（不作为回档依据）", e);
    }
    return emptyApplyLogStore();
  }
  // v1.2.3：读不到文本时，区分「文件本来就没有」和「有文件但这次没读成」。
  // 后者若被当成空的，随后的写入会覆盖掉本世界原有的回档记录 —— 至少要留个痕。
  if (storageLastError) {
    console.warn("[lh-world-sync] 回档账本读取失败（" + storageLastError + "），"
      + "本次将重新写一份账本；若旧账本其实存在，它的回档记录会被覆盖。");
  }
  const legacy = await storageRead(APPLOG_FILE_LEGACY);
  // v1.2.5：旧版合并账本读失败也要记下来 —— 否则这种情形会走「没有可回档记录」，
  // 而那个文件里可能还存着本世界的撤销点（与主账本读失败同类的错误因果）。
  if (!legacy && storageLastError && !applyLogReadError) applyLogReadError = storageLastError;
  if (legacy) {
    try {
      const raw = JSON.parse(legacy);
      const wid = currentWorldId();
      if (raw && raw.schema === APPLOG_SCHEMA && raw.worlds?.[wid]) {
        console.log("[lh-world-sync] 已从旧版合并账本 " + APPLOG_FILE_LEGACY + " 读到本世界的回档记录；"
          + "下次恢复起写入 " + applyLogFile() + "，旧文件保留不动，确认无误后可手动删除。");
        return { schema: APPLOG_SCHEMA, worlds: { [wid]: raw.worlds[wid] } };
      }
    } catch (e) { /* 旧文件损坏与本世界无关，忽略 */ }
  }
  return emptyApplyLogStore();
}
// 写入时只覆盖「本世界」那一格，其他世界的记录原样保留
async function writeApplyLog(prevMap, afterMap) {
  const store = await readApplyLogStore();
  // v1.2.4：账本读失败时绝不覆盖写。
  // 覆盖会把「上一次恢复前的值」永久挤掉 —— 服务器上没有账本的备份，
  // Foundry 也没有删除/恢复文件的 API，覆盖即永失，用户再也没有撤销点。
  // 这里抛错 → applySnapshot 以 __notStarted 收尾 → 世界一个设置都不会被改。
  if (applyLogReadError) {
    throw new Error("回档账本读取失败（" + applyLogReadError
      + "）——为避免覆盖本世界原有的回档记录，本次操作已中止。请检查服务器连接后重试。");
  }
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
  await storageWrite(applyLogFile(), JSON.stringify(store, null, 2));
}
// 回档成功后就地标记（审阅第 8 条：原实现可无限重复回档，几天后再点一次仍写旧值）
async function markLogRolledBack() {
  const store = await readApplyLogStore();
  const wid = currentWorldId();
  const e = store.worlds?.[wid];
  if (!e) return;
  e.status = "rolled-back";
  e.rolledBackAt = new Date().toISOString();
  await storageWrite(applyLogFile(), JSON.stringify(store, null, 2));
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
// v1.2.2：恢复「模组启用列表」时强制保留本模块自身为启用。
// 主快照可能来自「当时没启用本模块」的世界（例如别人服务器导出的文件），
// 整体覆盖之后刷新页面，本模块自己就没了 —— 用户只能去「管理模组」里手工找回。
let _selfKeepWarned = false;
function keepSelfEnabled(key, val) {
  if (key !== "core.moduleConfiguration") return val;
  if (!val || typeof val !== "object" || Array.isArray(val)) return val;
  if (val[MODULE_ID] === true) return val;
  // v1.2.3：收到「只看不写」的调用（diffSnapshot 每次进世界都跑）也不刷屏，只提示一次
  if (!_selfKeepWarned) {
    _selfKeepWarned = true;
    console.warn("[lh-world-sync] 快照的模组启用列表里没有本模块，已强制保留为启用：" + MODULE_ID);
  }
  return { ...val, [MODULE_ID]: true };
}
// v1.2.5：本机「有没有这个设置键所属的模组」。
// 恢复时这些键会被跳过（不创建没人读、却会随快照在服务器之间复制的悬空键），
// 因此「写入」「差异计算」「账本记账」三处必须共用同一个判据 —— v1.2.4 只在写入路径
// 用了它，于是差异永远存在（每次进世界弹提醒）、账本把没写的键记成「原本不存在」，
// 回档时会去删一个用户后来才产生的配置（第三轮盲审判定为致命）。
function isNsUnavailable(key) {
  const ns = String(key ?? "").split(".")[0];
  if (!ns) return false;
  if (ns === "core") return false;                 // 核心设置永远可写
  if (ns === MODULE_ID) return true;               // 本模块自指键：导出已排除，也不该写入
  if (ns === game.system?.id) return false;        // 当前系统的设置
  return !game.modules?.get(ns);                   // 未安装的模组
}
async function applySnapshot(snap, selection, precomputed) {
  // 写入口守卫（审阅第 10 条）：window.lhWorldSync.applySnapshot 对所有人生效
  if (!assertGM()) return { applied: [], skipped: 0, denied: true };
  // v1.2.5：统计「因本机未安装对应模组而不参与恢复」的键。
  // 它们已被 diffSnapshot 排除（否则会永远报差异、每次进世界弹提醒），
  // 所以这里单独从快照统计一次，好让提示与报告能说明「有 N 项没恢复」的原因。
  const unavailable = [];
  for (const item of (snap?.settings ?? [])) {
    if (isNsUnavailable(item.key)) unavailable.push(item.key);
  }
  // v1.2.1：允许调用方把弹窗里已经算好的清单原样传进来（自查第 8 项），
  // 让「用户看到的清单」与「实际写入的清单」是同一份，而不是各算一次。
  const diff = Array.isArray(precomputed) ? { changed: precomputed } : diffSnapshot(snap, selection);
  if (!diff.changed.length) return { applied: [], skipped: unavailable.length };
  // v1.2.5：闸必须加在「拿锁之前」。
  // v1.2.4 把它放在拿锁之后：beginOp 拒绝时直接 return，而那时文件锁已经写下、
  // 又落在 try/finally 之外 → 锁无人释放，带着 2 分钟 TTL 把其他 GM / 标签页全挡住，
  // 而实际并没有任何操作在跑（第三轮盲审判定为严重）。
  if (!beginOp("恢复主世界")) return { applied: [], skipped: 0, busy: true };
  let got = null;
  try {
    // 操作锁（审阅第 9 条）：另一个 GM 正在恢复时拒绝进入；TTL 到期自动失效
    got = await acquireLock("apply");
    if (!got.ok) {
      const h = got.holder ?? {};
      const who = h.userName || h.userId || "另一位 GM";
      const when = h.startedAt ? formatTs(h.startedAt) : "";
      console.warn("[lh-world-sync] 恢复被拒：已有进行中的恢复操作", h);
      notify.warn(`已有进行中的恢复操作（${escapeHtml(who)}${when ? " 于 " + when + " 开始" : ""}），请稍后再试。若对方已中断，约 2 分钟后会自动解锁。`);
      return { applied: [], skipped: 0, locked: true };
    }
    const SettingDoc = settingDocumentClass();
    const currentMap = collectWorldSettings();
    // v1.2.5：顺序反转 —— 先算出「真正会写什么」，再记账、再写。
    // v1.2.4 把「跳过本机未安装模组的键」只加在写入循环里，而记账循环写在它前面、
    // 记的是全部差异键，于是有三个连带病（第三轮盲审）：
    //   ① 账本把一个「本来不存在、这次也不会创建」的键记成 present:false →
    //      回档时按「恢复为键不存在」执行删除 —— 若用户此后装了那个模组并配置过它，
    //      这份配置会被删掉且不可撤销（Foundry 没有文件/文档恢复 API）。这是致命级。
    //   ② 报告弹窗按 diff.changed 计数，把没写的键也算进「已恢复 N 项」= 假成功。
    //   ③ 漂移检测拿 after（快照值）跟当前值（永远 undefined）比，
    //      把每个被跳过的键恒判为「又被改动过」，真漂移被噪声淹没。
    const updates = [];
    const creates = [];
    const skippedNs = [];
    const plan = [];             // 本次真正会写入的差异项：账本、报告、回滚都以它为准
    for (const c of diff.changed) {
      // v1.2.2：文档是否存在一律问 getSettingDoc（不经过任何过滤），
      // 不再用 currentMap —— currentMap 出自 collectWorldSettings，它会跳过
      // 本模块自指键与 user 级键，于是「明明已经存在的文档」被判成不存在 → 造出重复文档。
      // v1.2.4：一律用 getSettingDoc（与回档、回档还原路径同一规则）—— 两套查找规则
      // 在存在重复文档时会让「写入」与「还原」落在两份不同的文档上。
      const doc = getSettingDoc(c.key);
      const json = JSON.stringify(keepSelfEnabled(c.key, c.to));
      if (doc?._id) {
        updates.push({ _id: doc._id, value: json });
        plan.push(c);
      } else if (isNsUnavailable(c.key)) {
        // v1.2.4：本机没装的模组，不把它的设置键创建进本世界 —— 那些键没有任何
        // 代码会去读，却会被下一次「存主世界」收进快照，再传给别的世界：悬空键会自我复制。
        skippedNs.push(c.key);
      } else {
        creates.push({ key: c.key, user: null, value: json });
        plan.push(c);
      }
    }
    const prevMap = new Map();   // key -> { present, value }：恢复前的值（只记会写的键）
    const afterMap = new Map();  // key -> value：本次恢复写入的值（供漂移检测）
    for (const c of plan) {
      if (currentMap.has(c.key)) prevMap.set(c.key, { present: true, value: currentMap.get(c.key).value });
      else prevMap.set(c.key, { present: false, value: undefined });
      // v1.2.3：账本里记的必须是「实际写进去的值」，不是「想要写的值」。
      // 写入时 moduleConfiguration 会经 keepSelfEnabled 补上本模块自己，
      // 账本若还记原值，findDriftedKeys 会拿原值跟当前值比 → 误报「你又改过」。
      afterMap.set(c.key, keepSelfEnabled(c.key, c.to));
    }
    // 写账本（任何写入之前；失败=直接报错，未动任何设置）
    try {
      await writeApplyLog(prevMap, afterMap);
    } catch (e0) {
      // v1.2.3：账本都没写成 = 一个设置都没动过。
      // 打上标记，别让外层把它说成「已自动回滚到恢复前的状态」——那是假话。
      e0.__notStarted = true;
      throw e0;
    }
    try {
      if (updates.length) await SettingDoc.updateDocuments(updates, {});
      if (creates.length) await SettingDoc.createDocuments(creates, {});
    } catch (e) {
      // v1.2.5：这个判断是防御性的 —— 账本写失败在更外层的 try 里就已经标记并上抛，
      // 正常执行到不了这里。保留是为了将来若有代码把带 __notStarted 的异常放进这个 try，
      // 行为仍然正确（不会去做一次无意义的「回滚」）。
      if (e?.__notStarted) throw e;
      // 失败自动回滚：按账本把已写入的键恢复
      // v1.2.1：改成批量三连（delete/update/create），原来逐条 await，1300 项 = 1300 次往返
      console.error("lh-world-sync apply failed, rolling back", e);
      let rollbackErr = null;
      try {
        const u2 = [], c2 = [], d2 = [];
        for (const c of plan) {
          const p = prevMap.get(c.key);
          const doc = getSettingDoc(c.key);
          if (!p.present) {
            if (doc?._id) d2.push(doc._id);
          } else if (doc?._id) {
            u2.push({ _id: doc._id, value: JSON.stringify(p.value) });
          } else {
            c2.push({ key: c.key, user: null, value: JSON.stringify(p.value) });
          }
        }
        if (d2.length) await SettingDoc.deleteDocuments(d2, {});
        if (u2.length) await SettingDoc.updateDocuments(u2, {});
        if (c2.length) await SettingDoc.createDocuments(c2, {});
      } catch (e2) { console.error("lh-world-sync rollback failed", e2); rollbackErr = e2; }
      // v1.2.2：把「回滚到底成没成」如实带给上层 —— 原来外层无条件提示「已自动回滚」，
      // 回滚自己失败时那句话就是假的（世界停在半新半旧，用户却以为已经安全了）。
      e.__rollbackFailed = !!rollbackErr;
      throw e;
    }
    // v1.2.5：快照里有「本机未安装模组」的设置时必须说出来 —— 否则用户会觉得
    // 「恢复完了怎么还是不对」，却不知道原因是没有那几项。
    if (unavailable.length) {
      const mods = [...new Set(unavailable.map(k => String(k).split(".")[0]))];
      console.warn("[lh-world-sync] 有 " + unavailable.length + " 项设置未参与恢复：本机未安装对应模组 —— " + mods.join("、"));
      notify.warn("另有 " + unavailable.length + " 项未恢复：本世界没有安装对应的模组（"
        + escapeHtml(mods.slice(0, 5).join("、")) + (mods.length > 5 ? " 等" : "") + "）。");
    }
    return { applied: plan, skipped: unavailable.length };
  } finally {
    endOp();                                  // v1.2.4：无论成败都放闸
    if (got?.lock) await releaseLock(got.lock);   // v1.2.5：没拿到锁就别瞎释放
  }
}
// 回档：按 applyLog 恢复
// v1.2.4：返回值不再「一律 null」。原来「非 GM / 读不到账本 / 被锁拒绝 / 账本属于
// 别的世界」四种情况都返回 null，调用方统一弹「暂无可回档记录」——
// 把「被别人锁着」「读失败」「不是这个世界的账本」全都讲成了「你没有记录」。
async function rollbackApplyLog() {
  if (!assertGM()) return { denied: true };                   // assertGM 已提示过
  const log = await readApplyLog();
  if (!log?.prev) {
    return applyLogReadError ? { readError: applyLogReadError } : { empty: true };
  }
  // 纵深防御：账本必须属于当前世界（readApplyLog 已按 worldId 只取本世界的格子，
  // 这里再核一次 worldId，防止将来改动绕过这道门）
  if (log.worldId && String(log.worldId) !== currentWorldId()) {
    console.warn("[lh-world-sync] 回档被拒：账本属于其他世界", log.worldId);
    return { foreign: true, worldId: log.worldId };
  }
  const SettingDoc = settingDocumentClass();
  // v1.2.1：回档同样是写操作，纳入同一把锁（原来只有恢复上锁）
  const got = await acquireLock("rollback");
  if (!got.ok) {
    const h = got.holder ?? {};
    const who = h.userName || h.userId || "另一位 GM";
    const when = h.startedAt ? formatTs(h.startedAt) : "";
    console.warn("[lh-world-sync] 回档被拒：已有进行中的世界同步操作", h);
    notify.warn(`已有进行中的世界同步操作（${escapeHtml(who)}${when ? " 于 " + when + " 开始" : ""}），请稍后再试。若对方已中断，约 2 分钟后会自动解锁。`);
    return { locked: true, holder: h };
  }
  try {
    const keys = Object.keys(log.prev);
    // ① 先把「回档前的当前值」记下来 —— 后面的批量写入万一失败，用它还原
    const before = new Map();
    const updates = [], creates = [], deletes = [];
    for (const key of keys) {
      const p = log.prev[key];
      const doc = getSettingDoc(key);
      before.set(key, { present: !!doc?._id, value: doc?.value });
      if (!p.present) {
        if (doc?._id) deletes.push(doc._id);
      } else {
        // v1.2.3：回档写回模组启用列表时同样强制保留本模块，
        // 否则「账本里本模块是关的」这种极端情况下，回档会把模块自己关掉。
        const json = JSON.stringify(keepSelfEnabled(key, p.value));
        if (doc?._id) updates.push({ _id: doc._id, value: json });
        else creates.push({ key, user: null, value: json });
      }
    }
    // ② 批量执行（v1.2.1：原来逐条 await，1300 项就是 1300 次往返）
    try {
      if (deletes.length) await SettingDoc.deleteDocuments(deletes, {});
      if (updates.length) await SettingDoc.updateDocuments(updates, {});
      if (creates.length) await SettingDoc.createDocuments(creates, {});
    } catch (e) {
      // ③ 失败回滚：把已碰过的键还原成「回档前」的样子，绝不停在半回档状态
      console.error("[lh-world-sync] 回档失败，正在还原到回档前状态", e);
      let rollbackErr = null;
      const u2 = [], c2 = [], d2 = [];
      for (const key of keys) {
        const b = before.get(key);
        const doc = getSettingDoc(key);
        if (!b?.present) {
          if (doc?._id) d2.push(doc._id);
        } else {
          const json = JSON.stringify(keepSelfEnabled(key, b.value));
          if (doc?._id) u2.push({ _id: doc._id, value: json });
          else c2.push({ key, user: null, value: json });
        }
      }
      try {
        if (d2.length) await SettingDoc.deleteDocuments(d2, {});
        if (u2.length) await SettingDoc.updateDocuments(u2, {});
        if (c2.length) await SettingDoc.createDocuments(c2, {});
      } catch (e2) {
        console.error("[lh-world-sync] 回档失败后的还原也失败（世界可能停在中间状态）", e2);
        rollbackErr = e2;
      }
      // v1.2.2：如实上报还原是否完成（外层据此决定说「已还原」还是「没还原成功」）
      e.__rollbackFailed = !!rollbackErr;
      throw e;
    }
    // ④ 成功 → 就地标记账本已消费（审阅第 8 条：原实现可无限重复回档）
    try { await markLogRolledBack(); } catch (e) { console.error("lh-world-sync mark rolled-back failed", e); }
    // ⑤ 报告清单：按回档前的实际情况描述每一项究竟做了什么
    // v1.2.2：把「真的动过」和「本来就没这项、什么都没做」分成两笔账 ——
    // 原来两者都算进「已回档 N 项」，还配一句「已全部还原」，属于虚报。
    const restored = [], untouched = [];
    for (const key of keys) {
      const p = log.prev[key];
      const b = before.get(key);
      if (!p.present) {
        if (b?.present) restored.push({ key, action: "删除（恢复为键不存在）", value: undefined });
        else untouched.push({ key, action: "本就不存在（无需处理）", value: undefined });
      } else {
        restored.push({ key, action: "恢复", value: p.value });
      }
    }
    return { log, restored, untouched, changedCount: restored.length, untouchedCount: untouched.length };
  } finally {
    await releaseLock(got.lock);
  }
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
  // v1.2.2：删掉原先的 `&& n !== "core"`。curNs 统计的是「本世界实际存在的键」，
  // 而 core.time / core.permissions 被默认排除、core.moduleConfiguration 又在上面被跳过，
  // 于是一个新世界往往压根没有 core 这个命名空间。只要主快照里有任何 core.* 键，
  // 列表里就永远看不到 core 那一行、也就永远勾不上 → 走面板的恢复会静默跳过全部 core.*；
  // 而状态栏 / 进世界自动提醒走的是 buildSelection（不排除 core），照旧把它们算进差异
  // →「恢复完还一直报差异」。core 与其它命名空间同等对待，只有 modcfg 有独立开关。
  const extraNs = [...(snapNs ?? new Set())].filter(n => !curNs.has(n));
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
      ${THEMES.map(t => `<span class="wsync-theme-dot" data-theme-dot="${t.id}" title="${t.name}"></span>`).join("")}
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
          <button class="wsync-btn" data-act="preview" title="先看差异清单，确认后可以在那里面直接执行恢复"><i class="fa-solid fa-eye"></i> 差异与恢复</button>
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
        <label class="wsync-ns-row wsync-ns-autoprompt"><input type="checkbox" id="wsync-autoprompt"${game.settings.get(MODULE_ID, "autoPrompt") ? " checked" : ""}><span class="wsync-ns-name">进入世界时自动提醒<em class="wsync-ns-title">关闭后仅在手动点击「恢复主世界」时执行恢复</em></span></label>
        <div class="wsync-sec-title">不参与恢复的设置（通常无需修改）</div>
        <div class="wsync-adv-edit">
          <input type="text" id="wsync-excl" value="${escapeHtml((game.settings.get(MODULE_ID, "excludeKeys") || []).join(","))}" placeholder="core.time,core.permissions,foundry-mcp-bridge.lastActivity">
          <button class="wsync-btn" data-act="save-excl">保存</button>
        </div>
        <div class="wsync-scope-hint">前面那三项（core.time、core.permissions、foundry-mcp-bridge.lastActivity）始终排除、无法在这里移除；这个框里填写的会追加排除。</div>
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
  // custom 模式下一个模块都没勾 → 视为全部（不出现「恢复什么都没做」的死状态）。
  // v1.2.2 备注：这条兜底现在只在「偏好被手工改成空 custom」时才可能命中 ——
  // saveScopePref 已经拒绝保存 0 勾选的范围，正常操作不会再生成这种偏好。
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
  // v1.2.2：拒绝保存「一个都没勾」的范围。原来会存成 { mode:"custom", ns:{} }：
  // 面板显示「自定义（0 个模块）」，而 buildSelection 把空范围当「全部」、
  // selectionFromPanel 又当「什么都不恢复」—— 同一份偏好三种含义、三条路径三种提示。
  // 现在从源头不让存（返回 null，提示在这里给），调用方拿到 null 直接收手。
  if (picked === 0 && !sel.includeModuleConfig) {
    notify.warn("没有勾选任何恢复范围，未保存。请至少勾选一个模块，或勾上「模组启用状态」。");
    return null;
  }
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
  // v1.2.3：文案参数化。这个弹窗同时被「恢复主世界」和「导入的快照」两条路径复用，
  // 原来标题与正文都写死「主世界基准」，导入外部快照时是在说谎。
  const baseLabel = options.sourceLabel || "主世界基准";
  const dlg = new Dialog({
    title: options.title || "恢复主世界 · 确认",
    content: `<div class="wsync-body"><div class="wsync-diff-summary">${baseLabel}与当前世界存在 <b>${changed.length}</b> 处差异（${s.head}${s.more}）。以下为差异清单，确认后执行恢复。</div>${compatHTML}${lines}${trimmed}</div>`,
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
    // v1.2.1：把弹窗预览的那份清单原样交给写入逻辑（自查第 8 项），
    // 保证「你看到的」=「实际写的」。
    const res = await applySnapshot(snap, changed.__sel, Array.from(changed));
    // v1.2.1：被锁拒绝 / 被权限拒绝时，内部已经给过明确提示，
    // 这里不能再补一句「基准一致，无需恢复」——那是把「没执行」讲成「没必要」。
    // v1.2.5：同会话重入闸的 busy 也是「没执行」，必须一起挡掉（第三轮盲审发现漏了它）。
    if (res.locked || res.denied || res.busy) return;
    if (!res.applied.length) {
      // v1.2.5：区分「真的没有差异」与「有差异但全被跳过（本机没装那些模组）」——
      // 后者说成「基准一致」是假话，而且会让用户以为已经恢复过了。
      if (res.skipped) {
        notify.warn("没有可恢复的项：快照里有 " + res.skipped + " 项属于本世界未安装的模组，未参与恢复。装好对应的模组后再恢复。");
      } else {
        notify.ok("当前世界与主世界基准一致，无需恢复。");
      }
      return;
    }
    // 记录「刚才应用过」：刷新后跳过一轮自动提醒，避免弹窗自问自答
    try { sessionStorage.setItem("wsync.justApplied", Date.now()); } catch (e) {}
    openApplyReportDialog(res.applied);
  } catch (e) {
    console.error(e);
    // v1.2.2：回滚失败就不能说「已自动回滚」—— 如实告知世界可能停在中间状态，
    // 并明确让用户先别刷新（刷新会丢掉现场）。
    // v1.2.3：三种失败要分三句话说 —— 「一个字都没改」「改了又回滚成功」「改了且回滚也失败」。
    // 原来只有后两种情况，账本写不进去时会被说成「已自动回滚到恢复前的状态」（假话）。
    notify.err(e?.__notStarted
      ? "恢复没有开始：回档账本写不进服务器（磁盘满或目录权限问题），世界的设置一个字都没动。错误：" + (e?.message || e)
      : e?.__rollbackFailed
        ? "恢复失败，且自动回滚没能完成（世界可能停在中间状态）。请不要刷新页面，先看控制台错误，必要时用「回档」重试。错误：" + (e?.message || e)
        : "恢复失败，已自动回滚到恢复前的状态：" + (e?.message || e));
  }
}
function openApplyReportDialog(applied) {
  const hasModCfg = applied.some(c => c.key === "core.moduleConfiguration");
  const lines = applied.slice(0, 150).map(c => {
    const tag = describeChange(c.from, c.to);
    return `<div class="wsync-diff-row"><code>${escapeHtml(c.key)}</code><span class="wsync-diff-tag">${tag}</span><div class="wsync-diff-vals"><span class="wsync-v-now">${escapeHtml(shortVal(c.from))}</span><span class="wsync-v-master">→</span><span class="wsync-v-now">${escapeHtml(shortVal(c.to))}</span></div></div>`;
  }).join("");
  const trimmed = applied.length > 150 ? `<div class="wsync-diff-more">…还有 ${applied.length - 150} 项</div>` : "";
  // v1.2.1：清单存进 sessionStorage —— 自动刷新之后仍能在面板里回看「上一次改了什么」，
  // 而不是刷完就查无此事（自查第 14 项：写操作要可核查、可撤销）。
  saveLastReport(applied);
  // v1.2.1：自动刷新延迟 10 秒（原来 3 秒，150 项清单根本来不及看），并给出手动选项
  const RELOAD_MS = 10000;
  const timer = setTimeout(() => window.location.reload(), RELOAD_MS);
  new Dialog({
    title: `恢复完成 · ${RELOAD_MS / 1000} 秒后自动刷新`,
    content: `<div class="wsync-body"><div class="wsync-diff-summary">已恢复 <b>${applied.length}</b> 项设置。${hasModCfg ? "<b>模组启用状态已一并恢复</b>（此前被关闭的模组将重新启用）。" : ""}<br>页面将在 ${RELOAD_MS / 1000} 秒后自动刷新并生效。刷新完成后，仍可在面板里查看这次改动的清单。如需撤销，刷新完成后点「回档」。</div>${lines}${trimmed}</div>`,
    buttons: {
      now: { icon: "<i class=\"fa-solid fa-rotate\"></i>", label: "立即刷新", callback: () => { clearTimeout(timer); window.location.reload(); } },
      later: { icon: "<i class=\"fa-solid fa-clock\"></i>", label: "稍后再刷新", callback: () => { clearTimeout(timer); notify.ok("已取消自动刷新。模组启用状态要下次刷新页面才生效。"); } },
      close: { icon: "<i class=\"fa-solid fa-xmark\"></i>", label: "保持自动刷新", callback: () => {} }
    },
    render: ($h) => { styleWindow($h); }
  }, { classes: ["dialog", "wsync-app"], width: 640 }).render(true);
}
// v1.2.1：最近一次恢复的改动清单（存 sessionStorage，刷新后仍可回看；关标签页即清空）
const LAST_REPORT_KEY = "wsync.lastReport";
function saveLastReport(applied) {
  try {
    sessionStorage.setItem(LAST_REPORT_KEY, JSON.stringify({
      n: applied.length,
      at: new Date().toISOString(),
      sourceWorld: String(game.world?.title ?? ""),
      items: applied.slice(0, 200).map(c => ({ k: c.key, from: shortVal(c.from), to: shortVal(c.to), tag: describeChange(c.from, c.to) }))
    }));
  } catch (e) { /* 隐私模式或配额不足：忽略，不影响恢复本身 */ }
}
function readLastReport() {
  try {
    const t = sessionStorage.getItem(LAST_REPORT_KEY);
    return t ? JSON.parse(t) : null;
  } catch (e) { return null; }
}
function openLastReportDialog() {
  const rep = readLastReport();
  if (!rep) { notify.warn("暂时没有可查看的恢复记录。"); return; }
  const items = rep.items || [];
  const lines = items.map(it => `<div class="wsync-diff-row"><code>${escapeHtml(it.k)}</code><span class="wsync-diff-tag">${escapeHtml(it.tag || "")}</span><div class="wsync-diff-vals"><span class="wsync-v-now">${escapeHtml(it.from ?? "")}</span><span class="wsync-v-master">→</span><span class="wsync-v-now">${escapeHtml(it.to ?? "")}</span></div></div>`).join("");
  const trimmed = rep.n > items.length ? `<div class="wsync-diff-more">…还有 ${rep.n - items.length} 项（这里只回看最近 200 项）</div>` : "";
  new Dialog({
    title: "上一次恢复改动了什么",
    content: `<div class="wsync-body"><div class="wsync-diff-summary">共改动 <b>${rep.n}</b> 项 · 记录时间 ${escapeHtml(formatTs(rep.at))}<br>这份清单存在本浏览器会话里，刷新页面后仍可回看；关闭标签页后清空。</div>${lines}${trimmed}</div>`,
    buttons: { close: { icon: "<i class=\"fa-solid fa-xmark\"></i>", label: "关闭", callback: () => {} } },
    render: ($h) => styleWindow($h)
  }, { classes: ["dialog", "wsync-app"], width: 640 }).render(true);
}
function openRollbackDialog() {
  (async () => {
    const log = await readApplyLog();
    if (!log) {
      // v1.2.4：读失败 ≠ 没有记录。账本是唯一的撤销凭证，说错因果会让用户
      // 以为撤销点没了，转头继续改设置 —— 那时撤销点就真的没了。
      const body = applyLogReadError
        ? `<b>回档记录读取失败：</b>${escapeHtml(applyLogReadError)}<br>这不是「没有记录」——账本文件可能还在服务器上，请检查服务器连接后重开本面板再试。`
        : `本世界（${escapeHtml(game.world?.title ?? "")}）暂无可回档记录。回档记录按世界分开保存，且仅在执行过「恢复主世界」之后才会生成。`;
      new Dialog({
        title: "回档",
        content: `<div class="wsync-body"><div class="wsync-diff-summary">${body}</div></div>`,
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
  if (!beginOp("回档")) return;              // v1.2.4：同会话重入闸
  try {
    const res = await rollbackApplyLog();
    // v1.2.4：四种「没回成」分别说清楚。原来一律弹「暂无可回档记录」，
    // 把「被别人锁着」「读失败」「不是这个世界的账本」全讲成了「你没有记录」。
    if (res?.denied) return;                 // assertGM 已经提示过
    if (res?.locked || res?.busy) return;    // 上面已经提示过「已有进行中的操作」
    if (res?.readError) {
      notify.err("回档记录读取失败：" + res.readError
        + " ——这不是「没有记录」：账本文件可能还在服务器上，请检查服务器连接后重试。");
      return;
    }
    if (res?.foreign) { notify.warn("本世界没有可回档的记录（读到的是其他世界的账本）。"); return; }
    if (!res || res.empty) { notify.warn("暂无可回档记录。"); return; }
    // v1.2.2：清单把「真的动过的」和「本来就不存在、没动的」分开，数字不再混为一谈。
    const shown = res.restored.length ? res.restored : res.untouched;
    const lines = shown.slice(0, 150).map(r => `<div class="wsync-diff-row"><code>${escapeHtml(r.key)}</code><span class="wsync-diff-tag">${escapeHtml(r.action)}</span></div>`).join("");
    const trimmed = shown.length > 150 ? `<div class="wsync-diff-more">…还有 ${shown.length - 150} 项</div>` : "";
    const skippedNote = res.untouchedCount
      ? `另有 ${res.untouchedCount} 项在本世界本来就不存在，未做任何操作。`
      : "";
    const head = res.changedCount
      ? `已回档 ${res.changedCount} 项：上次恢复所改动的设置已还原。${skippedNote}`
      : `上次恢复涉及的设置在本世界已经不存在，无需回档。`;
    new Dialog({
      title: "回档完成 · 恢复了什么",
      content: `<div class="wsync-body"><div class="wsync-diff-summary">${head}</div>${lines}${trimmed}</div>`,
      buttons: { close: { icon: "<i class=\"fa-solid fa-xmark\"></i>", label: "关闭", callback: () => {} } },
      render: ($h) => styleWindow($h)
    }, { classes: ["dialog", "wsync-app"], width: 640 }).render(true);
  } catch (e) {
    console.error(e);
    // v1.2.1：回档失败会自动还原到回档前状态；v1.2.2 起还要区分「还原到底成没成」。
    notify.err(e?.__rollbackFailed
      ? "回档失败，且自动还原没能完成（世界可能停在中间状态）。请不要刷新页面，先看控制台错误。错误：" + (e?.message || e)
      : "回档失败，已自动还原到回档前的状态：" + (e?.message || e));
  } finally {
    endOp();                                  // v1.2.4：无论成败都放闸，别把闸卡死
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
              catch (e) { notify.err("快照解析失败:" + escapeHtml(String(e?.message || e))); }
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
  // v1.2.2：sourceWorldId 原来只写不读（死数据）。现在用它提示「这份快照来自别的世界」——
  // 跨服务器搬家时最容易搞混的就是「这份文件到底是不是我这个世界的存档」。
  const otherWorld = snap.sourceWorldId && String(snap.sourceWorldId) !== currentWorldId();
  const worldNote = otherWorld
    ? `<div class="wsync-compat">注意：这份快照来自另一个世界（${escapeHtml(snap.sourceWorld || "未命名")}），不是当前世界的存档。</div>`
    : "";
  const info = `<div class="wsync-diff-summary">快照来源：<b>${escapeHtml(snap.sourceWorld || "未知世界")}</b> · 保存于 ${escapeHtml(when)} · 共 <b>${n}</b> 项设置。</div>${worldNote}${notesHTML}`;
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
          let aborted = null;
          const r = await withOpLock("snapshot", async () => {
            // v1.2.1：同样先备份旧主快照（自查第 14 项）
            // v1.2.4：备份没做成就不覆盖 —— 原来备份失败只是静默跳过，
            // 而通知照样说「已设为主快照」，用户以为有退路，实际旧快照已被覆盖且无副本。
            const backed = await backupMasterSnapshot();
            if (!backed.ok) { aborted = backed; return null; }
            await storageWrite(MASTER_FILE, JSON.stringify(snap, null, 2));
            return { backed: backed.path };
          });
          if (r?.locked || r?.busy) return;
          if (aborted) {
            notify.err(aborted.reason === "readError"
              ? "未能读取现有主快照（" + aborted.detail + "），无法确认备份是否成功。为避免在没有退路的情况下覆盖，本次「设为主快照」已取消。请检查服务器后重试。"
              : "备份现有主快照失败（" + aborted.detail + "）。为避免在没有退路的情况下覆盖，本次「设为主快照」已取消。");
            return;
          }
          // v1.2.2：sourceWorld 来自外部文件，进通知条前必须转义（通知按 HTML 渲染）
          notify.ok(`已设为主快照（来源：${escapeHtml(snap.sourceWorld || "未知世界")}，${n} 项）。`
            + (r.backed ? `；上一份已备份为 ${r.backed}` : "；此前没有旧主快照，无需备份"));
          statusSnapCache = null;   // v1.2.4：基准换了 → 面板状态栏缓存作废，否则一直显示旧基准
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
  // v1.2.3：先把 __sel/__snap 挂上再开弹窗 —— 弹窗里的按钮回调要靠这两个字段，
  // 顺序反了就是「弹窗先拿到一个还没装配好的清单」（autoPromptCheck 一直是正确顺序）。
  diff.changed.__sel = sel;
  diff.changed.__snap = snap;
  const dlg = openDiffDialog(diff.changed, { applyLabel: "恢复为该快照", snap, title: "恢复为该快照 · 确认", sourceLabel: "这份快照" });
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
// （主界面按钮与高级区「差异与恢复」共用这一条路径：先展示差异清单，再决定是否恢复）
async function openRestoreConfirm($body) {
  const text = await storageRead(MASTER_FILE);
  if (!text) {
    // v1.2.2：区分「真的没有快照」与「读不到快照」—— 前者让用户去存，后者必须说真原因，
    // 否则服务器 5xx / 断网会被讲成「尚未保存主世界快照」，用户会去重复存快照。
    notify.warn(storageLastError
      ? "读取主世界快照失败：" + storageLastError + "。这不是「没有快照」，请检查服务器后重试。"
      : "尚未保存主世界快照。请先点击「存主世界」，或从文件导入快照。");
    return;
  }
  try {
    const snap = parseSnapshot(text);
    const sel = selectionFromPanel($body);
    // v1.2.2：范围为空时明说「一个都没勾」，别让后面的 diff 把它讲成「基准一致」
    if (!Object.keys(sel.ns).length && !sel.includeModuleConfig) {
      notify.warn("恢复范围为空白：下面一个模块都没勾选。请先勾选要恢复的模块（或勾上「模组启用状态」）。");
      return;
    }
    const diff = diffSnapshot(snap, sel);
    if (!diff.changed.length) { notify.ok("当前世界与主世界基准一致，无需恢复。"); return; }
    // v1.2.3：先挂 __sel/__snap 再开弹窗（与 restoreFromSnap / autoPromptCheck 统一顺序）
    diff.changed.__sel = sel;
    diff.changed.__snap = snap;
    const dlg2 = openDiffDialog(diff.changed, { snap });
    return dlg2;
  } catch (e) { console.error(e); notify.err("快照读取失败:" + (e?.message || e)); }
}
// v1.2.1：状态检测用的快照缓存 —— 面板里改勾选时只重算差异，不重新下载整个快照
let statusSnapCache = null;
// v1.2.2：面板单例 —— 侧边栏按钮连点两次会开出两个面板窗口，
// 而面板内的状态刷新原来用全局选择器 $(".wsync-app.wsync-panel").first()，
// 会把状态写进「先开的那个」窗口，第二个面板永远停在「正在读取…」。
let openPanelDlg = null;
async function openSyncPanel() {
  // 面板本来只给 GM 用（按钮 + 设置菜单 restricted），但 window.lhWorldSync.openPanel
  // 对所有人可见 → 这里补守卫（审阅第 10 条）
  if (!assertGM()) return;
  if (openPanelDlg?.rendered) { openPanelDlg.bringToTop?.(); return; }   // v1.2.2：已有面板就置顶它
  // 先读主快照：模块勾选列表要包含「主快照里有、本世界还没写过设置」的模块
  // （审阅第 2 条：新世界恢复的核心场景，原实现看不到这些模块）
  const snapNs = new Set();
  try {
    const text = await storageRead(MASTER_FILE);
    if (text) {
      const snap = parseSnapshot(text);
      for (const item of snap.settings) snapNs.add(String(item.key).split(".")[0]);
      // v1.2.4：顺手把这份快照交给状态栏复用。原来 openSyncPanel 读一次、
      // refreshStatus 又读一次：两次 HTTP 之间若主快照被别的 GM 更新，
      // 「模块勾选列表」与「状态栏差异数」就来自两份不同的快照。
      statusSnapCache = snap;
    } else {
      statusSnapCache = null;
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
        if (!assertGM()) return;             // v1.2.5：写入口自身守卫（纵深防御）
        try {
          const r = await withOpLock("snapshot", async () => {
            // v1.2.1：覆盖前先把现有主快照另存一份（自查第 14 项：写操作要能反悔）
            const backed = await backupMasterSnapshot();
            if (!backed.ok) return { backupFailed: backed };   // v1.2.4：没备份成就不覆盖
            const snap = buildSnapshot();
            const path = await storageWrite(MASTER_FILE, JSON.stringify(snap, null, 2));
            return { count: snap.settings.length, path, backed: backed.path };
          });
          if (r?.locked || r?.busy) return;
          if (r?.backupFailed) {
            const bf = r.backupFailed;
            notify.err(bf.reason === "readError"
              ? "未能读取现有主快照（" + bf.detail + "），无法确认备份是否成功。为避免在没有退路的情况下覆盖，本次保存已取消。请检查服务器后重试。"
              : "备份现有主快照失败（" + bf.detail + "）。为避免在没有退路的情况下覆盖，本次保存已取消。");
            return;
          }
          notify.ok(`已保存主世界快照：${r.count} 项设置（${r.path}）`
            + (r.backed ? `；上一份已备份为 ${r.backed}` : "；此前没有旧主快照，无需备份"));
          refreshStatus(true);
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
      // v1.2.5：首次刷新用缓存（openSyncPanel 刚读过主快照并放进 statusSnapCache），
      // 不再 force —— 原来 force=true 会立刻重读一遍，于是 v1.2.4 那句「面板不再读两次快照」
      // 等于没生效：模块勾选列表来自第 1 次读、状态栏差异数来自第 2 次读，两次之间
      // 别的 GM 更新了主快照，两处就基于不同基准（第三轮盲审）。存主世界后的刷新仍用 force。
      refreshStatus(false);
      // 高级区：看差异 / 文件面板
      $h.find("[data-act=preview]").on("click", () => { openRestoreConfirm($h); });
      // v1.2.1：状态栏里「上一次恢复改动了什么」的入口。内容由 refreshStatus 动态追加，
      // 所以用事件委托；用 span 而非 a[href]（后者会被 FVTT 全局超链接拦截，见 game.mjs:2018）
      $h.on("click", "[data-act=last-report]", () => { openLastReportDialog(); });
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
        refreshStatus();
      });
      // v1.2.1：勾选变化 → 立刻用缓存快照重算状态栏差异数（不发新请求）
      $h.find(".wsync-ns-row input[data-ns]").on("change", () => { syncAllCheckbox($h); refreshStatus(); });
      $h.find("#wsync-modcfg").on("change", () => { refreshStatus(); });
      syncAllCheckbox($h);
      // 保存恢复范围 → 世界级偏好 nsScope（v1.1.0，审阅第 6 条：
      // 此前勾选只对「这一次手动恢复」有效，自动提醒自己造了一套接近全选的范围）
      $h.find("[data-act=save-scope]").on("click", async (ev) => {
        ev.preventDefault();
        if (!assertGM()) return;             // v1.2.5：写入口自身守卫（纵深防御）
        const sel = selectionFromPanel($h);
        const total = $h.find(".wsync-ns-row input[data-ns]").length;
        try {
          const pref2 = await saveScopePref(sel, total);
          if (!pref2) return;   // v1.2.2：空范围被拒，提示已由 saveScopePref 给出
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
        if (!assertGM()) return;                 // v1.2.4：写入口自身守卫（纵深防御）
        const raw = $h.find("#wsync-excl").val() || "";
        const keys = raw.split(",").map(s => s.trim()).filter(Boolean);
        try {
          await game.settings.set(MODULE_ID, "excludeKeys", keys);
          // v1.2.4：把「始终排除的三项」也念出来 —— 它们由 isExcludedKey 里的
          // EXCLUDE_DEFAULT 恒定生效，这个输入框删不掉。原来删掉再点保存照样提示
          // 「已保存」，而 core.time 依然被排除：UI 承诺与真实行为不一致。
          notify.ok("已保存。" + EXCLUDE_DEFAULT.length + " 项始终排除（无法在这里移除）："
            + escapeHtml(EXCLUDE_DEFAULT.join("、"))
            + (keys.length ? "；另外排除：" + escapeHtml(keys.join("、")) : "；本次没有追加项。"));
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
    close: () => { openPanelDlg = null; }   // v1.2.2：单例释放
  }, { classes: ["dialog", "wsync-app", "wsync-panel"], width: 660, resizable: false, minimizable: false });
  dlg.render(true);
  openPanelDlg = dlg;                       // v1.2.2：登记单例

  async function refreshStatus(forceSnap) {
    // v1.2.2：只操作自己这个面板的元素。原来用全局选择器 $(".wsync-app.wsync-panel").first()，
    // 多面板时会写到别的窗口；而且对话框关闭后元素仍会在 DOM 里残留约 200ms（slideUp 动画），
    // first() 可能命中那个正在关闭的旧面板。dlg.element 是 jQuery 对象，用法与原来一致。
    const $h = dlg.element;
    if (!$h?.length) return;
    const $s = $h.find("#wsync-status");
    // v1.2.4：自动提醒开关必须在任何早退之前同步。原来唯一的同步点在函数最末尾，
    // 而「没存过快照 / 读取失败」会在中途 return → 复选框恒显示未勾选（真实默认是开），
    // 用户据此以为自动提醒已关，点一下反而把它真正打开。
    const $apEarly = $h.find("#wsync-autoprompt");
    if ($apEarly.length) $apEarly.prop("checked", game.settings.get(MODULE_ID, "autoPrompt"));
    try {
      // v1.2.1：快照缓存（forceSnap=true 时强制重读，例如刚存完主世界）
      if (forceSnap || !statusSnapCache) {
        const text = await storageRead(MASTER_FILE);
        statusSnapCache = text ? parseSnapshot(text) : null;
      }
      const snap = statusSnapCache;
      if (!snap) {
        // v1.2.2：读不到 ≠ 没存过 —— 5xx / 断网时要说真原因，别误导用户去重复存快照
        $s.html(storageLastError
          ? `<span class="wsync-status-none">读取主世界基准失败：${escapeHtml(storageLastError)}</span>`
          : "<span class=\"wsync-status-none\">尚未保存主世界快照。请先在一个配置齐全的世界中点击「存主世界」。</span>");
        return;
      }
      const n = snap.settings.length;
      // v1.2.1（自查第 5 项）：面板开着就以「面板当前勾选」为准 —— 这正是点
      // 「恢复主世界」实际执行的范围。原来这里用「已保存的恢复范围」，两条路径
      // 不同源：用户改了勾选没点保存，看到的数字就是过期的。
      const hasPanelChecks = $h.find(".wsync-ns-row input[data-ns]").length > 0;
      const sel = hasPanelChecks ? selectionFromPanel($h) : buildSelection(snap, readScopePref()).sel;
      const scopeNote = hasPanelChecks ? "按下面当前勾选" : "按已保存的恢复范围";
      const diff = diffSnapshot(snap, sel);
      let when = snap.savedAt;
      try { when = new Date(snap.savedAt).toLocaleString(); } catch (e) {}
      const base = `基准来源：<b>${escapeHtml(snap.sourceWorld)}</b> · 保存于 ${escapeHtml(when)} · 共 ${n} 项设置`;
      const rep = readLastReport();
      const repHTML = rep
        ? `<div class="wsync-last-report">上一次恢复改动了 <b>${rep.n}</b> 项 · <span class="wsync-link" data-act="last-report">查看清单</span></div>`
        : "";
      $s.html((diff.changed.length
        ? `当前世界与主世界基准存在 <b class="wsync-diff-has">${diff.changed.length}</b> 处差异（${scopeNote}）。<br>${base}`
        : `当前世界与主世界基准一致（${scopeNote}）。<br>${base}`) + repHTML);
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
  if (!text) {
    // v1.2.2：读不到（5xx/断网）与「没存过」都会静默返回，但至少留个日志 ——
    // 否则用户会把「读失败」当成「没有差异」。
    if (storageLastError) {
      console.warn("[lh-world-sync] 自动提醒跳过：读取主快照失败 —— " + storageLastError);
      // v1.2.4：不能一声不响。用户会把「没弹窗」理解成「没有差异」，
      // 而真实情况是这次根本没做成差异检查。面板路径早就说真话了，这里补上。
      notify.warn("读取主世界基准失败，本次未做差异检查：" + storageLastError);
    }
    return;
  }
  let snap;
  try { snap = parseSnapshot(text); } catch (e) { console.warn("[lh-world-sync] 自动提醒跳过：主快照解析失败", e); return; }
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
      <div class="wsync-prompt-hint">点击「恢复主世界」后，将按<b>已保存的恢复范围</b>把设置与模组启用状态恢复为基准值，完成后页面自动刷新。如需先看差异清单，可在右侧边栏「世界同步」面板点击「差异与恢复」；要改范围就在同一面板的高级选项里勾选后点「保存范围」。</div>
    </div>`,
    buttons: {
      apply: { icon: "<i class=\"fa-solid fa-check\"></i>", label: "恢复主世界", callback: async () => { dlg.close(); await proceedApplySnap(diff.changed); } },
      skip: { icon: "<i class=\"fa-solid fa-forward\"></i>", label: "暂不恢复", callback: () => { notify.ok("已暂不恢复。下次进入世界时会再次提醒。"); } },
      off: { icon: "<i class=\"fa-solid fa-ban\"></i>", label: "不再自动提醒", callback: async () => {
        await game.settings.set(MODULE_ID, "autoPrompt", false);
        notify.warn("已关闭自动提醒。可在「设置 → 世界同步装置」中重新开启。");
      } }
    },
    // v1.2.4：删掉原来 render 里查 #wsync-autoprompt 的两行 —— 本弹窗的 content
    // 里根本没有这个元素（只有面板里才有），永远 length === 0，是永不执行的死代码。
    render: ($h) => { styleWindow($h); },
    close: () => {}
  }, { classes: ["dialog", "wsync-app"], width: 620 });
  dlg.render(true);
}
Hooks.once("ready", () => {
  // 面板打开后支持后续操作；自动提醒延迟片刻，避免与世界初始化打架
  setTimeout(() => { autoPromptCheck().catch(e => console.error("lh-world-sync autoprompt", e)); }, 6000);
});

/* ============================ 侧边栏按钮（官方渲染 hook，挂在「设置」后） ============================ */
// hook 名 renderSidebar 的出处：ApplicationV2 渲染结束后按「render + 类名」派发 hook
// （client/applications/api/application.mjs:1226-1233 #callHooks：
//  Hooks.callAll(hookName.replace("{}", cls.name), this, ...)，其中 render 事件的
//  hookName 为 "render"，见同文件 :523；侧边栏类名 Sidebar 见
//  client/applications/sidebar/sidebar.mjs:23），故 hook 名 = "renderSidebar"。
// 另外 sidebar.mjs:250 在切 tab 时 Hooks.callAll("changeSidebarTab", ui[tab])，一并监听。
// ⚠ 这两个 Hooks.on 必须在模块加载期注册：侧边栏渲染早于 ready
//   （client/game.mjs:772 initializeUI() / :992 ui.sidebar.render()，而 :787 才
//    Hooks.callAll("ready")），等 ready 再注册会错过首次渲染。
let wsyncBtnLogged = false;
function mountSidebarButton() {
  // 锚点 = 右侧边栏 tab 区「设置」齿轮按钮（templates/sidebar/tabs.hbs：button[data-tab="settings"]）
  const $anchor = $("button[data-tab=\"settings\"]").first();
  if (!$anchor.length) return false;
  if ($("#" + BTN_ID).length) return true;
  const $li = $(`<li><button id="${BTN_ID}" type="button" class="ui-control plain icon ${BTN_ICON}" title="世界同步装置" aria-label="世界同步装置"></button></li>`);
  $li.find("button").on("click", () => openSyncPanel());
  $anchor.closest("li").after($li);
  // v1.2.1（自查第 3 项）：插入后回读校验。原来无条件 return true ——
  // 一旦锚点结构变化（closest("li") 为空则 after 无效），按钮永远挂不上，
  // 而兜底重试因为拿到 true 提前结束，且没有任何提示。
  if (!$("#" + BTN_ID).length) {
    console.warn("lh-world-sync: 侧边栏按钮插入未生效（锚点结构可能变化），将继续重试");
    return false;
  }
  if (!wsyncBtnLogged) {
    wsyncBtnLogged = true;
    console.log("lh-world-sync: 侧边栏按钮已挂载（renderSidebar hook，设置齿轮后） v" + MODULE_VERSION);
  }
  return true;
}
Hooks.on("renderSidebar", () => { if (game.user?.isGM) mountSidebarButton(); });
Hooks.on("changeSidebarTab", () => { if (game.user?.isGM) mountSidebarButton(); });
// 兜底：仅当两个 hook 都错过时（例如侧边栏在模块代码执行前就已渲染完）才会用到。
// 有限次重试、挂上即停 —— 不是常驻轮询。
const BTN_RETRY_MAX = 8;
function ensureSidebarButton(attempt = 0) {
  if (!game.user?.isGM) return;
  if (mountSidebarButton()) return;
  if (attempt >= BTN_RETRY_MAX) {
    console.warn("lh-world-sync: 侧边栏按钮未挂载（锚点 button[data-tab=\"settings\"] 未出现），"
      + "仍可从「设置 → 模组设置 → 世界同步装置面板」进入。");
    return;
  }
  setTimeout(() => ensureSidebarButton(attempt + 1), 1000);
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
  rollback: async (...args) => {           // v1.2.5：控制台入口也要过会话闸（原来是裸函数）
    if (!beginOp("回档")) return { busy: true };
    try { return await rollbackApplyLog(...args); } finally { endOp(); }
  },
  readScopePref,
  buildSelection
};
console.log(`lh-world-sync v${MODULE_VERSION} loaded (window.__WSYNC_VER=${window.__WSYNC_VER})`);
