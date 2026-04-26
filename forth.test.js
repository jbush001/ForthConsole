// Copyright 2024-2026 Jeff Bush
//
// Licensed under the Apache License, Version 2.0 (the 'License');
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an 'AS IS' BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

//
// Unit tests for core forth interpreter.
//

import {ForthContext} from './forth.js';

const DEBUG_SRC_NAME = 'testfile';

function runCode(source) {
  const ctx = new ForthContext();
  let strval = '';
  ctx.createBuiltinWord('.', 1, (val) => {
    strval += val.toString() + '\n';
  });

  const initialStack = ctx.stackPointer;
  ctx.interpretSource(source, DEBUG_SRC_NAME);
  if (ctx.stackPointer != initialStack) {
    let stackStr = '';
    const stackIndex = ctx.stackPointer >> 2;
    if (stackIndex >= 0 && stackIndex < ctx.memory.length) {
      stackStr += ctx.memory.slice(stackIndex,
          Math.min(stackIndex + 5, ctx.memory.length));
    }

    throw new Error('stack leak ' + stackStr);
  }

  return strval.trim();
}

test('maths', () => {
  const src = `
  \\ Immediate
  1 2 + .
  -5 7 * .
  4 10 - .
  347 7 2 3 * + / 13 +  .
  -20 abs .
  31 abs .

  \\ Compiled
  : foo
      -7 9 + .
      8 3 - .
      -3 -4 * .
      123 4 5 6 * + / 7 + .
      -19 abs .
      77 abs .
  ;
  foo
  `;

  expect(runCode(src)).toBe('3\n-35\n-6\n39\n20\n31\n2\n5\n12\n10\n19\n77');
});

test('shift', () => {
  const src = `
    345 2 lshift .
    567 3 rshift .
`;

  expect(runCode(src)).toBe('1380\n70');
});

test('variables', () => {
  const src = `
  variable a
  variable b
  variable c

  12 a !
  -13 b !
  14 c !
  a @ .
  b @ .
  c @ .
  15 a !
  a @ .`;

  expect(runCode(src)).toBe('12\n-13\n14\n15');
});

test('constant', () => {
  const src = `
  13 constant a
  17 constant b

  a .
  b .
  a b + .`;

  expect(runCode(src)).toBe('13\n17\n30');
});

test('conditionals', () => {
  const src = `
: main
true if
  17 .
else
  18 .
then

false if
  19 .
else
  20 .
then

true if
  21 .
then

false if
  22 .
then

true if
  true if
     23 .
  then
else
  24 .
then
;

main
`;

  expect(runCode(src)).toBe('17\n20\n21\n23');
});

test('while loop', () => {
  const src = `
  : main
  10
  begin
    dup 0 >
  while
    dup .
    1 -
  repeat
  drop
  ;

  main`;

  expect(runCode(src)).toBe('10\n9\n8\n7\n6\n5\n4\n3\n2\n1');
});

test('until loop', () => {
  const src = `
  : main
    10
    begin
      dup .
      1 -
      dup 0=
    until
    drop
  ;

  main
  `;

  expect(runCode(src)).toBe('10\n9\n8\n7\n6\n5\n4\n3\n2\n1');
});

test('nested loop', () => {
  const src = `
  variable a
  variable b
  : main
  0 a !
  begin
    3 b !
    begin
      b @ 7 <
    while
      a @ b @ + .
      b @ 2 + b !
    repeat

    a @ 10 + dup a ! 30 >=
  until
  ;

  main`;

  expect(runCode(src)).toBe('3\n5\n13\n15\n23\n25');
});

test('do loop', () => {
  const src = `
  : main
    10 1 do
      i .
    loop
  ;
  main
  `;

  expect(runCode(src)).toBe('1\n2\n3\n4\n5\n6\n7\n8\n9');
});

test('nested do loop', () => {
  const src = `
  : main
    4 1 do
      100 97 do
        j .
        i .
      loop
    loop
  ;
  main
  `;

  expect(runCode(src)).toBe(
      '1\n97\n1\n98\n1\n99\n2\n97\n2\n98\n2\n99\n3\n97\n3\n98\n3\n99');
});

test('underflow', () => {
  const t = () => {
    runCode('+');
  };
  expect(t).toThrow('stack underflow');
});

test('drop', () => {
  expect(runCode('1 2 3 drop . .')).toBe('2\n1');
});

