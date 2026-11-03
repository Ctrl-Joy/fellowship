/**
 * `npm run seed` — recreate server/data/fellowship.db with a demo workspace.
 * Users: ava@ / ben@ / cleo@fellowship.test, password "fellowship123".
 */
import { existsSync, rmSync } from 'node:fs';
import { buildApp, DEFAULT_DB_PATH } from './app';

const dbPath = process.env.FELLOWSHIP_DB ?? DEFAULT_DB_PATH;
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
}

const app = await buildApp({ dbPath });
const { ctx } = app;
const { core, messages, db } = ctx;

const PASSWORD = 'fellowship123';
const ava = core.createUser({ email: 'ava@fellowship.test', password: PASSWORD, fullName: 'Ava Okafor', displayName: 'ava', timezone: 'Europe/London', verified: true });
const ben = core.createUser({ email: 'ben@fellowship.test', password: PASSWORD, fullName: 'Ben Lindqvist', displayName: 'ben', timezone: 'America/New_York', verified: true });
const cleo = core.createUser({ email: 'cleo@fellowship.test', password: PASSWORD, fullName: 'Cleo Marchetti', displayName: 'cleo', timezone: 'Asia/Kolkata', verified: true });
db.prepare("UPDATE users SET title = 'Product lead' WHERE id = ?").run(ava.id);
db.prepare("UPDATE users SET title = 'Backend engineer' WHERE id = ?").run(ben.id);
db.prepare("UPDATE users SET title = 'Designer' WHERE id = ?").run(cleo.id);

const ws = core.createWorkspace(ava.id, 'Fellowship HQ');
core.joinWorkspace(ws.id, ben.id);
core.joinWorkspace(ws.id, cleo.id);
db.prepare("UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ? AND user_id = ?").run(ws.id, ben.id);

const general = db.prepare("SELECT * FROM conversations WHERE workspace_id = ? AND name = 'general'").get(ws.id) as any;
const random = db.prepare("SELECT * FROM conversations WHERE workspace_id = ? AND name = 'random'").get(ws.id) as any;
db.prepare('UPDATE conversations SET topic = ? WHERE id = ?').run('Weekly sync is Thursday 15:00 UTC', general.id);

const engineering = core.createChannel(ws.id, ben.id, {
  name: 'engineering', topic: 'Ship small, ship often', description: 'Builds, deploys and code review.', memberIds: [ava.id, cleo.id],
});
const design = core.createChannel(ws.id, cleo.id, {
  name: 'design', topic: 'Critiques on Tuesdays', description: 'Mockups, prototypes and visual polish.', memberIds: [ava.id],
});
const launch = core.createChannel(ws.id, ava.id, {
  name: 'launch-plan', isPrivate: true, topic: 'Private until announcement', description: 'Planning the public launch.', memberIds: [ben.id],
});
const dm = core.openDm(ws.id, ava.id, [ben.id]);

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const start = Date.now() - 3 * DAY;
let t = start;
const at = (deltaMin: number) => (t += deltaMin * 60_000);

function say(conv: { id: string }, user: { id: string }, text: string, deltaMin = 3, extra: Partial<Parameters<typeof messages.post>[0]> = {}) {
  return messages.post({ conversationId: conv.id, userId: user.id, text, createdAt: at(deltaMin), force: true, ...extra });
}

// Day 1
say(general, ava, 'Welcome to *Fellowship HQ*, everyone! This is where announcements land.', 0);
say(general, ben, 'Glad to be here :) I set up `#engineering` for build chatter.');
say(general, cleo, 'Hi all! Design reviews will happen in #design.', 2);
say(general, ava, `<!channel> Weekly sync moves to Thursday this week.`, 45);
say(engineering, ben, 'CI is green again after the flaky test fix.', 30);
say(engineering, ava, 'Nice. Can we get a staging deploy before Thursday?', 4);
say(engineering, ben, 'Yes, I will cut a build this afternoon.', 6);
say(design, cleo, 'Uploaded the new sidebar exploration. Thoughts welcome!', 20);
say(design, ava, 'The teal reads really well in dark mode.', 12);
say(random, cleo, 'Anyone tried the new ramen place on 5th?', 60);
say(random, ben, 'Yes! Get the miso. Trust me.', 5);

// Day 2
t = start + DAY;
const plan = say(engineering, ava, 'Proposal: we move release notes into the repo so they get reviewed like code.', 0);
say(engineering, ben, 'Agree. Markdown in `docs/releases/`?', 3, { threadRootId: plan.id });
say(engineering, cleo, 'Could we keep a short summary in #general too?', 4, { threadRootId: plan.id });
say(engineering, ava, 'Good call. I will post summaries there.', 5, { threadRootId: plan.id, alsoSendToChannel: true });
say(engineering, ben, 'Here is the structure I had in mind:\n```\ndocs/releases/\n  2026-11.md\n  2026-12.md\n```', 6, { threadRootId: plan.id });
say(general, ava, 'Reminder: please fill in your profile title and timezone.', 30);
say(general, ben, '> Reminder: please fill in your profile title\nDone ✅', 8);
say(design, cleo, 'Typography pass: _Inter_ for UI, ~Georgia~ nope, sticking with Inter everywhere.', 50);
say(launch, ava, 'Draft timeline is in the doc. Target is the first week of December.', 20);
say(launch, ben, 'Backend is on track. Load tests next week.', 9);
say(dm, ben, 'Hey Ava, got 10 minutes to talk about the deploy checklist?', 40);
say(dm, ava, 'Sure, after lunch works.', 5);

// Day 3 (today)
t = Date.now() - 3 * HOUR;
say(general, cleo, `Morning! <@${ava.id}> the new icons are ready for review.`, 0);
say(engineering, ben, 'Staging is up: https://staging.example.com', 15);
say(engineering, cleo, `<@${ben.id}> the login page looks off on narrow screens, I will file it.`, 20);
say(random, ava, 'Friday playlist thread, drop your tracks 🎶', 30);
say(dm, ben, 'Checklist is in #engineering, have a look when you can.', 25);
say(design, cleo, 'Final palette: **deep teal** + amber accents.', 10);
say(random, ben, `<@${cleo.id}> that playlist idea is great, adding two tracks now.`, 12);

// Read state: Ava has read everything before today; Ben and Cleo are caught up to day 2.
const today = Date.now() - 4 * HOUR;
db.prepare('UPDATE conversation_members SET last_read_ts = ? WHERE user_id = ?').run(today, ava.id);
db.prepare('UPDATE conversation_members SET last_read_ts = ? WHERE user_id IN (?, ?)').run(start + 2 * DAY, ben.id, cleo.id);

const count = (db.prepare('SELECT COUNT(*) AS n FROM messages').get() as any).n;
await app.close();
console.log(`Seeded "Fellowship HQ" (${count} messages) at ${dbPath}`);
console.log('Log in as ava@fellowship.test, ben@fellowship.test or cleo@fellowship.test — password fellowship123');
