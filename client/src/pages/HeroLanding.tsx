import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import '../styles/hero.css';

const IMG = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/';

const PRODUCT = [
  { title: 'Channels', body: 'A home for every topic, team and conversation.', img: `${IMG}hf_20260928_051509_384c49d8-b37c-49a7-9180-a06ad914ec24.png` },
  { title: 'Huddles', body: 'Drop into voice or video without booking a call.', img: `${IMG}hf_20260928_051509_bf51abc3-090e-459f-8066-8f0cdd0c36b9.png` },
  { title: 'Canvases', body: 'Notes and plans that live beside the conversation.', img: `${IMG}hf_20260928_051509_c4fa86ad-842a-41c9-8cff-a70068ac1aa3.png` },
  { title: 'Workflows', body: 'Routine work that runs itself, so people can talk.', img: `${IMG}hf_20260928_051511_ab19ff38-a140-442d-b2e7-82e3431bf3b6.png` },
];
const COMMUNITIES = [
  { title: 'Open communities', body: 'Public spaces anyone can find and join.', img: `${IMG}hf_20260928_051510_400ed870-8ffb-4030-b267-2b003780a5e3.png` },
  { title: 'Private teams', body: 'Invite-only spaces for the people you work with.', img: `${IMG}hf_20260928_051510_3d88d3aa-ac8a-4e80-b70b-0da5523138cf.png` },
];
const RESOURCES = ['Templates', 'Apps & bots', 'Projects', 'Self-hosting'];

const MENUS = ['discover', 'journeys', 'regions'] as const;
type Menu = (typeof MENUS)[number];
/** Lines each panel's text up with its trigger's text: 8px panel padding + 12px row padding. */
const PAD = 20;

