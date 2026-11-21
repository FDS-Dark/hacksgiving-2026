import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button, Chip, Chips, EmptyState, Field, Group, Header, Notice, Row, Screen, Txt, success } from '@/components/ui';
import {
  FALLBACK_OPPORTUNITIES,
  FALLBACK_RESOURCES,
  communityApi,
  type PublicResource,
  useAssistanceRequests,
  useCommunityFeed,
  useCommunityResources,
  useCreateAssistanceRequest,
  useCreateCommunityPost,
  useOpportunities,
} from '@/services/community';
import { useDeviceLocation } from '@/services/deviceLocation';
import { milesBetween } from '@/services/recentCalls';
import { radius, space, useTheme } from '@/theme/tokens';

type Section = 'resources' | 'request' | 'opportunities' | 'feed';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'resources', label: 'Find help' },
  { id: 'request', label: 'Request help' },
  { id: 'opportunities', label: 'Get involved' },
  { id: 'feed', label: 'Community' },
];
const REQUEST_CATEGORIES = ['Food', 'Housing', 'Safety support', 'Mental health', 'Transportation', 'Other'];

function resourceAction(resource: PublicResource) {
  if (resource.slug === 'milwaukee-911') return { label: 'Call 911', url: 'tel:911' };
  if (resource.slug === 'impact-211') return { label: 'Call 211', url: 'tel:211' };
  if (resource.slug === '988-lifeline') return { label: 'Call 988', url: 'tel:988' };
  if (resource.phone_e164) return { label: 'Call', url: `tel:${resource.phone_e164}` };
  if (resource.website_url) return { label: 'Open', url: resource.website_url };
  return null;
}

function ResourceList({ resources }: { resources: (PublicResource & { distance?: number })[] }) {
  return (
    <Group header={`${resources.length} trusted resources`} footer="Listings show public contact information only and are periodically verified.">
      {resources.map((resource) => {
        const action = resourceAction(resource);
        return (
          <Row
            key={resource.id}
            title={resource.name}
            subtitle={`${resource.description}${resource.hours_label ? ` · ${resource.hours_label}` : ''}${resource.distance !== undefined ? ` · ${resource.distance.toFixed(1)} mi away` : ''}`}
            detail={action?.label}
            detailTint={resource.is_emergency ? 'rgba(180,35,24,0.09)' : undefined}
            detailColor={resource.is_emergency ? '#B42318' : undefined}
            tile={{ icon: resource.is_emergency ? 'shield-alert' : 'hand-heart', color: resource.is_emergency ? '#B42318' : '#247A63' }}
            accessory={action ? 'chevron' : undefined}
            onPress={action ? () => Linking.openURL(action.url) : undefined}
          />
        );
      })}
    </Group>
  );
}