test('dup', () => {
  expect(runCode('1 2 3 dup . . . .'))
      .toBe('3\n3\n2\n1');
});

test('swap', () => {
  expect(runCode('1 2 3 swap . . .')).toBe('2\n3\n1');
});

test('over', () => {
  expect(runCode('1 2 3 over . . . .'))
      .toBe('2\n3\n2\n1');
});

test('nip', () => {
  expect(runCode('1 2 3 nip . .'))
      .toBe('3\n1');
});

test('tuck', () => {
  expect(runCode('1 2 3 4 tuck . . . . .'))
      .toBe('4\n3\n4\n2\n1');
});

test('2dup', () => {
  expect(runCode('27 31 over over . . . .'))
      .toBe('31\n27\n31\n27');
});

test('0=', () => {
  expect(runCode('1 0= . 100 0= . 0 0= .'))
      .toBe('0\n0\n-1');
});

test('comparisons', () => {
  expect(runCode(`
    12 24 > .
    12 -24 > .
    13 9 > .
    17 19 < .
    19 17 < .
    11 11 >= .
    11 12 >= .
    12 11 >= .
    22 23 <= .
    23 22 <= .
    22 22 <= .
    44 44 = .
    44 43 = .
    55 55 <> .
    54 53 <> .
  `)).toBe('0\n-1\n-1\n-1\n0\n-1\n0\n-1\n-1\n0\n-1\n-1\n0\n0\n-1');
});

test('logical', () => {
  expect(runCode(`
    4 1 or .
    10 3 and .
    13 6 xor .
    13 -1 xor .
  `)).toBe('5\n2\n11\n-14');
});

test('def', () => {
  expect(runCode(`
    : foo
       3 +
    ;

    : bar
      2 *
    ;

    7 bar foo .
  `)).toBe('17');
});

test('nested :', () => {
  const t = () => {
    runCode('\n\n: foo\n: bar\n');
  };
  expect(t).toThrow(`${DEBUG_SRC_NAME}:4: nested colon def`);
});

test('unmatched ;', () => {
  const t = () => {
    runCode('\n\n;\n');
  };
  expect(t).toThrow(`${DEBUG_SRC_NAME}:3: unmatched ;`);
});

test('variable inside :', () => {
  const t = () => {
    runCode('\n: foo\nvariable bar\n');
  };
  expect(t).toThrow(`${DEBUG_SRC_NAME}:3: create inside colon def`);
});

test('lookup table', () => {
  expect(runCode(`
    create foo 13 , 17 , 19 , 21 , 23 , 27 , 31 , 33 ,

    foo @ .
    foo 1 cells + @ .
    foo 2 cells + @ .
    foo 3 cells + @ .
    foo 4 cells + @ .
    foo 5 cells + @ .
    foo 6 cells + @ .
    foo 7 cells + @ .
  `)).toBe('13\n17\n19\n21\n23\n27\n31\n33');
});

test('array alloc', () => {
  expect(runCode(`
    create array1 5 cells allot drop

    variable foo
    5 array1 !
    7 array1 1 cells + !
    9 array1 2 cells + !
    13 array1 3 cells + !
    17 array1 4 cells + !
    99 foo !

    array1 @ .
    array1 1 cells + @ .
    array1 2 cells + @ .
    array1 3 cells + @ .
    array1 4 cells + @ .

    foo @ .
  `)).toBe('5\n7\n9\n13\n17\n99');
});

test('store out of range 1', () => {
  const t = () => {
    runCode('2 -1 !');
  };
  expect(t).toThrow('Memory store out of range: -1');
});

test('store out of range 2', () => {
  const t = () => {
    runCode('2 1000000 !');
  };
  expect(t).toThrow('Memory store out of range: 1000000');
});

test('fetch out of range 1', () => {
  const t = () => {
    runCode('-1 @');
  };
  expect(t).toThrow('Memory fetch out of range: -1');
});

test('fetch out of range 2', () => {
  const t = () => {
    runCode('9999999 @');
  };
  expect(t).toThrow('Memory fetch out of range: 9999999');
});

test('byte store out of range 1', () => {
  const t = () => {
    runCode('2 -1 c!');
  };
  expect(t).toThrow('Memory store out of range: -1');
});

test('byte store out of range 2', () => {
  const t = () => {
    runCode('2 1000000 c!');
  };
  expect(t).toThrow('Memory store out of range: 1000000');
});

