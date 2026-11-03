import type { ReactElement } from 'react';
import type { SceneKind } from './content';

/** Looping, CSS-animated miniatures of Fellowship screens. Decorative: hidden from assistive tech. */
export function Scene({ kind }: { kind: SceneKind }) {
  return <div className={`ed-scene ed-scene-${kind}`} aria-hidden="true">{SCENES[kind]()}</div>;
}

const Av = ({ c, t }: { c: string; t: string }) => <span className="sc-av" style={{ background: c }}>{t}</span>;

const SCENES: Record<SceneKind, () => ReactElement> = {
  chat: () => (
    <div className="sc-window">
      <div className="sc-head"># launch-plan <span>3 members</span></div>
      <div className="sc-msgs">
        <div className="sc-msg"><Av c="#C2562E" t="A" /><div><b>ava</b><p>Draft timeline is in the canvas 📄</p></div></div>
        <div className="sc-msg"><Av c="#8E3B4F" t="B" /><div><b>ben</b><p>Backend is on track, load tests next week</p></div></div>
        <div className="sc-msg"><Av c="#6E4BB8" t="C" /><div><b>cleo</b><p>Designs ready for review <span className="sc-chip">🎉 3</span></p></div></div>
      </div>
      <div className="sc-typing"><span /><span /><span /> ben is typing</div>
      <div className="sc-composer">Message #launch-plan<i /></div>
    </div>
  ),
  huddle: () => (
    <div className="sc-huddle">
      {[['#C2562E', 'Ava'], ['#8E3B4F', 'Ben'], ['#6E4BB8', 'Cleo'], ['#2A8C74', 'Dev']].map(([c, n], i) => (
        <div key={n} className={`sc-tile sc-tile-${i}`}><Av c={c} t={n[0]} /><em>{n}</em></div>
      ))}
      <div className="sc-share"><div /><div /><div /></div>
      <div className="sc-controls"><span>🎙</span><span>📷</span><span>🖥</span><span className="sc-leave">Leave</span></div>
    </div>
  ),
  canvas: () => (
    <div className="sc-window sc-doc">
      <div className="sc-doc-title">Launch checklist</div>
      <div className="sc-line sc-h" />
      <div className="sc-check"><i className="on" /><div className="sc-line" style={{ width: '62%' }} /></div>
      <div className="sc-check"><i className="on" /><div className="sc-line" style={{ width: '48%' }} /></div>
      <div className="sc-check"><i /><div className="sc-line sc-typing-line" /></div>
      <div className="sc-check"><i /><div className="sc-line" style={{ width: '40%' }} /></div>
      <span className="sc-cursor sc-cursor-a">ava</span>
      <span className="sc-cursor sc-cursor-b">cleo</span>
    </div>
  ),
  workflow: () => (
    <div className="sc-flow">
      {['When someone reacts 🌴', 'Send a form', 'Ask Ben to approve', 'Approved → tell the requester'].map((s, i) => (
        <div key={s} className={`sc-step sc-step-${i}`}><span>{i + 1}</span>{s}</div>
      ))}
      <div className="sc-approve"><b>Approve</b><b className="ghost">Deny</b></div>
    </div>
  ),
  apps: () => (
    <div className="sc-window">
      <div className="sc-head"># engineering</div>
      <div className="sc-msgs">
        <div className="sc-msg sc-bot"><Av c="#3B5BDB" t="🚀" /><div><b>Deploy Bot <span className="sc-app">APP</span></b><p>Deploy finished ✅ build #42</p></div></div>
        <div className="sc-poll"><b>Lunch?</b><div className="sc-bar"><i style={{ width: '66%' }} />Tacos · 2</div><div className="sc-bar"><i style={{ width: '33%' }} />Ramen · 1</div></div>
      </div>
      <div className="sc-slash"><div>/poll <em>Ask a question</em></div><div>/remind <em>Set a reminder</em></div><div>/topic <em>Set the channel topic</em></div></div>
      <div className="sc-composer">/p<i /></div>
    </div>
  ),
  search: () => (
    <div className="sc-window">
      <div className="sc-search">🔍 <span className="sc-q">timeline in:#launch-plan</span><i /></div>
      {[0, 1, 2].map((i) => (
        <div key={i} className={`sc-result sc-result-${i}`}>
          <Av c={['#C2562E', '#8E3B4F', '#6E4BB8'][i]} t={'ABC'[i]} />
          <div><b>#launch-plan</b><p>{['Draft <mark>timeline</mark> is in the doc', 'Moved the <mark>timeline</mark> by a week', '<mark>Timeline</mark> approved 🎉'][i].split(/<\/?mark>/).map((t, j) => j % 2 ? <mark key={j}>{t}</mark> : t)}</p></div>
        </div>
      ))}
    </div>
  ),
  board: () => (
    <div className="sc-board">
      {['To do', 'In progress', 'Done'].map((col) => (
        <div key={col} className="sc-col"><h6>{col}</h6><div className="sc-card" /><div className="sc-card short" /></div>
      ))}
      <div className="sc-card sc-moving"><b>FEL-12</b> Ship huddles</div>
    </div>
  ),
  admin: () => (
    <div className="sc-window sc-admin">
      {[['Ava Okafor', 'Owner'], ['Ben Lindqvist', 'Admin'], ['Cleo Marchetti', 'Member'], ['Guest reviewer', 'Guest']].map(([n, r], i) => (
        <div key={n} className="sc-row"><Av c={['#C2562E', '#8E3B4F', '#6E4BB8', '#5B6470'][i]} t={n[0]} /><span>{n}</span><em className={`sc-role sc-role-${i}`}>{r}</em></div>
      ))}
      <div className="sc-toggle"><span>Invite link enabled</span><i /></div>
    </div>
  ),
};
