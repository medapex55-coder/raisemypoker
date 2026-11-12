// The user's 6-max open charts given for one exact stack between 10 and 19bb
// (provided 2026-11-12), open 2bb, SB 3bb. Same layout and codes as
// charts-short.js: R raise, A all-in, F fold, SB: M limp, H raise / limp...
// { [stack]: { [seat]: grid } }. A seat with no chart here keeps the push/fold
// equilibrium (15bb and less) or the 20bb chart (16 to 19bb).
import { OPEN_CHARTS_20 } from './charts-short.js';

const pairsJam = [ // 77 and smaller pairs all-in, every offsuit ace all-in
  'AFFFFFFAFFFFF',
  'AFFFFFFFAFFFF',
  'AFFFFFFFFAFFF',
  'AFFFFFFFFFAFF',
  'AFFFFFFFFFFAF',
  'AFFFFFFFFFFFA',
];

export const OPEN_CHARTS_EXACT = {
  // The 19bb chart is the same as the 20bb one.
  19: { SB: OPEN_CHARTS_20.SB },
  14: {
    BTN: [
      'RRRRRAAAAAAAA',
      'RRRRAAAARRRFF',
      'AARAAAARRRFFF',
      'AAARAAARFFFFF',
      'AAAARAARFFFFF',
      'ARRFFRAFFFFFF',
      'AFFFFFRFFFFFF',
      ...pairsJam,
    ],
  },
  13: {
    BTN: [
      'RRRRAAAAAAAAA',
      'ARRAAAAAARRFF',
      'AARAAAARRFFFF',
      'AAARAAARFFFFF',
      'AAAARAAFFFFFF',
      'ARFFFRAFFFFFF',
      'AFFFFFAFFFFFF',
      ...pairsJam,
    ],
  },
  12: {
    BTN: [
      'RRRAAAAAAAAAA',
      'ARAAAAAAAAARF',
      'AARAAAARFFFFF',
      'AAARAAARFFFFF',
      'AAAARAAFFFFFF',
      'AAFFFAAAFFFFF',
      'AFFFFFAAFFFFF',
      ...pairsJam,
    ],
  },
  11: {
    BTN: [
      'RRAAAAAAAAAAA',
      'ARAAAAAAAAARF',
      'AARAAAARFFFFF',
      'AAARAAARFFFFF',
      'AAAAAAAAFFFFF',
      'AAFFFAAAFFFFF',
      'AFFFFFAAFFFFF',
      'AFFFFFFAAFFFF',
      ...pairsJam.slice(1),
    ],
  },
  10: {
    BTN: [
      'RAAAAAAAAAAAA',
      'ARAAAAAAAAAAA',
      'AARAAAAAARFFF',
      'AAAAAAAAFFFFF',
      'AAAAAAAAFFFFF',
      'AAAAAAAAFFFFF',
      'ARFFFFAAFFFFF',
      'AFFFFFFAAFFFF',
      ...pairsJam.slice(1),
    ],
  },
};