test('byte fetch out of range 1', () => {
  const t = () => {
    runCode('-1 c@');
  };
  expect(t).toThrow('Memory fetch out of range: -1');
});

test('byte fetch out of range 2', () => {
  const t = () => {
    runCode('9999999 c@');
  };
  expect(t).toThrow('Memory fetch out of range: 9999999');
});

// This is a little tricky, because we need to cross the stack boundary
// without triggering a stack overflow.
test('out of memory 1', () => {
  // Note: manually catch here (instead of calling expect().toThrow()) so we
  // exercise the toString method without a stack crawl.
  try {
    runCode('0 0 0 0 0 0 0 0 0 0 0 16380 here ! , , , , , , , , ');
    fail('did not throw OOM exception');
  } catch (e) {
    expect(e.toString()).toBe('out of memory');
  }
});

test('out of memory 2', () => {
  // As above, manually catching here to exercise toString
  try {
    runCode('16380 here ! s" This string will go past the end of memory"');
    fail('did not throw OOM exception');
  } catch (e) {
    expect(e.toString()).toBe('out of memory');
  }
});

test('invoke native underflow', () => {
  const ctx = new ForthContext();
  ctx.createBuiltinWord('foo', 1, (val) => {});

  const t = () => {
    ctx.interpretSource('foo');
  };

  expect(t).toThrow('stack underflow');
});

test('invoke native return', () => {
  const ctx = new ForthContext();
  ctx.createBuiltinWord('foo', 1, (val) => {
    return [val + 1, val + 2];
  });
  let strval = '';
  ctx.createBuiltinWord('.', 1, (val) => {
    strval += val.toString() + '\n';
  });

  ctx.interpretSource('17 foo . .');
  expect(strval).toBe('19\n18\n');
});

test('infinite loop', () => {
  const t = () => {
    runCode(': main begin 0 until ; main');
  };
  expect(t).toThrow('Exceeded maximum cycles');
});

test('branch zero', () => {
  const t = () => {
    runCode(': foo immediate \' branch , 0 , ;  : main foo ; main');
  };
  expect(t).toThrow('invalid branch to zero');
});

test('branch out of range', () => {
  const t = () => {
    runCode(': foo immediate \' branch , 17000 , ;  : main foo ; main');
  };
  expect(t).toThrow('Memory fetch out of range: 17000');
});

test('single line comment', () => {
  expect(runCode(`
    \\ ignore this it is a comment
    42 \\ push a value
    .
  `)).toBe('42');
});

test('paren comment', () => {
  expect(runCode(`
    (
      this is an example of a
      paren comment
    )
    ( a single line version )
    42 \\ ( this should be ignored )
    ( here's an interesting one \\ )
    .
  `)).toBe('42');
});

test('gcd', () => {
  expect(runCode(`
    : gcd ( a b -- n )
      begin dup while swap over mod repeat drop
    ;

    15 10 gcd .
    128 96 gcd .
  `)).toBe('5\n32');
});

test('exit', () => {
  expect(runCode(`
    : foo
      27 .
      39 .
      exit
      49 .
    ;

    foo
  `)).toBe('27\n39');
});

test('unmatched comment', () => {
  expect(runCode('\n: main ; \n( this is an unmatched... \n\n')).toBe('');
});

test('immediate outside word', () => {
  expect(runCode(`
    immediate
    : foo
      27 .
    ;

    foo
  `)).toBe('27');
});

test('push/pop return', () => {
  expect(runCode(`
    immediate
    : foo
      7 9 12 13 >r >r
      15 . .
      r> r> . .
      .
    ;

    foo
    99 .
  `)).toBe('15\n9\n13\n12\n7\n99');
});

test('return stack underflow 1', () => {
  const t = () => {
    runCode(': main r> r> ; main');
  };
  expect(t).toThrow('stack underflow');
});

test('return stack underflow 2', () => {
  const t = () => {
    runCode(': main r> ; main');
  };
  expect(t).toThrow('stack underflow');
});

test('missing word name', () => {
  const t = () => {
    runCode(':');
  };
  expect(t).toThrow(`${DEBUG_SRC_NAME}:1: missing word name`);
});

test('constant missing name', () => {
  const t = () => {
    runCode('constant');
  };
  expect(t).toThrow(`${DEBUG_SRC_NAME}:1: missing word name`);
});

