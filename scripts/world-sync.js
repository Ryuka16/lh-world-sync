/* ============================================================================
 * 世界同步装置 (lh-world-sync) v1.3.0
 * ----------------------------------------------------------------------------
 * v1.3.0：第七轮整体盲审剩下的 13 项一次收口 —— 导入体积上限 32MB（读之前校验）/
 *   快照拒收「始终排除键」/ 缺少稳定世界标识时拒绝写账本 / 回滚按本次真正创建的
 *   文档 id 删除 / 网络读取 30 秒超时（覆盖响应头与 body）/ 自动刷新前检查是否有
 *   操作在跑 / 复制剪贴板改为可 await 可失败 / 导出与差异清单的口径写清 /
 *   当前世界键值 2 秒短时缓存 / 不可用项去重改 Set / 玩家端不暴露写入口、
 *   自动提醒开关对玩家隐藏。
 * v1.2.9：第八轮 —— 收掉「多副本」结构病里的前两处（第八轮整体盲审点名四类
 *   「同一事实存多份副本」，本轮拆掉其中的读错误与互斥两类）：
 *   ① 【S5】「哪个文件读失败了」原来由单个模块级变量 storageLastError 承载，
 *      而一次操作会依次读锁文件 → 主快照 → 账本 → 旧账本，后一次读覆盖前一次；
 *      「404 清空、5xx 又写回」这类交错让上层根本说不清是哪个文件出了问题，
 *      而这正是多条错误提示的判据（六轮审阅里「读失败被当成不存在」反复出现在
 *      不同路径上）。→ storageRead 改为返回 { text, error }，原因随结果一起走，
 *      模块级变量删除（10 个调用点全部改为解构）。
 *   ② 【B4】「操作互斥」原有 3 套并行实现（withOpLock / applySnapshot 自己一套 /
 *      rollbackApplyLog 自己一套），三套的闸、锁与返回值形状各不相同。
 *      → 统一为唯一入口 withOpLock（新增 OP_LABELS 中文名映射与 label 参数），
 *        applySnapshot 与 rollbackApplyLog 改为包在它里面并补齐返回值形状；
 *        doRollback 与控制台入口不再自己 beginOp/endOp —— 否则是「自己把自己挡住」
 *        （第二次 beginOp 必被拒，回档会永远返回 busy）。
 *   本轮**不改对外行为**：与 v1.2.8 表现一致（427 项断言全绿；其中 4 条断言因
 *   返回值形状与提示文案变化而同步更新，逐条判定为预期变更）。
 * ----------------------------------------------------------------------------
 * v1.2.8：第七轮 —— 换成「整体盲审」：三个互不通气的独立视角（冷读接手者 /
 *   文档对现实 / 对抗破坏者）通读全文，**不给它们我已知的问题清单**，以免框住视线；
 *   另加作者侧的骨架统计与服务器实测。三个视角独立撞在同一点上，结论是：
 *   这个文件的病不在某个函数写错，而在**同一类事实存了多份副本** ——
 *   「上次读取成功没有」有 5 个模块级变量、「操作互斥」有 3 套实现、
 *   「哪些键该写」有 4 套判据、「失败怎么还原」有 2 处近乎逐字重复。
 *   所以「改一处、漏一处」是结构必然：六轮里 8 次「声称修了、实际只改一半」全出于此。
 *   本轮先修**会永久失去东西**的那几条（结构性合并留到 v1.2.9）：
 *   ① 【最危险 · A1】恢复途中按 F5 → 会话闸（内存变量，刷新必然清零）与文件锁
 *      （sessionStorage，刷新必然不变）**两道互斥同时失效** → 两个恢复并发 →
 *      后写者整格覆盖账本 → 唯一撤销点永久消失；世界还可能停在一个
 *      「从未存在过的中间态」，而界面对此零提示。
 *      修法：把「同一会话」再细分成「同一页面」—— 锁对象新增 pageToken
 *      （每次页面加载重新生成），owner 与 pageToken 都相同才算自己的锁；
 *      刷新后自己的旧锁不再被认领，而是给出能解释清楚的提示（staleSelf）。
 *   ② 【A1 纵深】账本覆盖前先另存一代 apply-log-<世界>.prev.json。
 *      文件锁是「尽力而为」的，不能把「撤销点不丢」全押在锁上 —— 即使并发真的
 *      发生，上一份撤销点仍留在磁盘上。账本体积小（实测 7.8KB），轮转代价可接受；
 *      主快照 8.8MB 做不到这一点，改用下面的内容体检。
 *   ③ 【A2】「存主世界」覆盖前做内容体检：当前世界设置数不足 20 项、或骤降到
 *      服务器主快照的三成以下时，先警告并要求再点一次确认；0 项直接拒绝。
 *      场景：完整快照 → 切到空世界再点存 → .prev 只保留一代 → 再存一次，
 *      完整快照在服务器上再无任何副本（Foundry 没有文件恢复 API，
 *      v13 也没有重命名 API，做不了多代轮转）。
 *   ④ 【B7】恢复完成后把账本标为 applied（原来一直停在 pending）：中途崩掉时
 *      世界停在半成品，几天后回档，界面会把「上次没写完」讲成「你又改过」——
 *      编出一个看起来合理、却完全错误的原因。停在 pending 时不再报漂移。
 *   ⑤ 【C2】会话闸能自愈：超过 5 分钟未结束按「已中断」放行。原来会永久卡住，
 *      只有刷新能救 —— 而刷新又恰好是 ① 的触发器。
 * ----------------------------------------------------------------------------
 * 功能：把一个世界当作「主世界」保存配置快照；新世界一键读回。
 * v1.2.7：第六轮 —— 对 v1.2.6 那次修复本身做的独立盲审（1 条严重、6 条一般、10 条建议），
 *   本轮改掉 7 处：
 *   ① 【性能】存主世界后不再把刚上传的快照整份读回来（本机实测 8.8MB / 约 4 秒）——
 *      原来写完文件紧接着调 refreshStatus(true)，只为刷新状态栏一行差异数就重新下载 + 解析
 *      整份快照。现在把刚生成的快照直接交给它。世界越大、存档越慢，感知越明显。
 *   ② 【S-1 严重】回档说明弹窗补认 legacyLogReadError：v1.2.6 给旧版合并账本的读失败
 *      单独记了状态，但**只有 doRollback 读它**，弹窗没读 —— 主账本本来就不存在、旧账本
 *      又读不到时，界面说「暂无可回档记录」，而撤销点很可能就在那份读不到的文件里。
 *   ③ 【G-3】账本存在但内容不可用时，界面直说「坏在哪 + 原文件另存成了什么」，
 *      不再只说「暂无可回档记录」；另存文件名由时间戳改为内容指纹，同一份坏账本
 *      不再每打开一次面板就多出一个备份（与 README「不会累积文件」自相矛盾过）。
 *   ④ 【G-6】账本补内容硬校验（validateApplyLogEntry）：键名必须含点、每条记录必须是
 *      对象、present 必须是布尔、条目上限 20000。原来只校验 schema/worlds 两层结构，
 *      内容不对时回档会照着账本里的键去删、去写**真实设置文档** —— 快照侧有十几条
 *      硬校验，账本侧一条都没有。
 *   ⑤ 【G-1】快照解析失败时清空 statusSnapCache：原来 parseSnapshot 抛错时赋值不执行，
 *      上一次的旧快照留在缓存里，之后不带参数的刷新会拿旧基准算差异还显示得好好的。
 *   ⑥ 【G-2】legacyLogReadError 每次读取先清零：原来主账本读到就直接 return，
 *      旧值永远清不掉，会把一次正常读取讲成「读取失败」。
 *   ⑦ 【G-4】保存「不参与恢复的设置」后刷新状态栏（排除表变了，差异数要重算）。
 * v1.2.6：第五轮 —— 对 v1.2.5 那次修复本身做的独立盲审（v1.2.5 的 6 组声明里
 *   3 组完全修好、2 组只落一半、1 组引入新问题；新增 2 条严重、5 条一般、6 条建议）。
 *   本轮的主线是「同一件事在不同路径上说法不一致」：
 *   ① 【严重】账本读错误需要分级。v1.2.5 把「旧版合并账本 apply-log.json 读失败」也记进了
 *      applyLogReadError，而那个文件**只读不写**。后果：服务器对一份永远不会被写的文件
 *      持续报错时，用户的每一次恢复都被中止，理由还是错的（「为避免覆盖本世界原有的
 *      回档记录」）。修法：legacy 读失败单独记进 legacyLogReadError，只影响回档提示。
 *   ② 【严重】回档路径与该规则相反：主账本读失败、旧账本却读到了条目时就照常回档 ——
 *      用可能过期的旧值覆盖世界，还会把主账本里更新的那条标成「已回档」，污染撤销点语义。
 *      现在与写入路径对齐：主账本读失败一律拒绝回档。
 *   ③ 「有 N 项因缺模组没恢复」口径与实现不符：旧实现拿**整份快照**统计，既不看勾选范围、
 *      也不看排除键，只勾一个模块也报「另有 250 项未恢复」，还把 core.time 这类故意永不
 *      恢复的键算了进去。抽出 collectUnavailable()（三条件：非排除键 + 模组没装 + 在勾选
 *      范围内），面板早退 / 文件导入 / 自动提醒 / 状态栏 / 写入后通知五处共用同一口径。
 *   ④ 差异为空时一律说「一致」——掩盖了「能恢复的已一致、另有 N 项从未落地」这种情形
 *      （跨服务器搬家的主场景）。三处早退现在分开说；状态栏也补上这一行。
 *   ⑤ 面板勾选列表把「本机没装的模组」显示成可勾选，勾了却不生效（UI 承诺与行为不符）→ 标灰。
 *   ⑥ 「面板不再读两次快照」引入了陈旧缓存：解析失败时旧缓存不清，状态栏拿上一次的基准算差异。
 *   ⑦ 死代码与静默失效：跳过键的中间变量全文件没人读、账本格式异常被静默当空后覆盖、
 *      「已回档过」标记失败时不吭声、「另有 N 项没恢复」只活在瞬时通知里（刷新即消失）。
 *   ⑧ finally 里先放闸后放锁 → 同标签页的下一个操作可能被上一个的释放动作误删锁。
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
const MODULE_VERSION = "1.3.0";
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
// v1.2.8（第六轮整体盲审 A1 / B8）：账本的「上一代」文件名。
// 覆盖一份尚未回档的账本之前，先把它原样写到这里 —— 保证撤销点不会因为
// 并发（刷新导致双互斥同时失效）或连续两次恢复而彻底消失。
function applyLogPrevFile() {
  return applyLogFile().replace(/\.json$/i, "") + ".prev.json";
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
// 本页面标识（v1.2.8，第六轮整体盲审 A1）：每次页面加载重新生成，刷新即变，不落任何存储。
// 为什么必须有它：owner 存在 sessionStorage —— 同一标签页刷新后**不变**，
// 而内存闸 _opInFlight 随刷新**必然清零**。于是「恢复途中按 F5」会让
//   ① 新页面的内存闸是空的（放行）② 旧锁的 owner 与自己相同（也放行）
// 两道互斥在同一个动作上同时失效 → 两个恢复并发 → 后写者整格覆盖账本，
// 前一次的撤销点永久消失，世界还可能停在一个「从未存在过的中间态」。
// 把「同一会话」再细分成「同一页面」：刷新后的旧锁不再被当成自己的锁认领。
let _myPageToken = null;
function myPageToken() {
  if (!_myPageToken) _myPageToken = "pg-" + foundry.utils.randomID();
  return _myPageToken;
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
// v1.3.0（卫生）：原来用全局 $(".wsync-app") 找窗口 —— 那是本模块给 Dialog 加的 class，
// 但弹窗关闭后元素会在 DOM 里滞留约 200ms（slideUp 动画），此时换主题会改写一个
// 正在消失的窗口。现在只改真正带主题类的窗口。
const setTheme = (t) => game.settings.set(MODULE_ID, THEME_SETTING, t).then(() => {
  $(".window-app.wsync-themed").each((i, el) => { $(el).attr("data-theme", t); });
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
// v1.3.0（C1）：copyPlainText 返回 Promise，原来既不 await 也不 catch —— 剪贴板被
// 浏览器拒绝（HTTP 非安全上下文、权限被拒）时会变成「未处理的 Promise 拒绝」，
// 而面板照样显示「已复制」，用户去粘贴得到的是上一次的内容。
const copyText = async (text) => {
  if (!game.clipboard?.copyPlainText) throw new Error("当前浏览器不支持复制，请手动选中文本复制");
  await game.clipboard.copyPlainText(text);
};
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
//      其余（HTTP 5xx / 断网）由 storageRead 的 error 字段返回，让界面能说真话。
//      返回语义仍然是 null（不给十几个调用点引入新的异常路径）。
// v1.2.9（S5）：原来这里有 `let storageLastError = null;` —— 已删除。
// 读取失败的原因改由 storageRead 的返回值（error 字段）逐次携带：
// 单变量会被同一次操作里后续的读取覆盖（读锁 → 读快照 → 读账本 → 读旧账本），
// 「哪个文件读失败了」因此变得不可靠，而它正是多条错误提示的判据。

// v1.2.4：回档账本的「读取失败」必须与「文件本来就不存在」分开，两个用途：
//   ① 给用户看：读失败不能说成「本世界暂无可回档记录」（错误因果，会让人以为撤销点没了）；
//   ② 给写路径用：读失败时绝不能照写覆盖 —— 账本里存的是「上一次恢复前的值」，
//      是用户点「回档」的唯一凭证，服务器上没有它的备份，覆盖即永失。
let applyLogReadError = null;      // 主账本 apply-log-<worldId>.json 本次读取失败的原因
// v1.2.6（第四轮盲审 S2）：旧版合并账本 apply-log.json 读失败**单独记**。
// 它只用于查旧撤销点，写新账本时永远不会覆盖它（第 257 行：只读不写）。
// v1.2.5 把它记进 applyLogReadError，于是这份永远不写的文件一旦读不到，
// 每一次恢复都会被中止，理由还是错的（「为避免覆盖本世界原有的回档记录」）。
let legacyLogReadError = null;
// v1.2.7（第六轮盲审 G-3）：主账本文件存在、但内容不可用时，记下「坏在哪」和
// 「原样另存成了哪个文件」。原来这两件事只在控制台里，界面上只说「暂无可回档记录」，
// 用户会以为压根没有记录 —— 而撤销点很可能就躺在那份读不懂的文件里。
let applyLogCorrupt = null;          // { reason: string, backup: string|null } 或 null
// v1.2.9（S5）：返回值从「text 或 null，同时写模块级 storageLastError」改成结构化 { text, error }。
// 原来「到底是哪个文件读失败了」只由一个全局变量承载，而一次操作会依次读锁文件、主快照、
// 账本、旧账本……后一次读覆盖前一次，于是「404 清空 → 5xx 又写回」这类交错让上层很难说清
// 谁出了问题（六轮审阅里「读失败被当成不存在」反复出现在不同路径）。把「读到什么」和
// 「为什么没读到」一起返回，上层就不必再去猜一个全局变量的当前值。
const STORAGE_TIMEOUT_MS = 30000;
async function storageRead(name) {
  const url = foundry.utils.getRoute(norm(STORAGE_DIR) + "/" + name);
  let r;
  // v1.3.0（C2）：30 秒超时。原来没有超时 —— 服务器「TCP 连上但不回包」时 fetch 会
  // 一直挂着，面板停在读取中，用户唯一能做的是刷新页面；而刷新正是本项目历史上出过
  // 事的入口（两套互斥同时归零、撤销点被覆盖）。超时同时覆盖响应头与响应体两段。
  // 用 typeof 探测而不是直接引用：vm 沙箱一类的运行环境可能没有 AbortController，
  // 那时退化成「无超时」继续工作，而不是抛 ReferenceError 把整个读取流程打断。
  const hasAbort = (typeof AbortController !== "undefined") && (typeof setTimeout === "function");
  const ctl = hasAbort ? new AbortController() : null;
  const timer = hasAbort ? setTimeout(() => ctl.abort(), STORAGE_TIMEOUT_MS) : null;
  try {
    try {
      r = await fetch(url, { cache: "no-store", signal: ctl ? ctl.signal : null });
    } catch (e) {
      console.warn("[lh-world-sync] 读取失败：" + url, e);
      return { text: null, error: (e?.name === "AbortError")
        ? ("服务器响应超时（超过 " + Math.round(STORAGE_TIMEOUT_MS / 1000) + " 秒无响应）")
        : ("无法连接服务器（" + (e?.message || e) + "）") };
    }
    // 只有 404 才是「服务器明确说这个文件不存在」，其余失败都不能当成「没有」
    if (r.status === 404) return { text: null, error: null };
    if (!r.ok) {
      console.warn("[lh-world-sync] 读取失败：" + url + " → HTTP " + r.status);
      return { text: null, error: "服务器返回 HTTP " + r.status + "（" + name + "）" };
    }
    // v1.2.4：读 body 必须包在 try 里。原来这行在函数内任何 try 之外，
    // 连接在「响应头已到、body 还没读完」时中断 → 异常直接逃到调用点；
    // 而 openRestoreConfirm 的首行、面板按钮回调都没有 catch，
    // 用户看到的现象是「点了没反应」（无提示、无日志）。
    try {
      return { text: await r.text(), error: null };
    } catch (e) {
      console.warn("[lh-world-sync] 读取响应失败：" + url, e);
      return { text: null, error: "读取响应内容失败（" + (e?.message || e) + "）" };
    }
  } finally {
    if (timer) clearTimeout(timer);
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
let _opInFlightAt = 0;
// v1.2.8（第六轮整体盲审 C2）：闸必须能自愈。上一次操作若异常中断（抛错、断网、
// 服务器不出结果），未必走到 endOp()，此时若永远回答「请等它完成」，等于把用户
// 永久锁在门外，只有刷新页面能救 —— 而刷新又正好是 A1 那个坑的触发器。
// 超过这个时长按「已中断」处理并放行（正常操作有 2 分钟锁 TTL 兜着，不会真的并发）。
const OP_INFLIGHT_TTL_MS = 300000;
// v1.2.8（A2）：「存主世界」覆盖前的二次确认标志。
// 第一次点若发现当前世界设置数骤降（判据见存主世界按钮），只警告不执行；
// 用户再点一次才真的覆盖 —— 这是主快照唯一的「防手滑」闸门。
let snapshotForceAck = false;
function beginOp(name) {
  if (_opInFlight) {
    const age = Date.now() - _opInFlightAt;
    if (age < OP_INFLIGHT_TTL_MS) {
      console.warn("[lh-world-sync] 同会话重入已被挡下：" + _opInFlight);
      try { notify.warn("已有正在进行的操作（" + _opInFlight + "），请等它完成后再试。"); } catch (e) { /* 忽略 */ }
      return false;
    }
    console.warn("[lh-world-sync] 上一次操作的会话闸已停留 " + Math.round(age / 1000) + " 秒（"
      + _opInFlight + "），判定为已中断，本次放行。");
  }
  _opInFlight = name;
  _opInFlightAt = Date.now();
  return true;
}
function endOp() { _opInFlight = null; _opInFlightAt = 0; }
// 轻量操作锁：两个 GM 同时点「恢复」时后进入者被拒绝。
// 实现说明（这是尽力而为的锁，不是严格互斥锁，别当分布式锁用）：
//   ① 读现有锁 → 未过期且属于别人 = 直接拒绝；
//   ② 写入自己的 operationId → 回读校验：若 operationId 已不是自己，说明
//      有人在我之后又写了一次 → 我放弃（后写者赢）；
//   ③ TTL 2 分钟（v1.2.5 起），持有者崩溃/关页面后自动失效，不会留下死锁。
async function acquireLock(opName) {
  const now = Date.now();
  const { text, error: lockReadErr } = await storageRead(LOCK_FILE);
  if (text) {
    try {
      const l = JSON.parse(text);
      // v1.2.2：判定「这是不是我自己持有的锁」改用 owner（浏览器会话标识），
      // 不再用 userId —— 同一个 GM 开两个标签页时 userId 相同，原来第二个标签页
      // 会直接放行，两个流程各自算账本、各自写设置。
      // 旧锁文件没有 owner 字段 → 退回旧的 userId 判定（向后兼容；TTL 到期自然过期）。
      const sameOwner = l?.owner ? (l.owner === myOwner()) : (l?.userId === game.user.id);
      // v1.2.8（第六轮整体盲审 A1）：同一会话还不够，必须同一页面。
      // 旧锁没有 pageToken 字段（v1.2.7 及以前写的）→ 按「同一页面」处理，向后兼容。
      const samePage = l?.pageToken ? (l.pageToken === myPageToken()) : true;
      if (l?.expiresAt > now && l.worldId === currentWorldId() && !(sameOwner && samePage)) {
        // staleSelf：这把锁是自己这个会话、但上一个页面留下的 —— 上层据此给出
        // 「你刚刷新过，上一次操作可能还没结束」这种能解释清楚的提示，
        // 而不是含混地说「另一位 GM」。
        return { ok: false, holder: l, staleSelf: sameOwner && !samePage };
      }
    } catch (e) { /* 坏文件按无锁处理 */ }
  } else if (lockReadErr) {
    // 读不到锁文件（5xx/断网）时按无锁放行，但必须留痕：这是「尽力而为的锁」
    console.warn("[lh-world-sync] 锁文件读取异常，本次跳过互斥检查：" + lockReadErr);
  }
  const lock = {
    operationId: foundry.utils.randomID(),
    op: opName,
    worldId: currentWorldId(),
    worldTitle: game.world?.title ?? "",
    userId: game.user.id,
    userName: game.user.name ?? "",
    owner: myOwner(),
    pageToken: myPageToken(),   // v1.2.8：页面级标识，刷新后旧锁不再被新页面认领
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
  const { text: back } = await storageRead(LOCK_FILE);
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
    const { text } = await storageRead(LOCK_FILE);
    const l = JSON.parse(text);
    if (l?.operationId === lock.operationId) {
      await storageWrite(LOCK_FILE, JSON.stringify({ ...l, releasedAt: new Date().toISOString(), expiresAt: 0 }, null, 2));
    }
  } catch (e) { /* 忽略 */ }
}
// v1.2.1：让「存主世界 / 回档 / 导入设为主快照」与「恢复」共用同一把锁。
// 拿不到锁时提示并返回 { locked: true }，调用方据此直接收手（别当成「无需执行」）。
// v1.2.9（B4）：opName → 中文名的映射表。原来写死 `opName === "snapshot" ? "存主快照" : opName`，
// 别的操作一旦也走这里，提示里就会直接冒出英文 opName。
const OP_LABELS = { snapshot: "存主快照", apply: "恢复主世界", rollback: "回档" };
// v1.2.9（B4）：本函数是全模块**唯一**的互斥入口（会话闸 + 文件锁）。
// v1.2.8 之前有三套并行实现（本函数 / applySnapshot 自己一套 / rollbackApplyLog 自己一套），
// 三套的闸、锁与返回值形状各不相同 ——「改一处必漏另外两处」是本项目的稳定失效模式。
async function withOpLock(opName, fn, label) {
  const zh = label || OP_LABELS[opName] || opName;
  // v1.2.4：同会话重入闸（存主快照 / 导入设为主快照 这两条写路径）
  if (!beginOp(zh)) return { busy: true };
  try {
    const got = await acquireLock(opName);
    if (!got.ok) {
      const h = got.holder ?? {};
      const who = h.userName || h.userId || "另一位 GM";
      const when = h.startedAt ? formatTs(h.startedAt) : "";
      console.warn("[lh-world-sync] 操作被拒：已有进行中的世界同步操作", h);
      if (got.staleSelf) {
        // v1.2.8（A1）护栏 + v1.2.9 通用化：这条提示必须压得住「再点一次」的冲动。
        notify.warn("检测到你刚刷新过页面，而上一次的「" + escapeHtml(zh) + "」可能还没有结束——它仍在服务器上继续执行。"
          + "请先等它跑完（最长约 2 分钟），再操作。现在重复操作会让两次写入互相覆盖，撤销点会丢失。");
        return { locked: true, staleSelf: true };
      }
      notify.warn(`已有进行中的「${escapeHtml(zh)}」操作（${escapeHtml(who)}${when ? " 于 " + when + " 开始" : ""}），请稍后再试。若对方已中断，约 2 分钟后会自动解锁。`);
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
    const { text: old, error: masterReadErr } = await storageRead(MASTER_FILE);
    if (!old) {
      if (masterReadErr) return { ok: false, reason: "readError", detail: masterReadErr };
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
    // v1.3.0（D2）：本模块永不同步的键，外来快照也不许带进来。
    // 这三项在 EXCLUDE_DEFAULT 恒定排除：core.permissions 是官方 GAMEMASTER_ONLY_KEYS
    //（common/documents/setting.mjs:57），写它需要 GM 角色，Assistant GM 会被服务端拒；
    // core.time 是世界时间戳，搬到别的世界会错乱。本模块产出的快照不会有这些键，
    // 出现即说明文件被手工改过或来自别处。
    if (EXCLUDE_DEFAULT.includes(item.key)) {
      throw new Error("快照里含有本模块始终排除的设置键：" + item.key + " —— 这类键不参与同步，已拒绝导入。");
    }
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
// v1.3.0（E1）：当前世界键值 Map 的短时缓存。
// 面板里每勾一下就要重算一遍差异（1435 项），而当前世界的设置在这几百毫秒里不会变，
// 每次重新遍历 Settings 集合、重建 Map 纯属白做。用 2 秒 TTL 而不是单一作废点：
// 少一个「忘了清缓存」的漏点；而写操作之后的状态刷新会显式清（见 refreshStatus）。
const CURRENT_MAP_TTL_MS = 2000;
let currentMapCache = null;
let currentMapCacheAt = 0;
function getCurrentMap() {
  const now = Date.now();
  if (currentMapCache && (now - currentMapCacheAt) < CURRENT_MAP_TTL_MS) return currentMapCache;
  currentMapCache = new Map([...collectWorldSettings().entries()].map(([k, v]) => [k, v.value]));
  currentMapCacheAt = now;
  return currentMapCache;
}
// v1.3.0（E1）：第三参数可传入「已展开的当前世界键值 Map」；不给则走上面的短时缓存
function diffSnapshot(snap, selection, currentOverride) {
  const current = (currentOverride instanceof Map)
    ? currentOverride
    : getCurrentMap();
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
// v1.2.7（第六轮盲审 G-6）：账本内容的**结构硬校验**。
// 原来只校验 { schema, worlds } 两层，内容不对时（例如 prev 里混进了非对象的值）
// 回档会照着账本里的键去删、去写真实 Setting 文档 —— 快照侧有十几条硬校验，
// 账本侧一条都没有。补齐：prev 是对象、每项是对象、present 必须是布尔、键名必须含点。
// 返回 null = 通过；返回字符串 = 不合格的原因。
function validateApplyLogEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "记录不是对象";
  const prev = entry.prev;
  if (!prev || typeof prev !== "object" || Array.isArray(prev)) return "prev 不是对象";
  const keys = Object.keys(prev);
  if (keys.length === 0) return "prev 里一条记录都没有";
  if (keys.length > 20000) return "条目过多（" + keys.length + " 项，上限 20000）";
  for (const k of keys) {
    if (typeof k !== "string" || !k.includes(".")) return "键名不合法：" + String(k);
    const p = prev[k];
    if (!p || typeof p !== "object" || Array.isArray(p)) return "「" + k + "」的记录不是对象";
    if (typeof p.present !== "boolean") return "「" + k + "」的 present 不是布尔值";
  }
  return null;
}
// v1.2.7（第六轮盲审 G-3）：同一份坏账本不要每次读取都另存一份新备份。
// 用内容指纹做文件名后缀 —— 内容没变就不重复备，内容变了才新增一个。
function contentTag(text) {
  const s = String(text ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).slice(0, 8);
}
// 读整个账本容器。文件 = apply-log-<worldId>.json（只可能含本世界一格）。
// 兼容：新文件不存在时，从旧版合并账本 apply-log.json 里取本世界那一格
// （只读不写；下次恢复会落到新文件，旧文件保持原样由用户自行删除）。
async function readApplyLogStore() {
  const { text, error: logReadErr } = await storageRead(applyLogFile());
  // v1.2.4：读完立刻捕获本次读取的结果；v1.2.9（S5）起由返回值直接给出 ——
  // 原来依赖的 storageLastError 是单变量，下面读旧账本时会被覆写，晚一步读就等于读错。
  applyLogReadError = text ? null : logReadErr;
  // v1.2.7（第六轮盲审 G-2）：每次读取都先清掉上一次的旧值。
  // 原来 legacyLogReadError 只在「主账本读不到」的分支里被重设，主账本一旦读到
  // 就直接 return，于是上一轮遗留的旧错误一直留着，会把一次正常读取讲成「读取失败」。
  legacyLogReadError = null;
  if (text) {
    let corrupt = null;   // v1.2.7（G-3）：坏在哪，要能说给用户听，不能只丢进控制台
    try {
      const raw = JSON.parse(text);
      if (raw && raw.schema === APPLOG_SCHEMA && raw.worlds && typeof raw.worlds === "object") {
        // v1.2.7（G-6）：结构过关不等于内容可靠 —— 本世界那一格还要过硬校验，
        // 否则回档会照着账本里的键去删、去写真实设置。
        const mine = raw.worlds[currentWorldId()];
        const bad = mine ? validateApplyLogEntry(mine) : null;
        if (!bad) return raw;
        corrupt = "记录内容不合法（" + bad + "）";
        console.warn("[lh-world-sync] 本世界账本记录内容不合法：" + bad + "，已忽略（不作为回档依据）");
      } else {
        corrupt = "文件结构不符（缺少 schema / worlds 字段）";
        console.warn("[lh-world-sync] 本世界账本文件格式异常，已忽略（不作为回档依据）");
      }
    } catch (e) {
      corrupt = "文件解析失败（" + (e?.message || e) + "）";
      console.warn("[lh-world-sync] 本世界账本文件解析失败，已忽略（不作为回档依据）", e);
    }
    // v1.2.6（第四轮盲审 T3）：格式不符/解析失败时，下面写账本会把这份文件**整份覆盖**。
    // 将来若升 schema，旧记录就此静默消失（违反「旧数据只读不删」）。先原样另存一份再继续；
    // 另存失败只告警，不阻断 —— 不能因为备份不了就让用户什么也做不了。
    try {
      // v1.2.7（G-3）：文件名改用内容指纹，不用时间戳 —— 同一份坏账本被反复读取时
      // 不会再每次都造一个新备份（原来每次进面板都会多一个 .bak-<时间戳>.json，
      // 与 README「不会累积文件」的说法自相矛盾）；内容真变了才会新增一个。
      const bak = applyLogFile().replace(/\.json$/i, "") + ".bak-" + contentTag(text) + ".json";
      await storageWrite(bak, text);
      applyLogCorrupt = { reason: corrupt, backup: bak };
      console.warn("[lh-world-sync] 原账本不可用（" + corrupt + "），已原样另存为 " + bak + "（新账本将重新开始记）");
    } catch (e2) {
      applyLogCorrupt = { reason: corrupt, backup: null };
      console.warn("[lh-world-sync] 原账本另存失败（不影响后续操作，但旧记录会被覆盖）：" + (e2?.message || e2));
    }
    return emptyApplyLogStore();
  }
  // v1.2.3：读不到文本时，区分「文件本来就没有」和「有文件但这次没读成」。
  // 后者若被当成空的，随后的写入会覆盖掉本世界原有的回档记录 —— 至少要留个痕。
  if (logReadErr) {
    console.warn("[lh-world-sync] 回档账本读取失败（" + logReadErr + "），"
      + "本次将重新写一份账本；若旧账本其实存在，它的回档记录会被覆盖。");
  }
  const { text: legacy, error: legacyReadErr } = await storageRead(APPLOG_FILE_LEGACY);
  // v1.2.5：旧版合并账本读失败也要记下来 —— 否则这种情形会走「没有可回档记录」，
  // 而那个文件里可能还存着本世界的撤销点（与主账本读失败同类的错误因果）。
  // v1.2.6（第四轮盲审 S2）：旧账本读失败记进 legacyLogReadError，**不能**记进
  // applyLogReadError —— 后者是「写新账本会不会覆盖掉旧记录」的判据，而
  // apply-log.json 全文件只读不写（第 257 行声明，唯一读点就是上面这行）。
  if (!legacy && legacyReadErr) {
    legacyLogReadError = legacyReadErr;
    console.warn("[lh-world-sync] 旧版合并账本 " + APPLOG_FILE_LEGACY + " 读取失败（" + legacyReadErr
      + "）。它只用于查旧的回档记录，不影响本次恢复；若其中还存着本世界的撤销点，这次会看不到它。");
  } else {
    legacyLogReadError = null;
  }
  if (legacy) {
    try {
      const raw = JSON.parse(legacy);
      const wid = currentWorldId();
      if (raw && raw.schema === APPLOG_SCHEMA && raw.worlds?.[wid]) {
        // v1.2.7（G-6）：旧版合并账本里本世界那一格同样要过内容校验
        const badLegacy = validateApplyLogEntry(raw.worlds[wid]);
        if (badLegacy) {
          console.warn("[lh-world-sync] 旧版合并账本里本世界的记录内容不合法（" + badLegacy + "），已忽略。");
          return emptyApplyLogStore();
        }
        console.log("[lh-world-sync] 已从旧版合并账本 " + APPLOG_FILE_LEGACY + " 读到本世界的回档记录；"
          + "下次恢复起写入 " + applyLogFile() + "，旧文件保留不动，确认无误后可手动删除。");
        return { schema: APPLOG_SCHEMA, worlds: { [wid]: raw.worlds[wid] } };
      }
    } catch (e) { /* 旧文件损坏与本世界无关，忽略 */ }
  }
  return emptyApplyLogStore();
}
// 写入时只覆盖「本世界」那一格，其他世界的记录原样保留
// v1.3.0（D3）：账本文件名由 world.id 生成。Foundry 一定给 id（client-documents 的
// exportToJSON 也用 game.world.id 标世界归属），但万一取不到，currentWorldId() 会退回
// 世界标题 —— 两个同名世界就会写到同一份账本、互相挤掉对方的撤销点。
// 宁可拒绝写账本（本次恢复不执行、世界零改动），也不制造一个会串数据的文件。
function hasStableWorldId() {
  return !!(game.world?.id ?? game.world?._id);
}
async function writeApplyLog(prevMap, afterMap) {
  if (!hasStableWorldId()) {
    throw new Error("当前世界没有稳定标识（game.world.id 取不到），无法安全地写回档账本 —— 本次操作已中止，世界未做任何改动。");
  }
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
  // v1.2.8（A1 / B8）：账本是「唯一的撤销点」，覆盖前必须先留一份。
  // 旧实现直接整格覆盖 store.worlds[wid]：连续两次恢复、或刷新导致两道互斥
  // 同时失效而并发时，上一份撤销点会**静默消失**，用户此后无路可退，
  // 界面上却看不出任何异常。账本体积小（实测 7.8KB），另存一代代价可接受。
  // 对照：主快照没有采用多代轮转 —— 8.8MB × 5 代 ≈ 44MB 传输，而 v13 没有文件
  // 重命名 API（manageFiles 只有 browseFiles/createDirectory/configurePath），
  // 只能读+写，代价过大；主快照改成「覆盖前内容体检」（见「存主世界」按钮）。
  const existing = store.worlds?.[wid];
  if (existing?.prev && existing.status !== "rolled-back") {
    try {
      await storageWrite(applyLogPrevFile(), JSON.stringify(existing, null, 2));
    } catch (e) {
      console.warn("[lh-world-sync] 上一份回档记录未能另存备份：" + (e?.message || e));
      try { notify.warn("注意：上一份回档记录未能备份（" + escapeHtml(e?.message || String(e)) + "），本次恢复会把它覆盖掉。"); } catch (e2) { /* 忽略 */ }
    }
  }
  const opId = myPageToken() + ":" + Date.now();   // 本次恢复的标识，供写完设置后回写完成标记
  store.worlds[wid] = {
    ts: new Date().toISOString(),
    worldId: wid,
    worldTitle: game.world?.title ?? "",
    appVersion: MODULE_VERSION,
    // status: pending（尚未回档）/ rolled-back（已回档过一次，再次回档会二次确认）
    // after：本次恢复「写入的值」，用于发现「恢复之后又被人工改过」的情况
    status: "pending",
    opId: opId,
    rolledBackAt: null,
    after: afterMap ? Object.fromEntries([...afterMap.entries()]) : {},
    prev: Object.fromEntries([...prevMap.entries()].map(([k, v]) => [k, { present: v.present, value: v.value }]))
  };
  await storageWrite(applyLogFile(), JSON.stringify(store, null, 2));
  return opId;   // v1.2.8：交给 applySnapshot，写完设置后用同一个 opId 标「已完成」
}
// 回档成功后就地标记（审阅第 8 条：原实现可无限重复回档，几天后再点一次仍写旧值）
async function markLogRolledBack() {
  const store = await readApplyLogStore();
  const wid = currentWorldId();
  const e = store.worlds?.[wid];
  // v1.2.6（第四轮盲审 T2）：读失败/条目缺失时原来静默 return —— 账本状态停在 pending，
  // 用户下次可以毫无警告地二次回档（v1.1.0 第 8 条「已回档过一次」的防护正好在这一刻失效）。
  // 防护可以失效，但不能悄无声息地失效。
  if (!e) {
    console.warn("[lh-world-sync] 未能在账本里标下「已回档过」"
      + (applyLogReadError ? "（账本读取失败：" + applyLogReadError + "）" : "（账本里没有本世界的条目）")
      + "。下次回档可能不会提示「已经回档过一次」。");
    return;
  }
  e.status = "rolled-back";
  e.rolledBackAt = new Date().toISOString();
  await storageWrite(applyLogFile(), JSON.stringify(store, null, 2));
}
// v1.2.8（第六轮整体盲审 B7）：设置真正写完之后，把账本标记为 applied。
// 旧实现写完设置就结束了，账本一直停在 pending（它的语义只是「还没回档过」）：
// 中途崩掉（刷新 / 断网 / 报错）时世界停在半成品，账本上没有任何标记；
// 几天后再回档，findDriftedKeys 会把「上一次没写完」讲成「你又改过」——
// 也就是界面编了一个看起来合理、但完全错误的原因。
async function markLogApplied(opId) {
  if (!opId) return;
  try {
    const store = await readApplyLogStore();
    const wid = currentWorldId();
    const e = store.worlds?.[wid];
    if (!e) {
      console.warn("[lh-world-sync] 未能在账本里标下「恢复已完成」（账本里没有本世界的条目）。");
      return;
    }
    if (e.opId && e.opId !== opId) {
      console.warn("[lh-world-sync] 账本已被另一次操作改写（opId 不匹配），本次不写完成标记。");
      return;
    }
    e.status = "applied";
    e.appliedAt = new Date().toISOString();
    await storageWrite(applyLogFile(), JSON.stringify(store, null, 2));
  } catch (e) {
    console.warn("[lh-world-sync] 未能标记「恢复已完成」：" + (e?.message || e));
  }
}
// 回档前自检：哪些键在「上次恢复之后」又被人改过（当前值 ≠ 账本记的 after）
function findDriftedKeys(log) {
  // v1.2.8（B7）：账本停在 pending 说明上一次恢复写完了账本、但写在设置中途就中断了。
  // 此时「当前值 ≠ 账本记的 after」是那次没写完造成的，不是用户又改动过 ——
  // 一律不报漂移，由界面按 log.status 给出准确说明（而不是编一个像样的原因）。
  if (log?.status === "pending") return [];
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
function nsIsUnavailable(ns) {
  const n = String(ns ?? "");
  if (!n) return false;
  if (n === "core") return false;                  // 核心设置永远可写
  if (n === MODULE_ID) return true;                // 本模块自指键：导出已排除，也不该写入
  if (n === game.system?.id) return false;         // 当前系统的设置
  return !game.modules?.get(n);                    // 未安装的模组
}
function isNsUnavailable(key) {
  return nsIsUnavailable(String(key ?? "").split(".")[0]);
}
// v1.2.6（第四轮盲审 G1/G2）：统一口径的「本该恢复、却恢复不了的键」。
// 三项条件同时满足才算，缺一项就是在虚报或误导：
//   ① 不是用户明确排除的键（EXCLUDE_DEFAULT / 自制排除表里的是**故意**永不恢复）
//   ② 所属模组本机没装（未启用但已安装的模组仍在 game.modules 里，不在此列）
//   ③ 落在本次勾选范围内（用户自己没勾的模块，不叫「被跳过」）
// 面板早退、文件导入早退、进世界自动提醒、状态栏、写入后的通知，五处共用同一个口径。
function collectUnavailable(snap, selection) {
  const sel = selection ?? { ns: {}, includeModuleConfig: false };
  const out = [];
  // v1.3.0（E2）：原来用 out.includes(key) 去重 —— 1435 项的快照上这是 O(n²)，
  // 而本函数在面板每次刷新、每次勾选变化、每次恢复前后都会被调用。
  const seen = new Set();
  for (const item of (snap?.settings ?? [])) {
    const key = String(item?.key ?? "");
    if (!key || seen.has(key)) continue;
    if (isExcludedKey(key)) continue;
    if (!isNsUnavailable(key)) continue;
    if (!sel?.ns?.[key.split(".")[0]]) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
function unavailableMods(keys) {
  return [...new Set((keys ?? []).map(k => String(k).split(".")[0]))];
}
// 一句话说清「有 N 项没恢复、为什么」——三个入口的文案必须一字不差，
// 否则同一件事在不同弹窗里说法不同，用户会以为是两回事。
function describeUnavailable(keys) {
  const mods = unavailableMods(keys);
  const tail = mods.length > 5 ? " 等 " + mods.length + " 个模组" : "";
  return "另有 " + keys.length + " 项设置没有恢复：本世界没有安装对应的模组（"
    + escapeHtml(mods.slice(0, 5).join("、")) + tail + "）。装好这些模组后再来恢复即可。";
}
async function applySnapshot(snap, selection, precomputed) {
  // 写入口守卫（审阅第 10 条）：window.lhWorldSync.applySnapshot 对所有人生效
  if (!assertGM()) return { applied: [], skipped: 0, denied: true };
  // v1.2.5：统计「因本机未安装对应模组而不参与恢复」的键。
  // 它们已被 diffSnapshot 排除（否则会永远报差异、每次进世界弹提醒），
  // 所以这里单独从快照统计一次，好让提示与报告能说明「有 N 项没恢复」的原因。
  // v1.2.6（第四轮盲审 G1）：改用 collectUnavailable —— 旧写法拿整份快照统计，
  // 既不看勾选范围、也不看排除键，于是「只勾一个模块」也报「另有 250 项未恢复」，
  // 还把 core.time 这类故意永不恢复的键算了进去，口径与 README/头注释都不符。
  const unavailable = collectUnavailable(snap, selection);
  // v1.2.1：允许调用方把弹窗里已经算好的清单原样传进来（自查第 8 项），
  // 让「用户看到的清单」与「实际写入的清单」是同一份，而不是各算一次。
  const diff = Array.isArray(precomputed) ? { changed: precomputed } : diffSnapshot(snap, selection);
  if (!diff.changed.length) return { applied: [], skipped: unavailable.length };
  // v1.2.9（B4）：互斥（会话闸 + 文件锁）改走唯一入口 withOpLock。
  // v1.2.5~v1.2.8 这里是第二套手写实现：自己的 beginOp、自己的 acquireLock、
  // 自己的拒绝文案、自己的 try/finally —— 与 withOpLock、与回档路径各写一遍。
  const r = await withOpLock("apply", async () => {
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
        // v1.2.6：正常流程到不了这里（diffSnapshot 已把这类键滤掉），保留是为了挡住
        // window.lhWorldSync 外部注入的 precomputed。原先它把键推进 skippedNs 后
        // 全文件再没人读 —— 是死代码（第四轮盲审 T1），现在直接并进 unavailable。
        if (!unavailable.includes(c.key)) unavailable.push(c.key);
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
    let logOpId = null;
    try {
      logOpId = await writeApplyLog(prevMap, afterMap);
    } catch (e0) {
      // v1.2.3：账本都没写成 = 一个设置都没动过。
      // 打上标记，别让外层把它说成「已自动回滚到恢复前的状态」——那是假话。
      e0.__notStarted = true;
      throw e0;
    }
    // v1.3.0（D1）：本次新建文档的 key → _id（失败回滚时精确删除用）
    const createdByKey = new Map();
    try {
      if (updates.length) await SettingDoc.updateDocuments(updates, {});
      // v1.3.0（D1）：记住本次真正创建出来的文档 id，失败回滚按它删 —— 不再靠
      // getSettingDoc 反查：刚创建的文档在集合缓存里可能还查不到，反查落空会把
      // 「本该删掉的新文档」留在世界里，成为同 key 的第二份 Setting（取哪份不确定）。
      if (creates.length) {
        const made = await SettingDoc.createDocuments(creates, {});
        for (const d of (made ?? [])) {
          const id = d?._id ?? d?.id;
          if (id && d?.key) createdByKey.set(d.key, id);
        }
      }
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
            // v1.3.0（D1）：本次新建的按记录下来的 id 删（最准）；否则回退到反查
            const newId = createdByKey.get(c.key);
            if (newId) d2.push(newId);
            else if (doc?._id) d2.push(doc._id);
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
    // v1.2.8（B7）：设置真的写完了 → 账本从 pending 改成 applied。
    // 这一步失败不影响恢复结果（设置已经写进去），只影响「下次回档时怎么解释」，
    // 所以只留日志、不抛错。
    await markLogApplied(logOpId);
    // v1.2.5：快照里有「本机未安装模组」的设置时必须说出来 —— 否则用户会觉得
    // 「恢复完了怎么还是不对」，却不知道原因是没有那几项。
    if (unavailable.length) {
      console.warn("[lh-world-sync] 有 " + unavailable.length + " 项设置未参与恢复：本机未安装对应模组 —— "
        + unavailableMods(unavailable).join("、"));
      notify.warn(describeUnavailable(unavailable));
    }
    return { applied: plan, skipped: unavailable.length, skippedKeys: unavailable };
  }, "恢复主世界");
  // v1.2.9（B4）：把 withOpLock 的 busy/locked 补成上层认识的样子 ——
  // 上层 proceedApplySnap 会读 res.applied.length，形状不齐会变成 TypeError。
  if (r?.busy || r?.locked) return { applied: [], skipped: 0, busy: r.busy, locked: r.locked, staleSelf: r.staleSelf };
  return r;
}
// 回档：按 applyLog 恢复
// v1.2.4：返回值不再「一律 null」。原来「非 GM / 读不到账本 / 被锁拒绝 / 账本属于
// 别的世界」四种情况都返回 null，调用方统一弹「暂无可回档记录」——
// 把「被别人锁着」「读失败」「不是这个世界的账本」全都讲成了「你没有记录」。
async function rollbackApplyLog() {
  if (!assertGM()) return { denied: true };                   // assertGM 已提示过
  const log = await readApplyLog();
  // v1.2.6（第四轮盲审 S1）：主账本读失败时**一律不许回档**，哪怕从旧版合并账本里凑出了条目。
  // 那份数据可能已经过期（本世界的账本更新过、这次没读到），拿它批量覆盖世界 = 用旧值抹掉新值；
  // 随后的 markLogRolledBack 还会把主账本里更新的那条标成「已回档」，撤销点语义被污染。
  // 写入路径（writeApplyLog）早就是这样拒绝的，回档路径现在与它对齐。
  if (applyLogReadError) return { readError: applyLogReadError };
  if (!log?.prev) {
    // v1.2.6：主账本里没有本世界的条目、而旧版合并账本**读失败** —— 那也是「读不到」，
    // 不等于「没有记录」：撤销点可能正存在那份读不到的文件里。
    // （注意与 S1 的区别：上面那条是主账本**存在却读失败** → 一律拒绝回档；
    //   这条是主账本本来就没有，此时 legacy 才是唯一来源，读失败要说成读失败。）
    if (legacyLogReadError) return { readError: legacyLogReadError };
    return { empty: true };
  }
  // 纵深防御：账本必须属于当前世界（readApplyLog 已按 worldId 只取本世界的格子，
  // 这里再核一次 worldId，防止将来改动绕过这道门）
  if (log.worldId && String(log.worldId) !== currentWorldId()) {
    console.warn("[lh-world-sync] 回档被拒：账本属于其他世界", log.worldId);
    return { foreign: true, worldId: log.worldId };
  }
  // v1.2.9（B4）：互斥改走唯一入口 withOpLock（原来这里是第三套手写实现）
  const r = await withOpLock("rollback", async () => {
    // v1.2.9：这行原来在函数顶部，随函数体一起移进锁内
    const SettingDoc = settingDocumentClass();
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
    // v1.3.0（D1）：同 applySnapshot —— 记录本次新建文档的 id，供失败还原精确删除
    const createdByKey = new Map();
    try {
      if (deletes.length) await SettingDoc.deleteDocuments(deletes, {});
      if (updates.length) await SettingDoc.updateDocuments(updates, {});
      if (creates.length) {
        const made = await SettingDoc.createDocuments(creates, {});
        for (const d of (made ?? [])) {
          const id = d?._id ?? d?.id;
          if (id && d?.key) createdByKey.set(d.key, id);
        }
      }
    } catch (e) {
      // ③ 失败回滚：把已碰过的键还原成「回档前」的样子，绝不停在半回档状态
      console.error("[lh-world-sync] 回档失败，正在还原到回档前状态", e);
      let rollbackErr = null;
      const u2 = [], c2 = [], d2 = [];
      for (const key of keys) {
        const b = before.get(key);
        const doc = getSettingDoc(key);
        if (!b?.present) {
          // v1.3.0（D1）：本次新建的按记录下来的 id 删，避免反查落空留下孤儿文档
          const newId = createdByKey.get(key);
          if (newId) d2.push(newId);
          else if (doc?._id) d2.push(doc._id);
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
  }, "回档");
  // v1.2.9（B4）：同上，补齐上层认识的形状
  if (r?.busy || r?.locked) return { busy: r.busy, locked: r.locked, staleSelf: r.staleSelf };
  return r;
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
    // v1.2.6（第四轮盲审 G3）：本机没装这个模组时，它下面的键会被跳过（不会恢复），
    // 旧界面却照常显示成可勾选 + 「来自主快照」—— 用户勾完点恢复，只得到一句「基准一致」，
    // UI 承诺与行为不符。这里直接把这一行标成不可用，别让人去踩。
    const off = nsIsUnavailable(n);
    const checked = mode === "all" ? true : !!pref?.ns?.[n];
    const cnt = off ? "本机未安装 · 不会恢复" : (fromSnap ? "来自主快照" : (curCount[n] + " 键"));
    const label = escapeHtml(n)
      + (friendly ? `<em class="wsync-ns-title">${escapeHtml(friendly)}</em>` : "")
      + (off
        ? `<em class="wsync-ns-title">（本机未安装这个模组 · 本次不会恢复）</em>`
        : (fromSnap ? `<em class="wsync-ns-title">（当前世界还没有它的设置 · 来自主快照）</em>` : ""));
    return `
    <label class="wsync-ns-row${off ? " wsync-ns-off" : ""}"${off ? ` title="本机未安装这个模组：它的设置不会被创建（避免留下没有任何代码会去读的悬空键）"` : ""}>
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
  // v1.3.0（B1）：原来说「完整清单见导出快照」—— 导出的是当前世界的设置**值**，
  // 不含差异标记，用户照它根本对不出「还有哪 200 项不同」。改为真的把清单给出去。
  try { console.log("[lh-world-sync] 差异清单（" + changed.length + " 项）", changed.map(c => c.key)); } catch (e) { /* 忽略 */ }
  const trimmed = changed.length > 120 ? `<div class="wsync-diff-more">…还有 ${changed.length - 120} 项。<b>完整清单已输出到浏览器控制台</b>（F12 → Console，搜 lh-world-sync）。</div>` : "";
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
    openApplyReportDialog(res.applied, res.skipped);
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
function openApplyReportDialog(applied, skipped) {
  const hasModCfg = applied.some(c => c.key === "core.moduleConfiguration");
  // v1.2.6（第四轮盲审 T4）：原来「另有 N 项未恢复」只出现在一条瞬时通知里，
  // 不进报告、不进「上一次恢复改动了什么」—— 刷新之后这句话就消失了。
  // 报告是用户事后唯一能回看的凭据，缺这项就等于没说过。
  const skippedNote = skipped
    ? `<div class="wsync-diff-more">另有 <b>${skipped}</b> 项没有恢复：本世界没有安装对应的模组。装好之后再恢复即可。</div>`
    : "";
  const lines = applied.slice(0, 150).map(c => {
    const tag = describeChange(c.from, c.to);
    return `<div class="wsync-diff-row"><code>${escapeHtml(c.key)}</code><span class="wsync-diff-tag">${tag}</span><div class="wsync-diff-vals"><span class="wsync-v-now">${escapeHtml(shortVal(c.from))}</span><span class="wsync-v-master">→</span><span class="wsync-v-now">${escapeHtml(shortVal(c.to))}</span></div></div>`;
  }).join("");
  const trimmed = applied.length > 150 ? `<div class="wsync-diff-more">…还有 ${applied.length - 150} 项</div>` : "";
  // v1.2.1：清单存进 sessionStorage —— 自动刷新之后仍能在面板里回看「上一次改了什么」，
  // 而不是刷完就查无此事（自查第 14 项：写操作要可核查、可撤销）。
  saveLastReport(applied, skipped);
  // v1.2.1：自动刷新延迟 10 秒（原来 3 秒，150 项清单根本来不及看），并给出手动选项
  const RELOAD_MS = 10000;
  // v1.3.0（C3）：自动刷新前先看有没有操作正在跑。刷新会掐断进行中的写入，而本项目
  // 历史上最危险的一次事故正是「恢复途中刷新」——两道互斥同时归零、撤销点被下一次
  // 恢复覆盖、世界停在从未存在过的中间态。宁可让用户自己决定何时刷新。
  const timer = setTimeout(() => {
    if (_opInFlightAt) {
      notify.warn("检测到仍有操作正在进行，已暂停自动刷新。请等操作结束后手动刷新页面（F5）。");
      return;
    }
    window.location.reload();
  }, RELOAD_MS);
  new Dialog({
    title: `恢复完成 · ${RELOAD_MS / 1000} 秒后自动刷新`,
    content: `<div class="wsync-body"><div class="wsync-diff-summary">已恢复 <b>${applied.length}</b> 项设置。${hasModCfg ? "<b>模组启用状态已一并恢复</b>（此前被关闭的模组将重新启用）。" : ""}<br>页面将在 ${RELOAD_MS / 1000} 秒后自动刷新并生效。刷新完成后，仍可在面板里查看这次改动的清单。如需撤销，刷新完成后点「回档」。</div>${skippedNote}${lines}${trimmed}</div>`,
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
function saveLastReport(applied, skipped) {
  try {
    sessionStorage.setItem(LAST_REPORT_KEY, JSON.stringify({
      n: applied.length,
      // v1.2.6（第四轮盲审 T4）：把「没恢复的项数」一并存下来，回看时数字才对得上。
      // 原 sourceWorld 字段存的是**当前世界**标题（命名反了）且全文件无人读取，已删（T5）。
      skipped: skipped || 0,
      at: new Date().toISOString(),
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
  // v1.2.6（第四轮盲审 T4）：回看清单里也要有「另有 N 项没恢复」，否则事后再看就觉得全恢复了。
  const skippedNote = rep.skipped ? `<div class="wsync-diff-more">另有 <b>${rep.skipped}</b> 项没有恢复：本世界没有安装对应的模组。</div>` : "";
  new Dialog({
    title: "上一次恢复改动了什么",
    content: `<div class="wsync-body"><div class="wsync-diff-summary">共改动 <b>${rep.n}</b> 项 · 记录时间 ${escapeHtml(formatTs(rep.at))}<br>这份清单存在本浏览器会话里，刷新页面后仍可回看；关闭标签页后清空。</div>${skippedNote}${lines}${trimmed}</div>`,
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
      // v1.2.7（第六轮盲审 S-1 + G-3）：
      // ① 旧版合并账本读失败也要算「读不到」—— 原来这里只判 applyLogReadError，
      //    于是「主账本本来就不存在 + 旧账本读失败」会显示成「暂无可回档记录」，
      //    而撤销点很可能就在那份读不到的文件里（doRollback 早已修对，这里漏了）。
      // ② 账本存在但内容不可用时，这里原来也说「暂无可回档记录」，原因与备份文件名
      //    只落在控制台 —— 现在把「坏在哪、另存成了什么」直接摆在界面上。
      const readErr = applyLogReadError || legacyLogReadError;
      const body = readErr
        ? `<b>回档记录读取失败：</b>${escapeHtml(readErr)}<br>这不是「没有记录」——账本文件可能还在服务器上，请检查服务器连接后重开本面板再试。`
        : applyLogCorrupt
          ? `<b>账本文件存在，但内容不可用：</b>${escapeHtml(applyLogCorrupt.reason)}<br>${applyLogCorrupt.backup
            ? `原文件已原样另存为 <code>${escapeHtml(applyLogCorrupt.backup)}</code>，可在服务器上查看它是否还留着你要的撤销点。`
            : "（原样另存也没能成功，下次恢复会把这份文件整份覆盖。）"}<br>本世界暂时没有可用的回档记录。`
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
  // v1.2.9（B4）：闸与锁统一由 rollbackApplyLog 内部的 withOpLock 负责。
  // 这里若再来一次 beginOp，会变成「自己把自己挡住」—— 第二次 beginOp 必被拒，
  // 于是回档永远返回 { busy: true }，用户看到的是「已有操作在进行」。
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
      <div class="wsync-file-note">快照保存在模块 storage 目录，所有世界共享读取。<b>下面「导出 / 复制」导出的都是当前世界的实时设置</b>，不是服务器上那份主快照 —— 它用于备份或搬到别的服务器。想直接拿主快照本身，请在服务器上取 storage 目录里的 world-snapshot-master.json。</div>
      <div class="wsync-file-btns">
        <button class="wsync-btn" data-file="export-snap">导出当前世界设置（下载文件）</button>
        <button class="wsync-btn" data-file="copy-full">复制当前世界设置全文</button>
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
        // v1.3.0（C1）：copyText 现在是 async，必须 await —— 否则「复制失败」的提示
        // 永远抢在真实结果之前，失败会被显示成成功。
        try { await copyText(JSON.stringify(buildSnapshot(), null, 2)); setMsg(true, "当前世界设置全文已复制到剪贴板。"); }
        catch (e) { setMsg(false, "复制失败：" + (e?.message || e)); }
      });
      $h.find("[data-file=import-file]").on("click", () => {
        const input = document.createElement("input");
        input.type = "file"; input.accept = ".json,application/json";
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return;
          // v1.3.0（E3）：先看体积再读进内存。f.text() 是全量读入 —— 一份几百 MB 的
          // 文件会让浏览器直接卡死，校验必须在读之前。
          const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
          if (f.size > MAX_IMPORT_BYTES) {
            setMsg(false, "文件太大（" + Math.round(f.size / 1048576) + " MB，上限 32 MB）：这可能不是本模块产出的快照。");
            return;
          }
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
          panelDirty = true;        // v1.3.0（B6）：让面板下次渲染强制重读新基准
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
  if (!diff.changed.length) {
    // v1.2.6（第四轮盲审 G2）：与面板路径同一区分 —— 别把「缺模组没恢复」讲成「一致」。
    const un = collectUnavailable(snap, sel);
    if (un.length) notify.warn(describeUnavailable(un));
    else notify.ok("当前世界与这份快照一致，无需恢复。");
    return;
  }
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
  const { text, error: readErr } = await storageRead(MASTER_FILE);
  if (!text) {
    // v1.2.2：区分「真的没有快照」与「读不到快照」—— 前者让用户去存，后者必须说真原因，
    // 否则服务器 5xx / 断网会被讲成「尚未保存主世界快照」，用户会去重复存快照。
    notify.warn(readErr
      ? "读取主世界快照失败：" + readErr + "。这不是「没有快照」，请检查服务器后重试。"
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
    if (!diff.changed.length) {
      // v1.2.6（第四轮盲审 G2）：「没有差异」有两种含义，必须分开说 ——
      // ① 真的完全一致；② 能恢复的那部分已经一致，另有 N 项因为本机没装模组从未落地。
      // 旧写法一律说「一致」，跨服务器搬家的用户永远看不到那 N 项（第四轮盲审目标场景）。
      const un = collectUnavailable(snap, sel);
      if (un.length) notify.warn(describeUnavailable(un));
      else notify.ok("当前世界与主世界基准一致，无需恢复。");
      return;
    }
    // v1.2.3：先挂 __sel/__snap 再开弹窗（与 restoreFromSnap / autoPromptCheck 统一顺序）
    diff.changed.__sel = sel;
    diff.changed.__snap = snap;
    const dlg2 = openDiffDialog(diff.changed, { snap });
    return dlg2;
  } catch (e) { console.error(e); notify.err("快照读取失败:" + (e?.message || e)); }
}
// v1.2.1：状态检测用的快照缓存 —— 面板里改勾选时只重算差异，不重新下载整个快照
let statusSnapCache = null;
// v1.3.0（B6）：面板之外的地方换过基准（导入并设为主快照）时置位 ——
// 面板下次渲染时据此强制重读，不让状态栏停在旧基准上。
let panelDirty = false;
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
    const { text } = await storageRead(MASTER_FILE);
    // v1.2.6（第四轮盲审 G4）：先把缓存清掉再尝试解析。
    // v1.2.5 把首次刷新改成 refreshStatus(false) 复用缓存之后，解析失败（快照损坏 /
    // schema 不符 / 条目超限）会让 statusSnapCache 保留**上一次打开面板时的**快照，
    // 而 refreshStatus 见缓存非空就跳过重读 → 状态栏拿旧基准算差异，还显示得好好的。
    statusSnapCache = null;
    if (text) {
      const snap = parseSnapshot(text);
      for (const item of snap.settings) snapNs.add(String(item.key).split(".")[0]);
      // v1.2.4：顺手把这份快照交给状态栏复用。原来 openSyncPanel 读一次、
      // refreshStatus 又读一次：两次 HTTP 之间若主快照被别的 GM 更新，
      // 「模块勾选列表」与「状态栏差异数」就来自两份不同的快照。
      statusSnapCache = snap;
    }
  } catch (e) {
    statusSnapCache = null;
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
        // v1.2.8（第六轮整体盲审 A2）：覆盖前的「内容体检」。
        // 攻击场景：完整主快照（实测 1400+ 项）→ 切到一个空世界/新世界再点「存主世界」→
        // 主快照被十几项覆盖，而 .prev 只保留一代 → 再存一次，完整快照在服务器上
        // 再无任何副本（Foundry 没有文件恢复 API，v13 也没有重命名 API）。
        // 8.8MB 的快照做不了多代轮转（见 writeApplyLog 的注释），
        // 所以改成「拦住明显不合理的覆盖」：条目数不足 20、或骤降到原来的三成以下时，
        // 先警告并要求再点一次确认。
        try {
          const nNow = collectWorldSettings().size;
          const nMaster = Array.isArray(statusSnapCache?.settings) ? statusSnapCache.settings.length : null;
          if (nNow === 0) {
            notify.err("当前世界没有任何设置可以保存，已取消（避免用空快照覆盖服务器上的完整主快照）。");
            return;
          }
          if (nMaster === null) {
            console.warn("[lh-world-sync] 未读到服务器现有主快照的条目数，本次跳过「覆盖前体检」。");
          } else if (nNow < nMaster * 0.3 && nNow < nMaster - 10 && !snapshotForceAck) {
            snapshotForceAck = true;
            notify.warn("警告：当前世界只有 " + nNow + " 项设置，而服务器上的主快照有 " + nMaster
              + " 项 —— 这通常说明你选错了世界。已暂停保存。"
              + "若确认要用这份覆盖主快照，请再点一次「存主世界」；否则请切回原来的世界。");
            return;
          } else {
            snapshotForceAck = false;
          }
        } catch (e) {
          console.warn("[lh-world-sync] 覆盖前体检出错，本次跳过：", e);
        }
        try {
          const r = await withOpLock("snapshot", async () => {
            // v1.2.1：覆盖前先把现有主快照另存一份（自查第 14 项：写操作要能反悔）
            const backed = await backupMasterSnapshot();
            if (!backed.ok) return { backupFailed: backed };   // v1.2.4：没备份成就不覆盖
            const snap = buildSnapshot();
            const path = await storageWrite(MASTER_FILE, JSON.stringify(snap, null, 2));
            // v1.2.7：把刚生成的快照一并交出去 —— 下面刷新状态栏直接用它，
            // 不再把刚上传上去的这份文件整份下载回来（本机实测 8.8MB / 约 4 秒）。
            return { count: snap.settings.length, path, backed: backed.path, snap };
          });
          if (r?.locked || r?.busy) return;
          if (r?.backupFailed) {
            const bf = r.backupFailed;
            notify.err(bf.reason === "readError"
              ? "未能读取现有主快照（" + bf.detail + "），无法确认备份是否成功。为避免在没有退路的情况下覆盖，本次保存已取消。请检查服务器后重试。"
              : "备份现有主快照失败（" + bf.detail + "）。为避免在没有退路的情况下覆盖，本次保存已取消。");
            return;
          }
          snapshotForceAck = false;   // v1.2.8：确认标志用完即清，避免影响下一次保存
          notify.ok(`已保存主世界快照：${r.count} 项设置（${r.path}）`
            + (r.backed ? `；上一份已备份为 ${r.backed}` : "；此前没有旧主快照，无需备份"));
          refreshStatus(r.snap);
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
      // v1.3.0（B6）：若期间有「设为主快照」换过基准，强制重读一次；
      // 否则复用 openSyncPanel 刚读过的那份（v1.2.5 的性能优化）。
      refreshStatus(panelDirty);
      panelDirty = false;
      // v1.3.0（卫生）：自动提醒是 GM 专属功能（autoPromptCheck 首行就是 isGM 检查），
      // 玩家看到这个开关只会困惑 —— 勾上它不会发生任何事。
      if (!game.user?.isGM) $h.find("#wsync-autoprompt").closest("label").hide();
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
        refreshStatus();   // v1.2.7（G-4）：排除表变了，状态栏那行差异数要跟着重算
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

  async function refreshStatus(snapOverride) {
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
      // v1.2.7（性能 + 第六轮盲审 G-1）：
      // ① 允许调用方直接传入刚生成的快照对象 —— 存主世界 / 设为基准之后不必再把
      //    整份快照（本机实测 8.8MB）重新下载 + 同步解析一遍，只为刷新一行差异数。
      // ② 需要重读时先把缓存清空再读：原来 parseSnapshot 抛错时赋值语句根本不执行，
      //    上一次的旧快照会留在缓存里，之后不带参数刷新就拿旧基准算差异还显示得好好的。
      // v1.2.9（S5）：本次读取的失败原因（读成功或 404 时为 null）
      let statusReadError = null;
      if (snapOverride && typeof snapOverride === "object" && Array.isArray(snapOverride.settings)) {
        statusSnapCache = snapOverride;
        // v1.3.0（E1）：拿到「刚写入的快照」说明世界刚被写过 → 当前世界键值缓存必须作废
        currentMapCache = null;
      } else if (snapOverride || !statusSnapCache) {
        statusSnapCache = null;
        // v1.2.9（S5）：读取结果与失败原因一起拿到，不再依赖模块级单变量
        const { text, error: readErr } = await storageRead(MASTER_FILE);
        statusReadError = readErr;
        statusSnapCache = text ? parseSnapshot(text) : null;
      }
      const snap = statusSnapCache;
      if (!snap) {
        // v1.2.2：读不到 ≠ 没存过 —— 5xx / 断网时要说真原因，别误导用户去重复存快照
        $s.html(statusReadError
          ? `<span class="wsync-status-none">读取主世界基准失败：${escapeHtml(statusReadError)}</span>`
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
      // v1.2.6（第四轮盲审 G1/G2）：状态栏也要说清「有 N 项因为本机没装模组而没参与比较」，
      // 口径与三个早退、写入后的通知完全一致（同一个 collectUnavailable）。
      const un = collectUnavailable(snap, sel);
      const unMods = unavailableMods(un);
      const unHTML = un.length
        ? `<br><span class="wsync-status-none">另有 ${un.length} 项未参与比较：本世界没有安装对应的模组（${escapeHtml(unMods.slice(0, 5).join("、"))}${unMods.length > 5 ? " 等 " + unMods.length + " 个模组" : ""}）。</span>`
        : "";
      $s.html((diff.changed.length
        ? `当前世界与主世界基准存在 <b class="wsync-diff-has">${diff.changed.length}</b> 处差异（${scopeNote}）。<br>${base}`
        : `当前世界与主世界基准一致（${scopeNote}）。<br>${base}`) + unHTML + repHTML);
      const $ap = $h.find("#wsync-autoprompt");
      if ($ap.length) $ap.prop("checked", game.settings.get(MODULE_ID, "autoPrompt"));
    } catch (e) {
      statusSnapCache = null;   // v1.2.7（G-1）：解析失败不留旧基准，宁可下次重读一次
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
  const { text, error: readErr } = await storageRead(MASTER_FILE);
  if (!text) {
    // v1.2.2：读不到（5xx/断网）与「没存过」都会静默返回，但至少留个日志 ——
    // 否则用户会把「读失败」当成「没有差异」。
    if (readErr) {
      console.warn("[lh-world-sync] 自动提醒跳过：读取主快照失败 —— " + readErr);
      // v1.2.4：不能一声不响。用户会把「没弹窗」理解成「没有差异」，
      // 而真实情况是这次根本没做成差异检查。面板路径早就说真话了，这里补上。
      notify.warn("读取主世界基准失败，本次未做差异检查：" + readErr);
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
  if (!diff.changed.length) {
    // v1.2.6（第四轮盲审 G2）：不弹窗 ≠ 没有差异 —— 差异也可能全是本机没装的模组。
    // 那种情况至少要留一句可见的提示，否则用户会以为一切正常。
    const un = collectUnavailable(snap, sel);
    if (un.length) notify.warn(describeUnavailable(un));
    return;
  }
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
// 控制台接口：写操作在函数内部统一 assertGM()（审阅第 10 条）；
// readScopePref / buildSelection 一并暴露，便于排查「为什么这一项没被恢复」。
// v1.3.0（卫生）：写入口只挂在 GM 的 window 上。函数内部本来就有 assertGM() 兜底，
// 但把 applySnapshot / rollback 直接摆在玩家端的全局对象里，等于给「绕过 UI 直接调」
// 留了一个显眼入口 —— 不构成漏洞，但没有理由摆在那里。
const _readonlyApi = { version: MODULE_VERSION, openPanel: openSyncPanel, buildSnapshot, parseSnapshot, diffSnapshot, readScopePref, buildSelection };
window.lhWorldSync = game.user?.isGM
  ? { ..._readonlyApi, applySnapshot, rollback: rollbackApplyLog }
  : _readonlyApi;
console.log(`lh-world-sync v${MODULE_VERSION} loaded (window.__WSYNC_VER=${window.__WSYNC_VER})`);
