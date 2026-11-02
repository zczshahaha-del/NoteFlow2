// Explanatory examples only. No account data or runtime telemetry is read here.
(() => {
  const step=(id,title,body,options={})=>({id,title,body,...options});
  const branch=(id,title,from,input,to,output,steps,aside='')=>({id,title,from,input,to,output,steps,aside});
  const modules={
    ui:{purpose:'接收你的操作，保留正在编辑的内容，把回答和候选稿显示出来。',branches:[
      branch('normal','输入与显示',['user','api'],'问题、编辑内容，或后端返回的结果',['user'],'界面里的答案、候选稿或保存状态',[
        step('input','接收操作','例如：输入“解释一下容器是什么”。'),
        step('prepare','保留现场','带上本轮问题、选区或当前编辑状态；未同步输入留在本地。'),
        step('send','发给后端接口','前端通过 HTTP 发命令，通过 SSE 收回答。',{target:'api'}),
        step('receive','显示返回结果','展示答案、保存结果或候选稿；根据真实结果更新状态。')]),
      branch('quick','采用选区改写',['api'],'后端返回的候选文字',['api'],'采用后的编辑器正文，另发普通保存请求',[
        step('candidate','收到候选','候选先显示在选区旁，正式正文还没有替换。'),
        step('review','由你审阅','可采用、继续调整或取消。',{wait:true}),
        step('adopt','替换准确选区','使用编辑器保存的位置替换；保留原生撤销。'),
        step('save','触发普通保存','把采用后的正文和预期版本发给保存接口。',{target:'api'})])
    ]},
    api:{purpose:'所有浏览器请求先经过这里；确认是谁在操作，再交给对应业务。',branches:[
      branch('request','一次业务请求',['ui'],'会话凭据、操作参数和输入内容',['router','notes','memory','files'],'通过检查的账号身份和业务参数',[
        step('auth','确认登录账号','从会话确定当前用户，后续查询都带账号范围。'),
        step('validate','检查请求','检查字段、权限与入口限流；Redis 参与限流计数。'),
        step('dispatch','交给对应入口','聊天交给任务分流；保存、快捷改写、附件走各自接口。'),
        step('reply','把结果返回前端','正常结果、冲突、错误或流式回答都经接口返回。',{target:'ui'})],
        '登录失败或参数不合法 → 返回明确错误，停止这次业务操作。')
    ]},
    router:{purpose:'只为需要判断意图的请求选择路径；模型提出计划，程序负责验证。',branches:[
      branch('chat','对话中的任务判断',['api'],'用户的话、近期聊天与页面可用信息',['context','notes','memory'],'校验后的意图、目标和所需资料',[
        step('receive','接收本轮需求','例如：“把当前这段解释得更通俗”。'),
        step('ask','请求识别计划','拼识别提示词，请模型提出“回答 / 新建 / 修改 / 记忆”的计划。',{target:'prompt'}),
        step('validate','程序检查计划','检查字段、目标和模式约束；缺信息就追问。'),
        step('dispatch','进入具体业务','有效计划交给回答、笔记或记忆服务。')],
        '必要信息不全 → 追问并等待补充；识别或格式修复失败 → 返回错误，不继续写入。'),
      branch('library','全库问答的固定路径',['api'],'已选择“全库搜索”的问题',['context'],'固定的本人笔记检索计划',[
        step('fixed','程序固定计划','直接采用本人知识库检索，无需模型再判断意图。'),
        step('dispatch','进入笔记问答','交给资料组织与检索；本路径跳过个人记忆。',{target:'context'})])
    ]},
    notes:{purpose:'管理正式笔记和候选稿；不同操作走不同分支，候选内容经确认后再保存。',branches:[
      branch('save','手动保存',['api'],'新正文、笔记 ID、预期版本',['db','index'],'正式正文、历史版本和后台索引任务',[
        step('accept','接收修改','例如：把一段 Docker 解释改得更清楚。'),
        step('load','读取当前原文','在当前账号下读取目标笔记。',{target:'db'}),
        step('version','检查预期版本','比较前端编辑时的版本与当前原文。'),
        step('commit','保存正文与历史','提交新正文、旧版本和索引任务。',{target:'db'}),
        step('index','后台更新索引','保存确认先返回；检索片段随后更新。',{target:'index'})],
        '版本不匹配 → 返回冲突，前端保留修改。跨设备原子并发保护仍待完善，不能据此保证所有并发已解决。'),
      branch('create','AI 新建',['ui','router'],'标题和写作要求，例如“Docker 学习笔记，先概念后示例”',['db','index'],'确认后的正式笔记；确认前一直是草稿',[
        step('brief','确认标题与要求','先显示可编辑的创建卡片，由你点击开始。',{wait:true}),
        step('outline','生成并调整大纲','先建立结构，再由你查看或调整。',{target:'prompt'}),
        step('generate','按章节生成','把要求和本节上下文交给提示词与模型；可由后台推进。',{target:'model'}),
        step('draft','保留候选草稿','章节内容和生成状态保存在草稿中。',{target:'db'}),
        step('review','审阅并确认保存','可编辑或继续处理，明确确认才成为正式笔记。',{wait:true}),
        step('publish','保存正式笔记','写入正式正文、版本与索引任务。',{target:'db'})],
        '停止或某节失败 → 保留已生成章节；返回创建卡片不代表全文已经生成。'),
      branch('preview','AI 修改预览',['api','db'],'原文、修改范围和要求，例如“把这段解释得更通俗”',['db','ui'],'确认后的正文和旧版本；审阅期间只存独立预览',[
        step('locate','确定原文与范围','按本人笔记、选区或章节确定要改哪里。'),
        step('generate','生成候选修改','仅将目标原文与要求交给提示词、模型。',{target:'prompt'}),
        step('check','检查候选结果','校验定位、格式和空结果；不通过不改正式正文。'),
        step('candidate','保存独立预览','存候选稿与原文指纹，原文暂时保留。',{target:'db'}),
        step('review','由你审阅','可以修改、继续调整、取消或点击应用。',{wait:true}),
        step('apply','复查原文后应用','检查版本与重复应用，再写正文、旧版本和索引任务。',{target:'db'})],
        '审阅期间原文已变化 → 阻止直接应用并保留候选。取消 → 不把候选写进正式正文。'),
      branch('quick','选区快捷改写',['api'],'选中文字、修改意见和可选的当前候选稿',['ui'],'只返回候选文字，供编辑器审阅和采用',[
        step('authorize','验证笔记归属','实际选区位置由编辑器持有，后端检查可访问性。'),
        step('generate','生成限定选区的候选','初次润色或按意见继续调整，不扩大修改范围。',{target:'prompt'}),
        step('return','返回文字给编辑器','不建立服务器修改预览；采用与撤销发生在前端。',{target:'ui'})],
        '前端点击采用 → 替换选区，再另走“手动保存”分支。不能把返回候选当成保存成功。')
    ]},
    context:{purpose:'决定本次回答具体参考哪些资料，把可用内容和引用组织给模型。',branches:[
      branch('chat','普通聊天',['router'],'问题和本轮携带的近期聊天',['prompt'],'本轮问题、历史和允许使用的相关记忆',[
        step('receive','接收回答计划','普通问题不会自动检索所有笔记。'),
        step('gather','按需准备资料','记忆开启且计划需要时，向记忆管理申请相关事实。',{target:'memory'}),
        step('send','组织回答输入','把问题、近期聊天和可用记忆交给回答提示词。',{target:'prompt'})],
        '可选记忆服务失败 → 可以不带记忆继续回答；本轮不把失败当作新的记忆来源。'),
      branch('note','基于笔记回答',['router','index'],'选区、当前正文或本人笔记的检索片段',['prompt','ui'],'带依据和可查看来源的回答',[
        step('receive','确定笔记资料来源','区分选区、未保存正文和已保存笔记；全库模式只走库内检索。'),
        step('retrieve','检索需要的片段','向检索模块申请相关笔记依据。',{target:'index'}),
        step('evidence','整理依据与引用','将有效片段和来源编号送入回答提示词。',{target:'prompt'}),
        step('cite','检查回答引用','核对模型使用的引用编号，再返回答案和来源。',{target:'ui'})],
        '全库没有可用来源 → 说明未找到。本条路径跳过个人记忆召回。')
    ]},
    index:{purpose:'把正文整理成可搜索的派生数据，再按问题返回相关片段。',branches:[
      branch('build','保存后的索引更新',['db'],'已经保存的正文版本与索引任务',['db'],'可重建的片段、词项和向量',[
        step('claim','领取持久索引任务','保存成功后后台再处理，二者不是同一时点。'),
        step('chunk','解析并分段','把正文整理成适合检索的片段。'),
        step('embed','生成片段向量','将片段文本交给嵌入模型。',{target:'model'}),
        step('publish','写入有效索引','保存片段与向量，同时记录来源版本。',{target:'db'})],
        '索引是派生数据，可以重建，不能用它覆盖正式正文。'),
      branch('search','按问题检索',['context'],'问题和当前账号可读取的范围',['context'],'排好序的笔记片段与引用信息',[
        step('scope','限定账号与范围','只查询本人可访问且来源有效的内容。'),
        step('recall','多路找候选','查询标题、词项和向量索引。',{target:'db'}),
        step('rank','融合并排序','合并候选，按配置排序并核对来源版本。'),
        step('cite','返回片段和来源','让回答模块拿到可用证据。',{target:'context'})])
    ]},
    prompt:{purpose:'把当前任务的规则与资料组合成模型消息；目前这些函数仍在业务代码中。',branches:[
      branch('plan','识别任务的提示',['router'],'用户的话、近期聊天和页面可用信息',['model'],'要求返回结构化计划的模型消息',[
        step('template','选择识别规则','列出允许的意图、模式限制和输出格式。'),
        step('fill','填入当前信息','例如：“修改这段” + 当前笔记 ID + 选区预览。'),
        step('send','交给模型提出计划','返回后仍由程序验证，提示词不代替权限检查。',{target:'model'})]),
      branch('answer','组织回答的提示',['context'],'问题、近期聊天和本轮允许使用的资料',['model'],'带上下文与引用规则的回答请求',[
        step('template','选择回答规则','普通对话与严格笔记回答有不同约束。'),
        step('fill','组合问题与资料','规则 + “容器是什么？” + 相关笔记片段或可用记忆。'),
        step('send','发送模型消息','模型收到组织后的消息，不会自动读取项目数据库。',{target:'model'})]),
      branch('write','新建与修改的提示',['notes'],'主题 / 要求，或目标原文与选区',['model'],'范围明确、格式受约束的生成请求',[
        step('template','选择写作规则','区分新建、大纲、章节、初次修改与继续调整。'),
        step('fill','拼合本轮输入','规则：“保留原意” + 要求：“更通俗” + 选中原文。'),
        step('send','交给模型生成候选','候选回到笔记业务检查，不能由提示词直接授权保存。',{target:'model'})])
    ]},
    memory:{purpose:'由项目决定哪些来源能保存、哪些事实当前可以被使用。',branches:[
      branch('write','保存新记忆',['router','context'],'用户本人原话，例如“解释时先给整体图”',['db','worker'],'合法来源和持久待办；此时未必已有整理后的事实',[
        step('check','先检查能否保存','核对账号、开关、安全规则与重复来源。'),
        step('queue','保存来源并入队','在项目数据库同一事务写来源与待办。',{target:'db'}),
        step('process','交由后台整理','后台还要复查规则与来源是否仍有效。',{target:'worker'})],
        '规则不允许 / 开关关闭 → 不入队。任务完成、取消流水不会因此自动变成个人经历。'),
      branch('read','读取可用记忆',['context','db'],'查询问题、使用范围和当前来源状态',['context'],'过滤后的相关事实',[
        step('gate','检查读取条件','看记忆开关、账号范围与来源控制信息。'),
        step('recall','申请候选事实','通过统一记忆接口查询引擎。',{target:'adapter'}),
        step('filter','过滤当前不可用项','排除停用、待确认、隐藏、已删来源和不适用事实。'),
        step('output','交回回答资料','只把可用事实交给资料组织，不直接生成答案。',{target:'context'})],
        '删除先设置不可读屏障，再清理引擎；清理失败保留重试，旧来源不得复活。')
    ]},
    worker:{purpose:'把记忆整理放到持久后台任务里，避免阻塞主回答。',branches:[
      branch('write','处理记忆待办',['db'],'来源编号、原话、规则版本和当前记忆批次',['adapter','db'],'整理请求和可重试的来源处理状态',[
        step('claim','领取待办','从数据库领取，而非仅靠进程内存排队。'),
        step('recheck','再次检查有效性','开关、规则版本、记忆批次或删除状态变化就跳过。',{target:'memory'}),
        step('send','调用记忆引擎接口','发送有效来源与当前提取规则。',{target:'adapter'}),
        step('settle','写回处理结果','记录完成、空结果或重试；来源状态仍由项目保存。',{target:'db'})],
        '当前 worker 随 FastAPI 同进程启动。失败可重试，已过期或已删除的来源不再执行。')
    ]},
    adapter:{purpose:'让项目用统一的记忆对象，不需要理解 Hindsight 的原生字段和状态。',branches:[
      branch('read','召回和管理结果',['memory'],'账号内的记忆查询或管理请求',['memory'],'项目统一的事实、来源或图谱',[
        step('request','调用引擎接口','把项目请求转换为 Hindsight 所需格式。',{target:'hindsight'}),
        step('normalize','转换返回字段','原生 text / 状态等转换为项目的 content / status。'),
        step('respond','交回统一结果','之后仍由记忆管理检查来源与当前可用性。',{target:'memory'})]),
      branch('write','提交来源原文',['worker'],'原话、来源 ID 和提取规则',['hindsight','worker'],'引擎写入结果或安全错误',[
        step('request','接收项目契约','调用方无需携带厂商专有字段。'),
        step('convert','适配到当前引擎','配置账号库并提交来源。',{target:'hindsight'}),
        step('respond','归一化处理结果','不把厂商原始状态直接交给业务。',{target:'worker'})],
        '当前正式事实引擎只有 Hindsight；旧 Mem0 索引兼容路径不是可直接互换的第二个正式引擎。')
    ]},
    model:{purpose:'接收明确输入并生成计划、文字或向量；项目数据的读写仍由业务代码负责。',branches:[
      branch('text','计划、回答与写作',['prompt'],'已经拼好的模型消息',['caller'],'结构化计划、回答或候选文字',[
        step('receive','接收模型消息','看得到的资料来自本轮请求，不会自动看到全部笔记。'),
        step('generate','按用途生成结果','识别计划、回答和写作是不同调用角色。'),
        step('respond','回到业务程序校验','可流式返回；生成候选不等于正文已经保存。')]),
      branch('embed','索引的嵌入模型',['index'],'待检索的正文片段文本',['index'],'对应片段的向量',[
        step('receive','接收片段文本','不是向聊天模型发送写作提示。'),
        step('generate','计算向量表示','为后续相似内容检索提供派生数据。'),
        step('respond','交回索引模块','由索引模块保存向量和来源版本。',{target:'index'})])
    ]},
    files:{purpose:'保存附件本体，并把可访问位置和归属记录到项目数据库。',branches:[
      branch('upload','上传附件',['api'],'文件内容与已认证账号',['db','api'],'磁盘 / 卷里的文件，以及数据库里的位置和归属',[
        step('validate','检查上传与权限','由附件服务验证请求。'),
        step('write','写入实际文件','调用文件存储实现，文件本体在磁盘或挂载卷。'),
        step('metadata','提交文件记录','数据库保存名称、位置、大小和账号归属。',{target:'db'}),
        step('return','返回访问结果','后续读取附件仍检查权限。',{target:'api'})],
        '文件与 SQL 不能一起回滚，失败后的清理 / 补偿仍待完善。只交换两步顺序不能消除这个窗口。')
    ]},
    runtime:{purpose:'记录一项工作进行到哪里，帮助追踪、等待和恢复；不代替笔记正文。',branches:[
      branch('run','任务进度与后台执行',['api','notes'],'本轮运行身份、计划或章节生成任务',['db'],'运行状态、图检查点和生成进度',[
        step('start','建立运行记录','记录本轮 runId 与会话，区别于长期记忆。'),
        step('checkpoint','保存流程位置','LangGraph 可记录节点和等待位置。'),
        step('worker','推进后台章节生成','草稿 worker 按实际业务状态执行章节任务。'),
        step('record','持久化进度','状态、检查点与草稿进度写入项目数据库。',{target:'db'})],
        '并非所有接口都走 LangGraph。完整执行追踪、任务恢复语义及部分故障窗口仍待完善。')
    ]},
    hindsight:{purpose:'按规则把来源原话整理成事实与关系，并提供相关记忆的候选召回。',branches:[
      branch('write','整理来源',['adapter'],'来源原话、来源 ID 与提取规则',['adapter'],'引擎中的事实、关系和来源原文',[
        step('receive','接收来源与规则','按当前账号隔离，并使用“要记什么”的提取规则。'),
        step('extract','整理事实和关系','例如从原话提取“解释偏好：先给整体图”。'),
        step('store','写入引擎自己的数据库','这里存事实与关系；项目数据库另管来源状态。'),
        step('return','交回整理结果','可能没有可用事实，也可能需要人工确认。',{target:'adapter'})]),
      branch('read','召回候选记忆',['adapter'],'该账号内的查询问题',['adapter'],'相关候选事实，尚需项目再次过滤',[
        step('receive','接收查询','查询只限当前账号库。'),
        step('query','检索相关事实','从自己保存的事实与关系中召回候选。'),
        step('return','交给适配器转换','由项目记忆管理决定哪些现在能用。',{target:'adapter'})])
    ]},
    db:{purpose:'持久保存项目自己的数据；不同业务读写不同表，不是所有请求的最后一步。',branches:[
      branch('write','写入项目数据',['notes','runtime','memory','index','files'],'正文 / 草稿，运行进度，规则 / 来源 / 队列，索引或附件元数据',['caller'],'提交成功后的数据与版本信息',[
        step('prepare','按业务组织写入','正式正文、候选稿、记忆控制和索引用不同表承担职责。'),
        step('commit','提交数据库事务','成功后才可以确认对应的 SQL 数据已保存。'),
        step('return','返回提交结果','业务接口再通知前端或继续后台处理。',{target:'api'})],
        '附件文件本体不在这里；Hindsight 的事实与关系也由引擎自己的数据库保存。'),
      branch('read','读取项目数据',['notes','context','memory','index'],'带账号范围、目标和条件的查询',['notes','context','memory','index'],'当前业务所需的正文、状态或检索数据',[
        step('scope','限定账号和目标','通过项目仓储 / 服务按所属账号查询。'),
        step('query','读取对应的数据表','例如正文版本、来源屏障或检索片段。'),
        step('return','交回调用方处理','数据库返回资料；业务决定后续检查和流程。')])
    ]}
  };
  const traces={
    chat:'api/request/auth runtime/run/start runtime/run/record router/chat/receive prompt/plan/fill model/text/generate router/chat/validate context/chat/receive memory/read/gate memory/read/gate adapter/read/request hindsight/read/query adapter/read/normalize memory/read/filter memory/read/output prompt/answer/fill model/text/generate ui/normal/receive',
    qa:'api/request/auth router/library/fixed context/note/receive index/search/scope index/search/recall index/search/rank context/note/evidence prompt/answer/fill model/text/generate context/note/cite ui/normal/receive',
    save:'api/request/auth notes/save/accept notes/save/load notes/save/version notes/save/commit db/write/commit ui/normal/receive index/build/claim model/embed/generate index/build/embed index/build/publish',
    create:'api/request/auth router/chat/receive prompt/plan/fill model/text/generate router/chat/validate notes/create/brief notes/create/brief notes/create/outline notes/create/outline prompt/write/fill model/text/generate notes/create/draft runtime/run/worker runtime/run/record notes/create/review notes/create/review notes/create/publish notes/create/publish db/write/commit ui/normal/receive',
    preview:'api/request/auth notes/preview/locate notes/preview/locate prompt/write/fill model/text/generate notes/preview/check notes/preview/candidate notes/preview/review notes/preview/review notes/preview/apply notes/preview/apply db/write/commit ui/normal/receive',
    quick:'api/request/auth notes/quick/authorize prompt/write/fill model/text/generate notes/quick/return ui/quick/review ui/quick/adopt ui/quick/save notes/save/accept notes/save/commit db/write/commit ui/normal/receive',
    remember:'api/request/auth router/chat/receive prompt/plan/fill model/text/generate router/chat/validate memory/write/check memory/write/check memory/write/queue worker/write/claim worker/write/recheck adapter/write/request hindsight/write/receive hindsight/write/extract adapter/write/respond worker/write/settle worker/write/settle',
    attachment:'api/request/auth files/upload/write files/upload/metadata db/write/commit ui/normal/receive'
  };
  window.NoteFlowMapDetails={modules,traces:Object.fromEntries(Object.entries(traces).map(([key,value])=>[key,value.split(' ').map(s=>{const[module,branch,stage]=s.split('/');return{module,branch,stage};})]))};
})();
