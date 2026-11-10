// The user's 6-max charts at 100bb deep for a seat other than the BB facing a
// single open (provided 2026-11-10, open 2.5bb; a 2bb open plays the same).
// 13x13, rows and columns A..2, suited above the diagonal, offsuit below.
// Same codes as the BB's charts (charts-50.js): F fold, C call, R 3bet,
// B 3bet light, r 3bet or call 50/50.
// { [defender]: { [opener]: chart } }
export const VS_OPEN_100 = {
  BTN: {
    LJ: {
      title: 'BTN vs open LJ', raiseLabel: '3bet',
      grid: [
        'RRCCCCCCCBBCC',
        'RRCCCCCBBFFFF',
        'rCRCCCBFFFFFF',
        'CBFRCCBFFFFFF',
        'BFFFCCBFFFFFF',
        'FFFFFCCCFFFFF',
        'FFFFFFCCCFFFF',
        'FFFFFFFCBCFFF',
        'FFFFFFFFCCFFF',
        'FFFFFFFFFCBFF',
        'FFFFFFFFFFCFF',
        'FFFFFFFFFFFCF',
        'FFFFFFFFFFFFC',
      ],
    },
    HJ: {
      title: 'BTN vs open HJ', raiseLabel: '3bet',
      grid: [
        'RRRCCCCCCBBCC',
        'RRCCCCCBBFFFF',
        'CCRCCCBBFFFFF',
        'CBBRCCBFFFFFF',
        'BFFFRCBFFFFFF',
        'FFFFFCCCFFFFF',
        'FFFFFFCCCFFFF',
        'FFFFFFFCBCFFF',
        'FFFFFFFFCCFFF',
        'FFFFFFFFFCBFF',
        'FFFFFFFFFFCFF',
        'FFFFFFFFFFFCF',
        'FFFFFFFFFFFFC',
      ],
    },
  },
};
