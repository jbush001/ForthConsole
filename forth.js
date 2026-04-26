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

// Core FORTH interpreter
// This was heavily inspired by the excellent jonesforth tutorial by
// Richard W.M. Jones: <http://git.annexia.org/?p=jonesforth.git;a=tree>

const MEMORY_CELLS = 16384;

// Number of bytes in the default machine integer data type (we'd normally
// call this the machine 'word', but that name has a specific meaning in
// FORTH, so we use the term 'cell' instead).
const CELL_SIZE = 4;

const HERE_PTR = 0;
const BASE_PTR = 4;
const STATE_PTR = 8;

// The interpreter executes this when it resets to define common words.
const BASE_WORDS = `

${HERE_PTR} constant here
${BASE_PTR} constant base
${STATE_PTR} constant state

-1 constant true
0 constant false

: begin immediate
  here @
;

: until immediate
  ' 0branch ,
  ,  \\ branch address, from stack, beginning of loop
;

\\ paren comment
: ( immediate
  begin      \\ consume until end of comment
    key dup
    char ) =
    swap -1 =  \\ end of input
    or
  until
;

: while immediate
  ' 0branch ,      \\ create a conditional branch to break out if 0
  here @           \\ Save new branch address
  0 ,              \\ dummy offset
;

: repeat immediate
  ' branch ,       \\ branch at end of previous block
  swap
  ,                \\ push address of top of loop

  \\ now patch the previous break out
  here @ swap !
;

( limit index -- )
: do immediate
  ' >r , ' >r ,
  here @ \\ Branch point
;

: loop immediate
  ' r> , ' r> ,        ( limit index )
  ' lit , 1 , ' + ,    \\ Increment index
  ' dup , ' >r ,       \\ put back on return stack
  ' over , ' >r ,
  ' = ,                 \\ Is index greater than limit?
  ' 0branch ,           \\ No, continue
  , \\ branch address is top of loop
  ' r> , ' drop ,
  ' r> , ' drop ,
;

: i immediate
  ' r> , ' r> ,  ( limit index )
  ' dup , ' >r ,
  ' swap , ' >r ,
;

: j immediate
' r> , ' r> , ' r> , ' r> , ( limit index limit index* )
' dup , ' >r ,
' swap , ' >r ,
' swap , ' >r ,
' swap , ' >r ,
;

: if immediate
  ' 0branch ,
  here @            \\ save on stack
  0 ,               \\ dummy offset
;

: then immediate
  here @ swap !     \\ patch branch
;

: else immediate
  ' branch ,       \\ branch at end of previous block
  here @           \\ Save new branch address
  0 ,              \\ dummy offset

  \\ Now patch previous branch
  swap
  here @ swap !
;

: case immediate
    0 \\ stack delimiter
;

: of immediate
    ' over ,
    ' = ,
    ' 0branch ,
    here @      \\ Save address to patch
    0 ,         \\ dummy branch offset
    ' drop ,
;

: endof immediate
    ' branch ,       \\ branch at end of previous block
    here @           \\ Save new branch address
    0 ,              \\ dummy branch offset

    \\ Now patch previous branch
    swap
    here @ swap !
;

: endcase immediate
    ' drop ,
    begin
        dup
    while
        here @ swap !     \\ patch branch
    repeat
    drop
;

: 0= 0 = ;

: > swap < ;
: >= < 0= ;
: <= swap < 0= ;
: <> = 0= ;

: 2dup over over ;

: allot  ( n -- start_address )
  here @ swap  ( start_address count )
  over +       ( start_address end_address )
  here !       ( start_address )
;

: cells ${CELL_SIZE} * ;

: variable immediate
  create 0 ,
;

( offset -- value )
: pick
  ${CELL_SIZE} * dsp@ + @
;

( src dest count -- )
: move
    0 do
       over @ over !
       ${CELL_SIZE} + swap ${CELL_SIZE} + swap
    loop
    drop drop
;

( address count -- )
: erase
    begin
        dup 0 >
    while
        over 0 swap !       \\ write 0
        1 -                 \\ decrement counter
        swap ${CELL_SIZE} + swap       \\ increment data pointer
    repeat
    drop drop
;

variable __rand_seed

_get_time __rand_seed !

: random
    __rand_seed @ 1103515245 * 12345 +
    2147483647 and
    dup __rand_seed !
;

: negate 0 swap - ;

\\ Add n to the contents of addr and write back to addr.
( n addr -- )
: +!
    swap over @
    + swap !
;

: dup2 over over ;

( a b c -- a c )
: nip swap drop ;

( a b c d -- a b d c d )
: tuck swap over ;

\\ Any literal numeric is interpreted in the current base, which means
\\ the hex and decimal words would not necessarily be idempotent
\\ if we didn't define these as constants up-front.
16 constant _BASE16
10 constant _BASE10
2 constant _BASE2

: hex immediate _BASE16 base ! ;
: decimal immediate _BASE10 base ! ;
: binary immediate _BASE2 base ! ;

`;

