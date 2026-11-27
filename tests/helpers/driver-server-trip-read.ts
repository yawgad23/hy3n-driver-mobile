import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type TripSnapshot = {
  id: string;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
  exists(): boolean;
  data(): Record<string, unknown>;
};

export function actualServerTripRead(read: (reference: { collection: string; id: string }) => Promise<TripSnapshot>) {
  const source = fs.readFileSync(path.join(__dirname, '../../lib/firebase.ts'), 'utf8');
  const tree = ts.createSourceFile('firebase.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let method: ts.MethodDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'firestoreDB' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      method = node.initializer.properties.find((property): property is ts.MethodDeclaration => ts.isMethodDeclaration(property) && property.name.getText(tree) === 'getFromServer');
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(method, 'the actual scoped server-read helper must exist');
  const code = ts.transpileModule(`const helpers = { ${method.getText(tree)} };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('doc', 'db', 'getDocFromServer', 'docToObj', `${code}\nreturn helpers.getFromServer;`)(
    (_db: unknown, collection: string, id: string) => ({ collection, id }), {}, read,
    (snapshot: TripSnapshot) => snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null,
  ) as (collection: string, id: string) => Promise<Record<string, unknown> | null>;
}

export function tripSnapshot(data: Record<string, unknown> | null, metadata = { fromCache: false, hasPendingWrites: false }): TripSnapshot {
  return { id: 'offer-A', metadata, exists: () => data !== null, data: () => data || {} };
}
