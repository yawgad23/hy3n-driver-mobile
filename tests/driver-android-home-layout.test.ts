import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { activeTripDetails } from '../lib/driver-active-trip-details';
import { createTranslucentPalette } from '../lib/driver-ios-overlay-theme';

// This evaluates the AST-extracted real JSX, not a separately reimplemented Home.
// Native host nodes are plain records: this proves render contracts/geometry inputs,
// not Yoga text measurement, touch dispatch, or Android native UI appearance.
const BASELINE = 'a7209d6a32f6e1df10a6760a66141e0242a56cf6';
const HOME = 'app/(tabs)/home.tsx';
const IOS_RELEASE = 'ddd131a4849b1784ff0e83861bf02d00ad42a9de';
const helperPath = path.resolve('lib/driver-android-home-layout.tsx');
const SOUND_FIX = '05754fe2ccc966c096000c42b8d20e574991ec1f';
const reviewedSoundHome = execFileSync('git', ['show', `${SOUND_FIX}:${HOME}`], { encoding: 'utf8' });
const beforeNativeRetirement = execFileSync('git', ['show', `${SOUND_FIX}^:${HOME}`], { encoding: 'utf8' });
const baseline = execFileSync('git', ['show', `${BASELINE}:${HOME}`], { encoding: 'utf8' });
const iosRelease = execFileSync('git', ['show', `${IOS_RELEASE}:${HOME}`], { encoding: 'utf8' });
const current = readFileSync(HOME, 'utf8');
const Fragment = Symbol('Fragment');
const React = {
  Fragment,
  createElement(type: any, props: any, ...children: any[]) {
    return { type, props: { ...props, children } };
  },
};
function compile(source: string) {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
}
function parse(source: string) {
  return ts.createSourceFile(HOME, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function declaration(file: ts.SourceFile, name: string) {
  let result = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) result = `const ${node.getText(file)};`;
    ts.forEachChild(node, visit);
  }
  visit(file);
  return result;
}
const hosts = ['View', 'Text', 'TouchableOpacity', 'ScrollView', 'KeyboardAvoidingView', 'ActivityIndicator', 'Image', 'Modal', 'TextInput'];
function native(platform: string) {
  return Object.fromEntries([
    ...hosts.map((name) => [name, name]),
    ['Platform', { OS: platform }], ['StyleSheet', { create: (styles: any) => styles }],
  ]);
}
function loadHelper(platform = 'android') {
  assert.ok(existsSync(helperPath), 'Android measured-layout helper must exist');
  const context: any = {
    exports: {}, require: (name: string) => name === 'react' ? { default: React, ...React } : native(platform),
  };
  vm.runInNewContext(compile(readFileSync(helperPath, 'utf8')), context);
  return context.exports;
}
function flattenStyle(style: any): any {
  if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean).map(flattenStyle));
  return style || {};
}
function expand(value: any): any[] {
  if (value === false || value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(expand);
  if (typeof value !== 'object') return [value];
  if (value.type === Fragment) return expand(value.props.children);
  if (typeof value.type === 'function') return expand(value.type(value.props));
  return [{ ...value, props: { ...value.props, children: expand(value.props.children) } }];
}
function allNodes(value: any): any[] {
  return expand(value).flatMap((node: any) => typeof node === 'object' ? [node, ...allNodes(node.props.children)] : []);
}
function text(node: any): string {
  return node.props.children.map((child: any) => typeof child === 'object' ? text(child) : String(child)).join('');
}
function normalized(value: any): any {
  if (typeof value === 'function') return value.toString();
  if (Array.isArray(value)) return Array.from(value, normalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([key, v]) => [key, normalized(key === 'style' ? flattenStyle(v) : v)]));
  }
  return value;
}
const trip = {
  id: 'ride-1', status: 'driver_arriving', rider_name: 'Rider with a long name',
  pickup_address: 'A long pickup address in Nima Accra', destination_address: 'A long destination address in Airport City',
  rider_rating: 4.8, rider_rating_count: 123, category: 'comfort', distance_km: 18.5,
  payment_method: 'cash', fare: 120,
};
const states = [
  { name: 'offline', isOnline: false },
  { name: 'online-location-pending', isOnline: true, hasCurrentLocation: false },
  { name: 'online-idle-long-destination', isOnline: true, prefs: { destinationFilter: 'A very long destination filter address across Accra' } },
  { name: 'incoming-offer', isOnline: true, incomingRide: trip },
  { name: 'pickup', isOnline: true, activeTrip: trip },
  { name: 'arrived', isOnline: true, activeTrip: { ...trip, status: 'driver_arrived' } },
  { name: 'in-progress', isOnline: true, activeTrip: { ...trip, status: 'in_progress' } },
  { name: 'multi-stop', isOnline: true, activeTrip: { ...trip, status: 'in_progress', route_target: { kind: 'stop', location: { name: 'A long approved stop address' } } } },
  { name: 'route-change-and-queue', isOnline: true, activeTrip: { ...trip, status: 'in_progress', route_change_request: { status: 'pending', kind: 'add_stop', location: { address: 'A long proposed stop address '.repeat(12) } } }, nextRide: { ...trip, id: 'ride-2' } },
];
function render(source: string, platform: string, overrides: any = {}) {
  const file = parse(source);
  const home = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'DriverHomeScreen') as ts.FunctionDeclaration;
  const returns = home.body!.statements.filter(ts.isReturnStatement);
  const jsx = returns[returns.length - 1].expression!.getText(file);
  const events: any = {};
  const context: any = {
    ...native(platform), React,
    useMemo: (factory: () => any) => factory(),
    GOLD: '#D4AF37', GREEN: '#22C55E', RED: '#EF4444', BLUE: '#3B82F6',
    Animated: { View: 'Animated.View' }, StatusBar: 'StatusBar', MaterialIcons: 'MaterialIcons',
    NativeDriverGoogleMap: 'NativeDriverGoogleMap', RideChatModal: 'RideChatModal',
    require: (name: string) => name,
    insets: { top: 24, bottom: 24, left: 0, right: 0 },
    isDark: false, themeColors: { background: '#fff', text: '#111', muted: '#777', border: '#ddd' },
    isOnline: true, hasCurrentLocation: true, activeTrip: null, incomingRide: null, nextRide: null,
    location: null, driverProfile: {}, driverStatusLabel: 'Online', notifications: [],
    showHeatmap: false, prefs: {}, offerPanResponder: { panHandlers: {} }, offerSwipeX: 0,
    pulseAnim: 1, rideOfferSeconds: 20, unreadCount: 2, tripActionPending: false, togglingOnline: false,
    activeNavigationTarget: null, activeNavigationId: null, mapTopInset: 92, mapBottomInset: 180,
    androidHomeHeight: 620, androidDockHeight: 158,
    iosHomeHeight: 620, iosDockHeight: 158,
    destModalVisible: false, destInput: '', showOtp: false, pickupCode: '', showCancel: false,
    showFareScreen: false, completedRide: null, showRating: false, ratingValue: 5, ratingFeedback: '',
    foundItem: '', safetyReport: '', ratingSubmitting: false, showChat: false, user: null, showNavigationChooser: false,
    notifOpen: false,
    formatPassengerFare: (fare: any) => `GH₵${fare || 0}`, activeTripDetails,
    rideCategoryName: () => 'Comfort', hasIncludedAirConditioning: () => true,
    airConditioningReminder: () => 'Comfort includes AC. Turn on the air conditioning before pickup.',
    isHighRiskArea: () => true,
    isDeliveryRide: () => false,
    setAndroidHomeHeight: (height: number) => { events.homeHeight = height; },
    setAndroidDockHeight: (height: number) => { events.dockHeight = height; },
    setIosHomeHeight: (height: number) => { events.iosHomeHeight = height; },
    setIosDockHeight: (height: number) => { events.iosDockHeight = height; },
    setMapTopInset: (height: number) => { events.mapTopInset = height; },
    setMapBottomInset: (height: number) => { events.mapBottomInset = height; },
  };
  // Every existing handler gets a distinct stable identity; no handler body runs.
  for (const node of home.body!.statements) {
    if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
        const name = d.name.text;
        context[name] = Object.assign(function handler() {}, { contractName: name });
      }
    }
  }
  for (const name of ['setShowChat', 'setUnreadCount', 'setShowHeatmap', 'setNotifOpen', 'setDestModalVisible', 'setPrefs', 'setShowCancel', 'setDestInput', 'setShowOtp', 'setPickupCode', 'setShowFareScreen', 'setShowRating', 'setRatingValue', 'setRatingFeedback', 'setFoundItem', 'setSafetyReport', 'setShowNavigationChooser']) context[name] = () => {};
  Object.assign(context, overrides);
  context.iosOverlayPalette = createTranslucentPalette(context.isDark ? 'dark' : 'light', Boolean(overrides.reduceTransparencyEnabled));
  if (existsSync(helperPath)) Object.assign(context, loadHelper(platform));
  vm.runInNewContext(compile(`${declaration(file, 'styles')}\n${declaration(file, 'androidLayoutStyles')}\n${declaration(file, 'iosLayoutStyles')}\n${declaration(file, 'iosOverlayStyles')}\n${declaration(file, 'androidHomeLayout')}\n${declaration(file, 'iosHomeLayout')}\n${declaration(file, 'dynamicStyles')}\nconst result = (${jsx});\nexports.result = result;`), Object.assign(context, { exports: {} }));
  const tree = expand(context.exports.result);
  return { tree, nodes: allNodes(tree), events };
}
function findStyled(nodes: any[], predicate: (style: any, node: any) => boolean) {
  return nodes.find((node) => predicate(flattenStyle(node.props.style), node));
}
function interactions(nodes: any[]) {
  return nodes.filter((node) => node.props.onPress).map((node) => ({
    type: node.type, label: node.props.accessibilityLabel, role: node.props.accessibilityRole,
    hint: node.props.accessibilityHint, text: text(node), disabled: node.props.disabled,
    handler: node.props.onPress.contractName || node.props.onPress.toString(),
  }));
}

