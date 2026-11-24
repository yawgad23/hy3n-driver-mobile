import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { activeTripDetails } from '../lib/driver-active-trip-details';

// This evaluates the AST-extracted real JSX, not a separately reimplemented Home.
// Native host nodes are plain records: this proves render contracts/geometry inputs,
// not Yoga text measurement, touch dispatch, or Android native UI appearance.
const BASELINE = 'a7209d6a32f6e1df10a6760a66141e0242a56cf6';
const HOME = 'app/(tabs)/home.tsx';
const helperPath = path.resolve('lib/driver-android-home-layout.tsx');
const baseline = execFileSync('git', ['show', `${BASELINE}:${HOME}`], { encoding: 'utf8' });
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
  if (existsSync(helperPath)) Object.assign(context, loadHelper(platform));
  vm.runInNewContext(compile(`${declaration(file, 'styles')}\n${declaration(file, 'androidLayoutStyles')}\n${declaration(file, 'androidHomeLayout')}\n${declaration(file, 'dynamicStyles')}\nconst result = (${jsx});\nexports.result = result;`), Object.assign(context, { exports: {} }));
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

test('all real iOS host trees, rendered styles/values and handler contracts remain equivalent to release baseline', () => {
  for (const state of states) for (const bottom of [0, 34]) for (const isDark of [false, true]) for (const pending of [false, true]) {
    const overrides = { ...state, isDark, tripActionPending: pending, togglingOnline: pending, insets: { top: 47, bottom, left: 0, right: 0 } };
    assert.deepEqual(normalized(render(current, 'ios', overrides).tree), normalized(render(baseline, 'ios', overrides).tree), `${state.name}, bottom=${bottom}, dark=${isDark}, pending=${pending}`);
  }
});

test('Android preserves every label, handler and disabled-state contract including offer, stop and route-update controls', () => {
  for (const state of states) for (const pending of [false, true]) {
    const overrides = { ...state, tripActionPending: pending, togglingOnline: pending };
    assert.deepEqual(interactions(render(current, 'android', overrides).nodes), interactions(render(baseline, 'android', overrides).nodes), state.name);
  }
});

test('scope proof: old styles, server/offer handlers and keyboard/rating JSX stay unchanged except the verified Android audio opt-in/gate', () => {
  const oldFile = parse(baseline), newFile = parse(current);
  const styleProperties = (file: ts.SourceFile) => {
    const node = file.statements.find((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => d.name.getText(file) === 'styles')) as ts.VariableStatement;
    const call = node.declarationList.declarations[0].initializer as ts.CallExpression;
    return (call.arguments[0] as ts.ObjectLiteralExpression).properties;
  };
  const newStyles = styleProperties(newFile);
  for (const prop of styleProperties(oldFile)) assert.equal(newStyles.find((p) => p.name?.getText(newFile) === prop.name?.getText(oldFile))?.getText(newFile), prop.getText(oldFile));
  // Reverse only these exact separately tested Android audio expressions for
  // the layout scope comparison. Do not whitelist whole handlers or effects.
  const audioDeltas = [
    ["Platform.OS === 'android' ? null : require('@/assets/audio/incoming-trip-alert.wav')", "require('@/assets/audio/incoming-trip-alert.wav')"],
    ["createDriverRequestAudio({\n    platform: Platform.OS,\n    createPlayer: () => createAudioPlayer(\n      require('@/assets/audio/incoming-trip-alert.wav'),\n      { keepAudioSessionActive: false },\n    ),\n  })", 'createDriverRequestAudio()'],
    ["(Platform.OS === 'android' && tripActionPending) || acceptedOfferAudioSuppressionRef.current", 'acceptedOfferAudioSuppressionRef.current'],
    ["(Platform.OS !== 'android' && !incomingTripAlertStatus.isLoaded)", '!incomingTripAlertStatus.isLoaded'],
    [", Platform.OS === 'android' && tripActionPending]);", ']);'],
  ];
  let compatibleSource = current;
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
  assert.equal(modals(current), modals(baseline), 'trailing modal JSX changed');
});