class ForthError extends Error {
  constructor(message, stackCrawl=null) {
    super(message);
    this.name = this.constructor.name;
  }
}

class ForthCompileError extends ForthError {
  constructor(message, fileName, lineNum) {
    super(fileName + ':' + lineNum + ': ' + message);
    this.name = this.constructor.name;
    this.fileName = fileName;
    this.lineNum = lineNum;
  }
}

class ForthRuntimeError extends ForthError {
  constructor(message, stackCrawl=null) {
    super(message);
    this.name = this.constructor.name;
    this.stackCrawl = stackCrawl;
  }

  toString() {
    let result = this.message;
    if (this.stackCrawl) {
      result += '\n(Most recent call first)\n';
      for (const frame of this.stackCrawl) {
        result += `${frame[0]} (${frame[2]}:${frame[3]}) @${frame[1]}\n`;
      }
    }

    return result;
  }
}

class Word {
  constructor(value, immediate=false, literal=false) {
    this.immediate = immediate;
    this.literal = literal;
    this.value = value;
  }
}

const STATE_INTERP = 0;
const STATE_COMPILE = 1;

const ZERO_ASCII = '0'.charCodeAt(0);
const LOWER_A_ASCII = 'a'.charCodeAt(0);
const A_ASCII = 'A'.charCodeAt(0);

/**
 * Stores information used to generate human readable traces, including mapping
 * addresses to words and source line numbers.
 * @note Does not always produce accurate results.
 */
class DebugInfo {
  constructor() {
    this.lineMappings = {};
    this.wordMappings = [];
    this.fileNames = [];
  }

  startFile(fileName) {
    this.fileNames.push(fileName);
  }

  startWord(name, address) {
    this.wordMappings.push([name, address, address]);
  }

  endWord(address) {
    this.wordMappings[this.wordMappings.length - 1][2] = address;
  }

  addLineMapping(address, line) {
    this.lineMappings[address] = [this.fileNames.length - 1, line];
  }

  lookupWord(address) {
    for (const [name, start, end] of this.wordMappings) {
      if (address >= start && address < end) {
        return name;
      }
    }

    return null;
  }

  lookupLine(address) {
    return this.lineMappings[address];
  }
}

