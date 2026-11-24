import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
process.env.TZ = 'UTC';
Date.now = () => Date.parse('2026-01-02T23:50:00Z');
const requireHere = createRequire(__filename);
const baselineSource = execFileSync('git', ['show', '16ebcf8c2ad2db3ed1cca041f6b3ea40b830eb6b:components/DriverNavigationBanner.tsx'], { encoding: 'utf8' });

type Guidance = {
  maneuver: string;
  nativeManeuverName?: string | null;
  instruction: string | null;
  roadName: string | null;
  distanceToManeuverMeters: number | null;
  navState: 'enroute' | 'rerouting' | 'arrived' | 'stopped' | 'unknown';
};

const baseGuidance: Guidance = {
  maneuver: 'left', nativeManeuverName: 'TURN_LEFT',
  instruction: 'Turn left onto Independence Avenue', roadName: 'Independence Avenue',
  distanceToManeuverMeters: 85, navState: 'enroute',
};

async function loadBanner(platform: 'ios' | 'android', useBaseline = false) {
  const result = await build({
    entryPoints: [path.join(__dirname, '../components/DriverNavigationBanner.tsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
    plugins: [{ name: 'banner-native-mocks', setup(buildContext) {
      buildContext.onResolve({ filter: /^(react-native|@expo\/vector-icons\/MaterialIcons)$/ }, args => ({ path: args.path, external: true }));
      if (useBaseline || process.env.DRIVER_BANNER_TEST_BASELINE === '1') {
        buildContext.onLoad({ filter: /DriverNavigationBanner\.tsx$/ }, () => ({ contents: baselineSource, loader: 'tsx', resolveDir: path.join(__dirname, '../components') }));
      }
    } }],
  });
  const native = {
    View: 'view', Text: 'text',
    Platform: { OS: platform },
    StyleSheet: { create: (styles: any) => styles },
  };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    (name: string) => name === 'react-native' ? native
      : name === '@expo/vector-icons/MaterialIcons' ? ((props: any) => React.createElement('icon', props))
      : requireHere(name),
    module, module.exports,
  );
  return module.exports.DriverNavigationBanner as React.ComponentType<any>;
}

function treeWithoutFunctions(value: any): any {
  if (Array.isArray(value)) return value.map(treeWithoutFunctions);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'function') {
      const normalized = treeWithoutFunctions(item);
      if (key === 'style' && Array.isArray(normalized)) {
        const styles = normalized.filter(Boolean);
        output[key] = styles.length === 1 ? styles[0] : Object.assign({}, ...styles);
      } else output[key] = normalized;
    }
  }
  return output;
}

async function renderBanner(props: Partial<React.ComponentProps<any>> = {}, platform: 'ios' | 'android' = 'ios', useBaseline = false) {
  const Banner = await loadBanner(platform, useBaseline);
  const onLayout = () => {};
  const allProps = {
    guidance: baseGuidance,
    message: null,
    remainingDistanceMeters: 1400,
    remainingTimeSeconds: 240,
    targetLabel: 'Independence Avenue',
    targetKind: 'destination',
    isDark: false,
    onLayout,
    ...props,
  };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(Banner, allProps)); });
  return { renderer, onLayout, allProps };
}

function hostNodes(renderer: ReactTestRenderer, type: string) {
  return renderer.root.findAllByType(type as any);
}

function textNodes(renderer: ReactTestRenderer) {
  return hostNodes(renderer, 'text').map(node => node.children.join(''));
}

function iconName(renderer: ReactTestRenderer) {
  return renderer.root.findByType('icon' as any).props.name;
}

function flattenStyle(value: any): any {
  return Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flattenStyle)) : value || {};
}

