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
The page with the full weather: now (feels-like, humidity, wind, UV, sunrise and sunset), the next hours, and the week. Opened from the rail or by tapping the weather on Today.
_Avoid_: Forecast page, weather screen

### Calendar

**Family calendar**:
The one calendar whose events belong to everyone. An event added for several people, or for someone with no writable calendar of their own, goes here.

**Read-only calendar**:
A calendar whose events the dashboard shows but can't add to or delete from, such as a person's Fastmail or work Outlook calendar.
_Avoid_: External calendar, subscribed calendar

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

**Home** (of a person):
A family member is home when Home Assistant places them in the home zone. Being at another zone, such as School, is away.
_Avoid_: In, present

**Away**:
A family member Home Assistant knows is somewhere other than home. When Home Assistant doesn't know, the person is neither home nor away.
_Avoid_: Out, absent, not home

**Phone layout**:
How the dashboard arranges itself on a phone held upright: one scrolling column per page and a tab bar at the bottom, with no Photos, ambient or night mode. Everywhere else it shows the frame's landscape layout, scaled to fit.
_Avoid_: Mobile view, responsive mode

### Chores

**Chore**:
A standing job someone in the family does, such as "Garbage to curb". It belongs to one person or to Anyone, sits in one routine, and happens on chosen days of the week. Changing who owns it, which days it happens or deleting it applies from today on; earlier days stay as they were.
_Avoid_: Item, task, to-do

**Routine**:
One of the two parts of the day that chores are grouped into: Morning or Evening.
_Avoid_: Time slot, period

**Anyone**:
A chore that has no owner. Anyone can check it off, and it counts toward nobody's hit day.
_Avoid_: Shared, unassigned

**Done**:
A chore checked off on a particular day. Every day starts with nothing done.
_Avoid_: Complete, checked

**Missed**:
A chore that wasn't done on a day it was scheduled. It doesn't carry over to the next day.
_Avoid_: Overdue, late

**Hit day**:
A day on which a person did every chore of theirs that was scheduled, across both routines. Anyone chores don't count. A day with nothing scheduled is neither a hit nor a miss.