export class ForthContext {
  constructor() {
    this.returnStack = [];

    // The intepreter stores memory as an array of 32-bit cells
    this.memory = Array(Math.floor(MEMORY_CELLS / CELL_SIZE)).fill(0);
    this.stackPointer = MEMORY_CELLS - CELL_SIZE;
    this.here = CELL_SIZE * 3; // Account for built-in vars: here, state, base.
    this.base = 10;
    this.state = STATE_INTERP;
    this.dictionary = {
      // Control flow/dictionary operations
      'create': new Word(this._create),
      'constant': new Word(this._constant, true),
      ':': new Word(this._colon, true),
      ';': new Word(this._semicolon, true),
      'immediate': new Word(this._immediate, true),
      '0branch': new Word(this._branchIfZero),
      'branch': new Word(this._branch),
      'exit': new Word(this._exit),

      // Stack operations
      'lit': new Word(this._lit),
      'dup': new Word(this._dup),
      'drop': new Word(this._drop),
      'swap': new Word(this._swap),
      'over': new Word(this._over),
      'rot': new Word(this._rot),
      '-rot': new Word(this._reverseRot),
      '>r': new Word(this._pushReturn),
      'r>': new Word(this._popReturn),
      'dsp@': new Word(this._dsp),

      // Arithmetic
      '+': new Word(this._add),
      '-': new Word(this._sub),
      '*': new Word(this._mul),
      '/': new Word(this._div),
      'mod': new Word(this._mod),
      'or': new Word(this._or),
      'and': new Word(this._and),
      'xor': new Word(this._xor),
      'lshift': new Word(this._lshift),
      'rshift': new Word(this._rshift),
      '=': new Word(this._equals),
      '<': new Word(this._lessThan),
      'abs': new Word(this._abs),

      // Memory access
      '@': new Word(this._fetch),
      '!': new Word(this._store),
      'c@': new Word(this._fetchChar),
      'c!': new Word(this._storeChar),
      ',': new Word(this._comma),

      // Misc
      '\'': new Word(this._tick),
      'key': new Word(this._key),
      's"': new Word(this._makeString, true),
      'char': new Word(this._char, true),
      '_get_time': new Word(this._getTime),
    };

    this.debugInfo = new DebugInfo();
    this.currentFile = '';

    this.interpretSource(BASE_WORDS, 'stdlib');
  }

  /**
   * Read a cell of memory. This will silently align the pointer and will throw
   * an exception for invalid addresses.
   * @param {number} addr
   * @return {number} memory value at address
   * @throws {ForthRuntimeError}
   */
  _fetchCell(addr) {
    if (addr < 0 || addr >= MEMORY_CELLS) {
      throw new ForthRuntimeError(`Memory fetch out of range: ${addr}`,
          this._debugStackCrawl());
    }

    return this.memory[Math.floor(addr / CELL_SIZE)];
  }

  /**
   * Write value to a memory cell.
   * @param {number} addr
   * @param {number} value
   * @throws {ForthRuntimeError}
   */
  _storeCell(addr, value) {
    if (addr < 0 || addr >= MEMORY_CELLS) {
      throw new ForthRuntimeError(`Memory store out of range: ${addr}`,
          this._debugStackCrawl());
    }

    this.memory[Math.floor(addr / CELL_SIZE)] = value;
  }

  /**
   * Read a byte from memory.
   * @param {number} addr
   * @return {number} Contents of location. The intepreter treats this as
   *    unsigned and won't sign extend it.
   * @throws {ForthRuntimeError}
   */
  fetchByte(addr) {
    const shift = (addr % CELL_SIZE) * 8;
    return (this._fetchCell(addr) >> shift) & 0xff;
  }

  _storeByte(addr, value) {
    if (addr < 0 || addr >= MEMORY_CELLS) {
      throw new ForthRuntimeError(`Memory store out of range: ${addr}`,
          this._debugStackCrawl());
    }

    const shift = (addr % CELL_SIZE) * 8;
    const index = Math.floor(addr / CELL_SIZE);
    this.memory[index] &= ~(0xff << shift);
    this.memory[index] |= (value & 0xff) << shift;
  }

  // Getters/setters for built-in words
  get here() {
    return this.memory[HERE_PTR / CELL_SIZE];
  }

  set here(value) {
    this.memory[HERE_PTR / CELL_SIZE] = value;
  }

  get state() {
    return this.memory[STATE_PTR / CELL_SIZE];
  }

