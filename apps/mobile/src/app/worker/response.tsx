import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { GroupedColumns, RankedBars } from '@/components/charts/Bars';
import { ChartCard, Legend, StatTile } from '@/components/charts/ChartCard';
import { Heatmap, MeterList, SegmentedBar } from '@/components/charts/Figures';
import { LineChart } from '@/components/charts/LineChart';
import { Page } from '@/components/Page';
import { SectionHeading } from '@/components/brand';
import { Chip, Chips, FieldLabel, Notice } from '@/components/ui';
import {
  DISTRICTS,
  HEAT_BLOCKS,
  HEAT_DAYS,
  PRIORITY_GOAL,
  RANGES,
  RESPONSE_TARGET_MIN,
  bucket,
  generate,
  median,
  type District,
  type RangeDays,
} from '@/lib/response';
import { useChartTheme } from '@/theme/chart';
import { space } from '@/theme/tokens';

/**
 * Rapid response and EMS: how fast teams reach people, how that compares
 * with EMS, what the calls are, when they come in, and how they end.
 * One filter row scopes every number on the page.
 */
export default function ResponseDashboard() {
  const chart = useChartTheme();
  const { width } = useWindowDimensions();
  const [range, setRange] = useState<RangeDays>(30);
  const [district, setDistrict] = useState<District>('All districts');
  const data = useMemo(() => generate(range, district), [range, district]);
  const { totals: t, previous: p } = data;
  const twoUp = width >= 960;

  // Daily points up to 30 days; weekly beyond, so the line stays readable.
  const linePoints = bucket(data.days, range === 90 ? 7 : 1);
  const lineLabels = linePoints.map((b) => b.label);
  const comforce = linePoints.map((b) => Math.round(median(b.days.map((d) => d.comforceMin)) * 10) / 10);
  const ems = linePoints.map((b) => Math.round(median(b.days.map((d) => d.emsMin)) * 10) / 10);

  const narcanPoints = bucket(data.days, range === 7 ? 1 : 7);
  const narcanLabels = narcanPoints.map((b) => b.label);
  const given = narcanPoints.map((b) => b.days.reduce((s, d) => s + d.naloxone, 0));
  const reversed = narcanPoints.map((b) => b.days.reduce((s, d) => s + d.reversals, 0));

  const lead = Math.round((t.emsMin - t.comforceMin) * 10) / 10;
  const prevLead = Math.round((p.emsMin - p.comforceMin) * 10) / 10;
  const rangeLabel = RANGES.find((r) => r.days === range)!.label.toLowerCase();

  return (
    <Page contentStyle={{ maxWidth: 1100 }}>
      <SectionHeading title="Rapid Response & EMS" kicker="Response times, EMS coordination, overdose response, and call patterns." />

      <Notice icon="construct-outline" tone="warning">
        Sample data. These charts will read from dispatch and incident records once they’re connected.
      </Notice>

      {/* One filter row; it scopes every number below. */}
      <View style={styles.filters}>
        <View style={{ gap: 6 }}>
          <FieldLabel>Date range</FieldLabel>
          <Chips>
            {RANGES.map((r) => (
              <Chip key={r.days} label={r.label} active={range === r.days} onPress={() => setRange(r.days)} />
            ))}
          </Chips>
        </View>
        <View style={{ gap: 6 }}>
          <FieldLabel>District</FieldLabel>
          <Chips>
            {DISTRICTS.map((d) => (
              <Chip key={d} label={d} active={district === d} onPress={() => setDistrict(d)} />
            ))}
          </Chips>
        </View>
      </View>

      <View style={styles.kpis}>
        <Kpi>
          <StatTile label="Incidents responded to" value={t.incidents.toLocaleString('en-US')} delta={t.incidents - p.incidents} neutral />
        </Kpi>
        <Kpi>
          <StatTile
            label="Median time to scene"
            value={t.comforceMin.toFixed(1)}
            unit="min"
            delta={Math.round((t.comforceMin - p.comforceMin) * 10) / 10}
            lowerIsBetter
            footnote={`Target ${RESPONSE_TARGET_MIN} min`}
          />
        </Kpi>
        <Kpi>
          <StatTile label="Ahead of EMS (median)" value={lead.toFixed(1)} unit="min" delta={Math.round((lead - prevLead) * 10) / 10} footnote="On calls both answered" />
        </Kpi>
        <Kpi>
          <StatTile label="EMS transports" value={t.transports.toLocaleString('en-US')} delta={t.transports - p.transports} neutral />
        </Kpi>
        <Kpi>
          <StatTile
            label="Overdose reversals"
            value={t.reversals.toLocaleString('en-US')}
            delta={t.reversals - p.reversals}
            neutral
            footnote={`${t.naloxone} naloxone administrations`}
          />
        </Kpi>
      </View>

      <Grid twoUp={twoUp}>
        <ChartCard
          title="Time to scene: ComForce vs EMS"
          subtitle={`Median minutes, ${rangeLabel}. ComForce ${t.comforceMin} min, EMS ${t.emsMin} min, target ${RESPONSE_TARGET_MIN} min.`}
          legend={
            <Legend
              shape="line"
              items={[
                { label: 'ComForce team', color: chart.series[0] },
                { label: 'EMS', color: chart.series[1] },
                { label: `Target ${RESPONSE_TARGET_MIN} min`, color: chart.reference, thin: true },
              ]}
            />
          }
          table={{ columns: [range === 90 ? 'Week' : 'Day', 'ComForce (min)', 'EMS (min)'], rows: linePoints.map((b, i) => [b.span, comforce[i], ems[i]]) }}
        >
          <LineChart
            labels={lineLabels}
            unit="min"
            tipLabels={linePoints.map((b) => b.span)}
            reference={{ value: RESPONSE_TARGET_MIN }}
            series={[
              { name: 'ComForce', color: chart.series[0], values: comforce },
              { name: 'EMS', color: chart.series[1], values: ems },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Calls reached within target"
          subtitle={`Share of calls reached in time, by priority. Goal: ${Math.round(PRIORITY_GOAL * 100)}%.`}
          table={{
            columns: ['Priority', 'Target', 'Calls', 'Within target'],
            rows: data.priorities.map((x) => [x.name, `${x.targetMin} min`, x.calls, `${Math.round(x.within * 100)}%`]),
          }}
        >
          <MeterList goal={PRIORITY_GOAL} items={data.priorities.map((x) => ({ name: x.name, detail: `${x.calls.toLocaleString('en-US')} calls · target ${x.targetMin} min`, value: x.within }))} />
        </ChartCard>

        <ChartCard
          title="What the calls were"
          subtitle={`Incidents by type, ${rangeLabel}. ${data.types[0].name} leads.`}
          table={{ columns: ['Type', 'Incidents', 'Share'], rows: data.types.map((x) => [x.name, x.count, `${Math.round((x.count / t.incidents) * 100)}%`]) }}
        >
          <RankedBars items={data.types.map((x) => ({ name: x.name, value: x.count }))} color={chart.series[0]} unit="incidents" />
        </ChartCard>

        <ChartCard
          title="When calls come in"
          subtitle="Incidents by day and time. Use it to plan staffing."
          table={{ columns: ['Day', ...HEAT_BLOCKS], rows: HEAT_DAYS.map((d, i) => [d, ...data.heat[i]]) }}
        >
          <Heatmap rows={HEAT_DAYS} columns={HEAT_BLOCKS} values={data.heat} unit="incidents" />
        </ChartCard>

        <ChartCard
          title="How incidents ended"
          subtitle={`${Math.round((data.outcomes[0].count / t.incidents) * 100)}% resolved on scene without EMS or police.`}
          table={{ columns: ['Outcome', 'Incidents', 'Share'], rows: data.outcomes.map((x) => [x.name, x.count, `${Math.round((x.count / t.incidents) * 100)}%`]) }}
        >
          <SegmentedBar parts={data.outcomes.map((x) => ({ name: x.name, value: x.count }))} />
        </ChartCard>

        <ChartCard
          title="Overdose response"
          subtitle={`Naloxone given and overdoses reversed, ${range === 7 ? 'by day' : 'by week'}. ${t.naloxone ? Math.round((t.reversals / t.naloxone) * 100) : 0}% reversed.`}
          legend={
            <Legend
              items={[
                { label: 'Naloxone given', color: chart.series[0] },
                { label: 'Reversed', color: chart.series[1] },
              ]}
            />
          }
          table={{ columns: [range === 7 ? 'Day' : 'Week', 'Naloxone given', 'Reversed'], rows: narcanPoints.map((b, i) => [b.span, given[i], reversed[i]]) }}
        >
          <GroupedColumns
            labels={narcanLabels}
            tipLabels={narcanPoints.map((b) => b.span)}
            series={[
              { name: 'Naloxone given', color: chart.series[0], values: given },
              { name: 'Reversed', color: chart.series[1], values: reversed },
            ]}
          />
        </ChartCard>
      </Grid>
    </Page>
  );
}

function Kpi({ children }: { children: ReactNode }) {
  return <View style={styles.kpi}>{children}</View>;
}

/** One column on phones, two side by side on wide screens. */
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
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', margin: -space.xs },
  kpi: { flexGrow: 1, flexBasis: 190, padding: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', margin: -space.sm },
  cell: { width: '50%', padding: space.sm },
});
