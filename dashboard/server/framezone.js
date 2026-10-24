// The frame's time zone and today's local date there: the one owner of both, and of the order the
// zone is settled in. The calendar fetches every calendar in this zone and reports the Family
// calendar's zone each time it loads (`settle`); chores ask it for "today".

// The local date (YYYY-MM-DD) at instant `t` in `timeZone`.
export function localDate(t, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t));
  const get = (type) => parts.find((p) => p.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

// timeZone: TZ from config, or null. lookup(): the Family calendar's zone, asked of Google (rejects
// when Google is down or says nothing).
export function createFrameZone({ timeZone = null, lookup, now = Date.now, log = console }) {
  let learned = null;

  // What the latest calendar load said the Family calendar's zone is; the newest wins.
  function learn(zone) {
    if (zone) learned = zone;
  }

  // 1. TZ, when set: the owner said so, and Google is never asked.
  // 2. Else the Family calendar's own zone: the latest one a load reported, or else asked of Google
  //    once and kept. A failure here rejects (and is asked again next time).
  async function strictZone() {
    if (timeZone) return timeZone;
    if (!learned) learn(await lookup());
    return learned;
  }

  // 3. Chores must not depend on Google being up: when the lookup fails, this process's own zone
  //    is used for this call only (not kept, so the next call asks again).
  async function zone() {
    try {
      return await strictZone();
    } catch (e) {
      log.error(`frame zone: using the server's local time zone, could not read the Family calendar's: ${e.message}`);
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  }

  async function today() {
    return localDate(now(), await zone());
  }

  // A calendar load: what the Family calendar reported (or nothing) → the zone to fetch the rest
  // in. Never the local zone: the calendar needs Google up anyway.
  async function settle(reported) {
    learn(reported);
    return strictZone();
  }

  // configured: TZ when set, else null (the zone to ask the Family calendar's events in).
  return { configured: timeZone, settle, zone, today };
}