  set state(value) {
    this.memory[STATE_PTR / CELL_SIZE] = value;
  }

  get base() {
    return this.memory[BASE_PTR / CELL_SIZE];
  }

  set base(value) {
    this.memory[BASE_PTR / CELL_SIZE] = value;
  }

  /**
   * Add a new forth word that calls a native Javascript function.
   * If the callback returns a list, this will push it back onto the stack.
   * (this allows dependency injection to test the interpreter standalone).
   * @param {string} name Dictionary key.
   * @param {number} argCount Number of arguments the interpreter will pop
   *   off the stack and pass to the callback.
   * @param {function} callback Javascript function the interpreter will call
   *   when it executes this word.
   * @throws {ForthRuntimeError} If the stack underflows while reading the
   *   arguments.
   */
  createBuiltinWord(name, argCount, callback) {
    const self = this;
    this.dictionary[name] = new Word(() => {
      if ((MEMORY_CELLS - self.stackPointer - CELL_SIZE) <
          argCount * CELL_SIZE) {
        throw new ForthRuntimeError('stack underflow',
            this._debugStackCrawl());
      }

      const args = [];
      let argPtr = this.stackPointer + (argCount - 1) * CELL_SIZE;
      for (let i = 0; i < argCount; i++) {
        args.push(self._fetchCell(argPtr));
        argPtr -= CELL_SIZE;
      }

      self.stackPointer += argCount * CELL_SIZE;
      const result = callback(...args);
      if (result) {
        for (const elem of result) {
          self._push(elem);
        }
      }
    });
  }

  /**
   * Remove top value from operand stack and return it.
   * @return {number|function}
   * @throws {ForthRuntimeError} if the stack is empty.
   */
  _pop() {
    if (this.stackPointer >= MEMORY_CELLS) {
      throw new ForthRuntimeError('stack underflow', this._debugStackCrawl());
    }

    const result = this._fetchCell(this.stackPointer);
    this.stackPointer += CELL_SIZE;
    return result;
  }

  /**
   * Put a value on top of the operand stack
   * @param {number|function} val What to push. The interpreter
   *     automatically truncates numbers to integers.
   * @throws {ForthRuntimeError} if the stack is full.
   */
  _push(val) {
    if (val === undefined) {
      throw new ForthRuntimeError('internal error: undefined pushed on stack',
          this._debugStackCrawl());
    }

    if (this.stackPointer < this.here) {
      throw new ForthRuntimeError('stack overflow', this._debugStackCrawl());
    }

    this.stackPointer -= CELL_SIZE;

    if (!(val instanceof Function)) {
      // the '| 0' forces this to fit in an int. The interpreter stores stack
      // entries as integers (except function references for built-in words).
      val |= 0;
    }

    this._storeCell(this.stackPointer, val);
  }

  /**
   * During compilation, write a word at 'here' (next code address) and
   * increment here by one word.
   * @param {number} value
   * @throws {ForthRuntimeError}
   */
  _emitCode(value) {
    this.debugInfo.addLineMapping(this.here, this.lineNumber);
    if (this.here >= MEMORY_CELLS) {
      throw new ForthRuntimeError('out of memory');
    }

    this._storeCell(this.here, value);
    this.here = this.here + CELL_SIZE;
  }

  /**
   * Read the next character from the source string.
   * @return {string} next character.
   */
  _readChar() {
    if (this.interpOffs == this.interpStr.length) {
      return '';
    }

    const ch = this.interpStr[this.interpOffs++];
    if (ch == '\n') {
      this.lineNumber++;
    }

    return ch;
  }

