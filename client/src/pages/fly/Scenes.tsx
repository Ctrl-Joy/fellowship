import { Avatar } from './Avatar';

/** Phone showing one of three conversation styles; messages animate in whenever the state becomes active. */
export function TalkPhone({ step }: { step: number }) {
  return (
    <div className="fy-phone">
      <div className="fy-phone-notch" />
      <div className="fy-phone-bar"><span>9:41</span><span>●●● ▮</span></div>
      {[
        { head: <><b># launch</b><small>12 members</small></>, msgs: [
          { who: 'Ava', seed: 3, text: 'Release notes are in the canvas. Can someone sanity-check pricing copy?' },
          { who: 'Ben', seed: 5, text: 'On it. Also moved FEL-12 to In review 👀' },
          { who: 'Cleo', seed: 9, text: 'Looks great. Shipping at 4 🚀', react: '🎉 4' },
        ] },
        { head: <><Avatar seed={5} className="fy-phone-av" /><b>Ben</b></>, msgs: [
          { who: 'You', me: true, text: 'Can you take the support queue this afternoon?' },
          { who: 'Ben', seed: 5, text: "Sure. I'll triage everything and flag anything urgent before 5." },
          { who: 'You', me: true, text: 'Perfect, thank you!' },
        ] },
        { head: <><b>Thread</b><small># launch</small></>, msgs: [
          { who: 'Ava', seed: 3, text: 'Release notes are in the canvas. Can someone sanity-check pricing copy?' },
          { who: 'Dev', seed: 12, text: 'Fixed two typos and the annual price.' },
          { who: 'Ava', seed: 3, text: 'Thanks! Also sent to #launch ✓' },
        ] },
      ].map((conv, i) => (
        <div key={i} className={`fy-phone-screen${i === step ? ' on' : ''}`}>
          <div className="fy-phone-head">{conv.head}</div>
          <div className="fy-msgs">
            {conv.msgs.map((m, k) => (
              <div key={k} className={`fy-msg${'me' in m && m.me ? ' me' : ''}`} style={{ animationDelay: `${0.15 + k * 0.45}s` }}>
                {!('me' in m && m.me) && 'seed' in m && <Avatar seed={m.seed as number} className="fy-msg-av" />}
                <div className="fy-bubble">
                  {!('me' in m && m.me) && <b>{m.who}</b>}
                  <span>{m.text}</span>
                  {'react' in m && m.react && <em className="fy-react">{m.react}</em>}
                </div>
              </div>
            ))}
            <div className="fy-typing" style={{ animationDelay: `${0.15 + conv.msgs.length * 0.45}s` }}><i /><i /><i /></div>
          </div>
          <div className="fy-phone-input">Message…</div>
        </div>
      ))}
    </div>
  );
}

/** Stack of workflow notifications sliding in, one after another. */
export function RoutinesStack() {
  const items = [
    { seed: 3, title: 'Daily stand-up', line: 'Form sent to #team · 9:00', time: 'now' },
    { seed: 12, title: 'Time-off approval', line: 'Approved by Ben · Dec 21–24', time: '2m' },
    { seed: 9, title: 'Welcome new members', line: 'Greeted Priya in #general', time: '14m' },
    { seed: 5, title: 'Incident report', line: 'Opened #incident-212 · Sev 2', time: '1h' },
  ];
  return (
    <div className="fy-stack">
      {items.map((it, i) => (
        <div key={it.title} className="fy-note" style={{ animationDelay: `${i * 0.35}s` }}>
          <Avatar seed={it.seed} className="fy-note-av" />
          <div><b>{it.title}</b><span>{it.line}</span></div>
          <time>{it.time}</time>
        </div>
      ))}
    </div>
  );
}

/** Project board with a card travelling across the columns. */
export function BoardScene() {
  const cols = [['FEL-9 Onboarding copy', 'FEL-14 Billing page'], ['FEL-11 Search filters'], ['FEL-7 Huddle summary', 'FEL-8 Polls']];
  return (
    <div className="fy-board">
      {['To do', 'In progress', 'Done'].map((c, i) => (
        <div key={c} className="fy-col">
          <h6>{c} <span>{cols[i].length}</span></h6>
          {cols[i].map((t) => <div key={t} className="fy-card"><b>{t.split(' ')[0]}</b>{t.slice(t.indexOf(' ') + 1)}</div>)}
        </div>
      ))}
      <div className="fy-card fy-card-moving"><b>FEL-12</b>Ship verified sign-in</div>
    </div>
  );
}

/** Huddle tiles with a speaking ring passing between people. */
export function HuddleScene() {
  return (
    <div className="fy-huddle">
      {[3, 5, 9, 12].map((s, i) => (
        <div key={s} className={`fy-tile fy-tile-${i}`}><Avatar seed={s} className="fy-tile-av" /><em>{['Ava', 'Ben', 'Cleo', 'Dev'][i]}</em></div>
      ))}
      <div className="fy-controls"><span>🎙</span><span>📷</span><span>🖥</span><span className="leave">Leave</span></div>
    </div>
  );
}

/** Small app windows that slide in around the integrations hub. */
export function IntegrationWindows() {
  return (
    <>
      <div className="fy-win fy-win-a">
        <div className="fy-win-bar"><i /><i /><i /><span>#deploys</span></div>
        <div className="fy-win-row"><span className="fy-app">APP</span><b>Deploy Bot</b></div>
        <p>Build #418 deployed to production ✅</p>
      </div>
      <div className="fy-win fy-win-b">
        <div className="fy-win-bar"><i /><i /><i /><span>POST /api/hooks/incoming/…</span></div>
        <pre>{'{\n  "text": "New ticket #212",\n  "username": "Helpdesk"\n}'}</pre>
      </div>
      <div className="fy-win fy-win-c">
        <div className="fy-win-bar"><i /><i /><i /><span>/poll</span></div>
        <b>Lunch?</b>
        <div className="fy-bar"><i style={{ width: '66%' }} />Tacos · 4</div>
        <div className="fy-bar"><i style={{ width: '33%' }} />Ramen · 2</div>
      </div>
      <div className="fy-win fy-win-d">
        <div className="fy-win-bar"><i /><i /><i /><span>events</span></div>
        <p><code>reaction.added</code> → signed, delivered ✓</p>
      </div>
    </>
  );
}