test('Android root measures the actual tab-contained Home rather than estimating screen percentages', () => {
  const { tree, events } = render(current, 'android');
  assert.equal(typeof tree[0].props.onLayout, 'function');
  tree[0].props.onLayout({ nativeEvent: { layout: { height: 588, width: 360 } } });
  assert.equal(events.homeHeight, 588);
});

test('real tab bar owns bottom system clearance; Android availability wraps text without hiding or shrinking its touch target', () => {
  const tabsFile = ts.createSourceFile('tabs.tsx', readFileSync('app/(tabs)/_layout.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let tabBarStyle: ts.ObjectLiteralExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(tabsFile) === 'tabBarStyle') tabBarStyle = node.initializer as ts.ObjectLiteralExpression;
    ts.forEachChild(node, visit);
  }
  visit(tabsFile);
  assert.ok(tabBarStyle);
  const tabProperties = tabBarStyle.properties.map((prop) => prop.name?.getText(tabsFile));
  assert.ok(tabProperties.includes('height') && tabProperties.includes('paddingBottom'));
  assert.ok(!tabProperties.includes('position'), 'non-absolute Tabs must keep Home above its system-safe bar');
  for (const state of states.slice(0, 3)) {
    const { nodes } = render(current, 'android', state);
    const toggle = nodes.find((node) => node.props.onPress?.contractName === 'handleToggleOnline');
    assert.equal(flattenStyle(toggle.props.style).minHeight, 44);
    assert.equal(flattenStyle(toggle.props.style).height, undefined, 'large font can grow the target');
    const status = nodes.find((node) => node.type === 'Text' && /You are Online|You are Offline|Getting your location/.test(text(node)));
    assert.equal(flattenStyle(status.props.style).flexShrink, 1);
    assert.equal(status.props.numberOfLines, undefined, 'status remains readable, never silently truncated');
    const card = findStyled(nodes, (style) => style.paddingVertical === 6 && style.borderRadius === 14);
    assert.ok(card);
    const left = card.props.children.find((node: any) => node.type === 'View');
    assert.equal(flattenStyle(left.props.style).flex, 1);
    assert.equal(flattenStyle(left.props.style).minWidth, 0);
  }
});

test('Android removes repeated gesture/tab inset and keeps its dock tight to the real scene bottom', () => {
  for (const bottom of [0, 8, 24, 48]) {
    const { nodes } = render(current, 'android', { activeTrip: trip, insets: { top: 24, bottom, left: 0, right: 0 } });
    const panel = findStyled(nodes, (style) => style.position === 'absolute' && style.bottom === 0);
    assert.equal(flattenStyle(panel.props.style).paddingBottom, 8);
    const actions = findStyled(nodes, (style) => style.gap === 6 && style.paddingBottom !== undefined && style.position !== 'absolute');
    assert.ok(actions);
    assert.equal(flattenStyle(actions.props.style).paddingBottom, 0);
  }
});

test('measured helper reserves map space in dp, budgets auxiliary panels after the real dock, and protects side cutouts', () => {
  const { getDriverAndroidHomeLayout } = loadHelper();
  for (const height of [420, 548, 620, 844, 1100]) for (const header of [68, 92, 124]) for (const dock of [0, 158, 224, 320]) {
    const layout = getDriverAndroidHomeLayout({ homeHeight: height, headerInset: header, dockHeight: dock, leftInset: 32, rightInset: 0 });
    assert.equal(layout.bottomStyle.paddingBottom, 8);
    assert.equal(layout.bottomStyle.paddingLeft, 40);
    assert.equal(layout.bottomStyle.paddingRight, 12);
    assert.ok(layout.dockMaxHeight >= 0 && layout.auxiliaryMaxHeight >= 0);
    assert.ok(layout.dockMaxHeight + layout.auxiliaryMaxHeight + 14 <= height - header);
    assert.ok(layout.bottomStyle.maxHeight <= height - header);
    if (dock === 158 && height >= 548) assert.ok(layout.dockMaxHeight >= dock, 'normal controls stay fully visible');
  }
  assert.equal(getDriverAndroidHomeLayout({ homeHeight: 0, headerInset: 92, dockHeight: 0 }).bottomStyle.maxHeight, undefined);
});

test('real Android regions use measured budgets and real rendered panel heights for map occlusion', () => {
  const { getDriverAndroidHomeLayout } = loadHelper();
  for (const state of states) for (const height of [548, 844]) for (const scale of [1, 1.5, 2]) {
    // Deliberately feed measured heights representative of font scaling; this is
    // not a claim that JS reproduces native font metrics.
    const dockHeight = Math.round(158 * scale);
    const expected = getDriverAndroidHomeLayout({ homeHeight: height, headerInset: 92, dockHeight });
    const { nodes, events } = render(current, 'android', { ...state, androidHomeHeight: height, androidDockHeight: dockHeight });
    const regions = nodes.filter((node) => node.type === 'ScrollView' && node.props.nestedScrollEnabled);
    assert.equal(regions.length, 2, state.name);
    assert.equal(flattenStyle(regions[0].props.style).maxHeight, expected.auxiliaryMaxHeight);
    assert.equal(flattenStyle(regions[1].props.style).maxHeight, expected.dockMaxHeight);
    regions[1].props.onContentSizeChange(360, dockHeight);
    assert.equal(events.dockHeight, dockHeight);
    const panel = findStyled(nodes, (style) => style.position === 'absolute' && style.bottom === 0);
    panel.props.onLayout({ nativeEvent: { layout: { height: 237, y: height - 237 } } });
    assert.equal(events.mapBottomInset, 249, 'real panel height plus existing 12dp camera breathing room only');
  }
});

test('Android and web real host trees, styles and handler contracts remain equivalent to build 125', () => {
  for (const platform of ['android', 'web']) for (const state of states) for (const bottom of [0, 34]) for (const isDark of [false, true]) for (const pending of [false, true]) {
    const overrides = { ...state, isDark, tripActionPending: pending, togglingOnline: pending, insets: { top: 47, bottom, left: 0, right: 0 } };
    assert.deepEqual(normalized(render(current, platform, overrides).tree), normalized(render(iosRelease, platform, overrides).tree), `${platform}, ${state.name}, bottom=${bottom}, dark=${isDark}, pending=${pending}`);
  }
});

test('iOS lowers availability and action controls by removing both repeated bottom-safe-area paddings', () => {
  for (const bottom of [0, 8, 34, 48]) for (const status of ['driver_arriving', 'driver_arrived', 'in_progress']) {
    const overrides = { activeTrip: { ...trip, status }, insets: { top: 47, bottom, left: 0, right: 0 } };
    const { nodes } = render(current, 'ios', overrides);
    const panel = findStyled(nodes, (style) => style.position === 'absolute' && style.bottom === 0);
    assert.equal(flattenStyle(panel.props.style).paddingBottom, 8, 'Tabs already owns home-indicator clearance');
    assert.equal(flattenStyle(panel.props.style).gap, 6);
    const actions = findStyled(nodes, (style) => style.gap === 6 && style.paddingBottom !== undefined && style.position !== 'absolute');
    assert.equal(flattenStyle(actions.props.style).paddingBottom, 0, 'no second spacer between actions and availability');
    const oldPanel = findStyled(render(iosRelease, 'ios', overrides).nodes, (style) => style.position === 'absolute' && style.bottom === 0);
    assert.equal(flattenStyle(oldPanel.props.style).paddingBottom - flattenStyle(panel.props.style).paddingBottom, bottom + 12);
  }
});

test('iOS End is in the same compact row as navigate/chat/call/cancel with a guarded 44pt target', () => {
  for (const pending of [false, true]) {
    const { nodes } = render(current, 'ios', { activeTrip: { ...trip, status: 'in_progress' }, tripActionPending: pending });
    const endTrip = nodes.find((node) => node.props.onPress?.contractName === 'handleEndTrip');
    assert.ok(endTrip);
    const style = flattenStyle(endTrip.props.style);
    assert.equal(style.width, undefined, 'not a full-width banner');
    assert.equal(style.flex, 1);
    assert.equal(style.minWidth, 44);
    assert.equal(style.minHeight, 44, 'preserve a usable native touch target');
    assert.equal(style.height, undefined, 'accessibility text can grow');
    assert.equal(style.paddingVertical, 6);
    assert.equal(endTrip.props.disabled, pending);
    assert.equal(endTrip.props.accessibilityLabel, 'End trip');
    assert.equal(endTrip.props.accessibilityRole, 'button');
    assert.equal(text(endTrip), pending ? '' : 'End');
    const row = findStyled(nodes, (style) => style.flexDirection === 'row' && style.width === '100%' && style.gap === 4);
    assert.ok(row);
    const buttons = row.props.children.filter((node: any) => node.type === 'TouchableOpacity');
    assert.equal(buttons.length, 5);
    assert.ok(buttons.some((button: any) => button.props.onPress === endTrip.props.onPress), 'the row contains the real End handler, not a separate banner');
    assert.equal(flattenStyle(row.props.style).flexWrap, 'wrap', 'very narrow/large-text layouts can wrap instead of clip');
    for (const button of buttons) assert.ok(flattenStyle(button.props.style).minHeight >= 44);
  }
});

test('iOS uses Start/End/Cancel with full accessibility labels and no separate primary-action banner', () => {
  for (const [status, handler, visible, accessible] of [
    ['driver_arrived', 'handleStartTrip', 'Start', 'Start trip'],
    ['in_progress', 'handleEndTrip', 'End', 'End trip'],
    ['driver_arriving', 'handleArrivedAtPickup', 'Arrived', 'Arrived at pickup'],
  ]) {
    const { nodes } = render(current, 'ios', { activeTrip: { ...trip, status } });
    const primary = nodes.find((node) => node.props.onPress?.contractName === handler);
    assert.equal(text(primary), visible);
    assert.equal(primary.props.accessibilityLabel, accessible);
    assert.equal(nodes.filter((node) => node.props.onPress?.contractName === handler).length, 1);
    const cancel = nodes.find((node) => node.props.accessibilityLabel === 'Cancel ride');
    assert.equal(text(cancel), 'Cancel');
    assert.equal(findStyled(nodes, (style) => style.width === '100%' && style.minHeight === 46 && style.paddingHorizontal === 16), undefined);
    const badge = findStyled(nodes, (style) => style.position === 'absolute' && style.width === 14 && style.borderRadius === 7);
    assert.ok(badge);
    assert.equal(flattenStyle(badge.props.style).top, 2);
    assert.equal(flattenStyle(badge.props.style).right, 2);
  }
});

test('iOS availability stays compact, wraps long status text and preserves its 44pt toggle target', () => {
  for (const state of states.slice(0, 3)) {
    const { nodes } = render(current, 'ios', state);
    const toggle = nodes.find((node) => node.props.onPress?.contractName === 'handleToggleOnline');
    assert.equal(flattenStyle(toggle.props.style).minHeight, 44);
    assert.equal(flattenStyle(toggle.props.style).height, undefined);
    const status = nodes.find((node) => node.type === 'Text' && /You are Online|You are Offline|Getting your location/.test(text(node)));
    assert.equal(flattenStyle(status.props.style).flexShrink, 1);
    assert.equal(status.props.numberOfLines, undefined);
    const card = findStyled(nodes, (style) => style.paddingVertical === 8 && style.borderRadius === 16 && style.gap === 10);
    assert.ok(card);
    const left = card.props.children.find((node: any) => node.type === 'View');
    assert.equal(flattenStyle(left.props.style).flex, 1);
    assert.equal(flattenStyle(left.props.style).minWidth, 0);
  }
});

test('iOS uses the tab-contained measured height, cutout padding and actual rendered dock height for camera clearance', () => {
  const { getDriverIosHomeLayout } = loadHelper('ios');
  for (const state of states) for (const height of [420, 548, 844]) for (const scale of [1, 1.5, 2]) {
    const dockHeight = Math.round(158 * scale);
    const expected = getDriverIosHomeLayout({ homeHeight: height, headerInset: 92, dockHeight, leftInset: 34, rightInset: 0 });
    const { tree, nodes, events } = render(current, 'ios', { ...state, iosHomeHeight: height, iosDockHeight: dockHeight, insets: { top: 47, bottom: 34, left: 34, right: 0 } });
    tree[0].props.onLayout({ nativeEvent: { layout: { height, width: 390 } } });
    assert.equal(events.iosHomeHeight, height);
    const regions = nodes.filter((node) => node.type === 'ScrollView' && node.props.nestedScrollEnabled);
    assert.equal(regions.length, 2);
    assert.equal(flattenStyle(regions[0].props.style).maxHeight, expected.auxiliaryMaxHeight);
    assert.equal(flattenStyle(regions[1].props.style).maxHeight, expected.dockMaxHeight);
    regions[1].props.onContentSizeChange(390, dockHeight);
    assert.equal(events.iosDockHeight, dockHeight);
    const panel = findStyled(nodes, (style) => style.position === 'absolute' && style.bottom === 0);
    assert.equal(flattenStyle(panel.props.style).paddingLeft, 42);
    assert.equal(flattenStyle(panel.props.style).paddingRight, 12);
    assert.ok(expected.dockMaxHeight + expected.auxiliaryMaxHeight + 14 <= height - 92);
    panel.props.onLayout({ nativeEvent: { layout: { height: 193, y: height - 193 } } });
    assert.equal(events.mapBottomInset, 205, 'camera uses the actual panel measurement, not assumed button geometry');
  }
});

test('iOS preserves all build 125 interactions and pending states except the explicitly shortened action labels', () => {
  for (const state of states) for (const pending of [false, true]) for (const isDark of [false, true]) {
    const overrides = { ...state, isDark, tripActionPending: pending, togglingOnline: pending };
    const expected = interactions(render(iosRelease, 'ios', overrides).nodes).map((item) => {
      if (item.label === 'Cancel ride') return { ...item, text: 'Cancel' };
      if (item.handler === 'handleEndTrip') return { ...item, text: pending ? '' : 'End', label: 'End trip', role: 'button' };
      if (item.handler === 'handleStartTrip') return { ...item, text: pending ? '' : 'Start', label: 'Start trip', role: 'button' };
      if (item.handler === 'handleArrivedAtPickup') return { ...item, label: 'Arrived at pickup', role: 'button' };
      if (item.handler === 'handleCompleteRouteStop') return { ...item, text: pending ? '' : 'Arrived', label: 'Arrived at approved stop', role: 'button' };
      if (item.handler === 'handleVerifyPickupCode') return { ...item, text: 'Verify & Start' };
      if (item.text === 'Accept route') return { ...item, text: 'Accept' };
      return item;
    }).filter(item => !(state.name === 'incoming-offer' && /Set destination filter|^Heading to /.test(item.text)));
    assert.deepEqual(interactions(render(current, 'ios', overrides).nodes), expected, state.name);
  }
});

test('Android preserves every label, handler and disabled-state contract including offer, stop and route-update controls', () => {
  for (const state of states) for (const pending of [false, true]) {
    const overrides = { ...state, tripActionPending: pending, togglingOnline: pending };
    assert.deepEqual(interactions(render(current, 'android', overrides).nodes), interactions(render(baseline, 'android', overrides).nodes), state.name);
  }
});

test('scope proof: current Home is the reviewed sound fix; historical layout/handler proof and current styles/modals remain protected', () => {
  assert.equal(current, reviewedSoundHome, 'current Home must remain byte-identical to the separately tested native retirement fix');
  const oldFile = parse(baseline), newFile = parse(current);
  const styleProperties = (file: ts.SourceFile) => {
    const node = file.statements.find((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => d.name.getText(file) === 'styles')) as ts.VariableStatement;
    const call = node.declarationList.declarations[0].initializer as ts.CallExpression;
    return (call.arguments[0] as ts.ObjectLiteralExpression).properties;
  };
  const newStyles = styleProperties(newFile);
  for (const prop of styleProperties(oldFile)) assert.equal(newStyles.find((p) => p.name?.getText(newFile) === prop.name?.getText(oldFile))?.getText(newFile), prop.getText(oldFile));
  // Reverse only these exact separately behavior-tested audio expressions for
  // the delivered 131 historical layout proof. Current Home is frozen above to
  // the reviewed sound fix and is still rendered by all current UI tests.
  // Native-retirement/start-boundary suites test that new audio wiring directly;
  // do not silently whitelist changed handlers or disable this historical proof.
  const audioDeltas = [
    ["Platform.OS === 'android' ? null : require('@/assets/audio/incoming-trip-alert.wav')", "require('@/assets/audio/incoming-trip-alert.wav')"],
    ["createDriverRequestAudio({\n    platform: Platform.OS,\n    createPlayer: () => createAudioPlayer(\n      require('@/assets/audio/incoming-trip-alert.wav'),\n      { keepAudioSessionActive: false },\n    ),\n  })", 'createDriverRequestAudio()'],
    ["((Platform.OS === 'android' || Platform.OS === 'ios') && tripActionPending) || acceptedOfferAudioSuppressionRef.current", 'acceptedOfferAudioSuppressionRef.current'],
    ["(Platform.OS !== 'android' && !incomingTripAlertStatus.isLoaded)", '!incomingTripAlertStatus.isLoaded'],
    [", (Platform.OS === 'android' || Platform.OS === 'ios') && tripActionPending]);", ']);'],
    ['  const incomingOfferAudioEligibilityRef = useRef({ incomingRide, activeTripId: activeTrip?.id || null, isOnline, hasCurrentLocation, prefs, driverId: user?.uid });\n  incomingOfferAudioEligibilityRef.current = { incomingRide, activeTripId: activeTrip?.id || null, isOnline, hasCurrentLocation, prefs, driverId: user?.uid };\n', ''],
    ['    const offerReceivedAtMs = incomingOfferReceivedAtRef.current ?? Date.now();\n', ''],
    ['    let failedAcceptConfirmedUnassigned = false;\n', ''],
    ['const reconcileAcceptedRide = async (confirmFailedAccept = false) => {', 'const reconcileAcceptedRide = async () => {'],
    ['        if (!driverOfferAcceptedByServer(serverRide, user.uid)) {\n          if (confirmFailedAccept) failedAcceptConfirmedUnassigned = true;\n          return false;\n        }', '        if (!driverOfferAcceptedByServer(serverRide, user.uid)) return false;'],
    ['if (!await reconcileAcceptedRide(true)) {', 'if (!await reconcileAcceptedRide()) {'],
    [`        const message = String(err?.message || '');
        const unavailable = /no longer available|already been accepted|has expired/i.test(message);
        if (Platform.OS === 'ios') {
          const current = incomingOfferAudioEligibilityRef.current;
          if (!serverConfirmed && failedAcceptConfirmedUnassigned && !unavailable && !isUnavailableDriverOfferError(err)
            && current.driverId === user.uid && current.hasCurrentLocation
            && String(current.incomingRide?.id || '') === rideId
            && shouldPresentDriverOffer(current.incomingRide, retiredOfferLeaseRef.current)
            && offerMatchesDriverPreferences(current.incomingRide, current.prefs)
            && isDriverOfferWithinWindow(driverOfferExpiryMs(current.incomingRide?.driver_offer_expires_at, offerReceivedAtMs), Date.now())
            && shouldPlayIncomingTripAlert({
              isOnline: current.isOnline,
              incomingRideId: rideId,
              activeTripId: current.activeTripId,
              soundAlerts: current.prefs.soundAlerts,
            })) {
            // Keep iOS hook/native ownership. Clear only this played-ride latch
            // before lifting suppression and the pending dependency reruns.
            incomingTripAudioRuntimeRef.current.rearmAfterFailedAccept(rideId);
            acceptedOfferAudioSuppressionRef.current = null;
          }
        } else if (String(incomingRide?.id || '') === rideId) {
          // Preserve Android's existing per-offer retirement/retry behavior.
          acceptedOfferAudioSuppressionRef.current = null;
        }`, "        if (String(incomingRide?.id || '') === rideId) acceptedOfferAudioSuppressionRef.current = null;\n        const message = String(err?.message || '');"],
    ['if (unavailable) {', 'if (/no longer available|already been accepted|has expired/i.test(message)) {'],
  ];
  let compatibleSource = beforeNativeRetirement;
  for (const [approved, original] of audioDeltas) {
    assert.equal(compatibleSource.split(approved).length - 1, 1, `approved audio expression must occur exactly once: ${approved}`);
    compatibleSource = compatibleSource.replace(approved, original);
  }
  const printer = ts.createPrinter({ removeComments: true });
  const logic = (file: ts.SourceFile) => {
    const home = file.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'DriverHomeScreen') as ts.FunctionDeclaration;
    return home.body!.statements.filter((s) => !ts.isReturnStatement(s)).map((s) => printer.printNode(ts.EmitHint.Unspecified, s, file));
  };
  const newLogic = logic(parse(compatibleSource));
  for (const oldStatement of logic(oldFile)) assert.ok(newLogic.includes(oldStatement), `existing logic changed: ${oldStatement.slice(0, 120)}`);
  const modals = (source: string) => source.slice(source.indexOf('      {/* Destination Modal */}'), source.indexOf('const styles = StyleSheet.create('));
  const approvedVerifyLabel = "{Platform.OS === 'ios' ? 'Verify & Start' : 'Verify & start trip'}";
  assert.equal(modals(current).split(approvedVerifyLabel).length - 1, 1, 'only the reviewed iPhone verify label is shortened');
  assert.equal(modals(current).replace(approvedVerifyLabel, 'Verify & start trip'), modals(baseline), 'modal surfaces, inputs and handlers remain source-identical');
});


