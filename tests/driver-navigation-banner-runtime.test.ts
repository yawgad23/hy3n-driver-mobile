import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
process.env.TZ = 'UTC';
Date.now = () => Date.parse('2026-01-02T23:50:00Z');
const requireHere = createRequire(__filename);
const BASELINE = '3aed02cdf4dfe02da445e2592112ed894226c59a';
const bannerPath = path.join(__dirname, '../components/DriverNavigationBanner.tsx');
const baselineSource = execFileSync('git', ['show', `${BASELINE}:components/DriverNavigationBanner.tsx`], { encoding: 'utf8' });
const materialGlyphs = requireHere('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialIcons.json');

type Guidance = {
  maneuver: string;
  nativeManeuverName?: string | null;
  instruction: string | null;
  roadName: string | null;
  distanceToManeuverMeters: number | null;
  navState: 'enroute' | 'rerouting' | 'arrived' | 'stopped' | 'unknown';
};
type PlatformName = 'ios' | 'android' | 'web';

const baseGuidance: Guidance = {
  maneuver: 'left', nativeManeuverName: 'TURN_LEFT',
  instruction: 'Turn left onto Independence Avenue', roadName: 'Independence Avenue',
  distanceToManeuverMeters: 85, navState: 'enroute',
};
const longInstruction = 'Turn left after the pedestrian crossing onto Independence Avenue toward the airport terminal and continue through the junction. '.repeat(4).trim();
const longRoad = 'Independence Avenue / Airport City Terminal Access Road / International Departures Entrance';
const representativeStates = [
  { guidance: baseGuidance, message: null },
  { guidance: { ...baseGuidance, nativeManeuverName: 'TURN_U_TURN_CLOCKWISE', maneuver: 'u-turn' }, message: null },
  { guidance: { ...baseGuidance, instruction: longInstruction, roadName: longRoad }, message: null },
  { guidance: { ...baseGuidance, maneuver: 'unknown', nativeManeuverName: 'UNKNOWN', instruction: 'Head toward the terminal' }, message: null },
  { guidance: { ...baseGuidance, nativeManeuverName: null }, message: null },
  { guidance: { ...baseGuidance, navState: 'rerouting' }, message: null },
  { guidance: { ...baseGuidance, navState: 'unknown' }, message: null },
  { guidance: { ...baseGuidance, navState: 'stopped' }, message: null },
  { guidance: { ...baseGuidance, navState: 'arrived' }, message: null },
  { guidance: null, message: null },
  { guidance: null, message: 'Route unavailable' },
  { guidance: baseGuidance, message: 'Preparing your route…' },
  { guidance: baseGuidance, message: 'Route unavailable' },
  { guidance: { ...baseGuidance, distanceToManeuverMeters: 0 }, message: null, remainingDistanceMeters: 0, remainingTimeSeconds: 0 },
  { guidance: { ...baseGuidance, distanceToManeuverMeters: null }, message: null, remainingDistanceMeters: null, remainingTimeSeconds: null },
  { guidance: { ...baseGuidance, instruction: null }, message: null },
  { guidance: { ...baseGuidance, roadName: baseGuidance.instruction }, message: null },
];

