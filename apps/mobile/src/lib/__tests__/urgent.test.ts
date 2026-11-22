import { describe, expect, it } from '@jest/globals';

import {
  alertView,
  bannerLine,
  bannerTitle,
  distanceLabel,
  hasPendingOffer,
  milesBetween,
  mmss,
  movesOnLabel,
  offerLine,
  responseTime,
  secondsLeft,
  takenLabel,
  type AlertLike,
} from '@/lib/urgent';

const NOW = Date.UTC(2026, 10, 21, 21, 41, 0);
const inSeconds = (s: number) => new Date(NOW + s * 1000).toISOString();

const alert = (over: Partial<AlertLike> = {}): AlertLike => ({
  case_number: 1048,
  case_title: 'Conflict near N 27th & Wells',
  status: 'offering',
  accepted_by: null,
  accepted_by_name: null,
  my_offer: { expires_at: inSeconds(272), outcome: 'pending' },
  next_name: 'Devon Harris',
  ...over,
});

describe('countdown', () => {
  it('formats m:ss', () => {
    expect(mmss(272)).toBe('4:32');
    expect(mmss(5)).toBe('0:05');
    expect(mmss(0)).toBe('0:00');
    expect(mmss(-3)).toBe('0:00');
  });

  it('counts whole seconds left and stops at zero', () => {
    expect(secondsLeft(inSeconds(272), NOW)).toBe(272);
    expect(secondsLeft(inSeconds(0.2), NOW)).toBe(1);
    expect(secondsLeft(inSeconds(-30), NOW)).toBe(0);
    expect(secondsLeft(inSeconds(60), new Date(NOW))).toBe(60);
  });

  it('names who it moves to, by first name', () => {
    expect(movesOnLabel(alert(), inSeconds(272), NOW)).toBe('Moves to Devon in 4:32');
    expect(movesOnLabel(alert({ next_name: null }), inSeconds(272), NOW)).toBe('Moves on in 4:32');
    expect(movesOnLabel(alert(), inSeconds(-1), NOW)).toBe('Moving to Devon now');
    expect(movesOnLabel(alert({ next_name: '  ' }), inSeconds(-1), NOW)).toBe('Moving on now');
  });

  it('writes the S7 card line', () => {
    expect(offerLine(alert(), inSeconds(252), NOW)).toBe('You’re on call. Accept within 4:12 or it goes to Devon.');
    expect(offerLine(alert({ next_name: null }), inSeconds(252), NOW)).toBe('You’re on call. Accept within 4:12 or it moves on.');
    expect(offerLine(alert(), inSeconds(-5), NOW)).toBe('You’re on call. Time’s up: it’s going to Devon.');
  });
});

describe('alertView', () => {
  const me = 'user-maria';

  it('responds while the alert is open', () => {
    expect(alertView(alert(), me)).toBe('respond');
    expect(alertView(alert({ status: 'unanswered', my_offer: null }), me)).toBe('respond');
    // A lapsed offer can still accept.
    expect(alertView(alert({ my_offer: { expires_at: inSeconds(-1), outcome: 'timed_out' } }), me)).toBe('respond');
  });

  it('is responding when I accepted', () => {
    expect(alertView(alert({ status: 'accepted', accepted_by: me }), me)).toBe('responding');
    expect(alertView(alert({ status: 'accepted', accepted_by: 'x', my_offer: { expires_at: inSeconds(0), outcome: 'accepted' } }), null)).toBe('responding');
  });

  it('is taken when someone else accepted', () => {
    const a = alert({ status: 'accepted', accepted_by: 'user-devon', accepted_by_name: 'Devon Harris', my_offer: { expires_at: inSeconds(0), outcome: 'superseded' } });
    expect(alertView(a, me)).toBe('taken');
    expect(alertView(a, undefined)).toBe('taken');
    expect(takenLabel(a)).toBe('Taken by Devon Harris');
    expect(takenLabel({ accepted_by_name: null })).toBe('Taken by someone else');
  });

  it('is closed when resolved or cancelled', () => {
    expect(alertView(alert({ status: 'resolved' }), me)).toBe('closed');
    expect(alertView(alert({ status: 'cancelled', accepted_by: me }), me)).toBe('closed');
  });

  it('only counts a pending offer on an open alert', () => {
    expect(hasPendingOffer(alert())).toBe(true);
    expect(hasPendingOffer(alert({ my_offer: null }))).toBe(false);
    expect(hasPendingOffer(alert({ status: 'accepted' }))).toBe(false);
    expect(hasPendingOffer(alert({ my_offer: { expires_at: inSeconds(10), outcome: 'passed' } }))).toBe(false);
  });
});

describe('banner', () => {
  it('leads with the case title', () => {
    expect(bannerTitle(alert())).toBe('Urgent: Conflict near N 27th & Wells');
  });

  it('says when nobody has accepted', () => {
    expect(bannerLine(alert({ status: 'unanswered', my_offer: null }))).toBe('Nobody has accepted #1048');
    expect(bannerLine(alert())).toBe('#1048 · offered to you, tap to respond');
    expect(bannerLine(alert({ my_offer: null }))).toBe('#1048 · finding someone on call');
  });
});

describe('distance', () => {
  it('measures straight-line miles', () => {
    // About 1.2 miles across Milwaukee's near west side.
    const miles = milesBetween({ latitude: 43.0389, longitude: -87.9065 }, { latitude: 43.0563, longitude: -87.9065 });
    expect(miles).toBeCloseTo(1.2, 1);
    expect(milesBetween({ latitude: 43, longitude: -88 }, { latitude: 43, longitude: -88 })).toBe(0);
  });

  it('walks short distances and drives longer ones', () => {
    expect(distanceLabel(0.05)).toBe('Right nearby');
    expect(distanceLabel(0.4)).toBe('0.4 mi away · about 8 min walk');
    expect(distanceLabel(1.2)).toBe('1.2 mi away · about 6 min drive');
    expect(distanceLabel(12.4)).toBe('12 mi away · about 51 min drive');
  });
});

describe('responseTime', () => {
  it('reads like "4 min"', () => {
    expect(responseTime(250)).toBe('4 min');
    expect(responseTime(45.4)).toBe('45 sec');
    expect(responseTime(4500)).toBe('1 h 15 min');
    expect(responseTime(7200)).toBe('2 h');
    expect(responseTime(null)).toBe('—');
    expect(responseTime(undefined)).toBe('—');
  });
});