test('actual iOS action row uses colour-only alpha fills with fully visible foregrounds and the same measured touch geometry', () => {
  for (const isDark of [false, true]) for (const reduceTransparencyEnabled of [false, true]) for (const status of ['driver_arriving', 'driver_arrived', 'in_progress']) {
    const palette = createTranslucentPalette(isDark ? 'dark' : 'light', reduceTransparencyEnabled);
    const { nodes } = render(current, 'ios', { isDark, reduceTransparencyEnabled, activeTrip: { ...trip, status } });
    const row = findStyled(nodes, style => style.flexDirection === 'row' && style.width === '100%' && style.gap === 4);
    const buttons = row.props.children.filter((node: any) => node.type === 'TouchableOpacity');
    const finalTone = status === 'in_progress' ? 'danger' : status === 'driver_arrived' ? 'success' : 'gold';
    const expected = [palette.button.blue, palette.button.blue, palette.button.slate, palette.button.danger, palette.button[finalTone]];
    assert.equal(buttons.length, expected.length);
    for (let index = 0; index < buttons.length; index++) {
      const button = buttons[index];
      const style = flattenStyle(button.props.style);
      assert.equal(style.backgroundColor, expected[index].backgroundColor);
      assert.equal(style.opacity, undefined, 'background alpha must not fade the whole control');
      assert.equal(button.props.activeOpacity, 1, 'pressing does not fade text/icons either');
      assert.ok(style.minHeight >= 44);
      assert.equal(style.height, undefined);
      assert.equal(style.maxHeight, undefined);
    }
    const finalText = buttons[4].props.children.find((node: any) => node.type === 'Text');
    assert.equal(flattenStyle(finalText.props.style).color, status === 'driver_arriving' ? palette.button.gold.color : '#FFF');
    assert.equal(flattenStyle(finalText.props.style).opacity, undefined);
    assert.equal(buttons[4].props.onPress.contractName, status === 'in_progress' ? 'handleEndTrip' : status === 'driver_arrived' ? 'handleStartTrip' : 'handleArrivedAtPickup');
    const availability = nodes.find(node => node.props.onPress?.contractName === 'handleToggleOnline');
    assert.equal(flattenStyle(availability.props.style).backgroundColor, palette.button.danger.backgroundColor);
    assert.equal(availability.props.activeOpacity, 1);
  }
});

