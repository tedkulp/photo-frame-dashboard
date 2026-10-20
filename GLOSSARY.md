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

### Home

**Climate**:
Indoor temperature, humidity and thermostat setting. Always in Fahrenheit.
_Avoid_: Weather, inside weather
