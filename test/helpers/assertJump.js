/* global assert */
// See https://github.com/OpenZeppelin/zeppelin-solidity/blob/master/test/helpers/assertJump.js
export default function assertJump (error) {
  assert.isAbove(error.message.search("invalid opcode"), -1);
}
