// The weather summary and advice lines, as two ordered rule tables: the first rule whose `when`
// matches gives the line. Edit, reorder or add rules here; dashboard/test/advice.test.js has a
// test per rule. Also loads in Node for those tests.
//
// Every rule gets the same `wx` (built by weather.js from the forecast, all temperatures in °F):
//   now      Date, the dashboard's current time
//   temp     current temperature
//   cond     current condition: sun, moon, partly, cloud, rain, snow or storm
//   hi, lo   today's high and low
//   wetNow   true when the current hour is a wet hour (chance of precipitation >= Advice.WET)
//   wetFrom  Date of the next wet hour later today, or null (only when not wetNow)
//   dryAt    Date the current wet stretch ends today, or null if it lasts all day (only when wetNow)
//   precip   'Rain', 'Snow' or 'Storms': what the wet hour now (or next) brings, else 'Rain'
(function (root) {
  'use strict';
  var Advice = root.Advice = {};

  Advice.WET = 50;  // % chance of precipitation that makes an hour a wet hour
  Advice.COOL = 55; // °F: below this it's jacket weather

  // "4 PM", "3:30 PM"
  function hour(d) {
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + (m ? ':' + (m < 10 ? '0' : '') + m : '') + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  function always() { return true; }

  Advice.summaryRules = [
    { when: function (wx) { return wx.wetNow && !wx.dryAt; }, say: function (wx) { return wx.precip + ' for the rest of the day'; } },
    { when: function (wx) { return wx.wetNow; }, say: function (wx) { return wx.precip + ' until ' + hour(wx.dryAt); } },
    { when: function (wx) { return wx.wetFrom; }, say: function (wx) { return wx.precip + ' from ' + hour(wx.wetFrom); } },
    { when: function (wx) { return wx.temp < Advice.COOL; }, say: 'Dry and cool' },
    { when: always, say: 'Dry all day' }
  ];

  Advice.adviceRules = [
    { when: function (wx) { return (wx.wetNow || wx.wetFrom) && wx.precip === 'Snow'; }, say: 'Boots and a warm coat' },
    { when: function (wx) { return wx.wetNow; }, say: 'Umbrella weather' },
    { when: function (wx) { return wx.wetFrom; }, say: 'Grab a rain jacket' },
    { when: function (wx) { return wx.temp < Advice.COOL; }, say: 'Jacket weather' },
    { when: always, say: 'Light layers' }
  ];

  // The line from the first matching rule ('' if none match).
  Advice.pick = function (rules, wx) {
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].when(wx)) return typeof rules[i].say === 'function' ? rules[i].say(wx) : rules[i].say;
    }
    return '';
  };
})(typeof window !== 'undefined' ? window : globalThis);