  /**
   * Read the next space delimited character sequence from the source string
   * (this calls _readChar).
   * @return {string} Next token, with leading and trailing whitespace stripped.
   */
  _readWord() {
    let singleLineComment = false;
    let token = '';
    while (true) {
      const ch = this._readChar();
      if (!ch) {
        return token;
      }

      const isSpace = /\s/.test(ch);
      if (singleLineComment) {
        if (ch == '\n') {
          singleLineComment = false;
        }
      } else if (!singleLineComment && ch == '\\') {
        singleLineComment = true;
      } else if (!isSpace) {
        token += ch;
      } else if (token != '') {
        // If terminated by newline, push back to correct lineNumber.
        if (this.interpStr[--this.interpOffs] == '\n') {
          this.lineNumber--;
        }

        return token;
      }
    }
  }

  /**
   * Add a word to the dictionary. Retrieve the name for this word from the next
   * token in the input string and set the value to the current 'here' address
   * (next code to be emitted)
   * @throws {ForthCompileError}
   */
  _create() {
    if (this.state == STATE_COMPILE) {
      throw new ForthCompileError('create inside colon def', this.currentFile,
          this.lineNumber);
    }

    const name = this._readWord();
    if (!name) {
      throw new ForthCompileError('missing word name', this.currentFile,
          this.lineNumber);
    }

    this.currentWord = new Word(this.here, false, true);
    this.dictionary[name] = this.currentWord;
    this.debugInfo.startWord(name, this.here);
  }

  /**
   * Create a constant in the dictionary, setting name from the next token in
   * the stream and popping its value from the stack.
   * e.g.
   *     10 constant foo
   * @throws {ForthCompileError}
   */
  _constant() {
    if (this.state == STATE_COMPILE) {
      throw new ForthCompileError(
          'constant inside colon def', this.currentFile, this.lineNumber);
    }

    const name = this._readWord();
    if (!name) {
      throw new ForthCompileError('missing word name', this.currentFile,
          this.lineNumber);
    }

    this.dictionary[name] = new Word(this._pop(), false, true);
  }

  /**
   * Begin compiling a new word, adding the address to the dictionary, named
   * the next token from the stream.
   * Set the state to compiling.
   * @throws {ForthCompileError}
   */
  _colon() {
    if (this.state == STATE_COMPILE) {
      throw new ForthCompileError('nested colon def', this.currentFile,
          this.lineNumber);
    }

    this._create();
    this.currentWord.literal = false;
    this.state = STATE_COMPILE;
  }

  /**
   * Finish compilation of the current word and generate an implicit 'exit'
   * word to return to the caller. Switch the state from compiling back to
   * interpreting.
   * @throws {ForthCompileError}
   */
  _semicolon() {
    if (this.state != STATE_COMPILE) {
      throw new ForthCompileError('unmatched ;', this.currentFile,
          this.lineNumber);
    }

    this.state = STATE_INTERP;
    this._emitCode(this._exit);
    this.debugInfo.endWord(this.here);
  }

  /**
   * Set a flag on the most recently emitted word so the interpreter will
   * execute it immediately when it reads it rather than compiling it.
   */
  _immediate() {
    // Note that this.currentWord can only be null if 'immediate'
    // is the first word in BASE_WORDS.
    this.currentWord.immediate = true;
  }

  _branchIfZero() {
    if (this._pop()) {
      // Don't branch
      this.pc += CELL_SIZE;
    } else {
      // Condition is false, branch
      this.pc = this._fetchCell(this.pc);
    }
  }

  _branch() {
    this.pc = this._fetchCell(this.pc);
  }

  /**
   * Return from the current function.
   */
  _exit() {
    // Most FORTH interpreters execute the REPL as an infinite loop. However,
    // this returns to the JavaScript caller once it finishes executing the
    // topmost function. It clears the continueExec flag in that case (which
    // exec() checks)
    if (this.returnStack.length > 0) {
      this.pc = this.returnStack.pop();
    } else {
      this.continueExec = false;
    }
  }

  /**
   * Push a constant (literal) value onto the stack. The interpreter generates
   * this implicity when it encounters a number, but code can also reference
   * as an explicit word, often paired with the tick operator. Only compiled
   * code can invoke this. This pushes the value from the subsequent program
   * address.
   */
  _lit() {
    this._push(this._fetchCell(this.pc));
    this.pc += CELL_SIZE;
  }