test('iOS banner host tree remains the exact baseline contract', async () => {
  const { renderer, onLayout } = await renderBanner();
  const tree = treeWithoutFunctions(renderer.toJSON());
  const root = renderer.root.findByType('view' as any);
  assert.equal(root.props.testID, 'driver-navigation-banner');
  assert.equal(root.props.pointerEvents, 'none');
  assert.equal(root.props.onLayout, onLayout);
  assert.deepEqual(tree, {
    type: 'view',
    props: { testID: 'driver-navigation-banner', pointerEvents: 'none', style: { borderRadius: 18, overflow: 'hidden', width: '100%' } },
    children: [
      {
        type: 'view',
        props: {
          style: {
            backgroundColor: '#096B47', flexDirection: 'row', alignItems: 'center',
            minHeight: 100, padding: 14, gap: 12,
          },
          accessibilityLabel: 'Turn left onto Independence Avenue. in 85 m. Independence Avenue',
        },
        children: [
          {
            type: 'view', props: { style: { width: 78, alignItems: 'center', justifyContent: 'center', gap: 4 } },
            children: [
              { type: 'icon', props: { name: 'turn-left', size: 48, color: '#FFFFFF' }, children: null },
              { type: 'text', props: { style: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', includeFontPadding: false }, numberOfLines: 1 }, children: ['85 m'] },
            ],
          },
          {
            type: 'view', props: { style: { flex: 1, minWidth: 0, gap: 5 } },
            children: [
              { type: 'text', props: { style: { color: '#FFFFFF', fontSize: 22, lineHeight: 27, fontWeight: '800', includeFontPadding: false }, numberOfLines: 2 }, children: ['Turn left onto Independence Avenue'] },
              { type: 'text', props: { style: { color: '#E6F5ED', fontSize: 16, lineHeight: 21, fontWeight: '600', includeFontPadding: false }, numberOfLines: 1 }, children: ['Independence Avenue'] },
            ],
          },
        ],
      },
      {
        type: 'view',
        props: { style: { paddingHorizontal: 16, paddingVertical: 11, gap: 5, borderWidth: 1, borderTopWidth: 0, backgroundColor: '#FFFFFF', borderColor: '#DBE2E8' } },
        children: [
          {
            type: 'view', props: { style: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 14, rowGap: 3 } },
            children: [
              { type: 'text', props: { style: { fontSize: 19, fontWeight: '800', includeFontPadding: false, color: '#087B4C' } }, children: ['4 min'] },
              { type: 'text', props: { style: { fontSize: 14, fontWeight: '700', includeFontPadding: false, color: '#23313F' } }, children: ['1.4 km'] },
              { type: 'text', props: { style: { fontSize: 14, fontWeight: '700', includeFontPadding: false, color: '#23313F' } }, children: ['11:54 PM', ' arrival'] },
            ],
          },
          { type: 'text', props: { style: { fontSize: 12, lineHeight: 17, fontWeight: '600', includeFontPadding: false, color: '#526273' }, numberOfLines: 1 }, children: ['Drop-off', ' · ', 'Independence Avenue'] },
        ],
      },
    ],
  });
});

test('Android keeps next-turn distance separate, compact, and readable without a fixed height', async () => {
  const { renderer } = await renderBanner({ guidance: { ...baseGuidance }, targetKind: 'pickup', targetLabel: 'Main entrance' }, 'android');
  const nodes = hostNodes(renderer, 'view');
  const panelStyle = flattenStyle(nodes[1].props.style);
  const iconColumnStyle = flattenStyle(nodes[2].props.style);
  const summaryText = textNodes(renderer);
  assert.equal(panelStyle.minHeight, 76, 'Android turn panel uses the intended compact minimum');
  assert.equal(panelStyle.height, undefined, 'banner must size naturally rather than use a fixed height');
  assert.ok(summaryText.includes('85 m'), 'next-turn distance is visible in the instruction panel');
  assert.ok(summaryText.includes('1.4 km'), 'remaining distance remains a separate summary metric');
  assert.notEqual(summaryText.indexOf('85 m'), summaryText.indexOf('1.4 km'), 'turn and remaining distances must not collapse into one label');
  assert.equal(iconColumnStyle.width, 56, 'Android icon column is the intended compact width');
  const icon = renderer.root.findByType('icon' as any);
  assert.equal(icon.props.size, 44, 'Android turn icon uses the intended prominent size');
  const turnDistance = hostNodes(renderer, 'text').find(node => node.children.includes('85 m'));
  assert.equal(turnDistance?.props.style.fontSize, 24, 'Android next-turn distance is prominent');
  assert.equal(turnDistance?.props.style.lineHeight, 28);
  assert.equal(nodes[0].props.pointerEvents, 'none');
});

test('Android maps actual native maneuver names to honest directional icons', async () => {
  const cases: [string, string, string][] = [
    ['left', 'TURN_LEFT', 'turn-left'],
    ['right', 'TURN_RIGHT', 'turn-right'],
    ['left', 'TURN_SHARP_LEFT', 'turn-sharp-left'],
    ['right', 'TURN_SHARP_RIGHT', 'turn-sharp-right'],
    ['ramp', 'ON_RAMP_RIGHT', 'turn-right'],
    ['ramp', 'OFF_RAMP_LEFT', 'turn-left'],
    ['ramp', 'ON_RAMP_SLIGHT_LEFT', 'turn-slight-left'],
    ['ramp', 'OFF_RAMP_SHARP_RIGHT', 'turn-sharp-right'],
    ['ramp', 'ON_RAMP_KEEP_RIGHT', 'fork-right'],
    ['ramp', 'OFF_RAMP_U_TURN_CLOCKWISE', 'u-turn-right'],
    ['ramp', 'ON_RAMP_U_TURN_COUNTERCLOCKWISE', 'u-turn-left'],
    ['keep-left', 'FORK_LEFT', 'fork-left'],
    ['merge', 'MERGE_RIGHT', 'merge'],
    ['u-turn', 'TURN_U_TURN_CLOCKWISE', 'u-turn-right'],
    ['u-turn', 'TURN_U_TURN_COUNTERCLOCKWISE', 'u-turn-left'],
    ['roundabout', 'ROUNDABOUT_CLOCKWISE', 'roundabout-right'],
    ['roundabout', 'ROUNDABOUT_COUNTERCLOCKWISE', 'roundabout-left'],
  ];
  for (const [maneuver, nativeManeuverName, expectedIcon] of cases) {
    const { renderer } = await renderBanner({ guidance: { ...baseGuidance, maneuver, nativeManeuverName } }, 'android');
    assert.equal(iconName(renderer), expectedIcon, `${nativeManeuverName} icon`);
  }
  const { renderer: fallback } = await renderBanner({ guidance: { ...baseGuidance, maneuver: 'left', nativeManeuverName: null, instruction: 'Head toward the terminal' } }, 'android');
  assert.equal(iconName(fallback), 'info-outline', 'missing native maneuver must not be guessed from English text or bearing');
});

test('iOS all representative states and themes match the actual baseline renderer', async () => {
  for (const isDark of [false, true]) for (const targetKind of ['pickup', 'destination', 'stop']) for (const state of [
    { guidance: baseGuidance, message: null },
    { guidance: { ...baseGuidance, nativeManeuverName: 'TURN_U_TURN_CLOCKWISE', maneuver: 'u-turn' }, message: null },
    { guidance: { ...baseGuidance, navState: 'rerouting', instruction: null }, message: null },
    { guidance: null, message: 'Route unavailable' },
    { guidance: { ...baseGuidance, distanceToManeuverMeters: 0 }, message: null },
  ]) {
    const props = { ...state, isDark, targetKind };
    const actual = await renderBanner(props, 'ios');
    const original = await renderBanner(props, 'ios', true);
    assert.deepEqual(treeWithoutFunctions(actual.renderer.toJSON()), treeWithoutFunctions(original.renderer.toJSON()));
    await act(async () => { actual.renderer.unmount(); original.renderer.unmount(); });
  }
});

test('unknown, reroute, error, and zero-value states stay neutral while labels remain truthful', async () => {
  for (const guidance of [
    { ...baseGuidance, maneuver: 'unknown', nativeManeuverName: 'UNKNOWN', instruction: null, roadName: null },
    { ...baseGuidance, navState: 'unknown', instruction: null, roadName: null },
    { ...baseGuidance, navState: 'rerouting', instruction: null, roadName: null },
    { ...baseGuidance, nativeManeuverName: 'ROUNDABOUT_WHATEVER_CLOCKWISE' },
    { ...baseGuidance, nativeManeuverName: 'FAKE_RAMP_LEFT' },
  ]) {
    const { renderer } = await renderBanner({ guidance, message: null }, 'android');
    assert.equal(iconName(renderer), 'info-outline');
  }
  const { renderer: messageRenderer } = await renderBanner({ message: 'Route unavailable', guidance: baseGuidance }, 'android');
  assert.equal(iconName(messageRenderer), 'info-outline');
  assert.ok(textNodes(messageRenderer).includes('Route unavailable'));
  const { renderer: zeroRenderer } = await renderBanner({ guidance: baseGuidance, remainingDistanceMeters: 0, remainingTimeSeconds: 0 }, 'android');
  assert.ok(textNodes(zeroRenderer).includes('0 m'));
  assert.ok(textNodes(zeroRenderer).includes('0 min'));
  assert.ok(textNodes(zeroRenderer).some(text => text.endsWith('arrival')));
  const { renderer: zeroTurn } = await renderBanner({ guidance: { ...baseGuidance, distanceToManeuverMeters: 0 } }, 'android');
  assert.ok(textNodes(zeroTurn).includes('0 m'));
  const { renderer: missingTurn } = await renderBanner({ guidance: { ...baseGuidance, distanceToManeuverMeters: null } }, 'android');
  assert.ok(!textNodes(missingTurn).includes('0 m'), 'missing turn distance cannot be invented as zero');
});

test('iOS and Android preserve provider instruction, road, summary, target labels, themes, and render contracts', async () => {
  const shared = { guidance: { ...baseGuidance }, targetKind: 'stop' as const, targetLabel: 'Gate B', isDark: true };
  const ios = await renderBanner(shared);
  const android = await renderBanner(shared, 'android');
  assert.deepEqual(textNodes(ios.renderer), textNodes(android.renderer));
  assert.ok(textNodes(ios.renderer).includes('Turn left onto Independence Avenue'));
  assert.ok(textNodes(ios.renderer).includes('Independence Avenue'));
  assert.ok(textNodes(ios.renderer).includes('Next stop · Gate B'));
  assert.equal(ios.renderer.root.findByType('view' as any).props.pointerEvents, 'none');
  assert.equal(android.renderer.root.findByType('view' as any).props.pointerEvents, 'none');
  const instruction = hostNodes(ios.renderer, 'text').find(node => node.props.numberOfLines === 2);
  assert.equal(instruction?.props.numberOfLines, 2);
  assert.equal(hostNodes(ios.renderer, 'text').find(node => node.children.includes('Independence Avenue'))?.props.numberOfLines, 1);
  assert.ok(hostNodes(android.renderer, 'text').filter(node => node.children.includes(baseGuidance.instruction!) || node.children.includes(baseGuidance.roadName!)).every(node => node.props.numberOfLines === undefined), 'Android provider instructions and road names wrap without a truncation limit');
  assert.equal(flattenStyle(hostNodes(android.renderer, 'view')[1].props.style).backgroundColor, '#064D36');
});
