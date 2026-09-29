// Fixed answers for local development without AWS. Selected only with MODEL_PROVIDER=fixture.
import { BRIEFING_SYSTEM, RECIPE_SYSTEM, BREAKING_SYSTEM, SCAN_SYSTEM, CHORE_CHECK_SYSTEM } from '../prompts.mjs';
import { addDays } from '../time.mjs';

export function fixtureModel() {
  let scans = 0;
  return {
    async text({ system, input }) {
      if (system === BRIEFING_SYSTEM) {
        return '[fixture] Rain is likely and Ken has soccer at 15:30, so pack his jacket and use the spinach tonight.';
      }
      if (system === RECIPE_SYSTEM) {
        // Pick the first four ids from the list, like the real model is asked to.
        const ids = [...input.matchAll(/id=(\S+)/g)].map((m) => m[1]).slice(0, 4);
        return JSON.stringify({
          title: 'Chicken and spinach omelette rice',
          uses: ids,
          note: '[fixture] The chicken and spinach should be used up today.',
        });
      }
      if (system === BREAKING_SYSTEM) {
        return `[fixture] ${input}`;
      }
      throw new Error('fixture model: unknown text prompt');
    },
    async vision({ system, input }) {
      if (system === CHORE_CHECK_SYSTEM) {
        return JSON.stringify({ confirmed: true, caption: '[fixture] A freshly watered plant on a windowsill.' });
      }
      if (system !== SCAN_SYSTEM) throw new Error('fixture model: unknown vision prompt');
      const today = input.match(/Today is (\d{4}-\d{2}-\d{2})/)[1];
      scans += 1;
      if (scans % 2 === 1) {
        return JSON.stringify({
          kind: 'notice',
          summary: '[fixture] School trip to the zoo added for next week.',
          events: [{ date: addDays(today, 7), time: '08:00', title: 'School trip to the zoo', who: 'Yui', away: true }],
          todos: [
            { title: 'Pack lunch and water bottle for the trip', who: 'Mom' },
            { title: 'Return the trip consent form', who: 'Yui' },
          ],
          groceries: [],
          purchaseDate: null,
        });
      }
      return JSON.stringify({
        kind: 'receipt',
        summary: '[fixture] Groceries from the supermarket added to the kitchen.',
        events: [],
        todos: [],
        groceries: [
          { name: 'Salmon', shelfLifeDays: 2 },
          { name: 'Tofu', shelfLifeDays: 5 },
          { name: 'Carrots', shelfLifeDays: 14 },
        ],
        purchaseDate: today,
      });
    },
  };
}
