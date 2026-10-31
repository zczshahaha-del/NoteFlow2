import { useEffect, useState } from 'react';
import { memoryConsole, type MemoryConsoleOverview, type MemoryGraph, type MemoryGraphNode, type MemorySourceRecord } from '../services/memoryConsole';
import './memory-console.css';

export function MemorySourceView({ sourceId }: { sourceId: string }) {
  const [data, setData] = useState<MemorySourceRecord | null>(null);
  const [error, setError] = useState('');
  return <details className="nf-memory-source" onToggle={event => {
    if (event.currentTarget.open && !data) void memoryConsole<MemorySourceRecord>('/source/' + encodeURIComponent(sourceId)).then(setData).catch(e => setError(e.message));
  }}><summary>查看来源</summary>{error ? <p role="alert">{error}</p> : data ? <>
    <p className="nf-notice">规则版本 {data.ruleVersion} · {data.createdAt?.slice(0, 10)}</p>
    <p>{data.document?.content || '来源原文已不可用。'}</p>
  </> : <p role="status">正在读取来源…</p>}</details>;
}

export default function MemoryConsole({ onChange }: { onChange: () => void }) {
  const [data, setData] = useState<MemoryConsoleOverview | null>(null);
  const [mission, setMission] = useState('');
  const [sample, setSample] = useState('我刚开始学习 Go，喜欢通俗的中文和简短例子。');
  const [preview, setPreview] = useState<string[] | null>(null);
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [selected, setSelected] = useState<MemoryGraphNode | null>(null);
  const [legacy, setLegacy] = useState<any[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => { const next = await memoryConsole<MemoryConsoleOverview>(); setData(next); setMission(next.mission); };
  useEffect(() => { let live = true; memoryConsole<MemoryConsoleOverview>().then(next => { if (live) { setData(next); setMission(next.mission); } }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
  const run = async (action: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试。'); } finally { setBusy(false); }
  };
  const nodes = graph?.nodes ?? [];
  const point = (index: number) => ({ x: 240 + Math.cos(index * Math.PI * 2 / Math.max(nodes.length, 1)) * 180, y: 150 + Math.sin(index * Math.PI * 2 / Math.max(nodes.length, 1)) * 110 });
  return <div className="nf-memory-console">
    {error && <p className="nf-notice nf-error" role="alert">{error}</p>}
    {notice && <p className="nf-notice" role="status">{notice}</p>}
    {!data ? <p className="nf-notice">正在读取记忆服务…</p> : <>
      <div className="nf-list-heading"><span>记忆规则与来源</span><button type="button" className="nf-button" disabled={busy} onClick={() => void run(async () => { await refresh(); onChange(); })}>刷新状态</button></div>
      {data.capabilities?.rules && <>
        {data.reviewNewFacts && <p className="nf-notice">你修订过记忆，后续自动整理的新事实需确认后才会用于回答。</p>}
        <details><summary>记忆规则 <span>版本 {data.ruleVersion}</span></summary>
          <label>希望记住什么<textarea aria-label="记忆抽取规则" className="nf-input" value={mission} onChange={e => setMission(e.target.value)} maxLength={4000} /></label>
          <label>试运行示例<textarea aria-label="记忆规则测试示例" className="nf-input" value={sample} onChange={e => setSample(e.target.value)} maxLength={4000} /></label>
          <p className="nf-notice">试运行使用隔离测试库，会调用现有模型；结果不会进入你的正式记忆。</p>
          <div className="nf-record-actions"><button type="button" className="nf-button" disabled={busy || !sample.trim() || !mission.trim()} onClick={() => void run(async () => { const r = await memoryConsole('/preview', 'POST', { mission, text: sample }); setPreview(r.facts); })}>试运行</button><button type="button" className="nf-button" disabled={busy || !mission.trim() || mission === data.mission} onClick={() => void run(async () => { await memoryConsole('/rules', 'PUT', { mission, expectedVersion: data.ruleVersion }); await refresh(); setNotice('规则已更新，仅影响新内容。'); })}>保存规则</button></div>
          {preview && <div className="nf-memory-preview">{preview.length ? preview.map((text, i) => <p key={i}>{text}</p>) : <p>没有提取出适合长期保存的信息。</p>}</div>}
          {data.history?.length > 0 && <label>恢复历史规则<select aria-label="恢复历史记忆规则" value="" disabled={busy} onChange={e => { const rule = data.history.find((h) => String(h.version) === e.target.value); if (rule) setMission(rule.mission); }}><option value="">选择版本，检查后保存</option>{data.history.map((h) => <option key={h.version} value={h.version}>版本 {h.version}</option>)}</select></label>}
        </details>
        <details hidden={!data.capabilities?.graph} onToggle={e => { if (e.currentTarget.open && !graph) void run(async () => setGraph(await memoryConsole<MemoryGraph>('/graph'))); }}><summary>记忆关系</summary>
          {graph && !nodes.length ? <p className="nf-notice">暂时没有可展示的关联。</p> : graph && <><svg className="nf-memory-graph" viewBox="0 0 480 300" role="group" aria-label="记忆关系图">{graph.edges.map((edge, i) => { const a = nodes.findIndex((n) => n.id === edge.source), b = nodes.findIndex((n) => n.id === edge.target); if (a < 0 || b < 0) return null; const p = point(a), q = point(b); return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y}><title>{edge.relation || '关联'}，关联不代表因果</title></line>; })}{nodes.map((node, index) => { const p = point(index); return <g key={node.id} role="button" tabIndex={0} aria-label={node.content} onClick={() => setSelected(node)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(node); } }}><circle cx={p.x} cy={p.y} r={selected?.id === node.id ? 10 : 7} /><text x={p.x} y={p.y + 23} textAnchor="middle">{(node.content || '').slice(0, 11)}…</text></g>; })}</svg><p className="nf-notice">点击节点查看内容。连线表示语义、时间或共同出现等关联。</p>{selected && <div className="nf-memory-preview"><p>{selected.content}</p>{selected.sourceRef && <MemorySourceView sourceId={selected.sourceRef} />}</div>}</>}
        </details>
      </>}
      <details onToggle={e => { if (e.currentTarget.open && !legacy) void run(async () => { const r = await memoryConsole('/legacy'); setLegacy(r.memories); setChosen(r.memories.filter((m: any) => m.suggested).map((m: any) => m.id)); }); }}><summary>原有记忆 · 导入预览</summary>
        {legacy?.length === 0 && <p className="nf-notice">没有原有记录。</p>}
        {legacy?.map(m => <label key={m.id} className="nf-memory-import"><input type="checkbox" checked={chosen.includes(m.id)} disabled={busy || m.status !== 'active'} onChange={e => setChosen(ids => e.target.checked ? [...ids, m.id] : ids.filter(id => id !== m.id))} /><span>{m.content}<small>{m.suggested ? '建议导入' : m.source === 'work_memory' ? '任务流水，请核实' : '已停用或需核实'}</small></span></label>)}
        {data.capabilities?.importLegacy && !!legacy?.length && <button type="button" className="nf-button" disabled={busy || !chosen.length} onClick={() => void run(async () => { const r = await memoryConsole('/import', 'POST', { ids: chosen }); setNotice(`已提交 ${r.submitted} 条整理，请刷新处理状态。`); })}>导入所选 {chosen.length} 条</button>}
      </details>
      {!!data.jobs?.length && <details><summary>最近处理状态</summary>{data.jobs.map((j: any) => <p className="nf-notice" key={j.id}>{({ empty: '未形成长期事实', skipped: '已跳过旧任务' } as Record<string, string>)[j.sourceStatus] || ({ pending: '等待处理', processing: '整理中', succeeded: '处理完成', dead: '处理失败' } as Record<string, string>)[j.status] || j.status}{j.error ? ` · ${j.error}` : ''}{j.status === 'dead' && <button type="button" className="nf-button" disabled={busy} onClick={() => void run(async () => { await memoryConsole('/retry/' + encodeURIComponent(j.id), 'POST'); await refresh(); setNotice('已提交重试。'); })}>重试</button>}</p>)}</details>}
    </>}
  </div>;
}