  _dup() {
    const val = this._pop();
    this._push(val);
    this._push(val);
  }

  _drop() {
    this._pop();
  }

  _swap() {
    const a = this._pop();
    const b = this._pop();
    this._push(a);
    this._push(b);
  }

  _over() {
    this._push(this._fetchCell(this.stackPointer + CELL_SIZE));
  }

  // ( a b c -- b c a )
  _rot() {
    const c = this._pop();
    const b = this._pop();
    const a = this._pop();
    this._push(b);
    this._push(c);
    this._push(a);
  }

  // ( a b c -- c a b )
  _reverseRot() {
    const c = this._pop();
    const b = this._pop();
    const a = this._pop();
    this._push(c);
    this._push(a);
    this._push(b);
  }

  /**
   * Pop a value from the operand stack and push onto the return stack.
   */
  _pushReturn() {
    this.returnStack.push(this._pop());
  }

  /**
   * Pop a value from the return stack and push onto the operand stack.
   * @throws {ForthRuntimeError}
   */
  _popReturn() {
    if (this.returnStack.length == 0) {
      throw new ForthRuntimeError(`return stack underflow`,
          this._debugStackCrawl());
    }

    this._push(this.returnStack.pop());
  }

  /**
   * Push the stack pointer.
   */
  _dsp() {
    this._push(this.stackPointer);
  }

  _add() {
    this._push(this._pop() + this._pop());
  }

  _sub() {
    const a = this._pop();
    const b = this._pop();
    this._push(b - a);
  }

  _mul() {
    this._push(this._pop() * this._pop());
  }

  _div() {
    const a = this._pop();
    const b = this._pop();
    this._push(b / a);
  }

  _mod() {
    const a = this._pop();
    const b = this._pop();
    this._push(b % a);
  }

  _or() {
    this._push(this._pop() | this._pop());
  }

  _and() {
    this._push(this._pop() & this._pop());
  }

  _xor() {
    this._push(this._pop() ^ this._pop());
  }

  _lshift() {
    const a = this._pop();
    const b = this._pop();
    this._push(b << a);
  }

  _rshift() {
    const a = this._pop();
    const b = this._pop();
    this._push(b >> a);
  }

  _equals() {
    this._push(this._pop() === this._pop() ? -1 : 0);
  }

  _lessThan() {
    const a = this._pop();
    const b = this._pop();
    this._push(b < a ? -1 : 0);
  }

  _abs() {
    this._push(Math.abs(this._pop()));
  }

  /**
   * Read a word from memory and push onto the stack
   */
  _fetch() {
    this._push(this._fetchCell(this._pop()));
  }

  /**
   * Pop address and value from the stack and store into memory.
   */
  _store() {
    const addr = this._pop();
    const value = this._pop();
    this._storeCell(addr, value);
  }

  /**
   * Read a byte from memory and push on operand stack, treating it
   * as unsigned and not sign extending.
   */
  _fetchChar() {
    const addr = this._pop();
    this._push(this.fetchByte(addr));
  }

  /**
   * Write a byte to memory, popping address and value from the operand stack
   * and truncating the upper bits of the value to fit in a byte.
   */
  _storeChar() {
    const addr = this._pop();
    const value = this._pop();
    this._storeByte(addr, value);
  }

  _comma() {
    this._emitCode(this._pop());
  }

  /**
   * Push the function address for the next word onto the stack.
   * This only works in compiled code. It uses the trick from jonesforth
   * which grabs the pointer from the next cell.
   */
  _tick() {
    this._push(this._fetchCell(this.pc));
    this.pc += CELL_SIZE;
  }

