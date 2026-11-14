/**
 * Claude Shell · Google feed
 *
 * A tiny web app that runs as YOU inside Google and returns today's calendar
 * and your recent inbox as JSON for the relay. No OAuth app, no verification,
 * no 7-day token expiry.
 *
 * Setup (5 minutes):
 *  1. Go to https://script.google.com → New project. Paste this file in.
 *  2. Project Settings → Script properties → add  SECRET = <any long random string>.
 *  3. Deploy → New deployment → type "Web app".
 *       Execute as: Me      Who has access: Anyone
 *     (The SECRET check below is what keeps it private.)
 *  4. Authorize when asked. Copy the Web app URL.
 *  5. In relay/.env:  GOOGLE_FEED_URL=<that URL>   GOOGLE_FEED_SECRET=<the same secret>
 *
 * After editing this file: Deploy → Manage deployments → edit → New version.
 */

const HOURS_AHEAD = 18;
const MAIL_COUNT = 12;

function doGet(e) {
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || !e || !e.parameter || e.parameter.secret !== secret) {
    return json({ error: 'unauthorized' });
  }
  try {
    return json({ events: events(), mail: mail(), at: Date.now() });
  } catch (err) {
    return json({ error: String(err) });
  }
}

function events() {
  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000);
  const end = new Date(now.getTime() + HOURS_AHEAD * 60 * 60 * 1000);
  return CalendarApp.getDefaultCalendar()
    .getEvents(start, end)
    .filter(function (ev) { return !ev.isAllDayEvent(); })
    .map(function (ev) {
      const desc = ev.getDescription() || '';
      const loc = ev.getLocation() || '';
      const meet = (desc + ' ' + loc).match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i);
      return {
        id: ev.getId(),
        title: ev.getTitle(),
        start: ev.getStartTime().getTime(),
        end: ev.getEndTime().getTime(),
        location: meet && loc.indexOf('meet.google.com') >= 0 ? '' : loc,
        meetUrl: meet ? meet[0] : null,
      };
    });
}

function mail() {
  return GmailApp.getInboxThreads(0, MAIL_COUNT).map(function (t) {
    const m = t.getMessages()[t.getMessageCount() - 1];
    const from = m.getFrom().replace(/<.*>/, '').replace(/"/g, '').trim();
    return {
      id: t.getId(),
      from: from,
      subject: t.getFirstMessageSubject(),
      snippet: m.getPlainBody().replace(/\s+/g, ' ').slice(0, 160),
      at: t.getLastMessageDate().getTime(),
      unread: t.isUnread(),
    };
  });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