test('constant in def', () => {
  const t = () => {
    runCode(': foo constant bar ;');
  };
  expect(t).toThrow(`${DEBUG_SRC_NAME}:1: constant inside colon def`);
});

test('set here', () => {
  expect(runCode(`
    : main
      300 here !
      here @ .
      1234 ,
      300 @ .
    ;

    main
  `)).toBe('300\n1234');
});

test('pick', () => {
  expect(runCode(`
    7 6 5 4 3 2 1
    1 pick .
    2 pick .
    3 pick .
    4 pick .
    5 pick .
    6 pick .
    7 pick .
    drop drop drop drop drop drop drop
  `)).toBe('1\n2\n3\n4\n5\n6\n7');
});

test('bases', () => {
  expect(runCode(`
    16 base !
    f00Abc .
    8 base !
    1234 .
    12 base !  \\ Actually 10, since our numbers are octal now
    456 .

    binary
    1010110 .
    hex
    abcd123 .
    hex
    def .
    decimal
    12 .

  `)).toBe('15731388\n668\n456\n86\n180146467\n3567\n12');
});

test('unknown word1', () => {
  const t = () => {
    runCode('16 base 1234g .');
  };
  expect(t).toThrow(`${DEBUG_SRC_NAME}:1: unknown word 1234g`);
});

test('unknown word2', () => {
  const t = () => {
    runCode('16 base 12-34 .');
  };
  expect(t).toThrow(`${DEBUG_SRC_NAME}:1: unknown word 12-34`);
});

test('unknown word3', () => {
  const t = () => {
    runCode('adsfasdf');
  };
  expect(t).toThrow(`${DEBUG_SRC_NAME}:1: unknown word adsfasdf`);
});

test('state', () => {
  expect(runCode(`
    : foo immediate
      state @ .
    ;

    : bar
      state @ .
      foo
    ;

    state @ .
    bar
  `)).toBe('1\n0\n0');
});

test('push undefined', () => {
  const t = () => {
    const ctx = new ForthContext();
    ctx._push(undefined);
  };
  expect(t).toThrow('internal error: undefined pushed on stack');
});

test('stack overflow', () => {
  const t = () => {
    runCode('16380 here ! 1 1 1 1 1 1 1 1 1 1');
  };
  expect(t).toThrow('stack overflow');
});

test('move', () => {
  expect(runCode(`
    create foo 12 , 17 , 19 , 23 , 25 , 27 , 29 ,
    create bar 9 allot drop

    foo bar 2 cells + 5 move

    bar @ .
    bar 1 cells + @ .
    bar 2 cells + @ .
    bar 3 cells + @ .
    bar 4 cells + @ .
    bar 5 cells + @ .
    bar 6 cells + @ .
    bar 7 cells + @ .
    bar 8 cells + @ .
  `)).toBe('0\n0\n12\n17\n19\n23\n25\n0\n0');
});

test('erase', () => {
  expect(runCode(`
    create foo 12 , 17 , 19 , 23 , 25 , 27 , 29 ,
    foo 2 cells + 4 erase

    foo @ .
    foo 1 cells + @ .
    foo 2 cells + @ .
    foo 3 cells + @ .
    foo 4 cells + @ .
    foo 5 cells + @ .
    foo 6 cells + @ .

  `)).toBe('12\n17\n0\n0\n0\n0\n29');
});

test('negate', () => {
  expect(runCode(`
    7 negate .
    -9 negate .
    0 negate .
  `)).toBe('-7\n9\n0');
});

test('+!', () => {
  expect(runCode(`
    variable foo
    2 foo !
    9 foo +!
    foo @ .
  `)).toBe('11');
});

test('case', () => {
  expect(runCode(`
    : dispatch
      case
        1 of 999 . endof
        2 of 800 . endof
        3 of 765 . endof
      endcase
    ;

    1 dispatch
    3 dispatch
    2 dispatch
  `)).toBe('999\n765\n800');
});

test('rot', () => {
  expect(runCode(`
    1 2 3 4 rot . . . .
    5 6 7 8 -rot . . . .
  `)).toBe('2\n4\n3\n1\n7\n6\n8\n5');
});

test('load byte', () => {
  expect(runCode(`
    hex
    create foo 12345678 ,
    decimal

    foo
    dup 3 + c@ .
    dup 2 + c@ .
    dup 1 + c@ .
    c@ .
  `)).toBe('18\n52\n86\n120');
});

