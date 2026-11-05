// Synthetic walkthroughs, kept separate from business data and live execution.
(() => {
  const explain = (input, action, output, note = '') => ({ input, action, output, note });
  const phase = (title, end, outcome) => ({ title, end, outcome });
  const planning = task => [
    explain('本轮消息 + 近期聊天 + 页面信息', '把允许的任务类型和当前信息组合成识别提示。', '一份要求返回结构化计划的模型请求'),
    explain('识别提示 + 规定的输出字段', '模型判断用户想做什么，并提出计划。', `候选计划 · ${task}`),
    explain(`模型提出的「${task}」计划`, '程序检查任务类型、目标和字段是否有效。', '可交给业务服务的有效计划', '必要信息不全时先追问；格式无效时修复或返回错误。')
  ];
  const flows = {
    attachment: {
      title: '上传附件', example: '上传「架构草图.png」', artifact: '架构草图.png',
      phases: [phase('接收、保存与登记', 5, '前端拿到可使用的附件记录')],
      steps: [
        explain('架构草图.png + 当前登录会话', '接口确认上传者身份，读取文件和可选笔记编号。', '已认证的上传请求', '关联笔记时，还要检查该笔记是否属于当前账号。'),
        explain('文件字节 + 名称 + 所属账号', '附件服务生成存储标识，调用文件存储将字节写入磁盘。', '存储位置 + 大小 + 文件摘要', '文件先落到本机目录或挂载卷。'),
        explain('文件名、存储位置、大小、账号与可选笔记编号', '把这些信息写成一条附件记录。', '数据库中的附件记录', '后续用记录找到实际文件，并判断访问权限。'),
        explain('待提交的附件记录', '数据库提交成功，再把已保存的记录交回接口。', '已提交的附件 ID 和文件信息', '文件写入和数据库提交分属两个存储，失败补偿仍待完善。'),
        explain('附件 ID + 文件信息', '前端显示上传结果，之后用附件 ID 申请访问。', '界面里的附件入口', '正常读取仍检查账号；带签名的访问由签名入口校验。')
      ]
    },
    create: {
      title: 'AI 新建笔记', example: '写一篇「Docker 入门」，先讲概念，再给示例', artifact: 'Docker 入门',
      phases: [phase('理解写作要求', 7, '确认标题和要求'), phase('生成候选草稿', 15, '可以审阅的章节草稿'), phase('确认并保存', 20, '正式笔记与索引待办')],
      steps: [
        explain('“写一篇 Docker 入门，先概念后示例”', '接口确认账号，接收这次新建需求。', '带账号身份的写作请求'),
        explain('写作需求 + 当前对话信息', '任务分流准备识别这次请求的意图。', '待识别的新建需求'),
        ...planning('新建笔记'),
        explain('有效的新建计划 + 用户原话', '提取明确给出的标题与写作要求，交给笔记服务。', '标题 · Docker 入门；要求 · 先概念后示例'),
        explain('标题和写作要求', '前端显示可编辑的创建卡片，等待用户点开始。', '待确认的创建卡片', '此处需要用户操作。可以修改要求或取消。'),
        explain('用户确认后的标题和要求', '前端发送开始生成命令，接口确认本次操作。', '允许启动的草稿请求'),
        explain('已确认的写作要求', '笔记服务进入草稿流程，先生成并展示大纲。', 'Docker 入门的大纲', '用户可以查看和调整大纲，再推进章节生成。'),
        explain('主题 + 要求 + 大纲或当前章节上下文', '选用大纲或章节模板，组织这一次模型请求。', '范围明确的写作提示'),
        explain('当前大纲或章节的写作提示', '模型生成本次请求所需的结构或正文。', '候选大纲或章节文字', '整篇笔记通常经过多次模型调用。'),
        explain('模型返回的候选文字', '笔记服务接收内容，放回对应草稿章节。', 'Docker 入门的候选章节'),
        explain('剩余章节与生成要求', '安排后台草稿任务，继续推进章节生成。', '可以推进、停止或重试的任务'),
        explain('已生成章节 + 当前任务状态', '将草稿内容与进度持久保存到项目数据库。', '可继续处理的草稿和进度', '停止或某节失败时，已生成章节仍可保留。'),
        explain('当前草稿与章节状态', '前端展示可审阅的内容，用户可以编辑后决定保存。', '等待确认的 Docker 入门草稿', '未完成的章节会显示真实状态。'),
        explain('用户确认保存的草稿', '前端发起保存到笔记的明确操作。', '采用当前草稿的保存请求'),
        explain('保存请求 + 草稿与生成任务', '笔记服务检查归属、内容和任务状态。', '可以提交的正式内容'),
        explain('确认后的正文', '在数据库事务里写入正式笔记并安排索引任务。', '正式正文 + 版本 + 索引待办'),
        explain('待提交的正式笔记数据', '数据库提交成功，返回笔记标识和版本。', '已保存的笔记 ID 与版本'),
        explain('笔记 ID + 正文 + 保存版本', '前端打开新笔记，显示已保存的内容。', '可编辑的「Docker 入门」', '检索索引随后在后台更新。')
      ]
    },
    chat: {
      title: '普通聊天', example: '问“容器是什么？”；已有偏好“先给整体图”', artifact: '容器是什么？',
      phases: [phase('接收并记录本轮', 3, '建立本轮运行'), phase('判断回答方式', 8, '得到有效回答计划'), phase('读取相关记忆', 15, '得到本轮可用偏好'), phase('组织并返回答案', 18, '前端逐段显示回答')],
      steps: [
        explain('“容器是什么？” + 近期聊天', '前端把问题与当前页面信息发送到已认证接口。', '带账号身份的问题'),
        explain('账号 + 会话 + 本轮问题', '为这轮聊天建立运行记录。', '本轮运行编号'),
        explain('运行编号与当前状态', '将运行状态和需要的检查点保存到项目数据库。', '可追踪的本轮状态'),
        explain('普通对话模式 + 用户问题', '把请求交给任务判断，决定回答需要哪些资料。', '待识别的问题'),
        ...planning('普通回答，并申请个人记忆'),
        explain('有效计划 + 用户问题', '资料组织接收回答任务，准备本轮上下文。', '需要资料的回答任务'),
        explain('问题 + 账号 + 本轮允许的范围', '向记忆管理申请与当前问题相关的个人记忆。', '受账号和范围约束的记忆查询'),
        explain('账号下的记忆开关与来源状态', '检查这轮能否使用记忆，以及哪些来源仍有效。', '本轮可用的读取条件'),
        explain('问题 + 允许的记忆范围', '通过统一接口申请相关事实。', '项目格式的召回请求'),
        explain('统一召回请求', '适配器转换查询，交给该账号的 Hindsight 记忆库。', '引擎内的相关事实查询'),
        explain('“容器是什么？”对应的检索结果', '引擎返回相关事实和原生状态。', '可能包含“先给整体图”的候选事实'),
        explain('引擎原生事实与状态', '适配器转换为项目统一的内容、来源和状态字段。', '可由项目检查的统一事实'),
        explain('候选事实 + 当前来源控制信息', '过滤停用、待确认、已删和不适用的内容。', '本轮可参考的“先给整体图”偏好', '可选记忆读取失败时，可以不带记忆继续回答。'),
        explain('问题 + 近期聊天 + 可用偏好', '将资料按回答规则组织成模型消息。', '带本轮上下文的回答提示'),
        explain('组织后的问题和上下文', '模型按要求生成关于容器的解释。', '逐步生成的回答文字'),
        explain('回答片段', '经后端接口流式返回，前端逐段显示。', '用户看到容器的解释', '是否保存新的记忆，由后续规则另行决定。')
      ]
    },
    qa: {
      title: '全库问答', example: '从自己的笔记里查“Docker 镜像和容器有什么区别？”', artifact: '镜像与容器有什么区别？',
      phases: [phase('确定查笔记', 3, '进入本人笔记问答'), phase('查找并整理依据', 7, '拿到带来源的片段'), phase('据此回答', 11, '答案附上可查看来源')],
      steps: [
        explain('全库模式 + 镜像与容器的问题', '接口确认账号，接收只查本人笔记的请求。', '带检索范围的问题'),
        explain('已选择的全库模式', '程序直接采用本人笔记检索计划。', '固定的知识库查询计划'),
        explain('固定计划 + 用户问题', '资料组织进入需要笔记证据的回答流程。', '待查找的笔记依据'),
        explain('查询问题 + 当前账号范围', '向检索模块申请相关笔记片段。', '限定范围的检索请求'),
        explain('问题和可读取的来源范围', '读取标题、词项和向量索引中的候选。', '候选片段与来源状态'),
        explain('数据库查询结果', '把本人有效笔记中的候选片段交回检索模块。', '可能相关的镜像、容器笔记片段'),
        explain('多路检索得到的片段', '融合排序并检查来源，给可用片段分配引用编号。', '有顺序、有来源编号的依据', '找不到可用来源时，直接说明未找到。'),
        explain('用户问题 + 近期聊天 + 有效片段', '组合严格按笔记回答的提示和引用规则。', '带证据的模型请求'),
        explain('问题、片段和引用编号', '模型据此组织解释并标出所用依据。', '带引用编号的候选答案'),
        explain('候选答案 + 可用引用编号', '检查答案引用是否对应本轮提供的来源。', '经过引用检查的回答'),
        explain('回答和来源信息', '经接口返回，前端同时提供笔记来源入口。', '可以回到原笔记核对的答案')
      ]
    },
    save: {
      title: '手动保存', example: '把「Docker 入门」的一段解释改得更清楚', artifact: 'Docker 入门 · 新正文',
      phases: [phase('检查并保存正文', 7, '界面确认正文已保存'), phase('后台更新检索', 11, '新内容随后可被检索')],
      steps: [
        explain('新正文 + 笔记编号 + 编辑时的版本', '前端发送修改和预期版本，接口确认账号。', '带版本信息的保存请求'),
        explain('已认证的保存请求', '直接交给笔记保存服务。', '待保存的新正文'),
        explain('账号与目标笔记编号', '读取本人当前保存的笔记正文和版本。', '数据库中的当前原文'),
        explain('当前原文版本 + 前端预期版本', '比较两者是否匹配，再决定能否继续保存。', '允许保存，或返回冲突', '发现冲突时保留本地修改。多设备原子并发保护仍待完善。'),
        explain('允许提交的新正文', '将正文、旧版本和后台索引待办一起提交。', '正式内容 + 历史版本 + 索引任务'),
        explain('待提交的数据', '数据库提交成功，交回新的保存版本。', '正文保存确认'),
        explain('服务端确认的保存版本', '前端更新保存状态，清理已获确认的本地修改。', '界面显示“已保存”', '此时检索索引可能仍在排队。'),
        explain('已保存版本对应的索引待办', '后台领取任务，读取需要处理的正文。', '待分段和索引的正文'),
        explain('正文分段得到的文本片段', '调用嵌入模型，把各片段转换为检索向量。', '生成向量的模型请求'),
        explain('嵌入模型的返回值', '按片段接收向量，准备索引写入。', '片段与向量的对应关系'),
        explain('片段 + 向量 + 来源版本', '写入可检索的派生内容并记录来源版本。', '更新后的搜索索引', '正式正文以笔记数据为准，索引可以重建。')
      ]
    },
    preview: {
      title: '修改预览', example: '把「Docker 入门」中的容器解释改得更通俗', artifact: '容器解释 · 修改预览',
      phases: [phase('定位并生成候选', 7, '独立保存一份修改预览'), phase('审阅并应用', 13, '确认后写回正式正文')],
      steps: [
        explain('笔记编号 + 修改范围 + “更通俗”的要求', '从预览入口发出明确的修改请求。', '带范围的修改命令'),
        explain('当前账号和修改目标', '笔记服务确定用户可访问的原文和范围。', '可读取的修改目标'),
        explain('目标笔记或章节编号', '读取原文内容及当前版本。', '待修改原文 + 版本指纹'),
        explain('目标原文 + 修改要求', '把允许修改的范围和写作规则组织成提示。', '限定范围的改写请求'),
        explain('改写提示中的原文和要求', '模型生成更通俗的候选文字。', '待检查的修改结果'),
        explain('模型返回的修改结果', '检查定位、格式和空内容等问题。', '通过检查的候选修改', '验证失败时停止处理并返回错误。'),
        explain('候选稿 + 原文版本指纹', '独立保存修改预览，供用户继续审阅。', '一份可审阅的预览记录'),
        explain('候选修改与对应原文', '前端显示预览，用户可以编辑、继续调整或取消。', '等待用户确认的候选稿'),
        explain('用户点击应用的当前候选稿', '前端发送明确采用这份预览的请求。', '应用修改命令'),
        explain('应用命令 + 当前原文状态', '锁定并复查预览、原文指纹和重复应用状态。', '允许提交的修改', '原文已变化时阻止直接应用，保留候选供处理。'),
        explain('检查通过的候选内容', '写入正文、历史版本、索引待办和应用状态。', '已应用的正文与历史记录'),
        explain('待提交的修改数据', '数据库提交成功，再交回笔记与版本。', '应用成功的保存结果'),
        explain('正式正文和新版本', '前端显示已应用内容，索引随后后台更新。', '更新后的 Docker 入门')
      ]
    },
    quick: {
      title: '选区快捷修改', example: '选中容器的一句话，要求“加一个生活中的比喻”', artifact: '容器解释 · 选中文字',
      phases: [phase('生成选区候选', 6, '在选区旁审阅候选'), phase('采用并保存', 12, '替换选区后确认保存')],
      steps: [
        explain('选中文字 + “加一个生活中的比喻”', '前端保存选区位置，向快捷改写接口发送文字和意见。', '限定选区的改写请求'),
        explain('账号、笔记编号和所选内容', '后端验证笔记归属，进入选区改写服务。', '允许处理的选区文字'),
        explain('所选 Markdown + 修改意见 + 可选旧候选', '组合保留原意和范围约束的改写提示。', '一段限定范围的模型输入'),
        explain('选区文字和改写规则', '模型生成或继续调整这一段候选。', '带生活比喻的候选解释'),
        explain('生成的候选解释', '接口取得候选文字，准备返回编辑器。', '候选文本'),
        explain('候选文本', '前端在选区附近展示，等待采用、继续调整或取消。', '尚待采用的候选', '这里的后端不会建立服务器修改预览。'),
        explain('用户点击采用 + 编辑器保存的选区位置', '确认原文仍匹配后，用编辑器事务替换准确位置。', '编辑器里的新正文', '可以一步撤销；原文变化会阻止直接采用。'),
        explain('替换后的正文 + 编辑时的预期版本', '编辑器另发普通自动保存请求。', '等待服务端确认的保存'),
        explain('普通保存请求', '进入笔记保存服务并检查当前数据。', '待提交的正文', '冲突或失败时保留本地输入。'),
        explain('允许提交的正文', '提交正文、历史版本和后台索引任务。', '正式正文和索引待办', '多设备原子并发保护仍待完善。'),
        explain('数据库提交结果', '把正文已保存的结果交回接口。', '服务器保存确认'),
        explain('保存确认', '前端显示已保存，检索索引继续后台处理。', '保存后的新解释')
      ]
    },
    remember: {
      title: '保存记忆', example: '“请记住，我希望解释时先给整体图”', artifact: '解释偏好 · 先给整体图',
      phases: [phase('理解记忆要求', 6, '得到用户明确原话'), phase('检查并排队', 10, '有效来源进入后台'), phase('整理并写回状态', 16, '引擎事实与来源状态就位')],
      steps: [
        explain('“请记住，我希望解释时先给整体图”', '接口确认账号，接收明确的记忆请求。', '带身份的原话'),
        explain('用户原话与当前对话', '任务判断准备识别这个保存记忆的命令。', '待识别的记忆请求'),
        ...planning('保存稳定偏好'),
        explain('有效的记忆计划 + 用户原话', '把用户明确说出的内容交给记忆管理。', '待检查的记忆来源'),
        explain('账号下的开关、规则和来源代数', '读取保存条件，确定这次来源是否允许处理。', '当前保存规则'),
        explain('允许保存的原话与来源信息', '完成安全和去重检查，在同一事务保存来源与待办。', '来源记录 + 持久任务', '这里只完成排队，事实整理随后执行。'),
        explain('数据库中的待办来源', '后台领取可以执行的记忆任务。', '待处理的用户原话'),
        explain('领取的任务 + 当前规则与来源状态', '再次确认开关、规则版本和来源仍然有效。', '允许继续整理的来源', '已过期、已删除或规则不匹配的来源会跳过。'),
        explain('有效来源 + 原话 + 当前提取规则', '通过统一接口提交整理请求。', '项目格式的记忆写入请求'),
        explain('统一写入请求', '适配器转换字段，将规则和来源发送到 Hindsight。', '引擎中的来源文档'),
        explain('来源原话与提取规则', '引擎提取偏好、实体及适用关系，写入自己的数据库。', '可能形成“先给整体图”的事实'),
        explain('引擎完成的整理结果', '把提取事实及状态交回适配器。', '引擎返回的事实或空结果', '人工保护规则可能使结果需要进一步确认。'),
        explain('引擎事实与原生状态', '转换成项目统一结果，交给后台任务收尾。', '完成、空结果或可重试结果'),
        explain('整理结果和来源编号', '将本次来源的处理状态写回项目数据库。', '可管理、可重试的来源状态', '项目数据库负责来源控制，事实与关系由引擎保存。')
      ]
    }
  };

  const attachmentTitles=['接收上传请求','把文件保存到存储','给附件建一条记录','确认附件记录已保存','在页面显示附件'];
  flows.attachment.steps.forEach((step,index)=>{step.title=attachmentTitles[index];});
  flows.attachment.steps[1].fields=[['文件','架构草图.png'],['保存到','账号目录 / 附件标识.png']];
  flows.attachment.steps[2].fields=[['名称','架构草图.png'],['位置','账号目录 / 附件标识.png'],['归属','当前账号']];
  flows.create.steps[5].fields=[['标题','Docker 入门'],['要求','先讲概念，再给示例']];
  flows.create.steps[13].fields=[['内容','已生成的章节'],['状态','候选草稿']];
  flows.create.steps[17].fields=[['正文','Docker 入门'],['状态','正式笔记'],['后续','后台更新索引']];
  flows.chat.steps[14].fields=[['偏好','解释时先给整体图'],['范围','当前账号的相关问题']];
  flows.qa.steps[6].fields=[['示例来源','Docker 入门'],['示例片段','镜像是模板，容器是基于镜像运行的实例。'],['用途','回答依据']];
  flows.create.steps[8].fields=[['示例大纲','概念 → 安装 → 基础操作 → 示例']];
  flows.quick.steps[0].input='选中“容器让应用在隔离环境中运行” + “加一个生活中的比喻”';
  flows.quick.steps[3].fields=[['示例候选','容器像给应用一个独立的小房间，里面准备好所需环境。']];
  flows.quick.steps[6].fields=[['编辑器','选区已替换'],['服务端','等待保存确认']];
  flows.remember.steps[7].fields=[['来源','用户明确说出的偏好'],['状态','待后台整理']];

  const icons = {
    ui: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M9 9v11"/>',
    api: '<path d="M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
    router: '<path d="M6 4v12a4 4 0 004 4h8M6 10h8a4 4 0 004-4V4M15 17l3 3-3 3M15 7l3-3 3 3"/>',
    notes: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"/>',
    context: '<path d="M4 4h6l2 2 2-2h6v16h-6l-2 2-2-2H4zM12 6v16"/>',
    prompt: '<path d="M8 3H6v6l-3 3 3 3v6h2M16 3h2v6l3 3-3 3v6h-2M10 9h4M10 15h4"/>',
    model: '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
    storage: '<path d="M3 7h7l2 3h9v10H3zM3 7V4h7l2 3"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
    files: '<path d="M8 12l7-7a4 4 0 016 6L10 22a5 5 0 01-7-7L14 4M7 15l9-9"/>',
    memory: '<circle cx="12" cy="12" r="4"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4"/>',
    worker: '<path d="M4 5h16M4 12h12M4 19h8M17 15l4 4-4 4"/>',
    runtime: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    adapter: '<path d="M4 8h6V4M20 16h-6v4M4 8l6-4M20 16l-6 4M4 8l12 12M20 16L8 4"/>',
    hindsight: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="19" r="3"/><path d="M9 6h6M7 9l4 7M17 9l-4 7"/>'
  };
  const shortNames = {ui:'前端',api:'接口与登录检查',router:'任务判断',notes:'笔记服务',context:'回答与资料',index:'检索与索引',prompt:'提示词拼装',model:'AI 模型',memory:'记忆管理',worker:'记忆后台任务',adapter:'记忆适配接口',hindsight:'Hindsight',runtime:'任务与检查点',db:'项目数据库',files:'附件服务',storage:'文件存储'};
  const icon = id => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[id]||icons.context}</svg>`;
  const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function create({root, scenarios, nodes, details, selectStep}) {
    const host = root.querySelector('#nf-map-operation');
    const nodeMap = new Map(nodes.map(node=>[node.id,node]));
    const reduced = matchMedia('(prefers-reduced-motion:reduce)');
    let scenario = '', selected = -1, activePhase = -1, packetAnimation = null;
    let edges = [], diagram, svg, positions = new Map();
    const ns = 'http://www.w3.org/2000/svg';
    const make = (tag,attrs={}) => {
      const el=document.createElementNS(ns,tag);
      for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));
      return el;
    };
    for(const [key,flow] of Object.entries(flows)) {
      if(flow.steps.length!==scenarios[key].steps.length || flow.phases.at(-1).end!==flow.steps.length)throw new Error(`Walkthrough length mismatch: ${key}`);
    }
    const getPhase = step => flows[scenario].phases.findIndex(phase=>step<phase.end);
    const stopPacket = () => {if(packetAnimation)cancelAnimationFrame(packetAnimation);packetAnimation=null;};

    function build(key) {
      scenario=key;activePhase=-1;selected=-1;
      const flow=flows[key];
      host.dataset.flowTitle=flow.title;
      host.dataset.flowExample=flow.example;
      host.innerHTML=`<nav class="flow-phases" aria-label="操作的完整阶段">${flow.phases.map((phase,index)=>`<button type="button" data-flow-phase="${index}"><span class="flow-phase-number">${String(index+1).padStart(2,'0')}</span><span><strong>${esc(phase.title)}</strong><small>第 ${index?flow.phases[index-1].end+1:1}–${phase.end} 步</small></span><span class="flow-phase-arrow" aria-hidden="true">→</span></button>`).join('')}</nav>
        <section class="flow-stage"><header class="flow-stage-heading"><div><h3 data-flow-phase-title></h3><p data-flow-phase-outcome></p></div><span class="flow-stage-count"></span></header>
          <div class="flow-stage-layout"><div class="flow-graph-column"><div class="flow-diagram"><svg class="flow-wires" role="group" aria-label="模块之间的操作流向"></svg><div class="flow-nodes"></div></div><div class="flow-wire-legend"><i></i>当前流向<span>点箭头编号或步骤查看</span></div><div class="flow-step-list" role="group" aria-label="本阶段的具体步骤"></div></div>
          <div class="flow-inspector-stack" aria-live="polite" aria-atomic="true"></div></div></section>`;
      diagram=host.querySelector('.flow-diagram');svg=host.querySelector('.flow-wires');
      host.querySelector('.flow-inspector-stack').innerHTML=flow.steps.map((story,index)=>{
        const step=scenarios[key].steps[index],point=details.traces[key][index],module=nodeMap.get(point.module);
        return `<article class="flow-inspector" data-flow-story="${index}" aria-hidden="true"><div class="flow-inspector-meta"><span>第 ${index+1} 步</span>${step.waitForUser?'<span class="flow-wait-tag">等待你确认</span>':''}</div><h3>${esc(story.title||step.title)}</h3><div class="flow-transfer"><span>${esc(shortNames[step.from])}</span><span aria-hidden="true">→</span><span>${esc(shortNames[step.to])}</span></div>
          <div class="flow-data-in"><span class="flow-data-label">收到</span><p>${esc(story.input)}</p></div><div class="flow-treatment"><span class="flow-data-label">这一步</span><p>${esc(story.action)}</p></div><div class="flow-data-out"><span class="flow-data-label">得到</span><p>${esc(story.output)}</p>${story.fields?`<dl>${story.fields.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`:''}</div>
          <details class="flow-implementation"><summary>原因、实现与边界</summary>${story.note?`<p>${esc(story.note)}</p>`:''}<p>${esc(module.note)}</p><small>涉及实现</small>${module.sources.map(source=>`<code>${esc(source)}</code>`).join('')}</details></article>`;
      }).join('');
      host.querySelector('.flow-phases').hidden=flow.phases.length===1;
      for(const button of host.querySelectorAll('[data-flow-phase]'))button.addEventListener('click',()=>{
        const index=Number(button.dataset.flowPhase);selectStep(index?flow.phases[index-1].end:0);
      });
      observer.observe(diagram);
    }

    function buildPhase(index) {
      const flow=flows[scenario],phase=flow.phases[index];
      const start=index?flow.phases[index-1].end:0;
      const steps=scenarios[scenario].steps.slice(start,phase.end);
      const ids=[...new Set(steps.flatMap(step=>[step.from,step.to]))];
      if(scenario==='attachment')ids.push('storage');
      activePhase=index;
      const maximumNodes=Math.max(...flow.phases.map((phase,i)=>new Set(scenarios[scenario].steps.slice(i?flow.phases[i-1].end:0,phase.end).flatMap(step=>[step.from,step.to])).size+(scenario==='attachment'?1:0)));
      diagram.style.setProperty('--flow-max-rows',Math.ceil(maximumNodes/2));
      diagram.style.setProperty('--flow-max-nodes',maximumNodes);
      host.querySelector('[data-flow-phase-title]').textContent=phase.title;
      host.querySelector('[data-flow-phase-outcome]').textContent=phase.outcome;
      host.querySelector('.flow-stage-count').textContent=`${ids.length} 个参与模块`;
      host.querySelector('.flow-nodes').innerHTML=ids.map((id,i)=>`<button type="button" class="flow-node" data-flow-module="${id}" style="--flow-order:${i}">${icon(id)}<span>${esc(shortNames[id])}<small>${esc(id==='storage'?'磁盘 / 挂载卷':id==='db'?'PostgreSQL':nodeMap.get(id).type.split(' · ').at(0))}</small></span></button>`).join('');
      host.querySelector('.flow-step-list').innerHTML=steps.map((step,i)=>`<button type="button" data-flow-step="${start+i}" aria-current="false"><span>${start+i+1}</span>${esc(flow.steps[start+i].title||step.title)}${step.waitForUser?'<i aria-label="等待确认">●</i>':''}</button>`).join('');
      for(const button of host.querySelectorAll('[data-flow-step]'))button.addEventListener('click',()=>selectStep(Number(button.dataset.flowStep)));
      for(const button of host.querySelectorAll('[data-flow-module]'))button.addEventListener('click',()=>{
        const id=button.dataset.flowModule;
        const local=steps.findIndex(step=>step.to===id||(id==='storage'&&step.to==='files'));
        selectStep(start+(local<0?0:local));
      });
      edges=[];
      for(const [i,step] of steps.entries()){
        const existing=edges.find(edge=>edge.from===step.from&&edge.to===step.to);
        if(existing)existing.steps.push(start+i);else edges.push({from:step.from,to:step.to,steps:[start+i]});
      }
      if(scenario==='attachment')edges.push({from:'files',to:'storage',steps:[1],component:true});
    }

    function connection(edge,index,width) {
      const a=positions.get(edge.from),b=positions.get(edge.to);
      const reverse=edges.some(other=>other.from===edge.to&&other.to===edge.from);
      if(edge.from===edge.to){
        const x=a.x+a.w,y=a.y+a.h/2;
        return {d:`M ${x} ${y-14} C ${x+34} ${y-45},${x+34} ${y+45},${x} ${y+14}`,label:[x+25,y]};
      }
      if(Math.abs(a.y-b.y)<2&&Math.abs(a.x-b.x)<a.w+100){
        const right=b.x>a.x,shift=reverse?(right?-17:17):0;
        const x1=right?a.x+a.w:a.x,x2=right?b.x:b.x+b.w,y=a.y+a.h/2+shift;
        return {d:`M ${x1} ${y} L ${x2} ${y}`,label:[(x1+x2)/2,y]};
      }
      const down=b.y>a.y;
      if(Math.abs(a.x-b.x)<2&&Math.abs(a.y-b.y)<a.h+100){
        const shift=reverse?(down?-20:20):0,x=a.x+a.w/2+shift,y1=down?a.y+a.h:a.y,y2=down?b.y:b.y+b.h;
        return {d:`M ${x} ${y1} L ${x} ${y2}`,label:[x,(y1+y2)/2]};
      }
      const lane=index%2?width-14-(index%4)*3:14+(index%4)*3;
      const x1=a.x+a.w/2,x2=b.x+b.w/2,y1=down?a.y+a.h:a.y,y2=down?b.y:b.y+b.h;
      const turn1=y1+(down?18:-18),turn2=y2+(down?-18:18);
      return {d:`M ${x1} ${y1} L ${x1} ${turn1} L ${lane} ${turn1} L ${lane} ${turn2} L ${x2} ${turn2} L ${x2} ${y2}`,label:[lane,(turn1+turn2)/2]};
    }

    function draw(animate=false) {
      stopPacket();if(host.hidden||!diagram?.clientWidth)return;
      const focusedStep=svg.contains(document.activeElement)?document.activeElement.dataset.flowEdgeStep:undefined;
      const columns=diagram.clientWidth>=600?3:2;
      host.querySelector('.flow-nodes').style.gridTemplateColumns=`repeat(${columns},minmax(0,1fr))`;
      diagram.style.setProperty('--flow-max-rows',Math.ceil(Number(diagram.style.getPropertyValue('--flow-max-nodes'))/columns));
      const base=diagram.getBoundingClientRect();positions=new Map();
      for(const el of host.querySelectorAll('[data-flow-module]')){
        const rect=el.getBoundingClientRect();positions.set(el.dataset.flowModule,{x:rect.x-base.x,y:rect.y-base.y,w:rect.width,h:rect.height});
      }
      svg.setAttribute('viewBox',`0 0 ${diagram.clientWidth} ${diagram.clientHeight}`);svg.replaceChildren();
      const defs=make('defs');
      for(const state of ['base','done','current']){
        const marker=make('marker',{id:`nf-flow-arrow-${state}`,viewBox:'0 0 8 8',refX:7,refY:4,markerWidth:5,markerHeight:5,orient:'auto'});
        marker.append(make('path',{d:'M0 0L8 4L0 8Z',class:`flow-arrow-${state}`}));defs.append(marker);
      }
      svg.append(defs);
      const labels=[];let activePath;
      for(const edge of edges.slice().sort((a,b)=>Number(a.steps.includes(selected))-Number(b.steps.includes(selected)))){
        const index=edges.indexOf(edge),{d,label}=connection(edge,index,diagram.clientWidth);
        const state=edge.steps.includes(selected)?'current':edge.steps.every(step=>step<selected)?'done':'base';
        const path=make('path',{d,class:`flow-edge flow-edge-${state}${edge.component?' flow-edge-component':''}`,'marker-end':`url(#nf-flow-arrow-${state})`,'data-flow-from':edge.from,'data-flow-to':edge.to});
        svg.append(path);if(state==='current'&&!edge.component)activePath=path;
        const hit=make('path',{d,class:'flow-edge-hit','aria-hidden':'true'});
        hit.addEventListener('click',()=>selectStep(edge.steps.find(step=>step>=selected)??edge.steps[0]));
        svg.append(hit);
        if(edge.component)continue;
        const badgeWidth=24,badgeHeight=edge.steps.length*23+1;
        const candidates=[label,...Array.from({length:25},(_,index)=>{
          const point=path.getPointAtLength(path.getTotalLength()*(index+1)/26);return[point.x,point.y];
        })];
        const fits=([x,y])=>{
          if(x-badgeWidth/2<2||x+badgeWidth/2>diagram.clientWidth-2||y-badgeHeight/2<2||y+badgeHeight/2>diagram.clientHeight-2)return false;
          if([...positions.values()].some(rect=>x+badgeWidth/2>rect.x-3&&x-badgeWidth/2<rect.x+rect.w+3&&y+badgeHeight/2>rect.y-3&&y-badgeHeight/2<rect.y+rect.h+3))return false;
          return !labels.some(box=>Math.abs(box.x-x)<(box.width+badgeWidth)/2+3&&Math.abs(box.y-y)<(box.height+badgeHeight)/2+3);
        };
        const [x,y]=candidates.find(fits)||label;
        labels.push({x,y,width:badgeWidth,height:badgeHeight,edge,state});
      }
      for(const {x,y,width,height,edge,state} of labels){
        const group=make('g',{class:`flow-edge-label flow-edge-label-${state}`,transform:`translate(${x-width/2} ${y-height/2})`});
        edge.steps.forEach((step,index)=>{
          const badge=make('g',{transform:`translate(0 ${index*23})`,role:'button',tabindex:'0','data-flow-edge-step':step,'aria-label':`第 ${step+1} 步 ${flows[scenario].steps[step].title||scenarios[scenario].steps[step].title}`});
          badge.append(make('rect',{x:0,y:0,width:24,height:24,rx:7}));
          const text=make('text',{x:12,y:16,'text-anchor':'middle'});text.textContent=step+1;badge.append(text);
          if(step===selected)badge.setAttribute('aria-current','step');
          badge.addEventListener('click',()=>selectStep(step));
          badge.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectStep(step);}});
          group.append(badge);
        });svg.append(group);
      }
      if(activePath){
        const packet=make('circle',{r:3.5,class:'flow-packet'});svg.append(packet);
        const length=activePath.getTotalLength(),end=activePath.getPointAtLength(length);
        packet.setAttribute('cx',end.x);packet.setAttribute('cy',end.y);
        if(animate&&!reduced.matches&&root.dataset.motion!=='off'){
          const started=performance.now();
          const tick=now=>{
            const portion=Math.min(1,(now-started)/1400),point=activePath.getPointAtLength(length*portion);
            packet.setAttribute('cx',point.x);packet.setAttribute('cy',point.y);
            if(portion<1)packetAnimation=requestAnimationFrame(tick);else packetAnimation=null;
          };packetAnimation=requestAnimationFrame(tick);
        }
      }
      if(focusedStep!==undefined){
        const target=svg.querySelector(`[data-flow-edge-step="${focusedStep}"]`)||svg.querySelector(`[data-flow-edge-step="${selected}"]`);
        target?.focus({preventScroll:true});
      }
    }
    const observer=new ResizeObserver(()=>draw(false));
    host.addEventListener('click',event=>{
      const summary=event.target.closest('.flow-implementation > summary');
      if(summary&&!summary.parentElement.open)selectStep(selected);
    });
    root.addEventListener('nf:motionchange',()=>draw(false));
    reduced.addEventListener('change',()=>draw(false));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPacket();});
    return {
      update(state){
        if(state.scenario==='overview'){host.hidden=true;stopPacket();return;}
        host.hidden=false;
        if(scenario!==state.scenario){if(diagram)observer.unobserve(diagram);build(state.scenario);}
        const phase=getPhase(Math.max(0,state.step));
        if(phase!==activePhase)buildPhase(phase);
        const changed=selected!==state.step;selected=state.step;
        for(const button of host.querySelectorAll('[data-flow-phase]')){
          const index=Number(button.dataset.flowPhase);
          button.setAttribute('aria-current',String(index===phase));button.dataset.complete=String(index<phase);
        }
        const step=scenarios[scenario].steps[selected];
        for(const button of host.querySelectorAll('[data-flow-module]')){
          const active=button.dataset.flowModule===step?.to||(button.dataset.flowModule==='storage'&&selected===1);
          button.dataset.active=String(active);
        }
        for(const button of host.querySelectorAll('[data-flow-step]'))button.setAttribute('aria-current',String(Number(button.dataset.flowStep)===selected));
        for(const article of host.querySelectorAll('[data-flow-story]')){
          const active=Number(article.dataset.flowStory)===selected;
          article.setAttribute('aria-hidden',String(!active));
          if(!active)for(const disclosure of article.querySelectorAll('details[open]'))disclosure.open=false;
        }
        draw(changed);
      }
    };
  }
  window.NoteFlowOperationView={create};
})();
