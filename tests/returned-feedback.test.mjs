import assert from 'node:assert/strict';
import test from 'node:test';
import { groupReturnedFeedback } from '../src/app/lib/returnedFeedback.ts';

test('one card per recording preserves distinct reviewer instructions without repeating comments', () => {
  const rows = [
    { recording_id: 'a', comments: ' Speak clearly ', language: 'Igbo' },
    { recording_id: 'a', comments: 'Speak clearly', language: 'Igbo' },
    { recording_id: 'a', comments: 'Improve lighting', language: 'Igbo' },
    { recording_id: 'b', comments: null, language: 'Hausa' },
    { recording_id: 'b', comments: '   ', language: 'Hausa' },
  ];
  const result = groupReturnedFeedback(rows);
  assert.deepEqual(result, [
    { recording_id: 'a', comments: 'Speak clearly\n\nImprove lighting', language: 'Igbo' },
    { recording_id: 'b', comments: null, language: 'Hausa' },
  ]);
  assert.equal(rows[0].comments, ' Speak clearly ');
  assert.deepEqual(groupReturnedFeedback([]), []);
});