  /**
   * Return the next input character from the source code string as a byte.
   * This uses a single byte unicode encoding. If the character cannot
   * be represented in a byte, a space is returned instead.
   */
  _key() {
    const val = this._readChar();
    if (val) {
      const code = val.charCodeAt(0);
      this._push(code < 256 ? code : 32);
    } else {
      this._push(-1);
    }
  }

  /**
   * Compile a string, pushing its start address and length onto the stack.
   * @note I could have implemented this in FORTH, but I was too lazy...
   * @throws {ForthError}
   */
  _makeString() {
    const startLine = this.lineNumber;
    const startAddr = this.here;

    // The tokenizer will have pushed back the whitespace char, which a hack
    // to ensure the line number is correct. Discard it here.
    this._readChar();

    // Create a jump over the contents of the string, which this emits in-line.
    this._storeCell(startAddr, this._branch);
    let curAddr = this.here + CELL_SIZE * 2;
    while (true) {
      if (curAddr >= MEMORY_CELLS) {
        throw new ForthRuntimeError('out of memory');
      }

      const ch = this._readChar();
      if (ch == '"') {
        break;
      } else if (ch) {
        this._storeByte(curAddr++, ch.charCodeAt(0));
      } else {
        throw new ForthCompileError('unterminated quote', this.currentFile,
            startLine);
      }
    }

    const length = curAddr - (startAddr + CELL_SIZE * 2);
    curAddr = (curAddr + CELL_SIZE - 1) & ~(CELL_SIZE - 1);
    this._storeCell(startAddr + CELL_SIZE, curAddr); // Patch branch address

    // Align to next word boundary
    this.here = curAddr;

    // Push start address and length on the stack
    if (this.state == STATE_COMPILE) {
      this._emitCode(this._lit);
      this._emitCode(startAddr + CELL_SIZE * 2);
      this._emitCode(this._lit);
      this._emitCode(length);
    } else {
      this._push(startAddr + CELL_SIZE * 2);
      this._push(length);
    }
  }

  _char() {
    const nextTok = this._readWord();
    if (this.state == STATE_COMPILE) {
      this._emitCode(this._lit);
      this._emitCode(nextTok.charCodeAt(0));
    } else {
      this._push(nextTok.charCodeAt(0));
    }
  }

  /**
   * Return number of elapsed seconds since epoch. Used to seed random number
   * generator.
   */
  _getTime() {
    this._push(Date.now());
  }

  /**
   * Execute source code. This intepreter doesn't have an actual REPL, so
   * it interprets code out of a string buffer. This implements the so-called
   * "outer interpreter."
   * @param {string} src The source code to interpret.
   * @param {string} filename Name of source file (for debug info)
   * @throws {ForthError}
  */
  interpretSource(src, filename='<unnamed>') {
    this.interpStr = src;
    this.interpOffs = 0;
    this.lineNumber = 1;

    this.debugInfo.startFile(filename);
    this.currentFile = filename;

    while (true) {
      const tok = this._readWord();
      if (!tok) {
        break;
      }

      const isCompiling = this.state == STATE_COMPILE;
      if (tok in this.dictionary) {
        const word = this.dictionary[tok];
        if (isCompiling && !word.immediate) {
          if (word.literal) {
            this._emitCode(this._lit);
          }

          this._emitCode(word.value);
        } else {
          if (word.value instanceof Function) {
            word.value.call(this);
          } else if (word.literal) {
            this._push(word.value);
          } else {
            this._exec(word.value);
          }
        }
      } else {
        const tokVal = this._parseNumber(tok);
        if (isCompiling) {
          this._emitCode(this._lit);
          this._emitCode(tokVal);
        } else {
          this._push(tokVal);
        }
      }
    }
  }

