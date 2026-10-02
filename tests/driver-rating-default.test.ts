import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = readFileSync(path.join(process.cwd(), 'app/(tabs)/home.tsx'), 'utf8');

test('Driver rating sheet opens with a selectable default score', () => {
  assert.match(source, /const \[ratingValue, setRatingValue\] = useState\(5\)/);
  assert.match(source, /setRatingValue\(5\);\n    setShowRating\(true\);/);
  assert.doesNotMatch(source, /setRatingValue\(0\);/);
  assert.match(source, /Alert\.alert\('Thank you!', `Your \$\{ratingValue\}-star rating for/);
});
