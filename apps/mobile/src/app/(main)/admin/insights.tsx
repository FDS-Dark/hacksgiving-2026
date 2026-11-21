import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { BackLink } from '@/components/admin/BackLink';
import { DivergingColumns, RankedBars } from '@/components/charts/Bars';
import { ChartCard, Legend, StatTile } from '@/components/charts/ChartCard';
import { MeterList } from '@/components/charts/Figures';
import { Page } from '@/components/Page';
import { SectionHeading } from '@/components/brand';
import { Button, Chip, Chips, FieldLabel, Group, Notice, Row, Txt } from '@/components/ui';
import { useAdmin } from '@/lib/admin';
import { STAFF } from '@/lib/directory';
import { ANNUAL_BUDGET, FUNDING_GOAL, PERIODS, VOLUNTEER_HOUR_VALUE, buildInsights, money, sampleBusiness, type Insight, type Period } from '@/lib/insights';
import { STATUS, useChartTheme } from '@/theme/chart';
import { radius, space, useTheme } from '@/theme/tokens';

const ALL = 'All';

/**
 * Business insights: what needs doing (ranked actions with a button to do
 * it), then the numbers behind them: budget, funding, cost per resident,
 * volunteer pipeline, and partner follow-through.
 */
export default function InsightsScreen() {
  const theme = useTheme();
  const chart = useChartTheme();
  const { width } = useWindowDimensions();
  const { requests, postings, posts, setAdminMode } = useAdmin();
  const [period, setPeriod] = useState<Period>('month');
  const [area, setArea] = useState<string>(ALL);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [showDone, setShowDone] = useState(false);

  const data = useMemo(() => sampleBusiness(period), [period]);
  const insights = useMemo(() => buildInsights(data, { requests, postings, posts, staff: STAFF }), [data, requests, postings, posts]);
  const active = insights.filter((i) => !done.has(i.id));
  const areas = [ALL, ...new Set(insights.map((i) => i.area))];
  const shown = (showDone ? insights : active).filter((i) => area === ALL || i.area === area);
  const counts = (['critical', 'serious', 'warning'] as const).map((l) => [l, active.filter((i) => i.level === l).length] as const);
  const twoUp = width >= 960;

  const costPer = data.programSpend / (data.residentsServed || 1);
  const prevCostPer = (data.programSpend * 0.97) / (data.residentsPrev || 1);
  // Received money is part of Awarded; count awards once.
  const secured = data.pipeline.find((p) => p.stage === 'Awarded')?.amount ?? 0;
  const refSent = data.partnerCompletion.reduce((s, p) => s + p.sent, 0);
  const refDone = data.partnerCompletion.reduce((s, p) => s + p.completed, 0);
  const periodLabel = PERIODS.find((p) => p.key === period)!.label.toLowerCase();
  const programs = [...data.programs].sort((a, b) => b.cost / b.residents - a.cost / a.residents);

  const act = (i: Insight) => {
    if (!i.href) return;
    if (i.adminMode) setAdminMode(true);
    router.navigate(i.href);
  };

  return (
    <Page contentStyle={{ maxWidth: 1100 }}>
      <BackLink label="Admin" href="/admin" />
      <SectionHeading title="Business Insights" kicker="What needs attention, why, and what to do next." />

      <Notice icon="construct-outline" tone="warning">
        Requests, training, postings, and posts are live from the admin pages. Budget, funding, and program numbers are sample data.
      </Notice>

      <View style={{ gap: 6 }}>
        <FieldLabel>Period</FieldLabel>
        <Chips>
          {PERIODS.map((p) => (
            <Chip key={p.key} label={p.label} active={period === p.key} onPress={() => setPeriod(p.key)} />
          ))}
        </Chips>
      </View>

      {/* Actions first: the point of the page. */}
      <View style={{ gap: space.md }}>
        <View style={styles.actionsHead}>
          <Text accessibilityRole="header" style={[styles.h2, { color: theme.text }]}>
            Actions
          </Text>
          <View style={styles.counts}>
            {counts.map(([l, n]) =>
              n ? (
                <View key={l} style={styles.count}>
                  <Ionicons name={STATUS[l].icon} size={15} color={STATUS[l].color} />
                  <Text style={[styles.countText, { color: theme.textSecondary }]}>
                    {n} {STATUS[l].label.toLowerCase()}
                  </Text>
                </View>
              ) : null,
            )}
          </View>
        </View>
        <Chips scroll>
          {areas.map((a) => (
            <Chip
              key={a}
              label={a}
              count={a === ALL ? active.length : active.filter((i) => i.area === a).length}
              active={area === a}
              onPress={() => setArea(a)}
            />
          ))}
        </Chips>
        {shown.length ? (
          <View style={[styles.cards, twoUp && styles.cardsWide]}>
            {shown.map((i) => (
              <View key={i.id} style={twoUp ? styles.cardCell : undefined}>
                <InsightCard
                  insight={i}
                  done={done.has(i.id)}
                  onAct={i.href ? () => act(i) : undefined}
                  onDone={() =>
                    setDone((prev) => {
                      const next = new Set(prev);
                      if (next.has(i.id)) next.delete(i.id);
                      else next.add(i.id);
                      return next;
                    })
                  }
                />
              </View>
            ))}
          </View>
        ) : (
          <Notice icon="checkmark-done-outline">Nothing to act on here. Nice work.</Notice>
        )}
        {done.size ? (
          <Button label={showDone ? 'Hide done' : `Show ${done.size} done`} variant="plain" onPress={() => setShowDone(!showDone)} style={{ alignSelf: 'flex-start' }} />
        ) : null}
      </View>

      <Text accessibilityRole="header" style={[styles.h2, { color: theme.text, marginTop: space.md }]}>
        The numbers
      </Text>
      <View style={styles.kpis}>
        <Kpi>
          <StatTile label="Residents served" value={data.residentsServed.toLocaleString('en-US')} delta={data.residentsServed - data.residentsPrev} footnote={periodLabel} />
        </Kpi>
        <Kpi>
          <StatTile
            label="Cost per resident served"
            value={`$${Math.round(costPer)}`}
            delta={Math.round(costPer - prevCostPer)}
            lowerIsBetter
            footnote="Program spend ÷ residents"
          />
        </Kpi>
        <Kpi>
          <StatTile
            label="Volunteer hours"
            value={data.volunteerHours.toLocaleString('en-US')}
            delta={data.volunteerHours - data.volunteerHoursPrev}
            footnote={`≈ ${money(data.volunteerHours * VOLUNTEER_HOUR_VALUE)} of donated time`}
          />
        </Kpi>
        <Kpi>
          <StatTile label="Funding secured" value={money(secured)} footnote={`${Math.round((secured / FUNDING_GOAL) * 100)}% of ${money(FUNDING_GOAL)} goal this year`} />
        </Kpi>
        <Kpi>
          <StatTile label="Referrals completed" value={`${Math.round((refDone / (refSent || 1)) * 100)}%`} footnote={`${refDone} of ${refSent} ended in service`} />
        </Kpi>
      </View>

      <Grid twoUp={twoUp}>
        <ChartCard
          title="Spending vs plan, by month"
          subtitle={`$ thousands over or under each month’s plan. ${money(Math.abs(data.spendActual.at(-1)! - data.spendPlan.at(-1)!) * 1000)} ${data.spendActual.at(-1)! >= data.spendPlan.at(-1)! ? 'over' : 'under'} plan so far on a ${money(ANNUAL_BUDGET)} budget; summer months drove it.`}
          legend={
            <Legend
              items={[
                { label: 'Over plan', color: chart.diverging.pos },
                { label: 'Under plan', color: chart.diverging.neg },
              ]}
            />
          }
          table={{
            columns: ['Month', 'Over/under ($K)', 'Year to date ($K)'],
            rows: data.months.map((m, i) => [m, data.monthlyVariance[i], data.spendActual[i] - data.spendPlan[i]]),
          }}
        >
          <DivergingColumns
            labels={data.months}
            values={data.monthlyVariance}
            format={(v) => `$${Number.isInteger(v) ? v : v.toFixed(1)}K`}
            posColor={chart.diverging.pos}
            negColor={chart.diverging.neg}
          />
        </ChartCard>

        <ChartCard
          title="Budget used by category"
          subtitle={`Share of each annual budget spent. The tick is where you’d be on pace (${Math.round(data.yearElapsed * 100)}% of the year).`}
          table={{
            columns: ['Category', 'Budget', 'Spent', 'Used', 'On pace'],
            rows: data.categories.map((c) => [c.name, money(c.budget), money(c.spent), `${Math.round((c.spent / c.budget) * 100)}%`, `${Math.round(data.yearElapsed * 100)}%`]),
          }}
        >
          <MeterList
            goal={data.yearElapsed}
            overIsBad
            status={(v, bad) => (v > 1 ? 'Over the annual budget' : bad ? 'Spending ahead of pace' : v < data.yearElapsed - 0.25 ? 'Well under pace: check restricted funds' : 'On pace')}
            items={data.categories.map((c) => ({ name: c.name, detail: `${money(c.spent)} of ${money(c.budget)}`, value: c.spent / c.budget }))}
          />
        </ChartCard>

        <ChartCard
          title="Funding pipeline"
          subtitle="Grants and contracts by stage, this year. Received is the part of Awarded paid out so far."
          table={{ columns: ['Stage', 'Amount', 'Grants'], rows: data.pipeline.map((p) => [p.stage, money(p.amount), p.count]) }}
        >
          <RankedBars items={data.pipeline.map((p) => ({ name: `${p.stage} (${p.count})`, value: p.amount }))} color={chart.series[0]} unit="dollars" format={money} share="none" />
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <FieldLabel>Coming up</FieldLabel>
            <Group>
              {data.deadlines.map((d) => {
                const days = d.daysLeft;
                const level = days <= 7 ? 'critical' : days <= 21 ? 'serious' : 'good';
                return (
                  <Row
                    key={d.name}
                    title={d.name}
                    subtitle={`${d.kind} · ${money(d.amount)} · due ${d.due}`}
                    leading={<Ionicons name={STATUS[level].icon} size={18} color={STATUS[level].color} />}
                    detail={`${days} days`}
                  />
                );
              })}
            </Group>
          </View>
        </ChartCard>

        <ChartCard
          title="Cost per resident served"
          subtitle={`By program, ${periodLabel}. ${programs[0].name} costs the most per person; ${programs[programs.length - 1].name} the least.`}
          table={{ columns: ['Program', 'Spend', 'Residents', 'Per resident'], rows: programs.map((p) => [p.name, money(p.cost), p.residents, `$${Math.round(p.cost / p.residents)}`]) }}
        >
          <RankedBars items={programs.map((p) => ({ name: p.name, value: Math.round(p.cost / p.residents) }))} color={chart.series[0]} unit="dollars per resident" format={(v) => `$${v}`} share="none" />
        </ChartCard>

        <ChartCard
          title="Volunteer pipeline"
          subtitle={`From sign-up to active, ${periodLabel}. The biggest drop is between training and a first shift.`}
          table={{ columns: ['Stage', 'People', 'Of sign-ups'], rows: data.funnel.map((f) => [f.stage, f.count, `${Math.round((f.count / data.funnel[0].count) * 100)}%`]) }}
        >
          <RankedBars items={data.funnel.map((f) => ({ name: f.stage, value: f.count }))} color={chart.series[0]} unit="people" share="first" />
        </ChartCard>

        <ChartCard
          title="Partner follow-through"
          subtitle={`Referrals that ended in service, ${periodLabel}. Goal: 80%.`}
          table={{ columns: ['Partner', 'Sent', 'Completed', 'Rate'], rows: data.partnerCompletion.map((p) => [p.name, p.sent, p.completed, `${Math.round((p.completed / (p.sent || 1)) * 100)}%`]) }}
        >
          <MeterList goal={0.8} items={data.partnerCompletion.map((p) => ({ name: p.name, detail: `${p.completed} of ${p.sent} referrals`, value: p.completed / (p.sent || 1) }))} />
        </ChartCard>
      </Grid>
    </Page>
  );
}