export default function CommunityScreen() {
  const theme = useTheme();
  const [section, setSection] = useState<Section>('resources');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [requestCategory, setRequestCategory] = useState('Food');
  const [requestSummary, setRequestSummary] = useState('');
  const [requestNeighborhood, setRequestNeighborhood] = useState('');
  const [postBody, setPostBody] = useState('');
  const [postNeighborhood, setPostNeighborhood] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [postSubmitted, setPostSubmitted] = useState(false);

  const resources = useCommunityResources(search);
  const opportunities = useOpportunities();
  const requests = useAssistanceRequests();
  const feed = useCommunityFeed();
  const createRequest = useCreateAssistanceRequest();
  const createPost = useCreateCommunityPost();
  const device = useDeviceLocation();
  const matchedResources = resources.data ?? FALLBACK_RESOURCES.filter((resource) => {
    if (!search) return true;
    const haystack = `${resource.name} ${resource.category} ${resource.description}`.toLowerCase();
    return search.toLowerCase().split(/\s+/).some((term) => haystack.includes(term));
  });
  const visibleResources = matchedResources
    .map((resource) => resource.latitude !== null && resource.longitude !== null && device.location
      ? { ...resource, distance: milesBetween(device.location, { latitude: resource.latitude, longitude: resource.longitude }) }
      : resource)
    .sort((a, b) => ('distance' in a ? a.distance : Number.POSITIVE_INFINITY) - ('distance' in b ? b.distance : Number.POSITIVE_INFINITY));
  const visibleOpportunities = opportunities.data ?? FALLBACK_OPPORTUNITIES;

  const ask = async () => {
    const question = searchDraft.trim();
    if (!question) return;
    setSearch(question);
    setAnswering(true);
    try {
      const result = await communityApi.assistant(question);
      setAnswer(result.answer);
    } catch {
      setAnswer('I searched the local fallback catalog below. For broader navigation, call 211. Call 911 for immediate danger.');
    } finally {
      setAnswering(false);
    }
  };

  const submitRequest = async () => {
    if (!requestSummary.trim()) return;
    await createRequest.mutateAsync({ category: requestCategory, summary: requestSummary.trim(), neighborhood: requestNeighborhood.trim() || undefined });
    setRequestSummary('');
    setRequestNeighborhood('');
    success();
  };

  const submitPost = async () => {
    if (!postBody.trim()) return;
    await createPost.mutateAsync({ body: postBody.trim(), neighborhood: postNeighborhood.trim() || undefined, anonymous });
    setPostBody('');
    setPostNeighborhood('');
    setPostSubmitted(true);
    success();
  };

  const refresh = () => {
    resources.refetch();
    opportunities.refetch();
    requests.refetch();
    feed.refetch();
  };

  return (
    <Screen refreshing={resources.isRefetching || opportunities.isRefetching || feed.isRefetching} onRefresh={refresh}>
      <Header title="Community hub" subtitle="Find help, ask for support, and connect with Milwaukee neighbors." />
      <Chips scroll>
        {SECTIONS.map((item) => <Chip key={item.id} label={item.label} active={section === item.id} onPress={() => setSection(item.id)} />)}
      </Chips>

      {section === 'resources' ? (
        <>
          <View style={[styles.assistantCard, { backgroundColor: theme.accentSoft }]}>
            <View style={styles.assistantTitle}>
              <Ionicons name="sparkles" size={22} color={theme.accent} />
              <Txt variant="headline">Ask the resource guide</Txt>
            </View>
            <Txt variant="subhead" tone="secondary">Describe what you need. Answers only use the verified public catalog.</Txt>
            <Field value={searchDraft} onChangeText={setSearchDraft} placeholder="Food tonight, safe shelter, counseling…" returnKeyType="search" onSubmitEditing={ask} />
            <Button label="Find matching help" icon="search-outline" loading={answering} onPress={ask} />
            {answer ? <Notice icon="chatbubble-ellipses-outline">{answer}</Notice> : null}
          </View>
          {resources.error ? <Notice icon="cloud-offline-outline">The API is offline, so verified fallback contacts are shown.</Notice> : null}
          {!device.location ? (
            <Button label="Show closest in-person resources" icon="navigate-outline" variant="tinted" loading={device.loading} onPress={device.locate} />
          ) : null}
          {device.error ? <Notice icon="location-outline" tone="warning">{device.error}</Notice> : null}
          <ResourceList resources={visibleResources} />
        </>
      ) : null}

      {section === 'request' ? (
        <>
          <Notice icon="lock-closed-outline">Your request is visible only to authorized coordinators. Do not include Social Security numbers, medical records, or another person’s private information.</Notice>
          <View style={{ gap: space.sm }}>
            <Txt variant="headline">What kind of help do you need?</Txt>
            <Chips>{REQUEST_CATEGORIES.map((item) => <Chip key={item} label={item} active={requestCategory === item} onPress={() => setRequestCategory(item)} />)}</Chips>
          </View>
          <Field label="Brief description" value={requestSummary} onChangeText={setRequestSummary} placeholder="Tell us enough to route your request" multiline maxLength={800} style={styles.longField} />
          <Field label="Neighborhood (optional)" value={requestNeighborhood} onChangeText={setRequestNeighborhood} placeholder="General area only—no exact address" maxLength={120} />
          {createRequest.error ? <Notice icon="cloud-offline-outline" tone="warning">The request could not be submitted. Check the API connection and try again.</Notice> : null}
          <Button label="Submit assistance request" icon="paper-plane-outline" size="lg" loading={createRequest.isPending} disabled={!requestSummary.trim()} onPress={submitRequest} />
          {requests.data?.length ? (
            <Group header="My requests" footer="Only you and authorized coordinators can see these requests.">
              {requests.data.map((item) => <Row key={item.id} title={item.category} subtitle={item.summary} detail={item.status} tile={{ icon: 'hand-heart', color: theme.brand }} />)}
            </Group>
          ) : null}
        </>
      ) : null}

      {section === 'opportunities' ? (
        <>
          <Notice icon="people-outline">Opportunities are public listings. Applying never shares your NearMKE activity or assistance requests.</Notice>
          <Group header="Jobs, training & volunteering">
            {visibleOpportunities.map((item) => (
              <Row key={item.id} title={item.title} subtitle={`${item.organization} · ${item.summary}`} detail={item.kind} tile={{ icon: item.kind === 'volunteer' ? 'hand-heart' : 'school', color: item.kind === 'job' ? '#2877A8' : '#247A63' }} accessory={item.apply_url ? 'chevron' : undefined} onPress={item.apply_url ? () => Linking.openURL(item.apply_url!) : undefined} />
            ))}
          </Group>
        </>
      ) : null}

      {section === 'feed' ? (
        <>
          <View style={[styles.composer, { backgroundColor: theme.surface }]}>
            <Txt variant="headline">Share with the community</Txt>
            <Field value={postBody} onChangeText={setPostBody} placeholder="Share a resource, event, or useful update" multiline maxLength={800} style={styles.longField} />
            <Field value={postNeighborhood} onChangeText={setPostNeighborhood} placeholder="Neighborhood (optional)" maxLength={120} />
            <View style={styles.composerFooter}>
              <Chip label="Post anonymously" active={anonymous} onPress={() => setAnonymous((value) => !value)} />
              <Button label="Submit" icon="send-outline" loading={createPost.isPending} disabled={!postBody.trim()} onPress={submitPost} />
            </View>
          </View>
          {postSubmitted ? <Notice icon="checkmark-circle-outline">Submitted for review. Approved posts appear in the community feed without exposing account details.</Notice> : null}
          {createPost.error ? <Notice icon="cloud-offline-outline" tone="warning">The post could not be shared. Check the API connection and try again.</Notice> : null}
          {feed.data?.length ? (
            <View style={{ gap: space.md }}>
              {feed.data.map((post) => (
                <View key={post.id} style={[styles.post, { backgroundColor: theme.surface }]}>
                  <View style={styles.postMeta}><Txt variant="headline">{post.author_label}</Txt><Txt variant="caption" tone="secondary">{post.neighborhood ?? 'Milwaukee'}</Txt></View>
                  <Txt variant="body">{post.body}</Txt>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState icon="chatbubbles-outline" title="No community posts yet" body="Be the first to share a useful resource or neighborhood update." />
          )}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  assistantCard: { padding: space.lg, borderRadius: radius.lg, gap: space.md },
  assistantTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  longField: { minHeight: 90, textAlignVertical: 'top' },
  composer: { padding: space.lg, borderRadius: radius.lg, gap: space.md },
  composerFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  post: { padding: space.lg, borderRadius: radius.lg, gap: space.sm },
  postMeta: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
});
