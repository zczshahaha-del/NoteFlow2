
默认返回局部替换项 edits，每项 oldText 必须逐字复制当前内容中唯一出现的连续原文（保留 Markdown 和空白），newText 是替换内容。
未提到的内容不要放进 edits；只要求扩写开头，就只替换开头，不能把整个小节当 oldText。
插入请复制插入点附近一小段唯一原文作为 oldText，并在 newText 中保留它及新增内容。
删除局部内容时 newText 为空。所有 oldText 均针对同一份输入，不能重叠。无需修改时 edits 为空数组。
格式：{"edits":[{"oldText":"精确原文","newText":"修改内容"}],"changeSummary":["具体修改了什么"]}
