# Home dashboard

The family dashboard shown on a repurposed photo frame: calendar, weather, chores and home controls, fed by the home server.

## Language

### Weather

**Weather**:
Outdoor conditions and forecast for the home's location, as reported by Home Assistant. Always in Fahrenheit.
_Avoid_: Climate (that's indoors)

**Condition**:
The one-word state of the sky for an hour or for now: sun, clear night, partly cloudy, cloudy, rain, snow or storm.
_Avoid_: Icon, weather type

**Wet hour**:
An hour whose forecast chance of precipitation is 50% or more.
_Avoid_: Rainy hour

**High / Low**:
Today's forecast maximum and minimum outdoor temperature.

**Weather summary**:
One short line describing the rest of today's weather, such as "Rain from 4 pm".
_Avoid_: Forecast text, description

**Advice**:
One short line telling the family what to wear or bring because of the weather, such as "Grab a rain jacket". Chosen by the first matching advice rule.
_Avoid_: Tip, recommendation

**Advice rule**:
A condition on the weather (and time of day) paired with the advice it produces. Rules are checked in order.

**Weather page**:
The page with the full weather: now (feels-like, humidity, wind, UV, sunrise and sunset), the radar, the next hours, and the week. Opened from the rail or by tapping the weather on Today.
_Avoid_: Forecast page, weather screen

**Radar**:
A map of where it is raining or snowing around the home right now, from LibreWXR rather than Home Assistant. Only Home Assistant's home location comes from Home Assistant.
_Avoid_: Precipitation map, weather map

**Weather alert**:
A warning, watch, advisory or statement the National Weather Service has issued for the home's location, such as a Winter Storm Warning. Comes from the NWS rather than Home Assistant; only the home's location comes from Home Assistant.
_Avoid_: Warning (that's one kind of alert), notification

**Notable alert**:
A weather alert of Moderate severity or worse. Only notable alerts show outside the Weather page.
_Avoid_: Important alert, major alert

**Urgent alert**:
A weather alert of Severe severity or worse that needs action now (urgency Immediate). An urgent alert takes over the frame's screen; at night only an Extreme one does.
_Avoid_: Emergency, critical alert

### Calendar

**Family calendar**:
The one calendar whose events belong to everyone. An event added for several people, or for someone with no writable calendar of their own, goes here.

**Read-only calendar**:
A calendar whose events the dashboard shows but can't add to or delete from, such as a person's Fastmail or work Outlook calendar.
_Avoid_: External calendar, subscribed calendar

**Holiday calendar**:
A calendar whose all-day events belong to no one (`"person": "none"`), such as a country's public holidays or a school's term dates. Its events show as grey chips and can't be deleted from the frame; its timed events aren't shown.
_Avoid_: Unassigned calendar, shared calendar

### Home

**Today**:
The glanceable overview page: clock, weather, next event, the family's day, chores, shopping and a home summary.
_Avoid_: Home page, home screen

**Home controls**:
The page for seeing and changing the house: lights, the lock, climate and the rest of what Home Assistant runs. It's labelled "Home" on the frame.
_Avoid_: Control, smart home, devices page

**Room**:
A part of the house that groups things on Home controls. It's the area the thing belongs to in Home Assistant.
_Avoid_: Area, zone

**Scene**:
A saved setup of the house, such as "Goodnight", started with one tap. Scenes are made and named in Home Assistant, not on the frame.
_Avoid_: Preset, mode

**Climate**:
Indoor temperature, humidity and thermostat setting. Always in Fahrenheit.
_Avoid_: Weather, inside weather

**Pending change**:
A tap on Home controls, or a chore checked or unchecked, that the frame already shows but the house or home server hasn't confirmed yet. If it isn't confirmed, the frame puts it back and says why. A later tap on the same thing replaces it.
_Avoid_: Pending tap, optimistic update, pending write

**Home** (of a person):
A family member is home when Home Assistant places them in the home zone. Being at another zone, such as School, is away.
_Avoid_: In, present

**Away**:
A family member Home Assistant knows is somewhere other than home. When Home Assistant doesn't know, the person is neither home nor away.
_Avoid_: Out, absent, not home

**Day**:
The frame's normal, lit dashboard with the rail and the pages. After 300 s with no touch it goes to Ambient by day or Night from 10 pm to 6 am.
_Avoid_: Normal mode, active mode

**Ambient**:
The idle screen in the daytime: a full-screen photo slideshow with the clock, the weather, the next event and who's home. A tap goes back to Today in Day.
_Avoid_: Screensaver, idle mode, photo mode

**Night**:
The idle screen from 10 pm to 6 am: a dim red clock with the house's lock state on black. A tap shows Nightdash. Ambient and Night swap over at 10 pm and 6 am.
_Avoid_: Sleep mode, dark mode

**Nightdash**:
The dimmed, red-tinted dashboard shown after tapping Night, so the family can check something without full brightness. It goes back to Night after 20 s with no touch.
_Avoid_: Night dashboard, dim mode

**Phone layout**:
How the dashboard arranges itself on a phone held upright: one scrolling column per page and a tab bar at the bottom, with no Photos, ambient or night mode. Everywhere else it shows the frame's landscape layout, scaled to fit.
_Avoid_: Mobile view, responsive mode

**Test controls**:
A hidden drawer on the frame for trying things out by hand: switching display modes, faster idle, pretending it's night and showing fake weather alerts. Everything it changes stays on that screen and is undone by a reload. Not on phones.
_Avoid_: Demo controls, debug menu

**Pretend night**:
A test control that makes the frame behave as if it were night hours while its clock still shows the real time.
_Avoid_: Fake time, demo time

### Chores

**Chore**:
A standing job someone in the family does, such as "Garbage to curb". It belongs to one person or to Anyone and happens on chosen days of the week, for the whole day. Changing who owns it, which days it happens or deleting it applies from today on; earlier days stay as they were.
_Avoid_: Item, task, to-do

**Anyone**:
A chore that has no owner. Anyone can check it off, and it counts toward nobody's hit day.
_Avoid_: Shared, unassigned

**Done**:
A chore checked off on a particular day, either on that day or up to 7 days later; a late check-off counts the same. Every day starts with nothing done.
_Avoid_: Complete, checked

**Missed**:
A chore that wasn't done on a day it was scheduled. It doesn't carry over to the next day, but it can still be checked off for its own day up to 7 days later.
_Avoid_: Overdue, late

**Hit day**:
A day on which a person did every chore of theirs that was scheduled. Anyone chores don't count. A day with nothing scheduled is neither a hit nor a miss.