test('load byte sign extension', () => {
  expect(runCode(`
    hex
    create foo ffffffff ,
    decimal

    foo c@ .
  `)).toBe('255');
});

test('store byte', () => {
  expect(runCode(`
    create foo 0 ,

    hex
    foo
    dup 3 + 12 swap c!
    dup 2 + 34 swap c!
    dup 1 + 56 swap c!
    78 swap c!
    foo @ .
  `)).toBe((0x12345678).toString(10));
});

test('string', () => {
  expect(runCode(`
    s" abcdef"
    .
    dup c@ .
    dup 1 + c@ .
    dup 2 + c@ .
    dup 3 + c@ .
    dup 4 + c@ .
    5 + c@ .

    : main
      s" efghij"
      .
      dup c@ .
      dup 1 + c@ .
      dup 2 + c@ .
      dup 3 + c@ .
      dup 4 + c@ .
      5 + c@ .
    ;

    main
  `)).toBe('6\n97\n98\n99\n100\n101\n102\n6\n101\n102\n103\n104\n105\n106');
});

test('unterminated quote', () => {
  const t = () => {
    runCode(`
    123 .
    s" this
    is a long multiline string
    foo
    bar
    `);
  };
  expect(t).toThrow(`${DEBUG_SRC_NAME}:3: unterminated quote`);
});

test('lookup word', () => {
  const ctx = new ForthContext();
  ctx.interpretSource(`
    : foo
       1234
    ;

    : bar
      5678
    ;

    variable baz
  `);
  expect(ctx.lookupWord('foo')).not.toBe(null);
  expect(ctx.lookupWord('bar')).not.toBe(null);
  expect(ctx.lookupWord('baz')).not.toBe(null);
  expect(ctx.lookupWord('boo')).toBe(null);
});

test('call word', () => {
  const ctx = new ForthContext();
  let strval = '';
  ctx.createBuiltinWord('.', 1, (val) => {
    strval = val.toString();
  });

  ctx.interpretSource(`
    : bar
      8888 .
      777   \\ xxx leak a word so we hit that code path
    ;

    : foo
      9999 .
    ;
  `);

  ctx.callWord(ctx.lookupWord('foo'));
  expect(strval).toBe('9999');
  ctx.callWord(ctx.lookupWord('bar'));
  expect(strval).toBe('8888');
});

test('read byte', () => {
  const ctx = new ForthContext();
  ctx.interpretSource('hex create foo 12345678 ,');
  const fooAddr = ctx.lookupWord('foo');
  expect(ctx.fetchByte(fooAddr)).toBe(0x78);
  expect(ctx.fetchByte(fooAddr + 1)).toBe(0x56);
  expect(ctx.fetchByte(fooAddr + 2)).toBe(0x34);
  expect(ctx.fetchByte(fooAddr + 3)).toBe(0x12);
});

test('char', () => {
  expect(runCode(`
  char A . char BCD .

  : main
    char EF . char G .
  ;
  main
`)).toBe('65\n66\n69\n71');
});

test('exception stack crawl', () => {
  try {
    runCode(`
      : foo
          !
      ;

      : bar
          foo
      ;

      bar`);
    fail('exception not thrown');
  } catch (err) {
    expect(err.name).toBe('ForthRuntimeError');
    expect(err.stackCrawl.length).toBe(2);
    expect(err.stackCrawl[0][0]).toBe('foo');
    expect(err.stackCrawl[0][3]).toBe(3);
    expect(err.stackCrawl[1][0]).toBe('bar');
    expect(err.stackCrawl[1][3]).toBe(7);
    expect(err.toString().replace(/@\d+/g, '@X')).toBe(`stack underflow
(Most recent call first)
foo (testfile:3) @X
bar (testfile:7) @X
`);
  }
});

test('compile error line info', () => {
  try {
    runCode(`

      1 2 + drop
      baz
      2 dup drop drop
    `);
    fail('exception not thrown');
  } catch (err) {
    expect(err.name).toBe('ForthCompileError');
    expect(err.fileName).toBe(DEBUG_SRC_NAME);
    expect(err.lineNum).toBe(4);
  }
});

test('unicode comment', () => {
  // The 'key' builtin checks if this is a unicode character and will
  // return -1 if so.
  runCode('( \u1F600  foo )');
});