function Chevron() {
  return (
    <svg viewBox="0 0 8 5" aria-hidden="true">
      <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** Fellowship's landing page: a full-screen still hero with a header whose dropdown morphs between menus. */
export function HeroLanding() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Fellowship — Where your community gathers';
    const el = root.current!;
    const header = el.querySelector<HTMLElement>('#header')!;
    const nav = el.querySelector<HTMLElement>('#nav')!;
    const dd = el.querySelector<HTMLElement>('#dd')!;
    const story = el.querySelector<HTMLElement>('#story-link')!;
    const sheet = el.querySelector<HTMLElement>('#sheet')!;
    const menuBtn = el.querySelector<HTMLButtonElement>('.menu-btn')!;
    const triggers = [...el.querySelectorAll<HTMLButtonElement>('.trigger')];
    const panels = [...dd.querySelectorAll<HTMLElement>('.panel')];
    const panel = (id: Menu) => dd.querySelector<HTMLElement>(`[data-panel="${id}"]`)!;
    const trigger = (id: Menu) => triggers.find((t) => t.dataset.menu === id)!;

    let current: Menu | null = null;
    let closeTimer = 0;

    const place = (id: Menu) => {
      const p = panel(id);
      const w = p.offsetWidth;
      const h = p.offsetHeight;
      const t = trigger(id).getBoundingClientRect();
      const hr = header.getBoundingClientRect();
      let x = t.left - PAD;
      x = Math.max(hr.left + 12, Math.min(x, hr.right - w - 12));
      x -= ((dd.offsetParent as HTMLElement | null) ?? header).getBoundingClientRect().left;
      dd.style.setProperty('--x', `${x}px`);
      dd.style.setProperty('--w', `${w}px`);
      dd.style.setProperty('--h', `${h}px`);
    };

    const open = (id: Menu) => {
      clearTimeout(closeTimer);
      if (id === current) return;
      const next = panel(id);
      if (!current) {
        // First open: appear in place; only scale, opacity and blur animate.
        dd.classList.add('instant', 'snap');
        panels.forEach((p) => { p.classList.add('snap'); delete p.dataset.state; });
        place(id);
        void dd.offsetWidth;
        dd.classList.remove('snap');
        panels.forEach((p) => p.classList.remove('snap'));
        dd.classList.add('open');
        requestAnimationFrame(() => dd.classList.remove('instant'));
      } else {
        // Switch: morph the container and slide content in the direction of travel.
        const dir = MENUS.indexOf(id) > MENUS.indexOf(current) ? 1 : -1;
        panel(current).dataset.state = dir > 0 ? 'exit-left' : 'exit-right';
        next.classList.add('snap');
        next.dataset.state = dir > 0 ? 'exit-right' : 'exit-left';
        void next.offsetWidth;
        next.classList.remove('snap');
        place(id);
      }
      next.dataset.state = 'active';
      triggers.forEach((t) => t.setAttribute('aria-expanded', String(t.dataset.menu === id)));
      current = id;
    };

    const close = () => {
      dd.classList.remove('open');
      if (current) delete panel(current).dataset.state;
      triggers.forEach((t) => t.setAttribute('aria-expanded', 'false'));
      current = null;
    };

    const scheduleClose = (ms = 140) => {
      clearTimeout(closeTimer);
      closeTimer = window.setTimeout(close, ms);
    };

    const setSheet = (on: boolean) => {
      sheet.classList.toggle('open', on);
      menuBtn.setAttribute('aria-expanded', String(on));
      menuBtn.setAttribute('aria-label', on ? 'Close menu' : 'Open menu');
    };

    const off: (() => void)[] = [];
    const on = <K extends keyof HTMLElementEventMap>(t: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      t.addEventListener(type, fn as EventListener);
      off.push(() => t.removeEventListener(type, fn as EventListener));
    };

    triggers.forEach((t) => {
      const id = t.dataset.menu as Menu;
      on(t, 'pointerenter', (e) => { if (e.pointerType === 'mouse') open(id); });
      on(t, 'click', () => { if (current === id) close(); else open(id); });
    });
    on(story, 'pointerenter', (e) => { if (e.pointerType === 'mouse') scheduleClose(60); });
    on(nav, 'pointerenter', () => clearTimeout(closeTimer));
    on(nav, 'pointerleave', (e) => { if (e.pointerType === 'mouse') scheduleClose(); });
    on(nav, 'focusout', (e) => { if (!nav.contains(e.relatedTarget as Node | null)) scheduleClose(0); });
    on(document, 'keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (current) { const t = trigger(current); close(); t.focus(); }
      setSheet(false);
    });
    on(document, 'pointerdown', (e) => { if (!nav.contains(e.target as Node)) close(); });
    on(window, 'resize', () => { if (current) place(current); });

    const items = [...el.querySelectorAll<HTMLElement>('.d-item')];
    const imgs = [...el.querySelectorAll<HTMLElement>('.d-media img')];
    const activate = (item: HTMLElement) => {
      items.forEach((i) => i.classList.toggle('is-active', i === item));
      imgs.forEach((img, n) => img.classList.toggle('is-active', String(n) === item.dataset.img));
    };
    items.forEach((item) => {
      on(item, 'pointerenter', () => activate(item));
      on(item, 'focus', () => activate(item));
    });

    on(menuBtn, 'click', () => setSheet(!sheet.classList.contains('open')));
    sheet.querySelectorAll('a').forEach((a) => on(a, 'click', () => setSheet(false)));

    return () => { clearTimeout(closeTimer); off.forEach((f) => f()); };
  }, []);

  return (
    <div className="hx" ref={root}>
      <section className="hero" aria-label="Fellowship community">
        <div
          className="hero-bg"
          role="img"
          aria-label="A turquoise glacial river winding through a volcanic valley toward snow-capped mountains"
        />

        <header className="header" id="header">
          <div className="bar">
            <Link to="/" className="logo" aria-label="Fellowship home">
              <svg width="30" height="26" viewBox="4 3 56 49" fill="none" stroke="#fff" strokeWidth="5" aria-hidden="true">
                <circle cx="32" cy="19" r="11" />
                <circle cx="23" cy="35" r="11" />
                <circle cx="41" cy="35" r="11" />
              </svg>
            </Link>

            <nav className="desktop-nav" id="nav" aria-label="Main">
              <ul className="links">
                <li><button className="trigger" data-menu="discover" aria-expanded="false">Product <Chevron /></button></li>
                <li><button className="trigger" data-menu="journeys" aria-expanded="false">Communities <Chevron /></button></li>
                <li><button className="trigger" data-menu="regions" aria-expanded="false">Resources <Chevron /></button></li>
                <li><Link className="plain-link" id="story-link" to="/login">Sign in</Link></li>
              </ul>

              <div className="dd" id="dd">
                <div className="panel" id="p-discover" data-panel="discover">
                  <div className="d-list">
                    {PRODUCT.map((p, i) => (
                      <Link key={p.title} to="/signup" className={`d-item${i === 0 ? ' is-active' : ''}`} data-img={i}>
                        <strong>{p.title}</strong>
                        <span>{p.body}</span>
                      </Link>
                    ))}
                  </div>
                  <div className="d-media" aria-hidden="true">
                    {PRODUCT.map((p, i) => (
                      <img key={p.title} src={p.img} alt="" className={i === 0 ? 'is-active' : undefined} />
                    ))}
                  </div>
                </div>

                <div className="panel" id="p-journeys" data-panel="journeys">
                  {COMMUNITIES.map((c) => (
                    <Link key={c.title} to="/signup" className="card">
                      <img src={c.img} alt="" />
                      <strong>{c.title}</strong>
                      <span>{c.body}</span>
                    </Link>
                  ))}
                </div>

                <div className="panel" id="p-regions" data-panel="regions">
                  {RESOURCES.map((r) => <Link key={r} to="/signup" className="r-link">{r}</Link>)}
                </div>
              </div>
            </nav>

            <div className="actions">
              <Link className="cta" to="/signup">Get started</Link>
              <button className="menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="sheet">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M2 5.5h12M2 10.5h12" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          <div className="sheet" id="sheet">
            <h3>Product</h3>
            {PRODUCT.map((p) => <Link key={p.title} to="/signup">{p.title}</Link>)}
            <h3>Communities</h3>
            {COMMUNITIES.map((c) => <Link key={c.title} to="/signup">{c.title}</Link>)}
            <h3>Resources</h3>
            {RESOURCES.map((r) => <Link key={r} to="/signup">{r}</Link>)}
            <h3>Fellowship</h3>
            <Link to="/login">Sign in</Link>
          </div>
        </header>

        <div className="scroll-cue" aria-hidden="true">
          <span>(</span><span>scroll down</span><span>)</span>
        </div>
      </section>
    </div>
  );
}