async function loadBanner(platform: PlatformName, useBaseline = false) {
  const result = await build({
    entryPoints: [bannerPath],
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
    plugins: [{ name: 'banner-native-mocks', setup(buildContext) {
      buildContext.onResolve({ filter: /^(react-native|@expo\/vector-icons\/MaterialIcons)$/ }, args => ({ path: args.path, external: true }));
      if (useBaseline) {
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

async function renderBanner(props: Record<string, any> = {}, platform: PlatformName = 'ios', useBaseline = false) {
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
  return { renderer, onLayout: allProps.onLayout, allProps };
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

async function unmount(...renderers: ReactTestRenderer[]) {
  await act(async () => { renderers.forEach(renderer => renderer.unmount()); });
}

function declarationSource(source: string, name: string): string {
  const file = ts.createSourceFile(bannerPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = file.statements.find(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === name
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(file) === name));
  assert.ok(declaration, `${name} declaration exists`);
  return declaration.getText(file);
}

test('Android mapper, renderer, and styles and the original shared mapper/styles are unchanged from 3aed02c', () => {
  const current = readFileSync(bannerPath, 'utf8');
  for (const name of ['androidManeuverIcon', 'AndroidDriverNavigationBanner', 'androidStyles', 'maneuverIcon', 'MANEUVER_ICONS', 'styles']) {
    assert.equal(declarationSource(current, name), declarationSource(baselineSource, name), `${name} must remain source-identical to ${BASELINE}`);
  }
});

test('Android and web representative states, targets, and themes match the 3aed02c host trees exactly', async () => {
  for (const platform of ['android', 'web'] as const) for (const isDark of [false, true]) for (const targetKind of ['pickup', 'destination', 'stop']) for (const state of representativeStates) {
    const props = { ...state, isDark, targetKind, targetLabel: longRoad };
    const actual = await renderBanner(props, platform);
    const original = await renderBanner(props, platform, true);
    assert.deepEqual(treeWithoutFunctions(actual.renderer.toJSON()), treeWithoutFunctions(original.renderer.toJSON()), `${platform}, dark=${isDark}, target=${targetKind}, state=${state.guidance?.navState ?? 'null'}`);
    assert.equal(hostNodes(actual.renderer, 'view')[0].props.onLayout, actual.onLayout);
    await unmount(actual.renderer, original.renderer);
  }
});

test('iOS promotes next-turn distance above full guidance in a 56dp column beside a 44dp icon', async () => {
  const { renderer, onLayout } = await renderBanner();
  const [root, panel, iconColumn, instructionColumn] = hostNodes(renderer, 'view');
  assert.equal(root.props.testID, 'driver-navigation-banner');
  assert.equal(root.props.pointerEvents, 'none');
  assert.equal(root.props.onLayout, onLayout);
  assert.deepEqual(flattenStyle(root.props.style), { borderRadius: 18, overflow: 'hidden', width: '100%' });
  assert.deepEqual(flattenStyle(panel.props.style), {
    backgroundColor: '#096B47', flexDirection: 'row', alignItems: 'center', minHeight: 100, padding: 14, gap: 12,
  });
  assert.equal(panel.props.accessibilityLabel, 'Turn left onto Independence Avenue. in 85 m. Independence Avenue');
  assert.equal(flattenStyle(iconColumn.props.style).width, 56);
  assert.equal(iconColumn.findAllByType('text' as any).length, 0, 'distance no longer sits under the arrow');
  const icon = renderer.root.findByType('icon' as any);
  assert.equal(icon.props.size, 44);
  assert.equal(icon.props.name, 'turn-left');
  assert.equal(icon.props.color, '#FFFFFF');
  assert.deepEqual(flattenStyle(instructionColumn.props.style), { flex: 1, minWidth: 0, gap: 5 });
  const columnTexts = instructionColumn.findAllByType('text' as any);
  assert.deepEqual(columnTexts.map(node => node.children.join('')), ['85 m', baseGuidance.instruction, baseGuidance.roadName]);
  assert.deepEqual(flattenStyle(columnTexts[0].props.style), { color: '#FFFFFF', fontSize: 24, lineHeight: 28, fontWeight: '800', includeFontPadding: false });
  assert.deepEqual(flattenStyle(columnTexts[1].props.style), { color: '#FFFFFF', fontSize: 22, lineHeight: 27, fontWeight: '800', includeFontPadding: false });
  assert.deepEqual(flattenStyle(columnTexts[2].props.style), { color: '#E6F5ED', fontSize: 16, lineHeight: 21, fontWeight: '600', includeFontPadding: false });
  assert.ok(columnTexts.every(node => node.props.numberOfLines === undefined), 'distance, instruction, and road all wrap');
  await unmount(renderer);
});

test('iOS long provider text and distance have no clipping limit or fixed height and layout events pass through untouched', async () => {
  let observed: any;
  const onLayout = (event: any) => { observed = event; };
  const distanceToManeuverMeters = Number.MAX_SAFE_INTEGER;
  const { renderer } = await renderBanner({ guidance: { ...baseGuidance, instruction: longInstruction, roadName: longRoad, distanceToManeuverMeters }, onLayout });
  const [root, panel, iconColumn, instructionColumn] = hostNodes(renderer, 'view');
  assert.equal(root.props.pointerEvents, 'none');
  assert.equal(root.props.onLayout, onLayout);
  const event = { nativeEvent: { layout: { width: 320, height: 412, x: 0, y: 0 } } };
  root.props.onLayout(event);
  assert.equal(observed, event, 'forward the actual native measurement, never estimate banner height');
  for (const node of [root, panel, iconColumn, instructionColumn]) {
    const style = flattenStyle(node.props.style);
    assert.equal(style.height, undefined);
    assert.equal(style.maxHeight, undefined);
  }
  const texts = instructionColumn.findAllByType('text' as any);
  assert.equal(texts.length, 3);
  assert.match(texts[0].children.join(''), /km$/);
  assert.equal(texts[1].children.join(''), longInstruction);
  assert.equal(texts[2].children.join(''), longRoad);
  for (const node of texts) {
    assert.equal(node.props.numberOfLines, undefined);
    assert.equal(node.props.ellipsizeMode, undefined);
    assert.equal(node.props.adjustsFontSizeToFit, undefined);
    assert.equal(flattenStyle(node.props.style).height, undefined);
    assert.equal(flattenStyle(node.props.style).maxHeight, undefined);
  }
  assert.equal(panel.props.accessibilityLabel, `${longInstruction}. in ${texts[0].children.join('')}. ${longRoad}`);
  await unmount(renderer);
});

test('iOS turn and remaining distance independently preserve zero/null, with honest duration and arrival', async () => {
  for (const turn of [0, null, 85]) for (const remaining of [0, null, 1400]) for (const seconds of [0, null]) {
    const { renderer } = await renderBanner({ guidance: { ...baseGuidance, distanceToManeuverMeters: turn }, remainingDistanceMeters: remaining, remainingTimeSeconds: seconds });
    const [, panel, , instructionColumn, , summaryMetrics] = hostNodes(renderer, 'view');
    const instructionTexts = instructionColumn.findAllByType('text' as any).map(node => node.children.join(''));
    assert.deepEqual(instructionTexts, [...(turn === null ? [] : [turn === 0 ? '0 m' : '85 m']), baseGuidance.instruction, baseGuidance.roadName]);
    const metrics = summaryMetrics.findAllByType('text' as any).map(node => node.children.join(''));
    assert.deepEqual(metrics, [seconds === null ? 'ETA updating' : '0 min', ...(remaining === null ? [] : [remaining === 0 ? '0 m' : '1.4 km']), ...(seconds === null ? [] : ['11:50 PM arrival'])]);
    assert.equal(panel.props.accessibilityLabel, [baseGuidance.instruction, turn === null ? null : `in ${turn === 0 ? '0 m' : '85 m'}`, baseGuidance.roadName].filter(Boolean).join('. '));
    await unmount(renderer);
  }
});

test('iOS states and light/dark pickup/drop-off/stop targets retain provider gating, accessibility, and the original summary', async () => {
  for (const isDark of [false, true]) for (const [targetKind, targetType] of [['pickup', 'Pickup'], ['destination', 'Drop-off'], ['stop', 'Next stop']]) for (const state of representativeStates) {
    const props = { ...state, isDark, targetKind, targetLabel: longRoad };
    const actual = await renderBanner(props);
    const original = await renderBanner(props, 'ios', true);
    const instruction = !state.message && state.guidance?.navState === 'enroute' ? state.guidance.instruction : null;
    const stateMessage = state.message || (state.guidance?.navState === 'rerouting' ? 'Recalculating your route…' : 'Waiting for live turn instructions…');
    const [, panel, iconColumn, instructionColumn, summary] = hostNodes(actual.renderer, 'view');
    assert.equal(flattenStyle(panel.props.style).backgroundColor, isDark ? '#064D36' : '#096B47');
    assert.equal(flattenStyle(panel.props.style).minHeight, 100);
    assert.equal(flattenStyle(panel.props.style).padding, 14);
    assert.equal(flattenStyle(iconColumn.props.style).width, 56);
    assert.equal(actual.renderer.root.findByType('icon' as any).props.size, 44);
    const columnTexts = instructionColumn.findAllByType('text' as any);
    assert.ok(columnTexts.some(node => node.children.join('') === (instruction || stateMessage)));
    assert.ok(columnTexts.every(node => node.props.numberOfLines === undefined));
    const expectedRoad = instruction && state.guidance?.roadName && state.guidance.roadName !== instruction;
    assert.equal(columnTexts.some(node => node.children.join('') === state.guidance?.roadName && state.guidance?.roadName !== instruction), Boolean(expectedRoad));
    if (!instruction) {
      assert.equal(columnTexts.length, 1, 'non-enroute/message states cannot show a stale turn distance or road');
      assert.equal(iconName(actual.renderer), 'info-outline');
    } else if (state.guidance?.maneuver === 'unknown') {
      assert.equal(iconName(actual.renderer), 'info-outline', 'unknown can retain provider text, but cannot imply a direction');
    } else {
      assert.equal(iconName(actual.renderer), iconName(original.renderer), 'known iOS maneuvers retain the original mapper');
    }
    const actualTree = treeWithoutFunctions(actual.renderer.toJSON());
    const originalTree = treeWithoutFunctions(original.renderer.toJSON());
    assert.equal(panel.props.accessibilityLabel, originalTree.children[0].props.accessibilityLabel, 'accessibility label composition remains unchanged');
    assert.deepEqual(actualTree.children[1], originalTree.children[1], 'summary and target are not part of this layout port');
    assert.equal(flattenStyle(summary.props.style).backgroundColor, isDark ? '#17212C' : '#FFFFFF');
    assert.equal(flattenStyle(summary.props.style).borderColor, isDark ? '#304151' : '#DBE2E8');
    const summaryTexts = summary.findAllByType('text' as any);
    assert.equal(flattenStyle(summaryTexts[0].props.style).color, isDark ? '#65DBAB' : '#087B4C');
    assert.equal(flattenStyle(summaryTexts[summaryTexts.length - 1].props.style).color, isDark ? '#B9C7D4' : '#526273');
    assert.equal(summaryTexts[summaryTexts.length - 1].children.join(''), `${targetType} · ${longRoad}`);
    assert.equal(summaryTexts[summaryTexts.length - 1].props.numberOfLines, 1, 'preserve the original target contract');
    await unmount(actual.renderer, original.renderer);
  }
});

test('iOS retains known maneuver mappings using installed MaterialIcons glyphs without changing Android mapping', async () => {
  const cases: [string, string, string][] = [
    ['left', 'TURN_LEFT', 'turn-left'],
    ['right', 'TURN_RIGHT', 'turn-right'],
    ['slight-left', 'TURN_SLIGHT_LEFT', 'turn-slight-left'],
    ['slight-right', 'TURN_SLIGHT_RIGHT', 'turn-slight-right'],
    ['keep-left', 'FORK_LEFT', 'fork-left'],
    ['keep-right', 'TURN_KEEP_RIGHT', 'fork-right'],
    ['u-turn', 'TURN_U_TURN_CLOCKWISE', 'u-turn-right'],
    ['u-turn', 'TURN_U_TURN_COUNTERCLOCKWISE', 'u-turn-left'],
    ['roundabout', 'ROUNDABOUT_RIGHT_CLOCKWISE', 'roundabout-right'],
    ['roundabout', 'ROUNDABOUT_EXIT_COUNTERCLOCKWISE', 'roundabout-left'],
    ['ramp', 'ON_RAMP_LEFT', 'turn-slight-left'],
    ['ramp', 'OFF_RAMP_RIGHT', 'turn-slight-right'],
    ['ramp', 'ON_RAMP_UNSPECIFIED', 'alt-route'],
    ['ramp', 'OFF_RAMP_U_TURN_COUNTERCLOCKWISE', 'u-turn-left'],
    ['merge', 'MERGE_RIGHT', 'merge'],
    ['straight', 'STRAIGHT', 'straight'],
    ['arrival', 'DESTINATION_LEFT', 'flag'],
  ];
  for (const [maneuver, nativeManeuverName, expectedIcon] of cases) {
    const props = { guidance: { ...baseGuidance, maneuver, nativeManeuverName } };
    const actual = await renderBanner(props);
    const original = await renderBanner(props, 'ios', true);
    assert.equal(iconName(actual.renderer), expectedIcon, nativeManeuverName);
    assert.equal(iconName(actual.renderer), iconName(original.renderer), 'minimal port preserves the known iOS mapper');
    assert.ok(Object.hasOwn(materialGlyphs, expectedIcon), `${expectedIcon} is supported by the installed native icon font`);
    await unmount(actual.renderer, original.renderer);
  }
  const neutral = await renderBanner({ guidance: { ...baseGuidance, maneuver: 'unknown', nativeManeuverName: 'UNKNOWN', instruction: 'Proceed toward the terminal' } });
  assert.equal(iconName(neutral.renderer), 'info-outline');
  assert.ok(Object.hasOwn(materialGlyphs, iconName(neutral.renderer)));
  await unmount(neutral.renderer);
});

test('Android keeps next-turn distance separate, compact, and readable without a fixed height', async () => {
  const { renderer } = await renderBanner({ targetKind: 'pickup', targetLabel: 'Main entrance' }, 'android');
  const nodes = hostNodes(renderer, 'view');
  const panelStyle = flattenStyle(nodes[1].props.style);
  const iconColumnStyle = flattenStyle(nodes[2].props.style);
  const summaryText = textNodes(renderer);
  assert.equal(panelStyle.minHeight, 76);
  assert.equal(panelStyle.height, undefined);
  assert.ok(summaryText.includes('85 m'));
  assert.ok(summaryText.includes('1.4 km'));
  assert.notEqual(summaryText.indexOf('85 m'), summaryText.indexOf('1.4 km'));
  assert.equal(iconColumnStyle.width, 56);
  assert.equal(renderer.root.findByType('icon' as any).props.size, 44);
  const turnDistance = hostNodes(renderer, 'text').find(node => node.children.includes('85 m'));
  assert.equal(flattenStyle(turnDistance?.props.style).fontSize, 24);
  assert.equal(flattenStyle(turnDistance?.props.style).lineHeight, 28);
  assert.equal(nodes[0].props.pointerEvents, 'none');
  await unmount(renderer);
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
    await unmount(renderer);
  }
  const { renderer } = await renderBanner({ guidance: { ...baseGuidance, nativeManeuverName: null, instruction: 'Head toward the terminal' } }, 'android');
  assert.equal(iconName(renderer), 'info-outline', 'missing native maneuver must not be guessed from English text or bearing');
  await unmount(renderer);
});

test('Android unknown, reroute, error, and zero-value states stay neutral while labels remain truthful', async () => {
  for (const guidance of [
    { ...baseGuidance, maneuver: 'unknown', nativeManeuverName: 'UNKNOWN', instruction: null, roadName: null },
    { ...baseGuidance, navState: 'unknown', instruction: null, roadName: null },
    { ...baseGuidance, navState: 'rerouting', instruction: null, roadName: null },
    { ...baseGuidance, nativeManeuverName: 'ROUNDABOUT_WHATEVER_CLOCKWISE' },
    { ...baseGuidance, nativeManeuverName: 'FAKE_RAMP_LEFT' },
  ]) {
    const { renderer } = await renderBanner({ guidance, message: null }, 'android');
    assert.equal(iconName(renderer), 'info-outline');
    await unmount(renderer);
  }
  const { renderer: messageRenderer } = await renderBanner({ message: 'Route unavailable' }, 'android');
  assert.equal(iconName(messageRenderer), 'info-outline');
  assert.ok(textNodes(messageRenderer).includes('Route unavailable'));
  const { renderer: zeroRenderer } = await renderBanner({ remainingDistanceMeters: 0, remainingTimeSeconds: 0 }, 'android');
  assert.ok(textNodes(zeroRenderer).includes('0 m'));
  assert.ok(textNodes(zeroRenderer).includes('0 min'));
  assert.ok(textNodes(zeroRenderer).some(text => text.endsWith('arrival')));
  const { renderer: zeroTurn } = await renderBanner({ guidance: { ...baseGuidance, distanceToManeuverMeters: 0 } }, 'android');
  assert.ok(textNodes(zeroTurn).includes('0 m'));
  const { renderer: missingTurn } = await renderBanner({ guidance: { ...baseGuidance, distanceToManeuverMeters: null } }, 'android');
  assert.ok(!textNodes(missingTurn).includes('0 m'), 'missing turn distance cannot be invented as zero');
  await unmount(messageRenderer, zeroRenderer, zeroTurn, missingTurn);
});

test('iOS and Android retain shared provider/summary text while web keeps its original truncation hierarchy', async () => {
  const shared = { targetKind: 'stop', targetLabel: 'Gate B', isDark: true };
  const ios = await renderBanner(shared);
  const android = await renderBanner(shared, 'android');
  const web = await renderBanner(shared, 'web');
  assert.deepEqual(textNodes(ios.renderer), textNodes(android.renderer));
  assert.deepEqual(textNodes(web.renderer), textNodes(android.renderer));
  assert.ok(textNodes(ios.renderer).includes('Next stop · Gate B'));
  for (const renderer of [ios.renderer, android.renderer]) {
    const instructionTexts = hostNodes(renderer, 'view')[3].findAllByType('text' as any);
    assert.ok(instructionTexts.every(node => node.props.numberOfLines === undefined));
    assert.equal(hostNodes(renderer, 'view')[0].props.pointerEvents, 'none');
    assert.equal(flattenStyle(hostNodes(renderer, 'view')[1].props.style).backgroundColor, '#064D36');
  }
  const webViews = hostNodes(web.renderer, 'view');
  assert.equal(flattenStyle(webViews[2].props.style).width, 78);
  assert.equal(web.renderer.root.findByType('icon' as any).props.size, 48);
  assert.equal(webViews[2].findByType('text' as any).props.numberOfLines, 1);
  assert.deepEqual(webViews[3].findAllByType('text' as any).map(node => node.props.numberOfLines), [2, 1]);
  await unmount(ios.renderer, android.renderer, web.renderer);
});
