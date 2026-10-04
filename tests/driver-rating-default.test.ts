import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = readFileSync(path.join(process.cwd(), 'app/(tabs)/home.tsx'), 'utf8');

test('Driver rating sheet opens with a selectable default score', () => {
  assert.match(source, /const \[ratingValue, setRatingValue\] = useState\(5\)/);
  assert.match(source, /setRatingValue\(5\);\n    setShowRating\(true\);/);
  assert.doesNotMatch(source, /setRatingValue\(0\);/);
  assert.match(source, /Alert\.alert\('Medaase!', `Your \$\{ratingValue\}-star rating for/);
  assert.doesNotMatch(source, /Thank you/i);
});

test('Driver rating submit is single-flight and visibly acknowledges pending work', () => {
  assert.match(source, /const \[ratingSubmitting, setRatingSubmitting\] = useState\(false\)/);
  assert.match(source, /const ratingSubmitInFlightRef = useRef\(false\)/);
  assert.match(source, /if \(!completedRide \|\| ratingSubmitInFlightRef\.current\) return;/);
  assert.match(source, /setRatingSubmitting\(true\)/);
  assert.match(source, /disabled=\{ratingSubmitting\}/);
  assert.match(source, /ratingSubmitting \? <ActivityIndicator size="small" color="#111"/);
});