  /**
   * Run compiled code. This implements the "inner interpreter." It
   * uses an indirect threaded interpreter. Each word in the program
   * consists of either javascript function references (for built-in words)
   * or an integer number that is a call address for a user defined word.
   * @param {number} startAddress Address in FORTH address space to begin
   *   execution.
   * @throws {ForthRuntimeError}
   */
  _exec(startAddress) {
    // Used to prevent infinite loops, which hang the browser.
    const MAX_EXEC_CYCLES = 100000;

    this.continueExec = true;
    this.pc = startAddress;
    for (let i = 0; i < MAX_EXEC_CYCLES && this.continueExec; i++) {
      const value = this._fetchCell(this.pc);
      this.pc += CELL_SIZE;
      if (value == 0) {
        throw new ForthRuntimeError(`invalid branch to zero`,
            this._debugStackCrawl());
      } else if (value instanceof Function) {
        value.call(this);
      } else {
        this.returnStack.push(this.pc);
        this.pc = value;
      }
    }

    if (this.continueExec) {
      throw new ForthRuntimeError('Exceeded maximum cycles',
          this._debugStackCrawl());
    }
  }

  /**
   * Wrapper for exec that does some extra error checking.
   * @param {number} startAddress
   * @throws {ForthRuntimeError}
   */
  callWord(startAddress) {
    this.stackPointer = MEMORY_CELLS - CELL_SIZE;
    this._exec(startAddress);
    if (this.stackPointer != MEMORY_CELLS - CELL_SIZE) {
      const leakedCells = (MEMORY_CELLS - CELL_SIZE - this.stackPointer) /
        CELL_SIZE;
      console.log(`WARNING: stack leaked ${leakedCells} cells`);
    }
  }

  /**
   * Find the address of a word in the dictionary.
   * @param {string} name Name of the word to find.
   * @return {number} Address or undefined if it doesn't exist.
   */
  lookupWord(name) {
    if (!(name in this.dictionary)) {
      return null;
    }

    return this.dictionary[name].value;
  }

  /**
   * Convert a string form of a number into an actual numeric value.
   * @param {string} tok A string containing the number.
   * @return {number} The numeric value
   * @throws {ForthCompileError} if the format is incorrect.
   */
  _parseNumber(tok) {
    let tokVal = 0;
    let digitval = 0;
    const base = this.base;
    let i = 0;
    let isNeg = false;
    if (tok[0] == '-') {
      isNeg = true;
      i++;
    }

    for (; i < tok.length; i++) {
      if (tok[i] >= '0' && tok[i] <= '9') {
        digitval = tok.charCodeAt(i) - ZERO_ASCII;
      } else if (tok[i] >= 'a' && tok[i] <= 'z') {
        digitval = tok.charCodeAt(i) - LOWER_A_ASCII + 10;
      } else if (tok[i] >= 'A' && tok[i] <= 'Z') {
        digitval = tok.charCodeAt(i) - A_ASCII + 10;
      } else {
        throw new ForthCompileError(`unknown word ${tok}`, this.currentFile,
            this.lineNumber);
      }

      if (digitval >= base) {
        throw new ForthCompileError(`unknown word ${tok}`, this.currentFile,
            this.lineNumber);
      }

      tokVal = (tokVal * base) + digitval;
    }

    if (isNeg) {
      tokVal = -tokVal;
    }

    return tokVal;
  }

  /**
   * Walk the return stack and show names of user defined words.
   * @return {Object[]} A list of stack frames, most recently called first
   */
  _debugStackCrawl() {
    const frames = [];

    const self = this;
    function addEntry(address) {
      const wordDef = self.debugInfo.lookupWord(address);
      const lineInfo = self.debugInfo.lookupLine(address);
      const fileName = lineInfo ? self.debugInfo.fileNames[lineInfo[0]] :
        'unknown';
      const lineNo = lineInfo ? lineInfo[1] : 'unknown';

      frames.push([wordDef, address, fileName, lineNo]);
    }

    addEntry(this.pc - CELL_SIZE);
    for (let i = this.returnStack.length - 1; i >= 0; i--) {
      addEntry(this.returnStack[i] - CELL_SIZE);
    }

    return frames;
  }
}
