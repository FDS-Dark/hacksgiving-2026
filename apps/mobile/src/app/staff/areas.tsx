import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { NeedMeasure, TractCoverage } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { CoverageMap, type CoverageLayer } from '@/components/staff/CoverageMap';
import { SHADES } from '@/lib/coverage';
import { Card, CardTitle, ChoiceRow, PageTitle } from '@/components/staff/kit';
import { ErrorBanner, Loading } from '@/components/ui';
import { CATEGORY_LABEL } from '@/lib/cases';
import { useCoverage } from '@/services/insights';
import { space, type, useTheme } from '@/theme/tokens';

const MEASURES = ['HOUSINSECU', 'FOODINSECU', 'LACKTRPT', 'SHUTUTILITY', 'EMOTIONSPT'] as const satisfies readonly NeedMeasure[];
type Measure = (typeof MEASURES)[number];
const MEASURE_LABEL: Record<Measure, string> = {
  HOUSINSECU: 'Housing',
  FOODINSECU: 'Food',
  LACKTRPT: 'Transportation',
  SHUTUTILITY: 'Utilities',
  EMOTIONSPT: 'Emotional support',
};
const LAYERS = ['need', 'incidents'] as const satisfies readonly CoverageLayer[];
const LAYER_LABEL: Record<CoverageLayer, string> = { need: 'Need (CDC)', incidents: 'Reviewed incidents' };
const PERIODS = ['30', '90', '365'] as const;
const PERIOD_LABEL: Record<(typeof PERIODS)[number], string> = { '30': '30 days', '90': '90 days', '365': '1 year' };

/**
 * Need versus coverage (items 21 and 23): census tracts on a map, filled
 * by a CDC PLACES need (or reviewed MPD incidents) and sized by ComForce
 * cases of the matching service placed there. Red rings and the list below
 * are the gaps: high need, few cases. GET /v1/insights/coverage.
 */
export default function AreasScreen() {
  const theme = useTheme();
  const [measure, setMeasure] = useState<Measure>('HOUSINSECU');
  const [layer, setLayer] = useState<CoverageLayer>('need');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('90');
  const [selected, setSelected] = useState<string | null>(null);
  const coverage = useCoverage(measure, Number(period));

  const data = coverage.data;
  const picked = data?.tracts.find((t) => t.tract_geoid === selected);

  return (
    <Page refreshing={coverage.isRefetching} onRefresh={() => coverage.refetch()} contentStyle={{ maxWidth: 720, gap: space.md }}>
      <BackLink to="/staff/insights" label="Insights" />
      <PageTitle title="Need vs coverage" subtitle={data ? `${data.measure_label}${data.need_year ? ` (CDC ${data.need_year})` : ''} · ComForce ${data.category ? `${CATEGORY_LABEL[data.category].toLowerCase()} ` : ''}cases, last ${PERIOD_LABEL[period]}` : undefined} />

      <View style={{ gap: space.sm }}>
        <ChoiceRow label="Need" options={MEASURES} value={measure} onChange={(m) => setMeasure(m ?? 'HOUSINSECU')} labels={MEASURE_LABEL} />
        <ChoiceRow label="Color by" options={LAYERS} value={layer} onChange={(l) => setLayer(l ?? 'need')} labels={LAYER_LABEL} />
        <ChoiceRow label="ComForce cases in" options={PERIODS} value={period} onChange={(p) => setPeriod(p ?? '90')} labels={PERIOD_LABEL} />
      </View>

      {coverage.isPending ? (
        <Loading label="Loading tracts" />
      ) : coverage.error || !data ? (
        <ErrorBanner error={coverage.error} onRetry={() => coverage.refetch()} />
      ) : (
        <>
          <CoverageMap tracts={data.tracts} layer={layer} onSelect={setSelected} />
          <Legend layer={layer} />
          {picked ? <TractCard tract={picked} label={data.measure_label} /> : null}

          <Card style={{ gap: space.sm }}>
            <CardTitle title="High need, few cases" icon="alert-circle-outline" />
            <Text style={[type.footnote, { color: theme.textSecondary }]}>{data.summary}</Text>
            {data.gaps.map((t) => (
              <Text
                key={t.tract_geoid}
                onPress={() => setSelected(t.tract_geoid)}
                accessibilityRole="button"
                style={[type.subhead, styles.gapRow, { color: theme.text, borderTopColor: theme.separator }]}
              >
                <Text style={{ fontWeight: '700' }}>Tract {t.name}</Text> · {t.need?.toFixed(1)}% · {t.cases} case{t.cases === 1 ? '' : 's'}
                {t.incidents ? ` · ${t.incidents} incidents` : ''}
              </Text>
            ))}
          </Card>

          <Text style={[type.caption, { color: theme.textSecondary }]}>
            Need: CDC PLACES model estimates of adults, by census tract. Incidents: MPD-reviewed (NIBRS) over the same period; tracts with fewer than 5 are left out. ComForce cases count only those with a known place.
          </Text>
        </>
      )}
    </Page>
  );
}

function Legend({ layer }: { layer: CoverageLayer }) {
  const theme = useTheme();
  return (
    <View style={styles.legend} accessibilityLabel={`Lighter is lower ${layer === 'need' ? 'need' : 'incidents'}, darker is higher. Bigger circles have more ComForce cases. A red ring is a gap.`}>
      <Text style={[type.caption, { color: theme.textSecondary }]}>Low</Text>
      {SHADES.map((c) => (
        <View key={c} style={[styles.swatch, { backgroundColor: c }]} />
      ))}
      <Text style={[type.caption, { color: theme.textSecondary }]}>High · bigger = more cases{layer === 'need' ? ' · red ring = gap' : ''}</Text>
    </View>
  );
}

function TractCard({ tract: t, label }: { tract: TractCoverage; label: string }) {
  const theme = useTheme();
  return (
    <Card style={{ gap: 4 }}>
      <Text style={[type.headline, { color: theme.text }]}>Tract {t.name}</Text>
      <Text style={[type.subhead, { color: theme.textSecondary }]}>
        {label}: {t.need === null || t.need === undefined ? 'no data' : `${t.need.toFixed(1)}% of adults`} · {t.cases} ComForce case{t.cases === 1 ? '' : 's'} ·{' '}
        {t.incidents === null || t.incidents === undefined ? 'under 5 incidents' : `${t.incidents} incidents`}
      </Text>
      {t.gap ? <Text style={[type.footnote, { color: theme.danger, fontWeight: '600' }]}>High need with few ComForce cases: a place for outreach.</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  gapRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  swatch: { width: 18, height: 10, borderRadius: 2 },
});
