import { hours, soft, timeAgo } from '@/components/worker/kit';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('timeAgo', () => {
  it('reads like a person would say it', () => {
    expect(timeAgo(ago(20_000), NOW)).toBe('just now');
    expect(timeAgo(ago(5 * 60_000), NOW)).toBe('5m ago');
    expect(timeAgo(ago(3 * 3_600_000), NOW)).toBe('3h ago');
    expect(timeAgo(ago(2 * 86_400_000), NOW)).toBe('2d ago');
  });

  it('never goes negative for a clock slightly ahead', () => {
    expect(timeAgo(new Date(NOW + 5_000).toISOString(), NOW)).toBe('just now');
  });
});

describe('hours', () => {
  it('picks a unit that fits the average resolution time', () => {
    expect(hours(null)).toBe('—');
    expect(hours(0.0001)).toBe('1 min');
    expect(hours(0.5)).toBe('30 min');
    expect(hours(5.25)).toBe('5.3 h');
    expect(hours(72)).toBe('3.0 days');
  });
});

describe('soft', () => {
  it('adds alpha to a hex color and leaves other colors alone', () => {
    expect(soft('#0F6B3A', 0.5)).toBe('#0F6B3A80');
    expect(soft('rgba(0,0,0,0.1)')).toBe('rgba(0,0,0,0.1)');
  });
});