test('iOS overlays use the actual theme/accessibility palette, keep the offer readable, and hide only its redundant destination filter', () => {
  for (const isDark of [false, true]) for (const reduceTransparencyEnabled of [false, true]) {
    const palette = createTranslucentPalette(isDark ? 'dark' : 'light', reduceTransparencyEnabled);
    const idle = render(current, 'ios', { isDark, reduceTransparencyEnabled });
    const badge = findStyled(idle.nodes, style => style.borderRadius === 30 && style.paddingHorizontal === 16);
    assert.equal(flattenStyle(badge.props.style).backgroundColor, palette.panel);
    const offer = render(current, 'ios', { isDark, reduceTransparencyEnabled, incomingRide: trip });
    const card = offer.nodes.find(node => node.type === 'Animated.View');
    assert.equal(flattenStyle(card.props.style).backgroundColor, palette.panel);
    assert.equal(flattenStyle(card.props.style).opacity, undefined);
    const title = offer.nodes.find(node => node.type === 'Text' && text(node) === 'New Ride Request');
    assert.equal(flattenStyle(title.props.style).opacity, 1);
    assert.equal(flattenStyle(title.props.style).color, palette.foreground);
    assert.ok(!offer.nodes.some(node => node.type === 'Text' && text(node) === 'Set destination filter'));
    assert.ok(idle.nodes.some(node => node.type === 'Text' && text(node) === 'Set destination filter'));
    for (const platform of ['android', 'web']) {
      const other = render(current, platform, { incomingRide: trip });
      assert.ok(other.nodes.some(node => node.type === 'Text' && text(node) === 'Set destination filter'), 'other platforms preserve their existing render');
    }
  }
});