function InsightCard({ insight: i, done, onAct, onDone }: { insight: Insight; done: boolean; onAct?: () => void; onDone: () => void }) {
  const theme = useTheme();
  const s = STATUS[i.level];
  return (
    <View
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator, opacity: done ? 0.6 : 1 }]}
      accessibilityLabel={`${s.label}. ${i.area}. ${i.title}`}
    >
      <View style={[styles.cardEdge, { backgroundColor: s.color }]} />
      <View style={styles.cardHead}>
        <Ionicons name={s.icon} size={18} color={s.color} />
        <Text style={[styles.level, { color: theme.text }]}>{s.label}</Text>
        <Text style={[styles.area, { color: theme.textTertiary }]}>· {i.area}</Text>
      </View>
      <Txt variant="headline">{i.title}</Txt>
      <Txt variant="subhead" tone="secondary">
        {i.detail}
      </Txt>
      <View style={styles.cardActions}>
        {onAct && !done ? <Button label={i.action} icon="arrow-forward" variant="tinted" onPress={onAct} /> : null}
        {!onAct && !done ? (
          <Txt variant="footnote" tone="secondary" style={{ alignSelf: 'center' }}>
            Next step: {i.action.toLowerCase()}
          </Txt>
        ) : null}
        <Button label={done ? 'Undo' : 'Mark done'} variant="plain" onPress={onDone} />
      </View>
    </View>
  );
}

function Kpi({ children }: { children: ReactNode }) {
  return <View style={styles.kpi}>{children}</View>;
}

function Grid({ twoUp, children }: { twoUp: boolean; children: ReactNode[] }) {
  if (!twoUp) return <View style={{ gap: space.lg }}>{children}</View>;
  return (
    <View style={styles.grid}>
      {children.map((c, i) => (
        <View key={i} style={styles.cell}>
          {c}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  h2: { fontSize: 20, fontWeight: '800' },
  actionsHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  count: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  countText: { fontSize: 13, fontWeight: '600' },
  cards: { gap: space.md },
  cardsWide: { flexDirection: 'row', flexWrap: 'wrap', gap: 0, margin: -space.sm },
  cardCell: { width: '50%', padding: space.sm },
  card: { gap: space.sm, padding: space.lg, paddingLeft: space.lg + 4, borderWidth: 1, borderRadius: radius.md, overflow: 'hidden', flexGrow: 1 },
  cardEdge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  level: { fontSize: 13, fontWeight: '800' },
  area: { fontSize: 13 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', margin: -space.xs },
  kpi: { flexGrow: 1, flexBasis: 190, padding: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', margin: -space.sm },
  cell: { width: '50%', padding: space.sm },
});