test('reviewed iPhone labels remain attached to their existing server/verification handlers while protected modal surfaces stay solid', () => {
  const route = render(current, 'ios', { activeTrip: { ...trip, status: 'in_progress', route_change_request: { status: 'pending', kind: 'add_stop', location: { name: 'Approved proposal' } } } });
  const accept = route.nodes.find(node => node.props.onPress && text(node) === 'Accept' && node.props.onPress.toString().includes('handleRouteChangeDecision'));
  assert.ok(accept);
  assert.equal(accept.props.disabled, false);
  const stop = render(current, 'ios', { activeTrip: { ...trip, status: 'in_progress', route_target: { kind: 'stop', location: { name: 'Approved stop' } } } });
  const arrived = stop.nodes.find(node => node.props.onPress?.contractName === 'handleCompleteRouteStop');
  assert.equal(text(arrived), 'Arrived');
  assert.equal(arrived.props.accessibilityLabel, 'Arrived at approved stop');
  const verify = stop.nodes.find(node => node.props.onPress?.contractName === 'handleVerifyPickupCode');
  assert.equal(text(verify), 'Verify & Start');
  const sheets = stop.nodes.filter(node => node.type === 'View' && flattenStyle(node.props.style).borderTopLeftRadius === 24);
  assert.ok(sheets.length > 0);
  for (const sheet of sheets) assert.ok(!String(flattenStyle(sheet.props.style).backgroundColor).startsWith('rgba('), 'verification/fare/cancellation sheets remain solid');
});
